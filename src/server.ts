import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addAnnotation, formatFeedbackForAgent, readAnnotations, removeAnnotation, type AgentFeedback, type StoredAnnotation } from "./annotations.js";
import express, { type Express, type Request, type Response } from "express";
import {
  DEFAULT_CONFIG_PATH,
  describeConfigFileProblem,
  expandHome,
  readConfigFile,
  resolveConfig,
  updateRoots,
  updateTitleOverride
} from "./config.js";
import { renderMarkdown } from "./markdown.js";
import { readOpenCodePlanContent } from "./opencode.js";
import { openLocalPath } from "./opener.js";
import { createDocumentIndex, type DocumentIndex } from "./index-service.js";
import { DEFAULT_STATE_PATH, parseStatePatch, readStateFile, updateStateFile } from "./state.js";
import type { DocumentMeta, RuntimeSpecHubConfig, SpecHubConfig } from "./types.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const legacyWebDir = path.join(moduleDir, "web");
const nextOutDirs = [path.resolve(moduleDir, "..", "out"), path.resolve(moduleDir, "..", "..", "out")];

export function createApp(config: RuntimeSpecHubConfig = {}, index: DocumentIndex = createDocumentIndex(config)): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/", asyncRoute(async (_request, response) => {
    response.sendFile(await dashboardIndexPath());
  }));
  for (const outDir of nextOutDirs) {
    app.use("/_next", express.static(path.join(outDir, "_next"), { fallthrough: true }));
    app.use(express.static(outDir, { fallthrough: true, index: false }));
  }
  app.use("/assets", express.static(legacyWebDir, { fallthrough: false }));

  app.get("/api/docs", asyncRoute(async (request, response) => {
    const allDocs = request.query.refresh === "1" ? await index.refresh() : await index.getDocs();

    const etag = computeETag(allDocs);
    if (request.headers["if-none-match"] === etag) {
      response.status(304).end();
      return;
    }
    response.setHeader("ETag", etag);

    const limitParam = parseInt(request.query.limit as string, 10);
    const offsetParam = parseInt(request.query.offset as string, 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;
    const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;

    const docs = limit ? allDocs.slice(offset, offset + limit) : allDocs.slice(offset);
    response.json({
      docs,
      repos: summarizeRepos(allDocs),
      total: allDocs.length
    });
  }));

  app.get("/api/docs/:id", asyncRoute(async (request, response) => {
    const doc = await index.findById(request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }

    const detail = {
      ...doc,
      rawUrl: `/raw/${doc.id}`
    };

    if (doc.kind === "markdown") {
      const raw = await readDocumentContent(doc);
      response.json({
        doc: {
          ...detail,
          renderedHtml: renderMarkdown(raw)
        }
      });
      return;
    }

    response.json({ doc: detail });
  }));

  app.get("/raw/:id", asyncRoute(async (request, response) => {
    const doc = await index.findById(request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }

    response.type(doc.kind === "html" ? "html" : "text/markdown");
    response.send(await readDocumentContent(doc));
  }));

  app.post("/api/docs/:id/open-source", asyncRoute(async (request, response) => {
    const doc = await index.findById(request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }
    await openLocalPath(sourcePath(doc));
    response.json({ ok: true });
  }));

  app.patch("/api/docs/:id/title", asyncRoute(async (request, response) => {
    const doc = await index.findById(request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }

    const title = typeof request.body?.title === "string" ? request.body.title.slice(0, 500) : "";
    await updateTitleOverride(config.configPath ?? DEFAULT_CONFIG_PATH, doc.absolutePath, title);
    await index.refresh();
    const updated = await index.findById(request.params.id);
    response.json({ doc: updated ?? doc });
  }));

  app.get("/api/config", asyncRoute(async (_request, response) => {
    response.json(await describeConfig(config));
  }));

  app.get("/api/state", asyncRoute(async (_request, response) => {
    response.json(await readStateFile(config.statePath ?? DEFAULT_STATE_PATH));
  }));

  app.patch("/api/state", asyncRoute(async (request, response) => {
    let patch;
    try {
      patch = parseStatePatch(request.body);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Invalid state payload." });
      return;
    }
    response.json(await updateStateFile(config.statePath ?? DEFAULT_STATE_PATH, patch));
  }));

  app.patch("/api/config/roots", asyncRoute(async (request, response) => {
    const candidate = request.body?.roots;
    if (!Array.isArray(candidate) || !candidate.every((entry: unknown) => typeof entry === "string")) {
      response.status(400).json({ error: "roots must be an array of strings." });
      return;
    }
    if (candidate.length > 50) {
      response.status(400).json({ error: "Too many roots (max 50)." });
      return;
    }
    try {
      await updateRoots(config.configPath ?? DEFAULT_CONFIG_PATH, candidate);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Invalid roots." });
      return;
    }
    await index.refresh();
    response.json(await describeConfig(config));
  }));

  app.get("/api/docs/:id/annotations", asyncRoute(async (request, response) => {
    const doc = await index.findById(request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }
    const annotations = await readAnnotations(doc.id);
    response.json({ annotations });
  }));

  app.post("/api/docs/:id/annotations", asyncRoute(async (request, response) => {
    const doc = await index.findById(request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }
    const body = request.body;
    if (!body || typeof body.id !== "string" || typeof body.type !== "string") {
      response.status(400).json({ error: "Invalid annotation payload." });
      return;
    }
    const annotation: StoredAnnotation = {
      id: body.id,
      docId: doc.id,
      type: body.type,
      selectedText: typeof body.selectedText === "string" ? body.selectedText : "",
      text: typeof body.text === "string" ? body.text : "",
      startOffset: typeof body.startOffset === "number" ? body.startOffset : 0,
      endOffset: typeof body.endOffset === "number" ? body.endOffset : 0,
      createdAt: typeof body.createdAt === "number" ? body.createdAt : Date.now()
    };
    const saved = await addAnnotation(doc.id, annotation);
    response.json({ annotation: saved });
  }));

  app.delete("/api/docs/:id/annotations/:annotationId", asyncRoute(async (request, response) => {
    const doc = await index.findById(request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }
    await removeAnnotation(doc.id, request.params.annotationId);
    response.json({ ok: true });
  }));

  app.post("/api/agent/feedback", asyncRoute(async (request, response) => {
    const body = request.body as AgentFeedback | undefined;
    if (!body || !body.docId || !body.agent || !Array.isArray(body.annotations)) {
      response.status(400).json({ error: "Invalid feedback payload." });
      return;
    }
    const formatted = formatFeedbackForAgent(body);
    response.json({ formatted });
  }));

  app.post("/api/docs/:id/open-folder", asyncRoute(async (request, response) => {
    const doc = await index.findById(request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }
    await openLocalPath(path.dirname(sourcePath(doc)));
    response.json({ ok: true });
  }));

  app.get("/api/events", (request, response) => {
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    response.write("event: hello\ndata: {}\n\n");

    const onDocsChanged = (event: { version: number }) => {
      response.write(`event: docs-changed\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      response.write(": heartbeat\n\n");
    }, 25_000);

    index.events.on("docs-changed", onDocsChanged);
    request.on("close", () => {
      clearInterval(heartbeat);
      index.events.off("docs-changed", onDocsChanged);
    });
  });

  app.use((_request, response) => notFound(response));

  return app;
}

async function dashboardIndexPath(): Promise<string> {
  for (const outDir of nextOutDirs) {
    const indexPath = path.join(outDir, "index.html");
    try {
      await access(indexPath);
      return indexPath;
    } catch {
      // Fall back to the legacy static UI when Next has not been built yet.
    }
  }
  return path.join(legacyWebDir, "index.html");
}

export async function startServer(config: RuntimeSpecHubConfig = {}, port = 0): Promise<{ server: Server; url: string; port: number }> {
  const index = createDocumentIndex(config);
  const app = createApp(config, index);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  await index.startWatching();
  server.on("close", () => {
    void index.close();
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine server address");
  }

  return {
    server,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`
  };
}

async function currentConfig(config: RuntimeSpecHubConfig): Promise<Partial<SpecHubConfig>> {
  if (config.configPath) {
    return resolveConfig({
      configPath: config.configPath,
      roots: config.explicitRoots === false ? undefined : config.roots
    });
  }
  return config;
}

async function describeConfig(config: RuntimeSpecHubConfig): Promise<{
  configPath: string;
  roots: Array<{ path: string; expandedPath: string; exists: boolean }>;
  explicitRoots: boolean;
  warnings: string[];
}> {
  const configPath = config.configPath ?? DEFAULT_CONFIG_PATH;
  const stored = await readConfigFile(configPath);
  const explicitRoots = config.explicitRoots === true;
  const sourceRoots = stored.roots ?? (config.roots ?? []);
  const roots = await Promise.all(
    sourceRoots.map(async (raw) => {
      const expanded = expandHome(raw);
      let exists = false;
      try {
        const info = await stat(expanded);
        exists = info.isDirectory();
      } catch {
        exists = false;
      }
      return { path: raw, expandedPath: expanded, exists };
    })
  );
  const warnings: string[] = [];
  const configProblem = await describeConfigFileProblem(configPath);
  if (configProblem) warnings.push(configProblem);
  if (explicitRoots) {
    warnings.push("Server was started with --roots; saved roots take effect on next launch.");
  }
  return { configPath, roots, explicitRoots, warnings };
}

async function readDocumentContent(doc: DocumentMeta): Promise<string> {
  if (!doc.contentSource || doc.contentSource.type === "file") {
    return readFile(doc.absolutePath, "utf8");
  }

  if (doc.contentSource.type === "opencode-db") {
    return readOpenCodePlanContent(doc.contentSource.dbPath, doc.contentSource.sessionId);
  }

  return readFile(doc.absolutePath, "utf8");
}

function sourcePath(doc: DocumentMeta): string {
  if (doc.contentSource?.type === "opencode-db") return doc.contentSource.dbPath;
  return doc.absolutePath;
}

function summarizeRepos(docs: DocumentMeta[]) {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    counts.set(doc.repoName, (counts.get(doc.repoName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response) => {
    handler(request, response).catch((error: unknown) => {
      console.error(error);
      response.status(500).json({ error: "Internal server error" });
    });
  };
}

function notFound(response: Response) {
  return response.status(404).json({ error: "Document not found" });
}

function computeETag(docs: DocumentMeta[]): string {
  const digest = createHash("md5");
  for (const doc of docs) digest.update(`${doc.id}:${doc.mtimeMs}\n`);
  return `"${digest.digest("hex")}"`;
}
