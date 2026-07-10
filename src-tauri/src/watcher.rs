use std::{
    collections::BTreeSet,
    path::{Component, Path, PathBuf},
    sync::mpsc::{channel, RecvTimeoutError},
    time::{Duration, Instant},
};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::{config_path, resolve_config, scan_documents_inner, AppState, SourceMode, SpecHubConfig};

const DEBOUNCE_MS: u64 = 500;
const WATCH_EXTENSIONS: &[&str] = &["md", "markdown", "html", "db"];

/// Start the filesystem watcher on a background thread. It mirrors the web
/// server's chokidar index (`src/index-service.ts`): watch the config file and
/// all source roots, debounce bursts for 500 ms, rescan, and emit a
/// `docs-changed` event so the frontend refreshes. All failures log and the
/// thread keeps running (or exits cleanly) — the manual refresh button remains
/// the fallback on locked-down systems (e.g. inotify limits).
pub(crate) fn start(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(error) = run(app) {
            eprintln!("SpecHub file watcher disabled: {error}");
        }
    });
}

fn run(app: AppHandle) -> Result<(), String> {
    let (tx, rx) = channel::<notify::Result<Event>>();
    let mut watcher: RecommendedWatcher =
        notify::recommended_watcher(move |result| {
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;

    let config_file = config_path();
    let mut config = resolve_config()?;
    let mut watched = watch_paths(&config, &config_file);
    register_paths(&mut watcher, &watched);

    let mut version: u32 = 0;

    loop {
        // Block until an event arrives (or the sender is dropped).
        let first = match rx.recv() {
            Ok(event) => event,
            Err(_) => return Ok(()),
        };
        let mut relevant = false;
        let mut config_changed = false;
        note_event(&first, &config, &config_file, &mut relevant, &mut config_changed);

        // Debounce: keep draining until DEBOUNCE_MS passes with no new event.
        let deadline = Instant::now() + Duration::from_millis(DEBOUNCE_MS);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match rx.recv_timeout(remaining) {
                Ok(event) => {
                    note_event(&event, &config, &config_file, &mut relevant, &mut config_changed);
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return Ok(()),
            }
        }

        if !relevant && !config_changed {
            continue;
        }

        let next_config = match resolve_config() {
            Ok(config) => config,
            Err(error) => {
                eprintln!("SpecHub config reload failed: {error}");
                continue;
            }
        };
        match scan_documents_inner(&next_config) {
            Ok(docs) => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut cached) = state.cached_docs.lock() {
                        *cached = docs;
                    }
                }
                version = version.wrapping_add(1);
                let _ = app.emit("docs-changed", serde_json::json!({ "version": version }));
            }
            Err(error) => {
                eprintln!("SpecHub rescan failed: {error}");
                continue;
            }
        }

        if config_changed {
            let next_paths = watch_paths(&next_config, &config_file);
            if next_paths != watched {
                for path in &watched {
                    let _ = watcher.unwatch(path);
                }
                register_paths(&mut watcher, &next_paths);
                watched = next_paths;
            }
        }
        config = next_config;
    }
}

fn note_event(
    event: &notify::Result<Event>,
    config: &SpecHubConfig,
    config_file: &Path,
    relevant: &mut bool,
    config_changed: &mut bool,
) {
    let Ok(event) = event else { return };
    if event.paths.iter().any(|path| path == config_file) {
        *config_changed = true;
    }
    if event_is_relevant(event, config) {
        *relevant = true;
    }
}

fn event_is_relevant(event: &Event, config: &SpecHubConfig) -> bool {
    let structural = matches!(event.kind, EventKind::Create(_) | EventKind::Remove(_));
    for path in &event.paths {
        if path_is_ignored(path, &config.ignore_patterns) {
            continue;
        }
        if has_watched_extension(path) {
            return true;
        }
        // Directory add/remove restructures the tree; extensionless create/remove
        // events are treated as likely directory changes (matches chokidar's
        // addDir/unlinkDir handling closely enough).
        if structural && (path.is_dir() || path.extension().is_none()) {
            return true;
        }
    }
    false
}

fn has_watched_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .map(|ext| WATCH_EXTENSIONS.contains(&ext.as_str()))
        .unwrap_or(false)
}

fn path_is_ignored(path: &Path, ignore_patterns: &[String]) -> bool {
    let simple: Vec<&str> = ignore_patterns
        .iter()
        .filter(|pattern| !pattern.contains('*') && !pattern.contains('/'))
        .map(String::as_str)
        .collect();
    path.components().any(|component| {
        if let Component::Normal(segment) = component {
            if let Some(text) = segment.to_str() {
                return simple.contains(&text);
            }
        }
        false
    })
}

/// Compute the set of paths to watch, mirroring `watchPathsForConfig`
/// (`src/index-service.ts`): the config file, every root, and each source root
/// (opencode-db sources watch `<root>/opencode.db`).
fn watch_paths(config: &SpecHubConfig, config_file: &Path) -> Vec<PathBuf> {
    let mut paths: BTreeSet<PathBuf> = BTreeSet::new();
    paths.insert(config_file.to_path_buf());
    for root in &config.roots {
        paths.insert(root.clone());
    }
    for source in &config.sources {
        for root in &source.roots {
            let ends_with_db = root.extension().and_then(|ext| ext.to_str()) == Some("db");
            if matches!(source.mode, SourceMode::OpencodeDb) && !ends_with_db {
                paths.insert(root.join("opencode.db"));
            } else {
                paths.insert(root.clone());
            }
        }
    }
    paths.into_iter().collect()
}

fn register_paths(watcher: &mut RecommendedWatcher, paths: &[PathBuf]) {
    for path in paths {
        if !path.exists() {
            continue;
        }
        if let Err(error) = watcher.watch(path, RecursiveMode::Recursive) {
            eprintln!("SpecHub watch failed for {}: {error}", path.display());
        }
    }
}
