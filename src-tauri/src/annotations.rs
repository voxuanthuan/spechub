use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::paths::{spechub_config_dir, write_json_atomic};

/// One annotation on a document, stored (with the web server) at
/// `~/.config/spechub/annotations/<safeId>.json`. Mirrors `StoredAnnotation` in
/// `src/annotations.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredAnnotation {
    pub id: String,
    pub doc_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub selected_text: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub start_offset: i64,
    #[serde(default)]
    pub end_offset: i64,
    #[serde(default)]
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentFeedback {
    #[allow(dead_code)]
    pub doc_id: String,
    pub doc_title: String,
    pub doc_path: String,
    pub annotations: Vec<StoredAnnotation>,
    pub agent: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct FormattedFeedback {
    formatted: String,
}

fn annotations_dir() -> PathBuf {
    spechub_config_dir().join("annotations")
}

fn annotations_file_path(doc_id: &str, base_dir: &Path) -> PathBuf {
    let safe_id: String = doc_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    base_dir.join(format!("{safe_id}.json"))
}

fn read_annotations_from(doc_id: &str, base_dir: &Path) -> Vec<StoredAnnotation> {
    let path = annotations_file_path(doc_id, base_dir);
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<StoredAnnotation>>(&raw).ok())
        .unwrap_or_default()
}

fn write_annotations_to(
    doc_id: &str,
    annotations: &[StoredAnnotation],
    base_dir: &Path,
) -> Result<(), String> {
    // Annotation files are 2-space pretty JSON WITHOUT a trailing newline,
    // matching `writeAnnotations` in src/annotations.ts.
    write_json_atomic(&annotations_file_path(doc_id, base_dir), &annotations, false)
}

fn add_annotation_to(
    doc_id: &str,
    mut annotation: StoredAnnotation,
    base_dir: &Path,
) -> Result<StoredAnnotation, String> {
    annotation.doc_id = doc_id.to_string();
    let mut existing = read_annotations_from(doc_id, base_dir);
    existing.push(annotation.clone());
    write_annotations_to(doc_id, &existing, base_dir)?;
    Ok(annotation)
}

fn remove_annotation_from(
    doc_id: &str,
    annotation_id: &str,
    base_dir: &Path,
) -> Result<(), String> {
    let filtered: Vec<StoredAnnotation> = read_annotations_from(doc_id, base_dir)
        .into_iter()
        .filter(|annotation| annotation.id != annotation_id)
        .collect();
    write_annotations_to(doc_id, &filtered, base_dir)
}

fn agent_label(agent: &str) -> &str {
    match agent {
        "claude-code" => "Claude Code",
        "opencode" => "OpenCode",
        "codex" => "Codex",
        "copilot-cli" => "Copilot CLI",
        "gemini-cli" => "Gemini CLI",
        other => other,
    }
}

/// Port of `formatFeedbackForAgent` (src/annotations.ts). Kept byte-for-byte
/// compatible so desktop and web produce identical agent feedback.
pub(crate) fn format_feedback_for_agent(feedback: &AgentFeedback) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("# Feedback for {}", agent_label(&feedback.agent)));
    lines.push(String::new());
    lines.push(format!("**Document:** {}", feedback.doc_title));
    lines.push(format!("**Path:** {}", feedback.doc_path));
    lines.push(format!("**Annotations:** {}", feedback.annotations.len()));
    lines.push(String::new());

    for annotation in &feedback.annotations {
        let type_label = match annotation.kind.as_str() {
            "deletion" => "DELETE",
            "comment" => "COMMENT",
            _ => "HIGHLIGHT",
        };
        lines.push(format!("## [{type_label}]"));
        lines.push(String::new());
        lines.push(
            annotation
                .selected_text
                .split('\n')
                .map(|line| format!("> {line}"))
                .collect::<Vec<_>>()
                .join("\n"),
        );
        lines.push(String::new());
        if !annotation.text.is_empty() {
            lines.push(annotation.text.clone());
            lines.push(String::new());
        }
        lines.push("---".to_string());
        lines.push(String::new());
    }

    lines.join("\n")
}

