import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SpecHubConfig, SpecHubSource } from "./types.js";

export const DEFAULT_IGNORE_PATTERNS = [
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  ".trash"
];

export const DEFAULT_DOC_PATTERNS = [
  "docs/**/*.{md,markdown,html}",
  "docs/superpowers/**/*.{md,html}",
  "docs/supperspowers/**/*.{md,html}",
  "docs/plans/**/*.md",
  "docs/specs/**/*.{md,html}",
  "specs/**/*.{md,html}",
  "Spec.md",
  "spec.md",
  "plan.md"
];

export const DEFAULT_CONFIG_PATH = "~/.config/spechub/config.json";

const DEFAULT_AGENT_DOC_PATTERNS = [
  "plans/**/*.{md,markdown,html}",
  "plan/**/*.{md,markdown,html}",
  "specs/**/*.{md,markdown,html}",
  "spec/**/*.{md,markdown,html}",
  "docs/**/*.{md,markdown,html}",
  "reports/**/*.{md,markdown,html}"
];

const DEFAULT_AGENT_SOURCE_NAMES = ["opencode", "codex", "claude", "cursor", "augment", "windsurf"];

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function defaultConfig(): SpecHubConfig {
  const roots = ["~/workspace", "~/.multica/server"].map(expandHome);
  const docPatterns = [...DEFAULT_DOC_PATTERNS];
  return {
    roots,
    ignorePatterns: [...DEFAULT_IGNORE_PATTERNS],
    docPatterns,
    sources: [
      legacySource(roots, docPatterns),
      ...DEFAULT_AGENT_SOURCE_NAMES.map((name) => ({
        name,
        mode: "direct" as const,
        roots: defaultAgentRoots(name),
        patterns: [...DEFAULT_AGENT_DOC_PATTERNS],
        inferRepoFromContent: true,
        defaultCategory: "plan" as const
      }))
    ],
    titleOverrides: {}
  };
}

function defaultAgentRoots(name: string): string[] {
  const roots = [expandHome(`~/.${name}`)];
  if (name === "opencode") {
    roots.push(expandHome("~/.local/share/opencode"));
  }
  return roots;
}

export function normalizeOverridePath(input: string): string {
  return path.resolve(expandHome(input));
}

export function normalizeTitleOverrides(overrides: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(overrides)
      .map(([key, value]) => [normalizeOverridePath(key), value.trim()])
      .filter(([, value]) => value.length > 0)
  );
}

function legacySource(roots: string[], docPatterns: string[]): SpecHubSource {
  return {
    name: "repositories",
    mode: "repositories",
    roots,
    patterns: docPatterns
  };
}

function normalizeSources(
  config: {
    roots?: string[];
    docPatterns?: string[];
    sources?: SpecHubSource[];
  },
  fallback: SpecHubConfig
): SpecHubSource[] {
  if (config.sources?.length) {
    return config.sources.map((source) => ({
      name: source.name,
      mode: source.mode,
      roots: source.roots.map(expandHome),
      patterns: [...source.patterns],
      inferRepoFromContent: source.inferRepoFromContent,
      defaultCategory: source.defaultCategory
    }));
  }

  if (!config.roots && !config.docPatterns) {
    return fallback.sources;
  }

  const roots = (config.roots ?? fallback.roots).map(expandHome);
  const docPatterns = config.docPatterns ?? fallback.docPatterns;
  return [
    legacySource(roots, docPatterns),
    ...fallback.sources.filter((source) => source.mode === "direct")
  ];
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<Partial<SpecHubConfig>> {
  const resolvedPath = expandHome(configPath);
  try {
    await access(resolvedPath);
  } catch {
    return {};
  }

  const raw = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<SpecHubConfig>;
  return {
    roots: parsed.roots?.map(expandHome),
    ignorePatterns: parsed.ignorePatterns,
    docPatterns: parsed.docPatterns,
    sources: parsed.sources,
    titleOverrides: parsed.titleOverrides
  };
}

export async function updateTitleOverride(configPath: string, absolutePath: string, title: string): Promise<void> {
  const resolvedPath = expandHome(configPath);
  let existing: Partial<SpecHubConfig> = {};
  try {
    existing = JSON.parse(await readFile(resolvedPath, "utf8")) as Partial<SpecHubConfig>;
  } catch {
    existing = {};
  }

  const titleOverrides = normalizeTitleOverrides(existing.titleOverrides);
  const key = normalizeOverridePath(absolutePath);
  const trimmed = title.trim();

  if (trimmed) {
    titleOverrides[key] = trimmed;
  } else {
    delete titleOverrides[key];
  }

  await mkdir(path.dirname(resolvedPath), { recursive: true });
  const tempPath = `${resolvedPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ ...existing, titleOverrides }, null, 2)}\n`, "utf8");
  await rename(tempPath, resolvedPath);
}

export async function resolveConfig(options: {
  configPath?: string;
  roots?: string[];
} = {}): Promise<SpecHubConfig> {
  const base = defaultConfig();
  const fileConfig = await loadConfig(options.configPath ?? DEFAULT_CONFIG_PATH);

  const roots = (options.roots?.length ? options.roots : fileConfig.roots ?? base.roots).map(expandHome);
  const docPatterns = fileConfig.docPatterns ?? base.docPatterns;

  return {
    roots,
    ignorePatterns: fileConfig.ignorePatterns ?? base.ignorePatterns,
    docPatterns,
    sources: normalizeSources(
      {
        roots: options.roots?.length ? options.roots : fileConfig.roots,
        docPatterns: fileConfig.docPatterns,
        sources: fileConfig.sources
      },
      base
    ),
    titleOverrides: normalizeTitleOverrides(fileConfig.titleOverrides)
  };
}
