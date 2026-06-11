import { EventEmitter } from "node:events";
import type { Stats } from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { DEFAULT_CONFIG_PATH, expandHome, defaultConfig, resolveConfig } from "./config.js";
import { scanDocuments } from "./scanner.js";
import type { DocumentMeta, RuntimeSpecHubConfig, SpecHubConfig } from "./types.js";

const WATCH_EXTENSIONS = new Set([".md", ".markdown", ".html", ".db"]);
const DEFAULT_DEBOUNCE_MS = 500;
const WATCH_DEPTH = 8;

export interface DocumentIndex {
  events: EventEmitter;
  getDocs(): Promise<DocumentMeta[]>;
  findById(id: string): Promise<DocumentMeta | undefined>;
  refresh(): Promise<DocumentMeta[]>;
  invalidate(): void;
  startWatching(): Promise<void>;
  close(): Promise<void>;
}

interface DocumentIndexOptions {
  debounceMs?: number;
}

interface DocsChangedEvent {
  version: number;
}

export function createDocumentIndex(
  runtimeConfig: RuntimeSpecHubConfig = {},
  options: DocumentIndexOptions = {}
): DocumentIndex {
  const events = new EventEmitter();
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let docs: DocumentMeta[] | null = null;
  let scanPromise: Promise<DocumentMeta[]> | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let version = 0;
  let watcher: FSWatcher | null = null;
  let watching = false;
  let watchedSignature = "";
  let closing = false;

  async function getDocs(): Promise<DocumentMeta[]> {
    if (docs) return docs;
    return runScan(false);
  }

  async function findById(id: string): Promise<DocumentMeta | undefined> {
    return (await getDocs()).find((doc) => doc.id === id);
  }

  async function refresh(): Promise<DocumentMeta[]> {
    return runScan(true);
  }

  function invalidate(): void {
    if (closing) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void refresh().catch((error: unknown) => {
        console.warn("SpecHub index refresh failed:", error);
      });
    }, debounceMs);
  }

  async function startWatching(): Promise<void> {
    watching = true;
    await resetWatcher(await resolveRuntimeConfig(runtimeConfig));
  }

  async function close(): Promise<void> {
    closing = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      const current = watcher;
      watcher = null;
      await current.close();
    }
    events.removeAllListeners();
  }

  async function runScan(force: boolean): Promise<DocumentMeta[]> {
    if (!force && docs) return docs;
    if (scanPromise) return scanPromise;

    scanPromise = (async () => {
      const resolved = await resolveRuntimeConfig(runtimeConfig);
      const nextDocs = await scanDocuments(resolved);
      docs = nextDocs;
      if (force) {
        version += 1;
        events.emit("docs-changed", { version } satisfies DocsChangedEvent);
      }
      if (watching && !closing) {
        await resetWatcher(resolved);
      }
      return nextDocs;
    })();

    try {
      return await scanPromise;
    } finally {
      scanPromise = null;
    }
  }

  async function resetWatcher(config: Partial<SpecHubConfig>): Promise<void> {
    const watchPaths = watchPathsForConfig(config, runtimeConfig.configPath);
    const signature = watchPaths.join("\n");
    if (watcher && signature === watchedSignature) return;

    if (watcher) {
      const current = watcher;
      watcher = null;
      await current.close();
    }

    watchedSignature = signature;
    if (watchPaths.length === 0) return;

    const roots = watchPaths.map((item) => path.resolve(item));
    watcher = chokidar.watch(roots, {
      ignoreInitial: true,
      depth: WATCH_DEPTH,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      ignored: (candidate, stats) => shouldIgnoreWatchPath(candidate.toString(), roots, config.ignorePatterns ?? defaultConfig().ignorePatterns, stats)
    });
    watcher
      .on("add", (changedPath) => handleWatchEvent("add", changedPath))
      .on("change", (changedPath) => handleWatchEvent("change", changedPath))
      .on("unlink", (changedPath) => handleWatchEvent("unlink", changedPath))
      .on("addDir", (changedPath) => handleWatchEvent("addDir", changedPath))
      .on("unlinkDir", (changedPath) => handleWatchEvent("unlinkDir", changedPath))
      .on("error", (error) => {
        console.warn("SpecHub file watcher disabled:", error);
      });
    await new Promise<void>((resolve) => {
      watcher?.once("ready", resolve);
      watcher?.once("error", () => resolve());
    });
  }

  function handleWatchEvent(eventName: string, changedPath: string): void {
    if (eventName === "addDir" || eventName === "unlinkDir" || isConfigPath(changedPath, runtimeConfig.configPath)) {
      invalidate();
      return;
    }

    if (WATCH_EXTENSIONS.has(path.extname(changedPath).toLowerCase())) {
      invalidate();
    }
  }

  return { events, getDocs, findById, refresh, invalidate, startWatching, close };
}

