"use client";

import { useState } from "react";
import { CloseIcon, SendIcon, TrashIcon } from "./icons/index.js";
import { AGENT_NAMES, deleteAnnotation, sendAgentFeedback } from "../lib/api.js";
import type { AgentOrigin, Annotation } from "../lib/types.js";

interface AnnotationPanelProps {
  docId: string;
  docTitle: string;
  docPath: string;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onDeleteAnnotation: (id: string) => void;
  onClose: () => void;
}

export function AnnotationPanel({
  docId,
  docTitle,
  docPath,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onDeleteAnnotation,
  onClose
}: AnnotationPanelProps) {
  const [feedbackAgent, setFeedbackAgent] = useState<AgentOrigin>("claude-code");
  const [feedbackResult, setFeedbackResult] = useState<string | null>(null);
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackCopied, setFeedbackCopied] = useState(false);

  async function handleDelete(annotationId: string) {
    try {
      await deleteAnnotation(docId, annotationId);
      onDeleteAnnotation(annotationId);
    } catch {
      // Silently fail — annotation may already be deleted
    }
  }

  async function handleSendFeedback() {
    if (annotations.length === 0) return;
    setFeedbackSending(true);
    setFeedbackResult(null);
    try {
      const result = await sendAgentFeedback({
        docId,
        docTitle,
        docPath,
        annotations,
        agent: feedbackAgent
      });
      setFeedbackResult(result.formatted);
    } catch (error) {
      setFeedbackResult(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setFeedbackSending(false);
    }
  }

  async function handleCopyFeedback() {
    if (!feedbackResult) return;
    try {
      await navigator.clipboard.writeText(feedbackResult);
      setFeedbackCopied(true);
      setTimeout(() => setFeedbackCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }

  const typeLabel = (type: Annotation["type"]) => {
    switch (type) {
      case "comment": return "Comment";
      case "highlight": return "Highlight";
      case "deletion": return "Deletion";
    }
  };

  return (
    <div className="annotation-panel">
      <div className="ann-panel-header">
        <h3>Annotations ({annotations.length})</h3>
        <button type="button" className="modal-close" title="Close panel" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      {annotations.length === 0 ? (
        <div className="ann-empty">
          <p>No annotations yet.</p>
          <p className="ann-hint">Select text in the document to add comments, highlights, or mark deletions.</p>
        </div>
      ) : (
        <>
          <div className="ann-list">
            {annotations.map((annotation) => (
              <div
                key={annotation.id}
                className="ann-card"
                data-type={annotation.type}
                aria-selected={annotation.id === selectedAnnotationId}
                onClick={() => onSelectAnnotation(annotation.id === selectedAnnotationId ? null : annotation.id)}
              >
                <div className="ann-card-header">
                  <span className="ann-type" data-type={annotation.type}>{typeLabel(annotation.type)}</span>
                  <button
                    type="button"
                    className="ann-card-delete"
                    title="Delete annotation"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDelete(annotation.id);
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
                <blockquote className="ann-selected-text">{annotation.selectedText}</blockquote>
                {annotation.text && <p className="ann-comment-text">{annotation.text}</p>}
              </div>
            ))}
          </div>

          <div className="ann-feedback-section">
            <h4>Send to Agent</h4>
            <div className="ann-agent-select">
              <label htmlFor="agent-select">Agent:</label>
              <select
                id="agent-select"
                value={feedbackAgent}
                onChange={(event) => setFeedbackAgent(event.target.value as AgentOrigin)}
              >
                {Object.entries(AGENT_NAMES).map(([key, name]) => (
                  <option key={key} value={key}>{name}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn primary ann-send-btn"
              disabled={feedbackSending || annotations.length === 0}
              onClick={() => void handleSendFeedback()}
            >
              <SendIcon />
              {feedbackSending ? "Generating..." : "Generate Feedback"}
            </button>
            {feedbackResult && (
              <div className="ann-feedback-result">
                <div className="ann-feedback-bar">
                  <span>Structured feedback</span>
                  <button type="button" className="btn" onClick={() => void handleCopyFeedback()}>
                    {feedbackCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre className="ann-feedback-pre">{feedbackResult}</pre>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
