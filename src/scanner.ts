import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import micromatch from "micromatch";
import { defaultConfig, normalizeOverridePath } from "./config.js";
import { scanOpenCodePlanSource } from "./opencode.js";
import { findHintByPath, inferRepoFromContent, normalizePath, type RepoHint } from "./paths.js";
import type { DocumentCategory, DocumentKind, DocumentMeta, SpecHubConfig, SpecHubSource } from "./types.js";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const LOCAL_AGENT_DISCOVERY_DEPTH = 6;
const TITLE_READ_BYTES = 4096;

export async function scanDocuments(config: Partial<SpecHubConfig> = {}): Promise<DocumentMeta[]> {
  const defaults = defaultConfig();
  const resolved = {
    ...defaults,
    ...config,
    roots: config.roots ?? defaults.roots,
    ignorePatterns: config.ignorePatterns ?? defaults.ignorePatterns,
    docPatterns: config.docPatterns ?? defaults.docPatterns,
    titleOverrides: config.titleOverrides ?? defaults.titleOverrides
  };
  const sources: SpecHubSource[] = config.sources ?? (
    config.roots || config.docPatterns
      ? [
          {
            name: "repositories",
            mode: "repositories" as const,
            roots: resolved.roots,
            patterns: resolved.docPatterns
          }
        ]
      : defaults.sources
  );
  const repoHints = await createRepoHints(resolved.roots, resolved.ignorePatterns);
  const localAgentSources = sources.some((source) => source.mode === "repositories")
    ? await discoverLocalAgentSources(resolved.roots, resolved.ignorePatterns, defaults.sources, sources)
    : [];
  const docs = await Promise.all(
    [...sources, ...localAgentSources].map((source) =>
      scanSource(source, resolved.ignorePatterns, resolved.titleOverrides, repoHints, resolved.maxPlanSessions)
    )
  );

  const uniqueDocs = new Map<string, DocumentMeta>();
  for (const doc of docs.flat()) {
    const key = path.resolve(doc.absolutePath);
    if (!uniqueDocs.has(key)) uniqueDocs.set(key, doc);
  }

  const scopedDocs = config.restrictAgentStorageToRoots
    ? [...uniqueDocs.values()].filter((doc) => isWithinRootScope(doc, resolved.roots, repoHints))
    : [...uniqueDocs.values()];

  return scopedDocs
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.repoName.localeCompare(right.repoName) || left.relativePath.localeCompare(right.relativePath));
}

async function scanSource(
  source: SpecHubSource,
  ignorePatterns: string[],
  titleOverrides: Record<string, string>,
  repoHints: RepoHint[],
  maxPlanSessions?: number
): Promise<DocumentMeta[]> {
  if (source.mode === "opencode-db") {
    return scanOpenCodePlanSource(source, titleOverrides, repoHints, maxPlanSessions);
  }

  if (source.mode === "direct") {
    const docs = await Promise.all(
      source.roots.map((root) => scanDirectRoot(root, source, ignorePatterns, titleOverrides, repoHints))
    );
    return docs.flat();
  }

  const repoRoots = await discoverRepositoryRoots(source.roots, ignorePatterns);
  const docs = await Promise.all(
    repoRoots.map((repoRoot) => scanRepository(repoRoot, source.patterns, ignorePatterns, titleOverrides, source.name, [], source.defaultCategory))
  );
  return docs.flat();
}

async function scanDirectRoot(
  root: string,
  source: SpecHubSource,
  ignorePatterns: string[],
  titleOverrides: Record<string, string>,
  repoHints: RepoHint[]
): Promise<DocumentMeta[]> {
  const repoRoot = path.resolve(root);
  if (!(await pathExists(repoRoot))) return [];
  return scanRepository(
    repoRoot,
    source.patterns,
    ignorePatterns,
    titleOverrides,
    source.name,
    source.inferRepoFromContent ? repoHints : [],
    source.defaultCategory,
    source.name
  );
}

async function createRepoHints(roots: string[], ignorePatterns: string[]): Promise<RepoHint[]> {
  const repoRoots = await discoverRepositoryRoots(roots, ignorePatterns);
  return repoRoots.map((root) => ({
    root: normalizePath(path.resolve(root)),
    name: path.basename(root)
  }));
}

