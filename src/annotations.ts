import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expandHome } from "./paths.js";

const DEFAULT_ANNOTATIONS_DIR = "~/.config/spechub/annotations";

export interface StoredAnnotation {
  id: string;
  docId: string;
  type: "comment" | "highlight" | "deletion";
  selectedText: string;
  text: string;
  startOffset: number;
  endOffset: number;
  createdAt: number;
}

export type AgentOrigin = "claude-code" | "opencode" | "codex" | "copilot-cli" | "gemini-cli";

export interface AgentFeedback {
  docId: string;
  docTitle: string;
  docPath: string;
  annotations: StoredAnnotation[];
  agent: AgentOrigin;
}

function annotationsFilePath(docId: string, baseDir = DEFAULT_ANNOTATIONS_DIR): string {
  const safeId = docId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(expandHome(baseDir), `${safeId}.json`);
}

export async function readAnnotations(docId: string): Promise<StoredAnnotation[]> {
  const filePath = annotationsFilePath(docId);
  try {
    await access(filePath);
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

export async function writeAnnotations(docId: string, annotations: StoredAnnotation[]): Promise<void> {
  const filePath = annotationsFilePath(docId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(annotations, null, 2), "utf8");
  await rename(tempPath, filePath);
}

export async function addAnnotation(docId: string, annotation: StoredAnnotation): Promise<StoredAnnotation> {
  const existing = await readAnnotations(docId);
  const full: StoredAnnotation = { ...annotation, docId };
  existing.push(full);
  await writeAnnotations(docId, existing);
  return full;
}

export async function removeAnnotation(docId: string, annotationId: string): Promise<void> {
  const existing = await readAnnotations(docId);
  const filtered = existing.filter((ann) => ann.id !== annotationId);
  await writeAnnotations(docId, filtered);
}

const AGENT_LABELS: Record<AgentOrigin, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
  "codex": "Codex",
  "copilot-cli": "Copilot CLI",
  "gemini-cli": "Gemini CLI"
};

export function formatFeedbackForAgent(feedback: AgentFeedback): string {
  const lines: string[] = [];
  const agentLabel = AGENT_LABELS[feedback.agent] ?? feedback.agent;
  lines.push(`# Feedback for ${agentLabel}`);
  lines.push("");
  lines.push(`**Document:** ${feedback.docTitle}`);
  lines.push(`**Path:** ${feedback.docPath}`);
  lines.push(`**Annotations:** ${feedback.annotations.length}`);
  lines.push("");

  for (const annotation of feedback.annotations) {
    const typeLabel = annotation.type === "deletion" ? "DELETE" : annotation.type === "comment" ? "COMMENT" : "HIGHLIGHT";
    lines.push(`## [${typeLabel}]`);
    lines.push("");
    lines.push(annotation.selectedText.split("\n").map((line) => `> ${line}`).join("\n"));
    lines.push("");
    if (annotation.text) {
      lines.push(annotation.text);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
