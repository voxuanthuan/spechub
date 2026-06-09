use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use chrono::{DateTime, Utc};
use hex::encode as hex_encode;
use rusqlite::{params, Connection, OpenFlags};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    clean_title, infer_repo_hint, normalize_override_path, DocumentCategory,
    DocumentContentSource, DocumentKind, DocumentMeta, RepoHint, SourceConfig,
};

const MAX_PLAN_SESSIONS: usize = 200;

#[derive(Debug, Clone)]
pub(crate) struct SessionRow {
    pub id: String,
    pub title: String,
    pub directory: Option<String>,
    pub time_created: Option<i64>,
    pub time_updated: Option<i64>,
}

pub(crate) fn scan_opencode_plan_source(
    source: &SourceConfig,
    title_overrides: &BTreeMap<String, String>,
    repo_hints: &[RepoHint],
) -> Vec<DocumentMeta> {
    let mut docs = Vec::new();
    for root in &source.roots {
        let db_path = resolve_db_path(root);
        match scan_db_path(&db_path, source, title_overrides, repo_hints) {
            Ok(mut found) => docs.append(&mut found),
            Err(error) => {
                eprintln!(
                    "spechub: skipping opencode plan db {}: {error}",
                    db_path.display()
                );
            }
        }
    }
    docs
}

pub(crate) fn read_opencode_plan_content(
    db_path: &str,
    session_id: &str,
) -> Result<String, String> {
    let conn = open_db(Path::new(db_path))?;
    let session = load_session(&conn, session_id)?
        .ok_or_else(|| format!("OpenCode plan session not found: {session_id}"))?;
    let text = read_assistant_text(&conn, session_id)?;
    Ok(format_plan_content(&session, &text))
}

pub(crate) fn parse_synthetic_path(absolute_path: &str) -> Option<(String, String)> {
    let (left, right) = absolute_path.rsplit_once('#')?;
    if !left.ends_with(".db") || right.is_empty() {
        return None;
    }
    Some((left.to_string(), right.to_string()))
}

fn scan_db_path(
    db_path: &Path,
    source: &SourceConfig,
    title_overrides: &BTreeMap<String, String>,
    repo_hints: &[RepoHint],
) -> Result<Vec<DocumentMeta>, String> {
    let metadata = fs::metadata(db_path).map_err(|error| error.to_string())?;
    let fallback_mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);

    let conn = open_db(db_path)?;
    if !has_required_tables(&conn)? {
        return Ok(Vec::new());
    }

    let sessions = list_plan_sessions(&conn)?;
    let mut docs = Vec::with_capacity(sessions.len());
    for session in sessions {
        let text = read_assistant_text(&conn, &session.id)?;
        if text.trim().is_empty() {
            continue;
        }
        docs.push(create_opencode_plan_meta(
            db_path,
            &session,
            &text,
            source,
            title_overrides,
            repo_hints,
            fallback_mtime_ms,
        ));
    }
    Ok(docs)
}

fn open_db(db_path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("open opencode db {}: {error}", db_path.display()))
}

fn has_required_tables(conn: &Connection) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session','message','part')",
        )
        .map_err(|error| error.to_string())?;
    let names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(names.len() == 3)
}

fn list_plan_sessions(conn: &Connection) -> Result<Vec<SessionRow>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, title, directory, time_created, time_updated
             FROM session
             WHERE agent = 'plan'
             ORDER BY COALESCE(time_updated, time_created, 0) DESC
             LIMIT {MAX_PLAN_SESSIONS}"
        ))
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], session_row_mapper)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

fn load_session(conn: &Connection, session_id: &str) -> Result<Option<SessionRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, directory, time_created, time_updated
             FROM session
             WHERE id = ?1 AND agent = 'plan'
             LIMIT 1",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query_map(params![session_id], session_row_mapper)
        .map_err(|error| error.to_string())?;
    match rows.next() {
        Some(Ok(row)) => Ok(Some(row)),
        Some(Err(error)) => Err(error.to_string()),
        None => Ok(None),
    }
}

fn session_row_mapper(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: row.get(0)?,
        title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        directory: row.get::<_, Option<String>>(2)?,
        time_created: row.get::<_, Option<i64>>(3)?,
        time_updated: row.get::<_, Option<i64>>(4)?,
    })
}

fn read_assistant_text(conn: &Connection, session_id: &str) -> Result<String, String> {
    let mut stmt = conn
        .prepare(
            "SELECT message.data AS message_data, part.data AS part_data
             FROM message
             JOIN part ON part.message_id = message.id
             WHERE message.session_id = ?1
             ORDER BY message.time_created ASC, part.id ASC",
        )
        .map_err(|error| error.to_string())?;

    let chunks: Vec<String> = stmt
        .query_map(params![session_id], |row| {
            let message_data: String = row.get(0)?;
            let part_data: String = row.get(1)?;
            Ok((message_data, part_data))
        })
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter_map(|(message_raw, part_raw)| {
            let message: Value = serde_json::from_str(&message_raw).ok()?;
            if message.get("role").and_then(Value::as_str) != Some("assistant") {
                return None;
            }
            let part: Value = serde_json::from_str(&part_raw).ok()?;
            if part.get("type").and_then(Value::as_str) != Some("text") {
                return None;
            }
            let text = part.get("text").and_then(Value::as_str)?.trim().to_string();
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        })
        .collect();

    Ok(chunks.join("\n\n---\n\n"))
}