#[tauri::command]
pub(crate) fn list_annotations(doc_id: String) -> Result<Vec<StoredAnnotation>, String> {
    Ok(read_annotations_from(&doc_id, &annotations_dir()))
}

#[tauri::command]
pub(crate) fn add_annotation(
    doc_id: String,
    annotation: StoredAnnotation,
) -> Result<StoredAnnotation, String> {
    add_annotation_to(&doc_id, annotation, &annotations_dir())
}

#[tauri::command]
pub(crate) fn remove_annotation(doc_id: String, annotation_id: String) -> Result<(), String> {
    remove_annotation_from(&doc_id, &annotation_id, &annotations_dir())
}

#[tauri::command]
pub(crate) fn clear_annotations(doc_id: String) -> Result<(), String> {
    write_annotations_to(&doc_id, &[], &annotations_dir())
}

#[tauri::command]
pub(crate) fn format_agent_feedback(payload: AgentFeedback) -> Result<FormattedFeedback, String> {
    Ok(FormattedFeedback {
        formatted: format_feedback_for_agent(&payload),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, kind: &str) -> StoredAnnotation {
        StoredAnnotation {
            id: id.to_string(),
            doc_id: "seed".to_string(),
            kind: kind.to_string(),
            selected_text: "selected".to_string(),
            text: "feedback".to_string(),
            start_offset: 0,
            end_offset: 8,
            created_at: 1,
        }
    }

    #[test]
    fn sanitizes_doc_id_into_file_name() {
        let base = Path::new("/tmp/annotations");
        let path = annotations_file_path("a/b .c:d", base);
        assert_eq!(path.file_name().unwrap(), "a_b__c_d.json");
    }

    #[test]
    fn add_remove_clear_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        add_annotation_to("doc-1", sample("a1", "comment"), base).unwrap();
        add_annotation_to("doc-1", sample("a2", "highlight"), base).unwrap();
        assert_eq!(read_annotations_from("doc-1", base).len(), 2);

        remove_annotation_from("doc-1", "a1", base).unwrap();
        let remaining = read_annotations_from("doc-1", base);
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "a2");
        assert_eq!(remaining[0].doc_id, "doc-1");

        write_annotations_to("doc-1", &[], base).unwrap();
        assert!(read_annotations_from("doc-1", base).is_empty());
    }

    #[test]
    fn reads_empty_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_annotations_from("nope", dir.path()).is_empty());
    }

    #[test]
    fn annotation_file_has_no_trailing_newline() {
        let dir = tempfile::tempdir().unwrap();
        add_annotation_to("doc-1", sample("a1", "comment"), dir.path()).unwrap();
        let raw = fs::read_to_string(annotations_file_path("doc-1", dir.path())).unwrap();
        assert!(raw.ends_with(']'));
        assert!(raw.contains("\"type\": \"comment\""));
        assert!(raw.contains("\"docId\": \"doc-1\""));
    }

    #[test]
    fn formats_feedback_like_web() {
        let feedback = AgentFeedback {
            doc_id: "doc-1".to_string(),
            doc_title: "Test Plan".to_string(),
            doc_path: "/path/to/plan.md".to_string(),
            annotations: vec![StoredAnnotation {
                selected_text: "hello".to_string(),
                text: "fix this".to_string(),
                ..sample("a1", "comment")
            }],
            agent: "claude-code".to_string(),
        };
        let output = format_feedback_for_agent(&feedback);
        assert!(output.contains("# Feedback for Claude Code"));
        assert!(output.contains("**Document:** Test Plan"));
        assert!(output.contains("**Annotations:** 1"));
        assert!(output.contains("## [COMMENT]"));
        assert!(output.contains("> hello"));
        assert!(output.contains("fix this"));
    }

    #[test]
    fn quotes_multiline_selected_text() {
        let feedback = AgentFeedback {
            doc_id: "doc-2".to_string(),
            doc_title: "Multi".to_string(),
            doc_path: "/path".to_string(),
            annotations: vec![StoredAnnotation {
                selected_text: "line1\nline2\nline3".to_string(),
                ..sample("a1", "highlight")
            }],
            agent: "opencode".to_string(),
        };
        let output = format_feedback_for_agent(&feedback);
        assert!(output.contains("> line1\n> line2\n> line3"));
    }
}
