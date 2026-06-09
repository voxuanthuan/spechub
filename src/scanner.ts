import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { defaultConfig, normalizeOverridePath } from "./config.js";
import { scanOpenCodePlanSource } from "./opencode.js";
import type { DocumentCategory, DocumentKind, DocumentMeta, SpecHubConfig, SpecHubSource } from "./types.js";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

interface RepoHint {
  root: string;
  name: string;
}

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
  const sources = config.sources ?? (
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
  const docs = await Promise.all(
    sources.map((source) => scanSource(source, resolved.ignorePatterns, resolved.titleOverrides, repoHints))
  );

  return docs
    .flat()
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.repoName.localeCompare(right.repoName) || left.relativePath.localeCompare(right.relativePath));
}

async function scanSource(
  source: SpecHubSource,
  ignorePatterns: string[],
  titleOverrides: Record<string, string>,
  repoHints: RepoHint[]
): Promise<DocumentMeta[]> {
  if (source.mode === "opencode-db") {
    return scanOpenCodePlanSource(source, titleOverrides, repoHints);
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
    const [stats, raw] = await Promise.all([stat(absolutePath), readFile(absolutePath, "utf8")]);
    const sourceTitle = extractTitle(raw, relativePath, kind);
    const override = titleOverrides[normalizeOverridePath(absolutePath)];
    return {
      id: documentId(absolutePath),
      title: override ?? sourceTitle,
      sourceTitle,
      kind,
      category: defaultCategory ?? inferCategory(relativePath),
      sourceName,
      absolutePath,
      relativePath: normalizePath(relativePath),
      repoName: inferRepoName(raw, repoHints) ?? repoNameOverride ?? path.basename(repoRoot),
      repoRoot,
      modifiedAt: stats.mtime.toISOString(),
      mtimeMs: stats.mtimeMs,
      sizeBytes: stats.size
    };
  } catch {
    return null;
  }
}

function inferRepoName(raw: string, repoHints: RepoHint[]): string | undefined {
  const normalizedRaw = normalizePath(raw);
  const byRootLength = [...repoHints].sort((left, right) => right.root.length - left.root.length);
  const exactRoot = byRootLength.find((repo) => normalizedRaw.includes(repo.root));
  if (exactRoot) return exactRoot.name;

  return byRootLength.find((repo) => new RegExp(`(^|[^\\w-])${escapeRegExp(repo.name)}([^\\w-]|$)`, "i").test(raw))?.name;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  return path.basename(relativePath, path.extname(relativePath)).replace(/[-_]+/g, " ");
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

function toFastGlobIgnore(ignorePatterns: string[]): string[] {
  return ignorePatterns.flatMap((pattern) => {
    if (pattern.includes("*") || pattern.includes("/")) return [pattern, `${pattern}/**`];
    return [`**/${pattern}/**`, `**/${pattern}`];
  });
}

function isIgnored(relativePath: string, ignorePatterns: string[]): boolean {
  const segments = normalizePath(relativePath).split("/");
  return ignorePatterns.some((pattern) => {
    if (!pattern.includes("*") && !pattern.includes("/")) return segments.includes(pattern);
    return fg.isDynamicPattern(pattern) ? false : segments.includes(pattern);
  });
}

function normalizePath(input: string): string {
  return input.split(path.sep).join("/");
}

async function pathExists(input: string): Promise<boolean> {
  try {
    await stat(input);
    return true;
  } catch {
    return false;
  }
}
