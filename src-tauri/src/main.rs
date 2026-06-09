use chrono::{DateTime, Utc};
use globset::{Glob, GlobSet, GlobSetBuilder};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};
use walkdir::WalkDir;

mod opencode;

const DEFAULT_IGNORE_PATTERNS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    "vendor",
    ".trash",
];

const DEFAULT_DOC_PATTERNS: &[&str] = &[
    "docs/**/*.{md,markdown,html}",
    "docs/superpowers/**/*.{md,html}",
    "docs/supperspowers/**/*.{md,html}",
    "docs/plans/**/*.md",
    "docs/specs/**/*.{md,html}",
    "specs/**/*.{md,html}",
    "Spec.md",
    "spec.md",
    "plan.md",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DocumentKind {
    Markdown,
    Html,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DocumentCategory {
    Plan,
    Spec,
    Superpowers,
    Doc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub(crate) enum DocumentContentSource {
    File,
    #[serde(rename_all = "camelCase")]
    OpencodeDb {
        db_path: String,
        session_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentMeta {
    pub id: String,
    pub title: String,
    pub source_title: String,
    pub kind: DocumentKind,
    pub category: DocumentCategory,
    pub source_name: String,
    pub absolute_path: String,
    pub relative_path: String,
    pub repo_name: String,
    pub repo_root: String,
    pub modified_at: String,
    pub mtime_ms: f64,
    pub size_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_source: Option<DocumentContentSource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentDetail {
    #[serde(flatten)]
    meta: DocumentMeta,
    raw_url: Option<String>,
    raw_content: String,
}

#[derive(Debug, Clone, Serialize)]
struct RepoSummary {
    name: String,
    count: usize,
}

#[derive(Debug, Clone, Serialize)]
struct ScanPayload {
    docs: Vec<DocumentMeta>,
    repos: Vec<RepoSummary>,
}

#[derive(Debug, Clone, Serialize)]
struct DetailPayload {
    doc: DocumentDetail,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SourceMode {
    Repositories,
    Direct,
    OpencodeDb,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialSourceConfig {
    name: String,
    mode: SourceMode,
    roots: Vec<String>,
    patterns: Vec<String>,
    infer_repo_from_content: Option<bool>,
    default_category: Option<DocumentCategory>,
}

#[derive(Debug, Clone)]
pub(crate) struct SourceConfig {
    pub name: String,
    pub mode: SourceMode,
    pub roots: Vec<PathBuf>,
    pub patterns: Vec<String>,
    pub infer_repo_from_content: bool,
    pub default_category: Option<DocumentCategory>,
}

#[derive(Debug, Clone)]
pub(crate) struct RepoHint {
    pub root: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialConfig {
    roots: Option<Vec<String>>,
    ignore_patterns: Option<Vec<String>>,
    doc_patterns: Option<Vec<String>>,
    sources: Option<Vec<PartialSourceConfig>>,
    title_overrides: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone)]
struct SpecHubConfig {
    roots: Vec<PathBuf>,
    ignore_patterns: Vec<String>,
    doc_patterns: Vec<String>,
    sources: Vec<SourceConfig>,
    title_overrides: BTreeMap<String, String>,
}

#[derive(Default)]
struct AppState {
    cached_docs: Mutex<Vec<DocumentMeta>>,
}

#[tauri::command]
fn scan_documents(state: tauri::State<'_, AppState>) -> Result<ScanPayload, String> {
    let docs = scan_documents_inner(&resolve_config()?)?;
    *state.cached_docs.lock().map_err(|error| error.to_string())? = docs.clone();
    Ok(ScanPayload {
        repos: summarize_repos(&docs),
        docs,
    })
}

#[tauri::command]
fn get_document(id: String, state: tauri::State<'_, AppState>) -> Result<DetailPayload, String> {
    let doc = find_document(&state, &id)?;
    let raw_content = read_document_content(&doc)?;

    Ok(DetailPayload {
        doc: DocumentDetail {
            meta: doc,
            raw_url: None,
            raw_content,
        },
    })
}

#[tauri::command]
fn read_raw_document(id: String, state: tauri::State<'_, AppState>) -> Result<String, String> {
    let doc = find_document(&state, &id)?;
    read_document_content(&doc)
}

#[tauri::command]
fn open_document_source(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let doc = find_document(&state, &id)?;
    open_path(&open_target(&doc).to_string_lossy())
}

#[tauri::command]
fn open_document_folder(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let doc = find_document(&state, &id)?;
    let target = open_target(&doc);
    let folder = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "Document folder not found".to_string())?
    };
    open_path(&folder.to_string_lossy())
}

#[tauri::command]
fn update_document_title(id: String, title: String, state: tauri::State<'_, AppState>) -> Result<DetailPayload, String> {
    let doc = find_document(&state, &id)?;
    write_title_override(&doc.absolute_path, &title)?;
    let docs = scan_documents_inner(&resolve_config()?)?;
    *state.cached_docs.lock().map_err(|error| error.to_string())? = docs.clone();
    let updated = docs
        .into_iter()
        .find(|candidate| candidate.id == id)
        .ok_or_else(|| "Document not found".to_string())?;
    let raw_content = read_document_content(&updated)?;

    Ok(DetailPayload {
        doc: DocumentDetail {
            meta: updated,
            raw_url: None,
            raw_content,
        },
    })
}

fn read_document_content(doc: &DocumentMeta) -> Result<String, String> {
    if let Some(DocumentContentSource::OpencodeDb { db_path, session_id }) = &doc.content_source {
        return opencode::read_opencode_plan_content(db_path, session_id);
    }
    if let Some((db_path, session_id)) = opencode::parse_synthetic_path(&doc.absolute_path) {
        return opencode::read_opencode_plan_content(&db_path, &session_id);
    }
    fs::read_to_string(&doc.absolute_path).map_err(|error| error.to_string())
}

fn open_target(doc: &DocumentMeta) -> PathBuf {
    let is_opencode_db = matches!(
        doc.content_source,
        Some(DocumentContentSource::OpencodeDb { .. })
    ) || opencode::parse_synthetic_path(&doc.absolute_path).is_some();

    if is_opencode_db {
        let repo_root = PathBuf::from(&doc.repo_root);
        if repo_root.exists() {
            return repo_root;
        }
        if let Some(DocumentContentSource::OpencodeDb { db_path, .. }) = &doc.content_source {
            if let Some(parent) = Path::new(db_path).parent() {
                return parent.to_path_buf();
            }
        }
        if let Some((db_path, _)) = opencode::parse_synthetic_path(&doc.absolute_path) {
            if let Some(parent) = Path::new(&db_path).parent() {
                return parent.to_path_buf();
            }
        }
    }

    PathBuf::from(&doc.absolute_path)
}

fn find_cached_document(state: &tauri::State<'_, AppState>, id: &str) -> Result<Option<DocumentMeta>, String> {
    Ok(state
        .cached_docs
        .lock()
        .map_err(|error| error.to_string())?
        .iter()
        .find(|candidate| candidate.id == id)
        .cloned())
}

fn find_document(state: &tauri::State<'_, AppState>, id: &str) -> Result<DocumentMeta, String> {
    if let Some(doc) = find_cached_document(state, id)? {
        return Ok(doc);
    }

    let docs = scan_documents_inner(&resolve_config()?)?;
    *state.cached_docs.lock().map_err(|error| error.to_string())? = docs.clone();
    docs.into_iter()
        .find(|candidate| candidate.id == id)
        .ok_or_else(|| "Document not found".to_string())
}

fn scan_documents_inner(config: &SpecHubConfig) -> Result<Vec<DocumentMeta>, String> {
    let mut docs = Vec::new();
    let repo_hints = create_repo_hints(&config.roots, &config.ignore_patterns);

    for source in &config.sources {
        scan_source(source, config, &repo_hints, &mut docs)?;
    }

    docs.sort_by(|left, right| {
        right
            .mtime_ms
            .partial_cmp(&left.mtime_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.repo_name.cmp(&right.repo_name))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    Ok(docs)
}

fn scan_source(
    source: &SourceConfig,
    config: &SpecHubConfig,
    repo_hints: &[RepoHint],
    docs: &mut Vec<DocumentMeta>,
) -> Result<(), String> {
    match source.mode {
        SourceMode::Repositories => {
            let doc_matcher = build_globset(&source.patterns)?;
            let repo_roots = discover_repository_roots(&source.roots, &config.ignore_patterns);
            for repo_root in repo_roots {
                scan_repository(&repo_root, &doc_matcher, config, &source.name, &[], source.default_category, None, docs);
            }
        }
        SourceMode::Direct => {
            let doc_matcher = build_globset(&source.patterns)?;
            for root in &source.roots {
                if root.exists() {
                    scan_repository(
                        root,
                        &doc_matcher,
                        config,
                        &source.name,
                        if source.infer_repo_from_content { repo_hints } else { &[] },
                        source.default_category,
                        Some(&source.name),
                        docs,
                    );
                }
            }
        }
        SourceMode::OpencodeDb => {
            let mut plan_docs =
                opencode::scan_opencode_plan_source(source, &config.title_overrides, repo_hints);
            docs.append(&mut plan_docs);
        }
    }

    Ok(())
}

fn create_repo_hints(roots: &[PathBuf], ignore_patterns: &[String]) -> Vec<RepoHint> {
    discover_repository_roots(roots, ignore_patterns)
        .into_iter()
        .map(|root| RepoHint {
            name: root
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| root.to_string_lossy().to_string()),
            root: normalize_path(&root),
        })
        .collect()
}

fn resolve_config() -> Result<SpecHubConfig, String> {
    let base = default_config();
    let file_config = read_config_file();
    let has_scan_overrides = file_config.roots.is_some() || file_config.doc_patterns.is_some() || file_config.sources.is_some();
    let roots = file_config
        .roots
        .unwrap_or_else(|| base.roots.iter().map(|path| path.to_string_lossy().to_string()).collect())
        .into_iter()
        .map(|path| expand_home(&path))
        .collect::<Vec<_>>();
    let ignore_patterns = file_config.ignore_patterns.unwrap_or(base.ignore_patterns);
    let doc_patterns = file_config.doc_patterns.unwrap_or(base.doc_patterns);
    let sources = if has_scan_overrides {
        normalize_sources(file_config.sources, &roots, &doc_patterns)
    } else {
        base.sources
    };

    Ok(SpecHubConfig {
        roots,
        ignore_patterns,
        doc_patterns,
        sources,
        title_overrides: normalize_title_overrides(file_config.title_overrides.unwrap_or_default()),
    })
}

fn default_config() -> SpecHubConfig {
    let roots = vec![expand_home("~/workspace"), expand_home("~/.multica/server")];
    let doc_patterns = DEFAULT_DOC_PATTERNS.iter().map(|item| item.to_string()).collect::<Vec<_>>();
    SpecHubConfig {
        sources: vec![
            SourceConfig {
                name: "repositories".to_string(),
                mode: SourceMode::Repositories,
                roots: roots.clone(),
                patterns: doc_patterns.clone(),
                infer_repo_from_content: false,
                default_category: None,
            },
            SourceConfig {
                name: "claude-plans".to_string(),
                mode: SourceMode::Direct,
                roots: vec![expand_home("~/.claude/plans")],
                patterns: vec!["*.md".to_string(), "*.markdown".to_string()],
                infer_repo_from_content: true,
                default_category: Some(DocumentCategory::Plan),
            },
            SourceConfig {
                name: "opencode-plan-sessions".to_string(),
                mode: SourceMode::OpencodeDb,
                roots: vec![expand_home("~/.local/share/opencode")],
                patterns: Vec::new(),
                infer_repo_from_content: true,
                default_category: Some(DocumentCategory::Plan),
            },
        ],
        roots,
        ignore_patterns: DEFAULT_IGNORE_PATTERNS.iter().map(|item| item.to_string()).collect(),
        doc_patterns,
        title_overrides: BTreeMap::new(),
    }
}

fn read_config_file() -> PartialConfig {
    fs::read_to_string(config_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<PartialConfig>(&raw).ok())
        .unwrap_or(PartialConfig {
            roots: None,
            ignore_patterns: None,
            doc_patterns: None,
            sources: None,
            title_overrides: None,
        })
}

fn normalize_sources(
    sources: Option<Vec<PartialSourceConfig>>,
    roots: &[PathBuf],
    doc_patterns: &[String],
) -> Vec<SourceConfig> {
    if let Some(sources) = sources.filter(|sources| !sources.is_empty()) {
        return sources
            .into_iter()
            .map(|source| SourceConfig {
                name: source.name,
                mode: source.mode,
                roots: source.roots.into_iter().map(|root| expand_home(&root)).collect(),
                patterns: source.patterns,
                infer_repo_from_content: source.infer_repo_from_content.unwrap_or(false),
                default_category: source.default_category,
            })
            .collect();
    }

    vec![SourceConfig {
        name: "repositories".to_string(),
        mode: SourceMode::Repositories,
        roots: roots.to_vec(),
        patterns: doc_patterns.to_vec(),
        infer_repo_from_content: false,
        default_category: None,
    }]
}

fn discover_repository_roots(roots: &[PathBuf], ignore_patterns: &[String]) -> Vec<PathBuf> {
    let mut discovered = BTreeSet::new();
    for root in roots {
        if root.exists() {
            walk_for_repos(root, root, ignore_patterns, &mut discovered, 0);
        }
    }
    discovered.into_iter().collect()
}

fn walk_for_repos(
    directory: &Path,
    scan_root: &Path,
    ignore_patterns: &[String],
    discovered: &mut BTreeSet<PathBuf>,
    depth: usize,
) {
    if depth > 6 {
        return;
    }

    if let Ok(relative) = directory.strip_prefix(scan_root) {
        if !relative.as_os_str().is_empty() && is_ignored(&normalize_path(relative), ignore_patterns) {
            return;
        }
    }

    if is_repository_like(directory) {
        discovered.insert(directory.to_path_buf());
        return;
    }

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_for_repos(&path, scan_root, ignore_patterns, discovered, depth + 1);
        }
    }
}

fn is_repository_like(directory: &Path) -> bool {
    [".git", "package.json", "pnpm-workspace.yaml", "docs", "specs"]
        .iter()
        .any(|marker| directory.join(marker).exists())
}

fn scan_repository(
    repo_root: &Path,
    doc_matcher: &GlobSet,
    config: &SpecHubConfig,
    source_name: &str,
    repo_hints: &[RepoHint],
    default_category: Option<DocumentCategory>,
    repo_name_override: Option<&str>,
    docs: &mut Vec<DocumentMeta>,
) {
    for entry in WalkDir::new(repo_root).follow_links(false).into_iter().filter_entry(|entry| {
        if entry.path() == repo_root {
            return true;
        }
        entry
            .path()
            .strip_prefix(repo_root)
            .map(|relative| !is_ignored(&normalize_path(relative), &config.ignore_patterns))
            .unwrap_or(true)
    }) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() {
            continue;
        }

        let relative = match entry.path().strip_prefix(repo_root) {
            Ok(relative) => normalize_path(relative),
            Err(_) => continue,
        };

        if doc_matcher.is_match(&relative) {
            if let Some(doc) = create_document_meta(
                repo_root,
                entry.path(),
                &relative,
                config,
                source_name,
                repo_hints,
                default_category,
                repo_name_override,
            ) {
                docs.push(doc);
            }
        }
    }
}

fn create_document_meta(
    repo_root: &Path,
    absolute_path: &Path,
    relative_path: &str,
    config: &SpecHubConfig,
    source_name: &str,
    repo_hints: &[RepoHint],
    default_category: Option<DocumentCategory>,
    repo_name_override: Option<&str>,
) -> Option<DocumentMeta> {
    let kind = match absolute_path.extension().and_then(|extension| extension.to_str()) {
        Some("html") => DocumentKind::Html,
        Some("md") | Some("markdown") => DocumentKind::Markdown,
        _ => DocumentKind::Markdown,
    };
    let metadata = fs::metadata(absolute_path).ok()?;
    let raw = fs::read_to_string(absolute_path).ok()?;
    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let mtime_ms = modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    let modified_at = DateTime::<Utc>::from(modified).to_rfc3339();
    let source_title = extract_title(&raw, relative_path, &kind);
    let override_key = normalize_override_path(&absolute_path.to_string_lossy());
    let title = config
        .title_overrides
        .get(&override_key)
        .cloned()
        .unwrap_or_else(|| source_title.clone());

    Some(DocumentMeta {
        id: document_id(absolute_path),
        title,
        source_title,
        kind,
        category: default_category.unwrap_or_else(|| infer_category(relative_path)),
        source_name: source_name.to_string(),
        absolute_path: absolute_path.to_string_lossy().to_string(),
        relative_path: relative_path.to_string(),
        repo_name: infer_repo_name(&raw, repo_hints).or_else(|| repo_name_override.map(ToString::to_string)).unwrap_or_else(|| {
            repo_root
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| repo_root.to_string_lossy().to_string())
        }),
        repo_root: repo_root.to_string_lossy().to_string(),
        modified_at,
        mtime_ms,
        size_bytes: metadata.len(),
        content_source: Some(DocumentContentSource::File),
    })
}

fn extract_title(raw: &str, relative_path: &str, kind: &DocumentKind) -> String {
    match kind {
        DocumentKind::Markdown => {
            if let Some(captures) = Regex::new(r"(?m)^#\s+(.+)$").ok().and_then(|regex| regex.captures(raw)) {
                if let Some(title) = captures.get(1) {
                    return clean_title(title.as_str());
                }
            }
        }
        DocumentKind::Html => {
            for pattern in [r"(?is)<title[^>]*>(.*?)</title>", r"(?is)<h1[^>]*>(.*?)</h1>"] {
                if let Some(captures) = Regex::new(pattern).ok().and_then(|regex| regex.captures(raw)) {
                    if let Some(title) = captures.get(1) {
                        return clean_title(title.as_str());
                    }
                }
            }
        }
    }

    Path::new(relative_path)
        .file_stem()
        .map(|name| name.to_string_lossy().replace(['-', '_'], " "))
        .unwrap_or_else(|| relative_path.to_string())
}

fn infer_category(relative_path: &str) -> DocumentCategory {
    let normalized = relative_path.to_lowercase();
    if Regex::new(r"(^|/)(plans?|plan\.md)(/|$)")
        .map(|regex| regex.is_match(&normalized))
        .unwrap_or(false)
    {
        return DocumentCategory::Plan;
    }
    if Regex::new(r"(^|/)(specs?|spec\.md|spec\.html|spec\.markdown)(/|$)")
        .map(|regex| regex.is_match(&normalized))
        .unwrap_or(false)
    {
        return DocumentCategory::Spec;
    }
    if normalized.contains("superpowers") || normalized.contains("supperspowers") {
        return DocumentCategory::Superpowers;
    }
    DocumentCategory::Doc
}

fn infer_repo_name(raw: &str, repo_hints: &[RepoHint]) -> Option<String> {
    infer_repo_hint(raw, repo_hints).map(|repo| repo.name)
}

pub(crate) fn infer_repo_hint(raw: &str, repo_hints: &[RepoHint]) -> Option<RepoHint> {
    let normalized_raw = raw.replace('\\', "/");
    let mut hints = repo_hints.to_vec();
    hints.sort_by(|left, right| right.root.len().cmp(&left.root.len()));

    if let Some(repo) = hints.iter().find(|repo| normalized_raw.contains(&repo.root)) {
        return Some(repo.clone());
    }

    hints.into_iter().find(|repo| {
        Regex::new(&format!(r"(?i)(^|[^\w-]){}([^\w-]|$)", regex::escape(&repo.name)))
            .map(|regex| regex.is_match(raw))
            .unwrap_or(false)
    })
}

pub(crate) fn clean_title(input: &str) -> String {
    strip_tags(input)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn strip_tags(input: &str) -> String {
    Regex::new(r"<[^>]*>")
        .map(|regex| regex.replace_all(input, "").to_string())
        .unwrap_or_else(|_| input.to_string())
}

fn summarize_repos(docs: &[DocumentMeta]) -> Vec<RepoSummary> {
    let mut counts = BTreeMap::new();
    for doc in docs {
        *counts.entry(doc.repo_name.clone()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .map(|(name, count)| RepoSummary { name, count })
        .collect()
}

fn document_id(path: &Path) -> String {
    let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(resolved.to_string_lossy().as_bytes());
    hex::encode(hasher.finalize()).chars().take(20).collect()
}

fn build_globset(patterns: &[String]) -> Result<GlobSet, String> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(Glob::new(pattern).map_err(|error| error.to_string())?);
    }
    builder.build().map_err(|error| error.to_string())
}

fn is_ignored(relative_path: &str, ignore_patterns: &[String]) -> bool {
    let segments = relative_path.split('/').collect::<Vec<_>>();
    ignore_patterns.iter().any(|pattern| {
        if !pattern.contains('*') && !pattern.contains('/') {
            return segments.iter().any(|segment| segment == pattern);
        }
        false
    })
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub(crate) fn normalize_override_path(input: &str) -> String {
    let path = expand_home(input);
    let absolute = if path.is_absolute() {
        path
    } else {
        env::current_dir()
            .map(|current| current.join(path))
            .unwrap_or_else(|_| PathBuf::from(input))
    };
    normalize_path(&absolute)
}

fn normalize_title_overrides(overrides: BTreeMap<String, String>) -> BTreeMap<String, String> {
    overrides
        .into_iter()
        .filter_map(|(path, title)| {
            let trimmed = title.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some((normalize_override_path(&path), trimmed))
            }
        })
        .collect()
}

fn expand_home(input: &str) -> PathBuf {
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

fn config_path() -> PathBuf {
    expand_home("~/.config/spechub/config.json")
}

fn write_title_override(absolute_path: &str, title: &str) -> Result<(), String> {
    let path = config_path();
    let mut value = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));

    if !value.is_object() {
        value = serde_json::Value::Object(serde_json::Map::new());
    }

    let existing = value
        .get("titleOverrides")
        .cloned()
        .and_then(|overrides| serde_json::from_value::<BTreeMap<String, String>>(overrides).ok())
        .unwrap_or_default();
    let mut title_overrides = normalize_title_overrides(existing);
    let key = normalize_override_path(absolute_path);
    let trimmed = title.trim();

    if trimmed.is_empty() {
        title_overrides.remove(&key);
    } else {
        title_overrides.insert(key, trimmed.to_string());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    if let Some(object) = value.as_object_mut() {
        object.insert(
            "titleOverrides".to_string(),
            serde_json::to_value(title_overrides).map_err(|error| error.to_string())?,
        );
    }

    let temp_path = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    fs::write(&temp_path, format!("{raw}\n")).map_err(|error| error.to_string())?;
    fs::rename(temp_path, path).map_err(|error| error.to_string())
}

fn open_path(path: &str) -> Result<(), String> {
    open::that(path).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            scan_documents,
            get_document,
            read_raw_document,
            open_document_source,
            open_document_folder,
            update_document_title
        ])
        .run(tauri::generate_context!())
        .expect("error while running SpecHub");
}

fn main() {
    run();
}
