import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { renderMarkdown } from "./markdown.js";
import { expandHome } from "./paths.js";
import type { DocumentCategory, DocumentKind, SharedDocument } from "./types.js";

export const DEFAULT_SHARE_DATA_DIR = "~/.local/share/spechub-share";
const MAX_SHARED_DOCUMENT_BYTES = 2 * 1024 * 1024;
const CREATE_LIMIT = 20;
const CREATE_WINDOW_MS = 60 * 60 * 1000;

interface StoredShare {
  id: string;
  secretHash: string;
  document: SharedDocument;
  createdAt: string;
  updatedAt: string;
}

interface ShareServiceOptions {
  dataDir?: string;
  publicUrl?: string;
  now?: () => Date;
  trustProxy?: boolean | number;
}

export function createShareService(options: ShareServiceOptions = {}): Express {
  const app = express();
  const dataDir = expandHome(options.dataDir ?? process.env.SPECHUB_SHARE_DATA_DIR ?? DEFAULT_SHARE_DATA_DIR);
  const configuredPublicUrl = normalizePublicUrl(options.publicUrl ?? process.env.SPECHUB_SHARE_PUBLIC_URL);
  const now = options.now ?? (() => new Date());
  const creates = new Map<string, number[]>();

  app.disable("x-powered-by");
  app.set("trust proxy", options.trustProxy ?? parseTrustProxy(process.env.SPECHUB_SHARE_TRUST_PROXY));
  app.use(express.json({ limit: "2100kb" }));
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/api/shares", asyncRoute(async (request, response) => {
    enforceCreateLimit(request, creates, now().getTime());
    const document = parseSharedDocument(request.body?.document);
    const id = await createShareId(dataDir);
    const secret = randomBytes(32).toString("base64url");
    const timestamp = now().toISOString();
    const share: StoredShare = {
      id,
      secretHash: hashSecret(secret),
      document,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await writeShare(share, dataDir);
    response.status(201).json({
      id,
      secret,
      url: `${shareBaseUrl(request, configuredPublicUrl)}/s/${id}`,
      updatedAt: timestamp
    });
  }));

  app.put("/api/shares/:id", asyncRoute(async (request, response) => {
    const share = await requireManagedShare(request.params.id, request.body?.secret, dataDir);
    const document = parseSharedDocument(request.body?.document);
    const updatedAt = now().toISOString();
    await writeShare({ ...share, document, updatedAt }, dataDir);
    response.json({
      id: share.id,
      url: `${shareBaseUrl(request, configuredPublicUrl)}/s/${share.id}`,
      updatedAt
    });
  }));

  app.delete("/api/shares/:id", asyncRoute(async (request, response) => {
    await requireManagedShare(request.params.id, request.body?.secret, dataDir);
    await unlink(sharePath(request.params.id, dataDir));
    response.status(204).end();
  }));

  app.get("/api/shares/:id/data", asyncRoute(async (request, response) => {
    const share = await readShare(request.params.id, dataDir);
    if (!share) {
      response.status(404).json({ error: "Share not found." });
      return;
    }
    response.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
    response.json({
      id: share.id,
      document: share.document,
      createdAt: share.createdAt,
      updatedAt: share.updatedAt
    });
  }));

  app.get("/s/:id", asyncRoute(async (request, response) => {
    const share = await readShare(request.params.id, dataDir);
    if (!share) {
      response.status(404).type("html").send(notFoundPage());
      return;
    }
    response.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
    response.setHeader("Content-Security-Policy", [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src data: https:",
      "font-src data: https:",
      "frame-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'"
    ].join("; "));
    response.type("html").send(renderSharePage(share));
  }));

  app.get("/s/:id/raw", asyncRoute(async (request, response) => {
    const share = await readShare(request.params.id, dataDir);
    if (!share || share.document.kind !== "html") {
      response.status(404).end();
      return;
    }
    response.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
    response.setHeader("Content-Security-Policy", [
      "default-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "img-src data: https:",
      "font-src data: https:",
      "connect-src 'none'",
      "media-src data: https:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'"
    ].join("; "));
    response.type("html").send(share.document.content);
  }));

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found." });
  });
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = error instanceof ShareServiceError ? error.status : isPayloadTooLarge(error) ? 413 : 500;
    const message = error instanceof ShareServiceError
      ? error.message
      : status === 413
        ? "Document is too large to share (2 MB maximum)."
        : "Share service request failed.";
    response.status(status).json({ error: message });
  });

  return app;
}

export async function startShareServer(options: ShareServiceOptions & {
  port?: number;
  host?: string;
} = {}): Promise<{ server: Server; url: string; port: number }> {
  const app = createShareService(options);
  const server = createServer(app);
  const port = options.port ?? Number.parseInt(process.env.PORT ?? "8787", 10);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine share server address.");
  }
  return {
    server,
    port: address.port,
    url: `http://${host}:${address.port}`
  };
}

function parseSharedDocument(value: unknown): SharedDocument {
  if (!value || typeof value !== "object") {
    throw new ShareServiceError(400, "Invalid shared document.");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1
    || !isString(candidate.title, 500)
    || !isDocumentKind(candidate.kind)
    || !isDocumentCategory(candidate.category)
    || !isString(candidate.repoName, 300)
    || !isString(candidate.relativePath, 1500)
    || !isString(candidate.modifiedAt, 100)
    || typeof candidate.content !== "string"
    || !isString(candidate.publishedAt, 100)
  ) {
    throw new ShareServiceError(400, "Invalid shared document.");
  }
  if (Buffer.byteLength(candidate.content, "utf8") > MAX_SHARED_DOCUMENT_BYTES) {
    throw new ShareServiceError(413, "Document is too large to share (2 MB maximum).");
  }
  return candidate as unknown as SharedDocument;
}