async function discoverLocalAgentSources(
  roots: string[],
  ignorePatterns: string[],
  sourceTemplates: SpecHubSource[],
  configuredSources: SpecHubSource[]
): Promise<SpecHubSource[]> {
  const directTemplates = sourceTemplates.filter((source) => source.mode === "direct");
  const templateByDirectory = new Map(directTemplates.map((source) => [`.${source.name}`, source]));
  const existingDirectRoots = new Set(
    configuredSources
      .filter((source) => source.mode === "direct")
      .flatMap((source) => source.roots.map((root) => path.resolve(root)))
  );
  const discovered = await discoverLocalAgentRoots(roots, templateByDirectory, ignorePatterns);

  return directTemplates.flatMap((template) => {
    const localRoots = [...(discovered.get(template.name) ?? [])]
      .map((root) => path.resolve(root))
      .filter((root) => !existingDirectRoots.has(root))
      .sort();

    if (localRoots.length === 0) return [];
    return [{ ...template, roots: localRoots }];
  });
}

async function discoverLocalAgentRoots(
  roots: string[],
  templateByDirectory: Map<string, SpecHubSource>,
  ignorePatterns: string[]
): Promise<Map<string, Set<string>>> {
  const discovered = new Map<string, Set<string>>();

  async function walk(directory: string, scanRoot: string, depth: number): Promise<void> {
    if (depth > LOCAL_AGENT_DISCOVERY_DEPTH) return;
    const relative = path.relative(scanRoot, directory);
    if (relative && isIgnored(relative, ignorePatterns)) return;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const template = templateByDirectory.get(entry.name);
          const child = path.join(directory, entry.name);

          if (template) {
            const sourceRoots = discovered.get(template.name) ?? new Set<string>();
            sourceRoots.add(child);
            discovered.set(template.name, sourceRoots);
            return;
          }

          await walk(child, scanRoot, depth + 1);
        })
    );
  }

  await Promise.all(
    roots.map(async (root) => {
      const scanRoot = path.resolve(root);
      if (!(await pathExists(scanRoot))) return;
      await walk(scanRoot, scanRoot, 0);
    })
  );

  return discovered;
}

export async function discoverRepositoryRoots(roots: string[], ignorePatterns: string[]): Promise<string[]> {
  const discovered = new Set<string>();

  for (const root of roots.map((item) => path.resolve(item))) {
    if (!(await pathExists(root))) continue;
    await walkForRepos(root, root, ignorePatterns, discovered, 0);
  }

  return [...discovered].sort();
}

async function walkForRepos(
  directory: string,
  scanRoot: string,
  ignorePatterns: string[],
  discovered: Set<string>,
  depth: number
) {
  if (depth > 6) return;
  const relative = path.relative(scanRoot, directory);
  if (relative && isIgnored(relative, ignorePatterns)) return;

  if (await isRepositoryLike(directory)) {
    discovered.add(directory);
    return;
  }

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => walkForRepos(path.join(directory, entry.name), scanRoot, ignorePatterns, discovered, depth + 1))
  );
}

async function isRepositoryLike(directory: string): Promise<boolean> {
  const markers = [".git", "package.json", "pnpm-workspace.yaml", "docs", "specs"];
  const checks = await Promise.all(markers.map((marker) => pathExists(path.join(directory, marker))));
  return checks.some(Boolean);
}

async function scanRepository(
  repoRoot: string,
  docPatterns: string[],
  ignorePatterns: string[],
  titleOverrides: Record<string, string>,
  sourceName: string,
  repoHints: RepoHint[] = [],
  defaultCategory?: DocumentCategory,
  repoNameOverride?: string
): Promise<DocumentMeta[]> {
  const paths = await fg(docPatterns, {
    cwd: repoRoot,
    onlyFiles: true,
    absolute: false,
    dot: false,
    unique: true,
    ignore: toFastGlobIgnore(ignorePatterns)
  });

  const docs = await Promise.all(
    paths.map((relativePath) =>
      createDocumentMeta(repoRoot, relativePath, titleOverrides, sourceName, repoHints, defaultCategory, repoNameOverride)
    )
  );
  return docs.filter((doc): doc is DocumentMeta => Boolean(doc));
}