fn create_opencode_plan_meta(
    db_path: &Path,
    session: &SessionRow,
    text: &str,
    source: &SourceConfig,
    title_overrides: &BTreeMap<String, String>,
    repo_hints: &[RepoHint],
    fallback_mtime_ms: f64,
) -> DocumentMeta {
    let resolved_db_path = db_path
        .canonicalize()
        .unwrap_or_else(|_| db_path.to_path_buf());
    let absolute_path = format!("{}#{}", resolved_db_path.to_string_lossy(), session.id);

    let cleaned_title = clean_title(&session.title);
    let source_title = if cleaned_title.is_empty() {
        "OpenCode Plan".to_string()
    } else {
        cleaned_title
    };

    let directory = session.directory.as_ref().map(|dir| {
        let path = PathBuf::from(dir);
        path.canonicalize().unwrap_or(path)
    });

    let (repo_root, repo_name) = if let Some(dir) = &directory {
        (
            dir.to_string_lossy().to_string(),
            dir.file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| dir.to_string_lossy().to_string()),
        )
    } else if let Some(hint) = infer_repo_hint(text, repo_hints) {
        (hint.root, hint.name)
    } else {
        let fallback_root = resolved_db_path
            .parent()
            .map(|parent| parent.to_string_lossy().to_string())
            .unwrap_or_else(|| resolved_db_path.to_string_lossy().to_string());
        (fallback_root, source.name.clone())
    };

    let mtime_ms = session
        .time_updated
        .or(session.time_created)
        .map(|value| value as f64)
        .unwrap_or(fallback_mtime_ms);
    let modified_at = mtime_to_rfc3339(mtime_ms);
    let formatted = format_plan_content(session, text);

    let override_key = normalize_override_path(&absolute_path);
    let title = title_overrides
        .get(&override_key)
        .cloned()
        .unwrap_or_else(|| source_title.clone());

    DocumentMeta {
        id: short_hash(&absolute_path),
        title,
        source_title,
        kind: DocumentKind::Markdown,
        category: source.default_category.unwrap_or(DocumentCategory::Plan),
        source_name: source.name.clone(),
        absolute_path,
        relative_path: format!("{}/{}.md", source.name, safe_filename(&session.id)),
        repo_name,
        repo_root,
        modified_at,
        mtime_ms,
        size_bytes: formatted.len() as u64,
        content_source: Some(DocumentContentSource::OpencodeDb {
            db_path: resolved_db_path.to_string_lossy().to_string(),
            session_id: session.id.clone(),
        }),
    }
}

fn format_plan_content(session: &SessionRow, text: &str) -> String {
    let cleaned_title = clean_title(&session.title);
    let title = if cleaned_title.is_empty() {
        "OpenCode Plan".to_string()
    } else {
        cleaned_title
    };

    let mut sections: Vec<String> = vec![format!("# {title}")];
    let mut meta = vec![format!("Session: `{}`", session.id)];
    if let Some(dir) = &session.directory {
        meta.push(format!("Directory: `{dir}`"));
    }
    sections.push(meta.join("\n"));
    let body = text.trim();
    if !body.is_empty() {
        sections.push(body.to_string());
    }
    sections.join("\n\n")
}

fn mtime_to_rfc3339(mtime_ms: f64) -> String {
    let millis = mtime_ms.max(0.0) as u64;
    let when = SystemTime::UNIX_EPOCH + Duration::from_millis(millis);
    DateTime::<Utc>::from(when).to_rfc3339()
}

fn safe_filename(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn resolve_db_path(root: &Path) -> PathBuf {
    if root
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("db"))
        .unwrap_or(false)
    {
        root.to_path_buf()
    } else {
        root.join("opencode.db")
    }
}