function isDocumentKind(value: unknown): value is DocumentKind {
  return value === "markdown" || value === "html";
}

function isDocumentCategory(value: unknown): value is DocumentCategory {
  return value === "plan" || value === "spec" || value === "superpowers" || value === "doc";
}

function isString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

async function requireManagedShare(id: string, secret: unknown, dataDir: string): Promise<StoredShare> {
  const share = await readShare(id, dataDir);
  if (!share) throw new ShareServiceError(404, "Share not found.");
  if (typeof secret !== "string" || !safeSecretEqual(share.secretHash, hashSecret(secret))) {
    throw new ShareServiceError(403, "Invalid share management secret.");
  }
  return share;
}

async function createShareId(dataDir: string): Promise<string> {
  await mkdir(dataDir, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = randomBytes(9).toString("base64url");
    try {
      await access(sharePath(id, dataDir));
    } catch {
      return id;
    }
  }
  throw new Error("Unable to allocate a share ID.");
}

async function readShare(id: string, dataDir: string): Promise<StoredShare | undefined> {
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) return undefined;
  try {
    return JSON.parse(await readFile(sharePath(id, dataDir), "utf8")) as StoredShare;
  } catch {
    return undefined;
  }
}

async function writeShare(share: StoredShare, dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const filePath = sharePath(share.id, dataDir);
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(share, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, filePath);
}

function sharePath(id: string, dataDir: string): string {
  return path.join(dataDir, `${id}.json`);
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function safeSecretEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizePublicUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Public share URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Public share URL must not include credentials.");
  }
  return url.toString().replace(/\/$/, "");
}

function parseTrustProxy(value: string | undefined): boolean | number {
  if (!value) return false;
  if (value === "true") return true;
  const hops = Number.parseInt(value, 10);
  return Number.isFinite(hops) && hops >= 0 ? hops : false;
}

function shareBaseUrl(request: Request, configuredPublicUrl: string | undefined): string {
  return configuredPublicUrl ?? `${request.protocol}://${request.get("host")}`;
}

function enforceCreateLimit(request: Request, creates: Map<string, number[]>, timestamp: number): void {
  const key = request.ip || "unknown";
  const recent = (creates.get(key) ?? []).filter((createdAt) => timestamp - createdAt < CREATE_WINDOW_MS);
  if (recent.length >= CREATE_LIMIT) {
    throw new ShareServiceError(429, "Too many shares created. Try again later.");
  }
  recent.push(timestamp);
  creates.set(key, recent);
}

function renderSharePage(share: StoredShare): string {
  const document = share.document;
  const content = document.kind === "markdown"
    ? `<article class="markdown">${renderMarkdown(document.content)}</article>`
    : `<iframe title="${escapeHtml(document.title)}" sandbox="allow-scripts" src="/s/${share.id}/raw"></iframe>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(document.title)} · SpecHub</title>
  <style>${sharePageStyles()}</style>
</head>
<body>
  <header>
    <a href="https://github.com/voxuanthuan/spechub" rel="noreferrer">SpecHub</a>
    <span>Shared ${escapeHtml(document.category)}</span>
  </header>
  <main>
    <section class="meta">
      <p>${escapeHtml(document.repoName)} / ${escapeHtml(document.relativePath)}</p>
      <h1>${escapeHtml(document.title)}</h1>
      <time datetime="${escapeHtml(share.updatedAt)}">Updated ${escapeHtml(formatDate(share.updatedAt))}</time>
    </section>
    <section class="document">${content}</section>
  </main>
</body>
</html>`;
}

function notFoundPage(): string {
  return "<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"><title>Share not found · SpecHub</title></head><body><main><h1>Share not found</h1><p>This link may have been removed.</p></main></body></html>";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(value));
}

function sharePageStyles(): string {
  return `
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#f6f7f8;color:#202326}
*{box-sizing:border-box}body{margin:0}header{height:54px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dfe3e6;background:#fff;color:#667078}header a{color:#18794e;font-weight:750;text-decoration:none}
main{width:min(980px,calc(100% - 32px));margin:0 auto;padding:48px 0 80px}.meta{margin-bottom:24px}.meta p,.meta time{color:#69727a;font:12px ui-monospace,monospace}.meta h1{margin:8px 0;font-size:30px;line-height:1.2}
.document{min-height:300px;padding:clamp(22px,4vw,56px);border:1px solid #dfe3e6;border-radius:14px;background:#fff;box-shadow:0 10px 35px rgb(20 30 40 / .07)}
.markdown{max-width:780px;margin:0 auto;font-size:16px;line-height:1.7}.markdown h1,.markdown h2,.markdown h3{line-height:1.25;margin-top:1.6em}.markdown pre{overflow:auto;padding:16px;border-radius:9px;background:#17191b;color:#f7f7f7}.markdown code{font-family:ui-monospace,monospace}.markdown table{border-collapse:collapse;width:100%}.markdown th,.markdown td{padding:8px 10px;border:1px solid #dfe3e6}.markdown img{max-width:100%}.markdown a{color:#18794e}
iframe{display:block;width:100%;height:75vh;border:0;background:#fff}
@media(prefers-color-scheme:dark){:root{background:#151719;color:#eef0f1}header,.document{background:#1e2124;border-color:#33383d}.meta p,.meta time,header{color:#a7afb6}.markdown th,.markdown td{border-color:#3b4146}}
@media(max-width:600px){header{padding:0 16px}main{padding-top:28px}.document{padding:20px}.meta h1{font-size:24px}}
`;
}

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

function isPayloadTooLarge(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 413);
}

class ShareServiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
