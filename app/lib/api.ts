import type { AgentFeedbackPayload, AgentOrigin, Annotation, DocumentDetail, DocumentPayload, SpecHubState } from "./types.js";

export function isDesktop() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function fetchDocs(force = false): Promise<DocumentPayload> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<DocumentPayload>("scan_documents");
  }
  const response = await fetch(force ? "/api/docs?refresh=1" : "/api/docs");
  if (!response.ok) throw new Error("Unable to index local files.");
  return response.json() as Promise<DocumentPayload>;
}

export async function fetchDocument(id: string): Promise<DocumentDetail> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const payload = await invoke<{ doc: DocumentDetail }>("get_document", { id });
    return payload.doc;
  }
  const response = await fetch(`/api/docs/${id}`);
  if (!response.ok) throw new Error("Document not found.");
  const payload = (await response.json()) as { doc: DocumentDetail };
  return payload.doc;
}

export async function fetchState(): Promise<SpecHubState> {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("Unable to load dashboard state.");
  return response.json() as Promise<SpecHubState>;
}

export async function patchState(patch: Partial<SpecHubState>): Promise<SpecHubState> {
  const response = await fetch("/api/state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Unable to save dashboard state.");
  return response.json() as Promise<SpecHubState>;
}

export async function fetchAnnotations(docId: string): Promise<Annotation[]> {
  const response = await fetch(`/api/docs/${docId}/annotations`);
  if (!response.ok) throw new Error("Unable to load annotations.");
  const payload = (await response.json()) as { annotations: Annotation[] };
  return payload.annotations;
}

export async function saveAnnotation(docId: string, annotation: Omit<Annotation, "docId">): Promise<Annotation> {
  const response = await fetch(`/api/docs/${docId}/annotations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(annotation)
  });
  if (!response.ok) throw new Error("Unable to save annotation.");
  const payload = (await response.json()) as { annotation: Annotation };
  return payload.annotation;
}

export async function deleteAnnotation(docId: string, annotationId: string): Promise<void> {
  const response = await fetch(`/api/docs/${docId}/annotations/${annotationId}`, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error("Unable to delete annotation.");
}

export async function sendAgentFeedback(payload: AgentFeedbackPayload): Promise<{ formatted: string }> {
  const response = await fetch("/api/agent/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Unable to send feedback to agent.");
  return response.json() as Promise<{ formatted: string }>;
}

export const AGENT_NAMES: Record<AgentOrigin, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
  "codex": "Codex",
  "copilot-cli": "Copilot CLI",
  "gemini-cli": "Gemini CLI"
};
