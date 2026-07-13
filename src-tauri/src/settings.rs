use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeSet, fs};

use crate::paths::{expand_home, write_json_atomic};
use crate::{config_path, resolve_config, scan_documents_inner, AppState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigRoot {
    path: String,
    expanded_path: String,
    exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigInfo {
    config_path: String,
    roots: Vec<ConfigRoot>,
    explicit_roots: bool,
    share_server_url: String,
    warnings: Vec<String>,
}

#[tauri::command]
pub(crate) fn get_config_info() -> Result<ConfigInfo, String> {
    describe_config()
}

#[tauri::command]
pub(crate) fn update_settings(
    roots: Vec<String>,
    share_server_url: String,
    state: tauri::State<'_, AppState>,
) -> Result<ConfigInfo, String> {
    let roots = normalize_roots(roots);
    if roots.is_empty() {
        return Err("At least one workspace root is required.".to_string());
    }
    let share_server_url = normalize_share_server_url(&share_server_url)?;
    let path = config_path();
    let mut value = match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<Value>(&raw)
            .map_err(|_| format!("Config file could not be parsed: {}", path.display()))?,
        Err(_) => serde_json::json!({}),
    };
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Config file must contain a JSON object.".to_string())?;
    object.insert(
        "roots".to_string(),
        serde_json::to_value(&roots).map_err(|error| error.to_string())?,
    );
    if let Some(sources) = object.get_mut("sources").and_then(Value::as_array_mut) {
        for source in sources {
            if source.get("mode").and_then(Value::as_str) == Some("repositories") {
                if let Some(source_object) = source.as_object_mut() {
                    source_object.insert(
                        "roots".to_string(),
                        serde_json::to_value(&roots).map_err(|error| error.to_string())?,
                    );
                }
            }
        }
    }
    if let Some(url) = share_server_url {
        object.insert("shareServerUrl".to_string(), Value::String(url));
    } else {
        object.remove("shareServerUrl");
    }
    write_json_atomic(&path, &value, true)?;

    let docs = scan_documents_inner(&resolve_config()?)?;
    *state
        .cached_docs
        .lock()
        .map_err(|error| error.to_string())? = docs;
    describe_config()
}

fn describe_config() -> Result<ConfigInfo, String> {
    let path = config_path();
    let mut warnings = Vec::new();
    let stored = match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(value) => value,
            Err(_) => {
                warnings.push(format!(
                    "Config file could not be parsed: {}",
                    path.display()
                ));
                Value::Null
            }
        },
        Err(_) => Value::Null,
    };
    let resolved = resolve_config()?;
    let roots = stored
        .get("roots")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            resolved
                .roots
                .iter()
                .map(|root| root.to_string_lossy().to_string())
                .collect()
        })
        .into_iter()
        .map(|root| {
            let expanded = expand_home(&root);
            ConfigRoot {
                path: root,
                expanded_path: expanded.to_string_lossy().to_string(),
                exists: expanded.is_dir(),
            }
        })
        .collect();
    Ok(ConfigInfo {
        config_path: path.to_string_lossy().to_string(),
        roots,
        explicit_roots: false,
        share_server_url: resolved.share_server_url.unwrap_or_default(),
        warnings,
    })
}

fn normalize_roots(roots: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    roots
        .into_iter()
        .map(|root| root.trim().to_string())
        .filter(|root| !root.is_empty())
        .filter(|root| seen.insert(expand_home(root).to_string_lossy().to_string()))
        .collect()
}

fn normalize_share_server_url(value: &str) -> Result<Option<String>, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(None);
    }
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| "Share server URL must be a valid URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Share server URL must use http or https.".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Share server URL must not include credentials.".to_string());
    }
    Ok(Some(parsed.to_string().trim_end_matches('/').to_string()))
}
