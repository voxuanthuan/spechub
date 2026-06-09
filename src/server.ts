import { access, readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type Request, type Response } from "express";
import {
  DEFAULT_CONFIG_PATH,
  expandHome,
  readConfigFile,
  resolveConfig,
  updateRoots,
  updateTitleOverride
} from "./config.js";
import { renderMarkdown } from "./markdown.js";
import { readOpenCodePlanContent } from "./opencode.js";
import { openLocalPath } from "./opener.js";
import { scanDocuments } from "./scanner.js";
import type { DocumentMeta, RuntimeSpecHubConfig, SpecHubConfig } from "./types.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const legacyWebDir = path.join(moduleDir, "web");
const nextOutDirs = [path.resolve(moduleDir, "..", "out"), path.resolve(moduleDir, "..", "..", "out")];

export function createApp(config: RuntimeSpecHubConfig = {}): Express {
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

  app.get("/api/docs", asyncRoute(async (_request, response) => {
    const docs = await scanDocuments(await currentConfig(config));
    response.json({
      docs,
      repos: summarizeRepos(docs)
    });
  }));

  app.get("/api/docs/:id", asyncRoute(async (request, response) => {
    const doc = await findDocument(await currentConfig(config), request.params.id);
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
    const doc = await findDocument(await currentConfig(config), request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }

    response.type(doc.kind === "html" ? "html" : "text/markdown");
    response.send(await readDocumentContent(doc));
  }));

  app.post("/api/docs/:id/open-source", asyncRoute(async (request, response) => {
    const doc = await findDocument(await currentConfig(config), request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }
    await openLocalPath(sourcePath(doc));
    response.json({ ok: true });
  }));

  app.patch("/api/docs/:id/title", asyncRoute(async (request, response) => {
    const doc = await findDocument(await currentConfig(config), request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }

    const title = typeof request.body?.title === "string" ? request.body.title : "";
    await updateTitleOverride(config.configPath ?? DEFAULT_CONFIG_PATH, doc.absolutePath, title);
    const updated = await findDocument(await currentConfig(config), request.params.id);
    response.json({ doc: updated ?? doc });
  }));

  app.get("/api/config", asyncRoute(async (_request, response) => {
    response.json(await describeConfig(config));
  }));

  app.patch("/api/config/roots", asyncRoute(async (request, response) => {
    const candidate = request.body?.roots;
    if (!Array.isArray(candidate) || !candidate.every((entry: unknown) => typeof entry === "string")) {
      response.status(400).json({ error: "roots must be an array of strings." });
      return;
    }
    try {
      await updateRoots(config.configPath ?? DEFAULT_CONFIG_PATH, candidate);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Invalid roots." });
      return;
    }
    response.json(await describeConfig(config));
  }));

  app.post("/api/docs/:id/open-folder", asyncRoute(async (request, response) => {
    const doc = await findDocument(await currentConfig(config), request.params.id);
    if (!doc) {
      notFound(response);
      return;
    }
    await openLocalPath(path.dirname(sourcePath(doc)));
    response.json({ ok: true });
  }));

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
  const app = createApp(config);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
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
  if (explicitRoots) {
    warnings.push("Server was started with --roots; saved roots take effect on next launch.");
  }
  return { configPath, roots, explicitRoots, warnings };
}

async function findDocument(config: Partial<SpecHubConfig>, id: string): Promise<DocumentMeta | undefined> {
  const docs = await scanDocuments(config);
  return docs.find((doc) => doc.id === id);
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
