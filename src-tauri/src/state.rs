use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::paths::{resolve_like_node, spechub_config_dir, write_json_atomic};
use crate::AppState;

/// Dashboard state shared with the web server, stored at
/// `~/.config/spechub/state.json`. Mirrors `SpecHubState` in `src/state.ts`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpecHubState {
    pub favorites: Vec<String>,
    pub tags: BTreeMap<String, Vec<String>>,
    pub hidden_repos: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatePatch {
    pub favorites: Option<Vec<String>>,
    pub tags: Option<BTreeMap<String, Vec<String>>>,
    pub hidden_repos: Option<Vec<String>>,
}

pub(crate) fn state_path() -> PathBuf {
    spechub_config_dir().join("state.json")
}

/// Read and normalize the state file. Missing or unparseable files yield empty
/// state, and each field is normalized independently (like `normalizeState` in
/// `src/state.ts`), so a single malformed field does not discard the rest.
pub(crate) fn read_state_file(path: &Path) -> SpecHubState {
    let value = fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or(Value::Null);
    normalize_state(&value)
}

pub(crate) fn update_state_file(path: &Path, patch: StatePatch) -> Result<SpecHubState, String> {
    let existing = read_state_file(path);
    let mut merged = serde_json::json!({
        "favorites": existing.favorites,
        "tags": existing.tags,
        "hiddenRepos": existing.hidden_repos,
    });
    if let Some(favorites) = patch.favorites {
        merged["favorites"] = serde_json::to_value(favorites).map_err(|error| error.to_string())?;
    }
    if let Some(tags) = patch.tags {
        merged["tags"] = serde_json::to_value(tags).map_err(|error| error.to_string())?;
    }
    if let Some(hidden_repos) = patch.hidden_repos {
        merged["hiddenRepos"] =
            serde_json::to_value(hidden_repos).map_err(|error| error.to_string())?;
    }

    let normalized = normalize_state(&merged);
    write_json_atomic(path, &normalized, true)?;
    Ok(normalized)
}

fn normalize_state(value: &Value) -> SpecHubState {
    let object = value.as_object();
    SpecHubState {
        favorites: normalize_paths(object.and_then(|map| map.get("favorites"))),
        tags: normalize_tags(object.and_then(|map| map.get("tags"))),
        hidden_repos: normalize_names(object.and_then(|map| map.get("hiddenRepos"))),
    }
}

fn normalize_paths(value: Option<&Value>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    if let Some(array) = value.and_then(Value::as_array) {
        for item in array {
            if let Some(raw) = item.as_str() {
                let trimmed = raw.trim();
                if !trimmed.is_empty() {
                    seen.insert(resolve_like_node(trimmed).to_string_lossy().to_string());
                }
            }
        }
    }
    seen.into_iter().collect()
}

fn normalize_names(value: Option<&Value>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    if let Some(array) = value.and_then(Value::as_array) {
        for item in array {
            if let Some(raw) = item.as_str() {
                let trimmed = raw.trim();
                if !trimmed.is_empty() {
                    seen.insert(trimmed.to_string());
                }
            }
        }
    }
    seen.into_iter().collect()
}

fn normalize_tags(value: Option<&Value>) -> BTreeMap<String, Vec<String>> {
    let mut result = BTreeMap::new();
    if let Some(object) = value.and_then(Value::as_object) {
        for (key, raw_tags) in object {
            let tags = normalize_names(Some(raw_tags));
            if !tags.is_empty() {
                result.insert(resolve_like_node(key).to_string_lossy().to_string(), tags);
            }
        }
    }
    result
}

#[tauri::command]
pub(crate) fn get_state() -> Result<SpecHubState, String> {
    Ok(read_state_file(&state_path()))
}

#[tauri::command]
pub(crate) fn patch_state(
    patch: StatePatch,
    app_state: tauri::State<'_, AppState>,
) -> Result<SpecHubState, String> {
    let _guard = app_state
        .state_lock
        .lock()
        .map_err(|error| error.to_string())?;
    update_state_file(&state_path(), patch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_empty_state_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let state = read_state_file(&dir.path().join("state.json"));
        assert!(state.favorites.is_empty());
        assert!(state.tags.is_empty());
        assert!(state.hidden_repos.is_empty());
    }

    #[test]
    fn normalizes_dedupes_and_sorts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let patch = StatePatch {
            hidden_repos: Some(vec![
                "beta".to_string(),
                "alpha".to_string(),
                "beta".to_string(),
                "  ".to_string(),
            ]),
            ..Default::default()
        };
        let saved = update_state_file(&path, patch).unwrap();
        assert_eq!(saved.hidden_repos, vec!["alpha".to_string(), "beta".to_string()]);

        // File is 2-space pretty JSON with a trailing newline (web-compatible).
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.ends_with("}\n"));
        assert!(raw.contains("  \"hiddenRepos\""));
    }

    #[test]
    fn patch_merges_over_existing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        update_state_file(
            &path,
            StatePatch {
                hidden_repos: Some(vec!["repo".to_string()]),
                ..Default::default()
            },
        )
        .unwrap();
        let merged = update_state_file(
            &path,
            StatePatch {
                favorites: Some(vec!["/tmp/a/../a/doc.md".to_string()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(merged.hidden_repos, vec!["repo".to_string()]);
        assert_eq!(merged.favorites, vec!["/tmp/a/doc.md".to_string()]);
    }

    #[test]
    fn drops_empty_tag_lists() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let mut tags = BTreeMap::new();
        tags.insert("/tmp/doc.md".to_string(), vec!["important".to_string()]);
        tags.insert("/tmp/empty.md".to_string(), Vec::new());
        let saved = update_state_file(
            &path,
            StatePatch {
                tags: Some(tags),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(saved.tags.len(), 1);
        assert!(saved.tags.contains_key("/tmp/doc.md"));
    }
}
