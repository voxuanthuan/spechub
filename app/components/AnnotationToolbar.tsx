"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { CommentIcon, HighlightIcon, StrikethroughIcon } from "./icons/index.js";
import type { AnnotationType } from "../lib/types.js";

interface AnnotationToolbarProps {
  containerRef: RefObject<HTMLElement | null>;
  onAnnotate: (type: AnnotationType, selectedText: string, startOffset: number, endOffset: number) => void;
}

export function AnnotationToolbar({ containerRef, onAnnotate }: AnnotationToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [selection, setSelection] = useState({ text: "", start: 0, end: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        setVisible(false);
        return;
      }

      const range = sel.getRangeAt(0);
      const container = containerRef.current;
      if (!container || !container.contains(range.startContainer)) {
        setVisible(false);
        return;
      }

      const text = sel.toString().trim();
      if (!text) {
        setVisible(false);
        return;
      }

      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      const bodyText = container.textContent ?? "";
      const preRange = document.createRange();
      preRange.setStart(container, 0);
      preRange.setEnd(range.startContainer, range.startOffset);
      const startOffset = preRange.toString().length;
      const endOffset = startOffset + text.length;

      setSelection({ text, start: startOffset, end: endOffset });
      setPosition({
        top: rect.top - containerRect.top - 44,
        left: rect.left - containerRect.left + rect.width / 2
      });
      setVisible(true);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [containerRef]);

  useEffect(() => {
    if (!visible) return;
    function handlePointerDown(event: PointerEvent) {
      if (toolbarRef.current?.contains(event.target as Node)) return;
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [visible]);

  function handleAnnotate(type: AnnotationType) {
    onAnnotate(type, selection.text, selection.start, selection.end);
    window.getSelection()?.removeAllRanges();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      className="annotation-toolbar"
      style={{ top: position.top, left: position.left }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="ann-btn"
        title="Add comment"
        onClick={() => handleAnnotate("comment")}
      >
        <CommentIcon />
        <span>Comment</span>
      </button>
      <button
        type="button"
        className="ann-btn ann-highlight"
        title="Highlight"
        onClick={() => handleAnnotate("highlight")}
      >
        <HighlightIcon />
        <span>Highlight</span>
      </button>
      <button
        type="button"
        className="ann-btn ann-delete"
        title="Mark for deletion"
        onClick={() => handleAnnotate("deletion")}
      >
        <StrikethroughIcon />
        <span>Delete</span>
      </button>
    </div>
  );
}