fn short_hash(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex_encode(hasher.finalize()).chars().take(20).collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use rusqlite::Connection;
    use serde_json::json;
    use tempfile::TempDir;

    use super::*;
    use crate::{SourceConfig, SourceMode};

    fn build_schema(conn: &Connection) {
        conn.execute_batch(
            r#"
            CREATE TABLE session (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                directory TEXT,
                agent TEXT,
                time_created INTEGER,
                time_updated INTEGER
            );
            CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                time_created INTEGER,
                data TEXT NOT NULL
            );
            CREATE TABLE part (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                data TEXT NOT NULL
            );
            "#,
        )
        .expect("schema");
    }

    fn insert_plan_session(conn: &Connection, id: &str, title: &str, directory: Option<&str>) {
        conn.execute(
            "INSERT INTO session (id, title, directory, agent, time_created, time_updated)
             VALUES (?1, ?2, ?3, 'plan', 1700000000000, 1700000005000)",
            params![id, title, directory],
        )
        .expect("session");
    }

    fn insert_assistant_text(conn: &Connection, session_id: &str, message_id: &str, text: &str) {
        let message_data = json!({ "role": "assistant" }).to_string();
        let part_data = json!({ "type": "text", "text": text }).to_string();
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, data) VALUES (?1, ?2, 1, ?3)",
            params![message_id, session_id, message_data],
        )
        .expect("message");
        conn.execute(
            "INSERT INTO part (id, message_id, data) VALUES (?1, ?2, ?3)",
            params![format!("{message_id}-part"), message_id, part_data],
        )
        .expect("part");
    }

    fn build_fixture(dir: &TempDir, repo_root: Option<&str>) -> PathBuf {
        let db_path = dir.path().join("opencode.db");
        let conn = Connection::open(&db_path).expect("create db");
        build_schema(&conn);
        insert_plan_session(&conn, "ses_plan_1", "Plan one", repo_root);
        insert_assistant_text(&conn, "ses_plan_1", "msg_1", "First chunk");
        insert_assistant_text(&conn, "ses_plan_1", "msg_2", "Second chunk");
        // Non-plan session must be ignored.
        conn.execute(
            "INSERT INTO session (id, title, directory, agent, time_created, time_updated)
             VALUES ('ses_build_1', 'Build session', NULL, 'build', 1700000000000, 1700000005000)",
            [],
        )
        .expect("build session");
        // Plan session with no assistant text must be filtered out by scanner.
        insert_plan_session(&conn, "ses_plan_empty", "Empty plan", None);
        db_path
    }

    fn build_source(roots: Vec<PathBuf>) -> SourceConfig {
        SourceConfig {
            name: "opencode-plan-sessions".to_string(),
            mode: SourceMode::OpencodeDb,
            roots,
            patterns: Vec::new(),
            infer_repo_from_content: true,
            default_category: Some(DocumentCategory::Plan),
        }
    }

    #[test]
    fn scans_plan_sessions_from_db_directory() {
        let dir = TempDir::new().expect("tempdir");
        let repo_dir = TempDir::new().expect("repo");
        build_fixture(&dir, Some(repo_dir.path().to_str().unwrap()));

        let source = build_source(vec![dir.path().to_path_buf()]);
        let docs = scan_opencode_plan_source(&source, &BTreeMap::new(), &[]);

        assert_eq!(docs.len(), 1, "expected only the populated plan session");
        let doc = &docs[0];
        assert_eq!(doc.title, "Plan one");
        assert_eq!(doc.source_name, "opencode-plan-sessions");
        assert!(matches!(doc.kind, DocumentKind::Markdown));
        assert!(matches!(doc.category, DocumentCategory::Plan));
        assert!(doc.absolute_path.ends_with("#ses_plan_1"));
        let expected_repo_root = repo_dir
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(doc.repo_root, expected_repo_root);
        let expected_repo_name = repo_dir
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(doc.repo_name, expected_repo_name);
        assert!(matches!(
            doc.content_source,
            Some(DocumentContentSource::OpencodeDb { .. })
        ));
    }

    #[test]
    fn read_plan_content_returns_formatted_markdown() {
        let dir = TempDir::new().expect("tempdir");
        let repo_dir = TempDir::new().expect("repo");
        let db_path = build_fixture(&dir, Some(repo_dir.path().to_str().unwrap()));

        let content =
            read_opencode_plan_content(db_path.to_str().unwrap(), "ses_plan_1").expect("content");

        assert!(content.starts_with("# Plan one\n\n"));
        assert!(content.contains("Session: `ses_plan_1`"));
        assert!(content.contains(&format!(
            "Directory: `{}`",
            repo_dir.path().to_string_lossy()
        )));
        assert!(content.contains("First chunk"));
        assert!(content.contains("Second chunk"));
        assert!(content.contains("\n\n---\n\n"));
    }

    #[test]
    fn read_plan_content_errors_for_missing_session() {
        let dir = TempDir::new().expect("tempdir");
        let db_path = build_fixture(&dir, None);

        let err = read_opencode_plan_content(db_path.to_str().unwrap(), "ses_missing")
            .expect_err("missing session must error");
        assert!(err.contains("not found"));
    }

    #[test]
    fn skips_non_opencode_databases() {
        let dir = TempDir::new().expect("tempdir");
        let db_path = dir.path().join("opencode.db");
        Connection::open(&db_path).expect("create empty db");

        let source = build_source(vec![dir.path().to_path_buf()]);
        let docs = scan_opencode_plan_source(&source, &BTreeMap::new(), &[]);
        assert!(docs.is_empty());
    }

    #[test]
    fn parses_synthetic_path() {
        let (db, session) =
            parse_synthetic_path("/home/user/.local/share/opencode/opencode.db#ses_xyz")
                .expect("parse");
        assert_eq!(db, "/home/user/.local/share/opencode/opencode.db");
        assert_eq!(session, "ses_xyz");
        assert!(parse_synthetic_path("/repo/docs/plan.md").is_none());
        assert!(parse_synthetic_path("/repo/opencode.db#").is_none());
    }
}