async function resolveRuntimeConfig(config: RuntimeSpecHubConfig): Promise<Partial<SpecHubConfig>> {
  if (config.configPath) {
    return resolveConfig({
      configPath: config.configPath,
      roots: config.explicitRoots === false ? undefined : config.roots
    });
  }
  return config;
}

function watchPathsForConfig(config: Partial<SpecHubConfig>, configPath?: string): string[] {
  const defaults = defaultConfig();
  const roots = config.roots ?? defaults.roots;
  const sources = config.sources ?? (
    config.roots || config.docPatterns
      ? [
          {
            name: "repositories",
            mode: "repositories" as const,
            roots,
            patterns: config.docPatterns ?? defaults.docPatterns
          }
        ]
      : defaults.sources
  );
  const paths = new Set<string>();
  paths.add(path.resolve(expandHome(configPath ?? DEFAULT_CONFIG_PATH)));
  for (const root of roots) paths.add(path.resolve(expandHome(root)));
  for (const source of sources) {
    for (const root of source.roots) {
      const resolved = path.resolve(expandHome(root));
      paths.add(source.mode === "opencode-db" && !path.basename(resolved).endsWith(".db")
        ? path.join(resolved, "opencode.db")
        : resolved);
    }
  }
  return [...paths].sort();
}

function shouldIgnoreWatchPath(candidate: string, roots: string[], ignorePatterns: string[], stats?: Stats): boolean {
  const resolved = path.resolve(candidate);
  const relative = relativeToNearestRoot(resolved, roots);
  if (relative && isIgnored(relative, ignorePatterns)) return true;
  const extension = path.extname(resolved).toLowerCase();
  if (stats?.isFile()) return !WATCH_EXTENSIONS.has(extension);
  if (extension && !WATCH_EXTENSIONS.has(extension)) return true;
  return false;
}

function relativeToNearestRoot(candidate: string, roots: string[]): string | undefined {
  const normalizedCandidate = normalizePath(candidate);
  const root = [...roots]
    .map((item) => normalizePath(path.resolve(item)))
    .sort((left, right) => right.length - left.length)
    .find((item) => normalizedCandidate === item || normalizedCandidate.startsWith(`${item}/`));
  if (!root || normalizedCandidate === root) return undefined;
  return normalizedCandidate.slice(root.length + 1);
}

function isConfigPath(candidate: string, configPath?: string): boolean {
  return path.resolve(candidate) === path.resolve(expandHome(configPath ?? DEFAULT_CONFIG_PATH));
}

function isIgnored(relativePath: string, ignorePatterns: string[]): boolean {
  const segments = normalizePath(relativePath).split("/");
  return ignorePatterns.some((pattern) => {
    if (!pattern.includes("*") && !pattern.includes("/")) return segments.includes(pattern);
    return pattern.includes("*") ? false : segments.includes(pattern);
  });
}

function normalizePath(input: string): string {
  return input.split(path.sep).join("/");
}
