"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "./icons/index.js";

interface CommentDialogProps {
  selectedText: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function CommentDialog({ selectedText, onSubmit, onCancel }: CommentDialogProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="comment-dialog-backdrop" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="comment-dialog" role="dialog" aria-modal="true" aria-label="Add comment">
        <div className="comment-dialog-header">
          <h4>Add Comment</h4>
          <button type="button" className="modal-close" title="Cancel" onClick={onCancel}>
            <CloseIcon />
          </button>
        </div>
        <blockquote className="comment-dialog-quote">{selectedText}</blockquote>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(text);
          }}
        >
          <textarea
            ref={inputRef}
            className="comment-dialog-input"
            value={text}
            placeholder="Your comment or feedback for the agent..."
            rows={3}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onSubmit(text);
              }
            }}
          />
          <div className="comment-dialog-actions">
            <button type="button" className="btn" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn primary">Add Comment</button>
          </div>
        </form>
      </div>
    </div>
  );
}
