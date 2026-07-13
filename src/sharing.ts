import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expandHome } from "./paths.js";
import type { DocumentMeta, DocumentShare, PublicDocumentShare, SharedDocument } from "./types.js";

export const DEFAULT_SHARE_STATE_DIR = "~/.config/spechub/shares";
const MAX_SHARED_DOCUMENT_BYTES = 2 * 1024 * 1024;

export function createSharedDocument(doc: DocumentMeta, content: string): SharedDocument {
  if (Buffer.byteLength(content, "utf8") > MAX_SHARED_DOCUMENT_BYTES) {
    throw new Error("Document is too large to share (2 MB maximum).");
  }
  return {
    schemaVersion: 1,
    title: doc.title,
    kind: doc.kind,
    category: doc.category,
    repoName: doc.repoName,
    relativePath: doc.relativePath,
    modifiedAt: doc.modifiedAt,
    content,
    publishedAt: new Date().toISOString()
  };
}

export async function readDocumentShare(docId: string, stateDir = DEFAULT_SHARE_STATE_DIR): Promise<DocumentShare | undefined> {
  try {
    const parsed = JSON.parse(await readFile(shareStatePath(docId, stateDir), "utf8")) as Partial<DocumentShare>;
    if (
      typeof parsed.id !== "string"
      || typeof parsed.url !== "string"
      || typeof parsed.secret !== "string"
      || typeof parsed.updatedAt !== "string"
    ) {
      return undefined;
    }
    return parsed as DocumentShare;
  } catch {
    return undefined;
  }
}

export async function publishDocumentShare(input: {
  docId: string;
  shareServerUrl?: string;
  document: SharedDocument;
  stateDir?: string;
  fetcher?: typeof fetch;
}): Promise<PublicDocumentShare> {
  const stateDir = input.stateDir ?? DEFAULT_SHARE_STATE_DIR;
  const existing = await readDocumentShare(input.docId, stateDir);
  const shareServerUrl = existing?.serverUrl ?? input.shareServerUrl;
  if (!shareServerUrl) {
    throw new Error("Configure a share server URL in Workspace settings before publishing.");
  }
  const fetcher = input.fetcher ?? fetch;
  const response = existing
    ? await fetcher(`${shareServerUrl}/api/shares/${encodeURIComponent(existing.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: existing.secret, document: input.document })
      })
    : await fetcher(`${shareServerUrl}/api/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: input.document })
      });

  if (!response.ok) {
    throw new Error(await shareRequestError(response, "Unable to publish document."));
  }

  const payload = await parseShare(response);
  const share: DocumentShare = {
    id: payload.id,
    url: payload.url,
    secret: payload.secret ?? existing?.secret ?? "",
    serverUrl: shareServerUrl,
    updatedAt: payload.updatedAt
  };
  if (!share.secret) {
    throw new Error("Share server did not return a management secret.");
  }
  await writeDocumentShare(input.docId, share, stateDir);
  return publicShare(share);
}

export async function removeDocumentShare(input: {
  docId: string;
  shareServerUrl?: string;
  stateDir?: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  const stateDir = input.stateDir ?? DEFAULT_SHARE_STATE_DIR;
  const share = await readDocumentShare(input.docId, stateDir);
  if (!share) return;
  const shareServerUrl = share.serverUrl ?? input.shareServerUrl;
  if (!shareServerUrl) {
    throw new Error("Configure the original share server URL before unsharing.");
  }
  const response = await (input.fetcher ?? fetch)(`${shareServerUrl}/api/shares/${encodeURIComponent(share.id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: share.secret })
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(await shareRequestError(response, "Unable to unshare document."));
  }
  await unlink(shareStatePath(input.docId, stateDir)).catch(() => {});
}

export function publicShare(share: DocumentShare): PublicDocumentShare {
  return {
    id: share.id,
    url: share.url,
    updatedAt: share.updatedAt
  };
}

function shareStatePath(docId: string, stateDir: string): string {
  const safeId = createHash("sha256").update(docId).digest("hex").slice(0, 40);
  return path.join(expandHome(stateDir), `${safeId}.json`);
}

async function writeDocumentShare(docId: string, share: DocumentShare, stateDir: string): Promise<void> {
  const filePath = shareStatePath(docId, stateDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(share, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, filePath);
}

async function parseShare(response: Response): Promise<Partial<DocumentShare> & PublicDocumentShare> {
  const payload = await response.json() as Partial<DocumentShare>;
  if (
    typeof payload.id !== "string"
    || typeof payload.url !== "string"
    || typeof payload.updatedAt !== "string"
  ) {
    throw new Error("Share server returned an invalid response.");
  }
  return payload as Partial<DocumentShare> & PublicDocumentShare;
}

async function shareRequestError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch {
    return fallback;
  }
}
