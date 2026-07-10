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
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SpecHubState>("get_state");
  }
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("Unable to load dashboard state.");
  return response.json() as Promise<SpecHubState>;
}

export async function patchState(patch: Partial<SpecHubState>): Promise<SpecHubState> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SpecHubState>("patch_state", { patch });
  }
  const response = await fetch("/api/state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Unable to save dashboard state.");
  return response.json() as Promise<SpecHubState>;
}

export async function fetchAnnotations(docId: string): Promise<Annotation[]> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Annotation[]>("list_annotations", { docId });
  }
  const response = await fetch(`/api/docs/${docId}/annotations`);
  if (!response.ok) throw new Error("Unable to load annotations.");
  const payload = (await response.json()) as { annotations: Annotation[] };
  return payload.annotations;
}

export async function saveAnnotation(docId: string, annotation: Omit<Annotation, "docId">): Promise<Annotation> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Annotation>("add_annotation", { docId, annotation: { ...annotation, docId } });
  }
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
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("remove_annotation", { docId, annotationId });
    return;
  }
  const response = await fetch(`/api/docs/${docId}/annotations/${annotationId}`, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error("Unable to delete annotation.");
}

export async function clearAnnotations(docId: string): Promise<void> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("clear_annotations", { docId });
    return;
  }
  const response = await fetch(`/api/docs/${docId}/annotations`, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error("Unable to clear annotations.");
}

export async function sendAgentFeedback(payload: AgentFeedbackPayload): Promise<{ formatted: string }> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<{ formatted: string }>("format_agent_feedback", { payload });
  }
  const response = await fetch("/api/agent/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Unable to send feedback to agent.");
  return response.json() as Promise<{ formatted: string }>;
}

/**
 * Subscribe to document-change notifications. On desktop this listens to the
 * Rust watcher's `docs-changed` Tauri event; on web it uses the server's SSE
 * stream. Returns a cleanup function that stops the subscription.
 */
export function subscribeDocsChanged(onChange: () => void): () => void {
  if (isDesktop()) {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("docs-changed", () => onChange()).then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }

  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource("/api/events");
  source.addEventListener("docs-changed", () => onChange());
  return () => source.close();
}

export const AGENT_NAMES: Record<AgentOrigin, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
  "codex": "Codex",
  "copilot-cli": "Copilot CLI",
  "gemini-cli": "Gemini CLI"
};
