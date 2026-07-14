use chrono::Utc;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{fs, path::PathBuf};

use crate::paths::{spechub_config_dir, write_json_atomic};
use crate::{
    find_document, read_document_content, resolve_config, AppState, DocumentCategory, DocumentKind,
};

const MAX_SHARED_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedDocument {
    schema_version: u8,
    title: String,
    kind: DocumentKind,
    category: DocumentCategory,
    repo_name: String,
    relative_path: String,
    modified_at: String,
    content: String,
    published_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentShare {
    id: String,
    url: String,
    secret: String,
    #[serde(default)]
    server_url: Option<String>,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublicDocumentShare {
    id: String,
    url: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShareResponse {
    id: String,
    url: String,
    secret: Option<String>,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: Option<String>,
}

#[tauri::command]
pub(crate) fn get_document_share(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<PublicDocumentShare>, String> {
    find_document(&state, &id)?;
    Ok(read_document_share(&id).map(public_share))
}

#[tauri::command]
pub(crate) async fn share_document(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<PublicDocumentShare, String> {
    let document = find_document(&state, &id)?;
    let content = read_document_content(&document)?;
    if content.len() > MAX_SHARED_DOCUMENT_BYTES {
        return Err("Document is too large to share (2 MB maximum).".to_string());
    }
    let existing = read_document_share(&id);
    let share_server_url = existing
        .as_ref()
        .and_then(|share| share.server_url.clone())
        .or(resolve_config()?.share_server_url)
        .ok_or_else(|| {
            "Configure shareServerUrl in ~/.config/spechub/config.json before publishing."
                .to_string()
        })?;
    let snapshot = SharedDocument {
        schema_version: 1,
        title: document.title,
        kind: document.kind,
        category: document.category,
        repo_name: document.repo_name,
        relative_path: document.relative_path,
        modified_at: document.modified_at,
        content,
        published_at: Utc::now().to_rfc3339(),
    };
    let client = Client::new();
    let response = if let Some(share) = &existing {
        client
            .put(format!("{share_server_url}/api/shares/{}", share.id))
            .json(&serde_json::json!({ "secret": share.secret, "document": snapshot }))
            .send()
            .await
    } else {
        client
            .post(format!("{share_server_url}/api/shares"))
            .json(&serde_json::json!({ "document": snapshot }))
            .send()
            .await
    }
    .map_err(|error| format!("Unable to reach share server: {error}"))?;

    if !response.status().is_success() {
        return Err(response_error(response, "Unable to publish document.").await);
    }
    let payload = response
        .json::<ShareResponse>()
        .await
        .map_err(|_| "Share server returned an invalid response.".to_string())?;
    let share = DocumentShare {
        id: payload.id,
        url: payload.url,
        secret: payload
            .secret
            .or_else(|| existing.map(|item| item.secret))
            .ok_or_else(|| "Share server did not return a management secret.".to_string())?,
        server_url: Some(share_server_url),
        updated_at: payload.updated_at,
    };
    write_document_share(&id, &share)?;
    Ok(public_share(share))
}

#[tauri::command]
pub(crate) async fn unshare_document(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    find_document(&state, &id)?;
    let Some(share) = read_document_share(&id) else {
        return Ok(());
    };
    let share_server_url = share
        .server_url
        .clone()
        .or(resolve_config()?.share_server_url)
        .ok_or_else(|| "Configure the original shareServerUrl before unsharing.".to_string())?;
    let response = Client::new()
        .delete(format!("{share_server_url}/api/shares/{}", share.id))
        .json(&serde_json::json!({ "secret": share.secret }))
        .send()
        .await
        .map_err(|error| format!("Unable to reach share server: {error}"))?;
    if !response.status().is_success() && response.status() != StatusCode::NOT_FOUND {
        return Err(response_error(response, "Unable to remove public share.").await);
    }
    let path = share_path(&id);
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn read_document_share(doc_id: &str) -> Option<DocumentShare> {
    fs::read_to_string(share_path(doc_id))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

fn write_document_share(doc_id: &str, share: &DocumentShare) -> Result<(), String> {
    let path = share_path(doc_id);
    write_json_atomic(&path, share, true)?;
    #[cfg(unix)]
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn share_path(doc_id: &str) -> PathBuf {
    let digest = Sha256::digest(doc_id.as_bytes());
    spechub_config_dir()
        .join("shares")
        .join(format!("{}.json", &hex::encode(digest)[..40]))
}

fn public_share(share: DocumentShare) -> PublicDocumentShare {
    PublicDocumentShare {
        id: share.id,
        url: share.url,
        updated_at: share.updated_at,
    }
}

async fn response_error(response: reqwest::Response, fallback: &str) -> String {
    response
        .json::<ErrorResponse>()
        .await
        .ok()
        .and_then(|payload| payload.error)
        .unwrap_or_else(|| fallback.to_string())
}
