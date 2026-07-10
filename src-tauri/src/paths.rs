use std::{
    env,
    ffi::OsString,
    fs,
    path::{Component, Path, PathBuf},
};

use serde::Serialize;

/// Expand a leading `~`/`~/` to the user's home directory. Mirrors the TS
/// `expandHome` helper in `src/paths.ts` and is used on every platform.
pub(crate) fn expand_home(input: &str) -> PathBuf {
    if input == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(input));
    }
    if let Some(rest) = input.strip_prefix("~/") {
        return dirs::home_dir()
            .map(|home| home.join(rest))
            .unwrap_or_else(|| PathBuf::from(input));
    }
    PathBuf::from(input)
}

/// SpecHub's config/state directory. Intentionally `~/.config/spechub` on every
/// platform so the desktop app shares config, state, and annotation files with
/// the Node CLI/server. Do NOT switch to `dirs::config_dir()`.
pub(crate) fn spechub_config_dir() -> PathBuf {
    expand_home("~/.config/spechub")
}

/// Resolve a path the way Node's `path.resolve(expandHome(input))` does:
/// expand `~`, make it absolute against the current working directory, and
/// collapse `.`/`..` components lexically (without resolving symlinks). Native
/// separators are preserved, matching the TS `normalizeOverridePath`.
pub(crate) fn resolve_like_node(input: &str) -> PathBuf {
    let expanded = expand_home(input);
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        env::current_dir()
            .map(|cwd| cwd.join(&expanded))
            .unwrap_or(expanded)
    };
    normalize_lexically(&absolute)
}

fn normalize_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() && out.as_os_str().is_empty() {
                    // Only keep `..` for a relative accumulator; at a root/prefix
                    // `..` has no effect (matches path.resolve).
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Atomically write a value as pretty (2-space) JSON via a `<path>.tmp` file and
/// a rename, matching the TS `mutateJsonFile`. `trailing_newline` controls the
/// terminating `\n`: state/config files use `true`, annotation files use `false`.
pub(crate) fn write_json_atomic<T: Serialize>(
    path: &Path,
    value: &T,
    trailing_newline: bool,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut serialized = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    if trailing_newline {
        serialized.push('\n');
    }

    let mut temp_os: OsString = path.as_os_str().to_owned();
    temp_os.push(".tmp");
    let temp_path = PathBuf::from(temp_os);
    fs::write(&temp_path, serialized).map_err(|error| error.to_string())?;
    fs::rename(&temp_path, path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapses_dot_and_dotdot() {
        assert_eq!(resolve_like_node("/a/b/../c/./d"), PathBuf::from("/a/c/d"));
    }

    #[test]
    fn dotdot_at_root_is_noop() {
        assert_eq!(resolve_like_node("/.."), PathBuf::from("/"));
    }

    #[test]
    fn writes_json_with_trailing_newline() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("nested").join("state.json");
        write_json_atomic(&target, &serde_json::json!({ "a": 1 }), true).unwrap();
        let raw = fs::read_to_string(&target).unwrap();
        assert!(raw.ends_with("}\n"));
        assert!(!dir.path().join("nested").join("state.json.tmp").exists());
    }

    #[test]
    fn writes_json_without_trailing_newline() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("annotations.json");
        write_json_atomic(&target, &serde_json::json!([]), false).unwrap();
        let raw = fs::read_to_string(&target).unwrap();
        assert!(raw.ends_with("]"));
    }
}