async function readHead(filePath: string, bytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(filePath, { encoding: "utf8", end: bytes - 1 });
    stream.on("data", (chunk: string | Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

async function createDocumentMeta(
  repoRoot: string,
  relativePath: string,
  titleOverrides: Record<string, string>,
  sourceName: string,
  repoHints: RepoHint[],
  defaultCategory?: DocumentCategory,
  repoNameOverride?: string
): Promise<DocumentMeta | null> {
  const absolutePath = path.join(repoRoot, relativePath);
  const extension = path.extname(relativePath).toLowerCase();
  const kind: DocumentKind = MARKDOWN_EXTENSIONS.has(extension) ? "markdown" : extension === ".html" ? "html" : "markdown";

  try {
    const [stats, head] = await Promise.all([stat(absolutePath), readHead(absolutePath, TITLE_READ_BYTES)]);
    const sourceTitle = extractTitle(head, relativePath, kind);
    const override = titleOverrides[normalizeOverridePath(absolutePath)];
    const pathRepo = findHintByPath(absolutePath, repoHints);
    const contentRepo = pathRepo ? undefined : inferRepoName(head, repoHints);
    return {
      id: documentId(absolutePath),
      title: override ?? sourceTitle,
      sourceTitle,
      kind,
      category: defaultCategory ?? inferCategory(relativePath),
      sourceName,
      absolutePath,
      relativePath: normalizePath(relativePath),
      repoName: pathRepo?.name ?? contentRepo ?? repoNameOverride ?? path.basename(repoRoot),
      repoRoot,
      modifiedAt: stats.mtime.toISOString(),
      mtimeMs: stats.mtimeMs,
      sizeBytes: stats.size
    };
  } catch {
    return null;
  }
}

function isWithinRootScope(doc: DocumentMeta, roots: string[], repoHints: RepoHint[]): boolean {
  const rootPaths = roots.map((root) => normalizePath(path.resolve(root)));
  const isUnderRoots = (candidate: string): boolean => {
    const normalized = normalizePath(path.resolve(candidate));
    return rootPaths.some((root) => normalized === root || normalized.startsWith(`${root}/`));
  };

  if (isUnderRoots(doc.absolutePath) || isUnderRoots(doc.repoRoot)) return true;
  return repoHints.some((hint) => hint.name === doc.repoName);
}

function inferRepoName(raw: string, repoHints: RepoHint[]): string | undefined {
  return inferRepoFromContent(raw, repoHints)?.name;
}

function extractTitle(raw: string, relativePath: string, kind: DocumentKind): string {
  if (kind === "markdown") {
    const heading = raw.match(/^#\s+(.+)$/m);
    if (heading?.[1]) return cleanTitle(heading[1]);
  } else {
    const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (title?.[1]) return cleanTitle(title[1]);
    const h1 = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1?.[1]) return cleanTitle(stripTags(h1[1]));
  }

  return titleCaseSlug(path.basename(relativePath, path.extname(relativePath)));
}

function inferCategory(relativePath: string): DocumentCategory {
  const normalized = normalizePath(relativePath).toLowerCase();
  if (/(^|\/)(plans?|plan\.md)(\/|$)/.test(normalized)) return "plan";
  if (/(^|\/)(specs?|spec\.md|spec\.html|spec\.markdown)(\/|$)/.test(normalized)) return "spec";
  if (normalized.includes("superpowers") || normalized.includes("supperspowers")) return "superpowers";
  return "doc";
}

function documentId(absolutePath: string): string {
  return createHash("sha256").update(path.resolve(absolutePath)).digest("hex").slice(0, 20);
}

function cleanTitle(input: string): string {
  return stripTags(input).replace(/\s+/g, " ").trim();
}

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

function titleCaseSlug(input: string): string {
  return input
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toFastGlobIgnore(ignorePatterns: string[]): string[] {
  return ignorePatterns.flatMap((pattern) => {
    if (pattern.includes("*") || pattern.includes("/")) return [pattern, `${pattern}/**`];
    return [`**/${pattern}/**`, `**/${pattern}`];
  });
}

function isIgnored(relativePath: string, ignorePatterns: string[]): boolean {
  const normalized = normalizePath(relativePath);
  const segments = normalized.split("/");
  const simple = ignorePatterns.filter((pattern) => !pattern.includes("*") && !pattern.includes("/"));
  if (simple.some((pattern) => segments.includes(pattern))) return true;
  const globs = ignorePatterns.filter((pattern) => pattern.includes("*") || pattern.includes("/"));
  if (globs.length > 0 && micromatch.isMatch(normalized, globs)) return true;
  return false;
}

async function pathExists(input: string): Promise<boolean> {
  try {
    await stat(input);
    return true;
  } catch {
    return false;
  }
}
