import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expandHome } from "./paths.js";
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
  ".opencode/agents/**/*.{md,markdown,html}",
  "docs/**/*.{md,markdown,html}",
  "docs/superpowers/plans/**/*.{md,markdown,html}",
  "docs/superpowers/specs/**/*.{md,markdown,html}",
  "docs/superpowers/**/*.{md,html}",
  // Typo-tolerant variants of "superpowers" seen in the wild:
  "docs/supperpowers/plans/**/*.{md,markdown,html}",
  "docs/supperpowers/specs/**/*.{md,markdown,html}",
  "docs/supperpowers/**/*.{md,html}",
  "docs/supperspowers/plans/**/*.{md,markdown,html}",
  "docs/supperspowers/specs/**/*.{md,markdown,html}",
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
  "agents/**/*.{md,markdown,html}",
  "plans/**/*.{md,markdown,html}",
  "plan/**/*.{md,markdown,html}",
  "specs/**/*.{md,markdown,html}",
  "spec/**/*.{md,markdown,html}",
  "docs/**/*.{md,markdown,html}",
  "reports/**/*.{md,markdown,html}"
];

const DEFAULT_AGENT_SOURCE_NAMES = ["opencode", "codex", "claude", "cursor", "augment", "windsurf"];

export { expandHome } from "./paths.js";

export function defaultConfig(): SpecHubConfig {
  const roots = ["~/workspace", "~/.multica/server"].map(expandHome);
  const docPatterns = [...DEFAULT_DOC_PATTERNS];
  return {
    roots,
    ignorePatterns: [...DEFAULT_IGNORE_PATTERNS],
    docPatterns,
    sources: [
      legacySource(roots, docPatterns),
      ...DEFAULT_AGENT_SOURCE_NAMES.flatMap((name) => [
        {
          name,
          mode: "direct" as const,
          roots: defaultAgentRoots(name),
          patterns: [...DEFAULT_AGENT_DOC_PATTERNS],
          inferRepoFromContent: true,
          defaultCategory: "plan" as const
        },
        ...(name === "opencode"
          ? [
              {
                name: "opencode-plan-sessions",
                mode: "opencode-db" as const,
                roots: [expandHome("~/.local/share/opencode")],
                patterns: [],
                inferRepoFromContent: true,
                defaultCategory: "plan" as const
              }
            ]
          : [])
      ]),
    ],
    titleOverrides: {}
  };
}

function defaultAgentRoots(name: string): string[] {
  const roots = [expandHome(`~/.${name}`)];
  if (name === "opencode") {
    roots.push(expandHome("~/.config/opencode"));
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
    patterns: mergeDefaultDocPatterns(docPatterns)
  };
}

function mergeDefaultDocPatterns(docPatterns: string[]): string[] {
  return [...new Set([...docPatterns, ...DEFAULT_DOC_PATTERNS])];
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
      patterns: source.mode === "repositories" ? mergeDefaultDocPatterns(source.patterns) : [...source.patterns],
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
    ...fallback.sources.filter((source) => source.name !== "repositories")
  ];
}

export async function readConfigFile(configPath: string): Promise<Partial<SpecHubConfig>> {
  const resolvedPath = expandHome(configPath);
  try {
    await access(resolvedPath);
  } catch {
    return {};
  }
  const raw = await readFile(resolvedPath, "utf8");
  try {
    return JSON.parse(raw) as Partial<SpecHubConfig>;
  } catch (error) {
    console.warn(`SpecHub config could not be parsed: ${resolvedPath}`, error);
    return {};
  }
}

export async function describeConfigFileProblem(configPath: string): Promise<string | null> {
  const resolvedPath = expandHome(configPath);
  try {
    await access(resolvedPath);
  } catch {
    return null;
  }
  try {
    JSON.parse(await readFile(resolvedPath, "utf8"));
    return null;
  } catch {
    return `Config file could not be parsed: ${resolvedPath}. Defaults are being used until the file is fixed.`;
  }
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<Partial<SpecHubConfig>> {
  const parsed = await readConfigFile(configPath);
  if (!Object.keys(parsed).length) return {};
  return {
    roots: parsed.roots?.map(expandHome),
    ignorePatterns: parsed.ignorePatterns,
    docPatterns: parsed.docPatterns,
    sources: parsed.sources,
    titleOverrides: parsed.titleOverrides
  };
}

export function normalizeRoots(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of roots) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = expandHome(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export async function mutateJsonFile<T>(
  filePath: string,
  readExisting: () => Promise<T>,
  mutator: (existing: T) => T | Promise<T>
): Promise<T> {
  const resolvedPath = expandHome(filePath);
  const existing = await readExisting();
  const next = mutator(existing);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  const tempPath = `${resolvedPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(await next, null, 2)}\n`, "utf8");
  await rename(tempPath, resolvedPath);
  return next;
}

async function mutateConfigFile(
  configPath: string,
  mutator: (existing: Partial<SpecHubConfig>) => Partial<SpecHubConfig>
): Promise<Partial<SpecHubConfig>> {
  return mutateJsonFile(configPath, () => readConfigFile(configPath), mutator);
}

export async function updateTitleOverride(configPath: string, absolutePath: string, title: string): Promise<void> {
  await mutateConfigFile(configPath, (existing) => {
    const titleOverrides = normalizeTitleOverrides(existing.titleOverrides);
    const key = normalizeOverridePath(absolutePath);
    const trimmed = title.trim();
    if (trimmed) {
      titleOverrides[key] = trimmed;
    } else {
      delete titleOverrides[key];
    }
    return { ...existing, titleOverrides };
  });
}

export async function updateRoots(configPath: string, roots: readonly string[]): Promise<string[]> {
  const normalized = normalizeRoots(roots);
  if (normalized.length === 0) {
    throw new Error("At least one workspace root is required.");
  }
  await mutateConfigFile(configPath, (existing) => {
    const next: Partial<SpecHubConfig> = { ...existing, roots: normalized };
    if (existing.sources?.length) {
      next.sources = existing.sources.map((source) =>
        source.mode === "repositories" ? { ...source, roots: normalized } : source
      );
    }
    return next;
  });
  return normalized;
}

export async function resolveConfig(options: {
  configPath?: string;
  roots?: string[];
} = {}): Promise<SpecHubConfig> {
  const base = defaultConfig();
  const fileConfig = await loadConfig(options.configPath ?? DEFAULT_CONFIG_PATH);

  const roots = (options.roots?.length ? options.roots : fileConfig.roots ?? base.roots).map(expandHome);
  const docPatterns = mergeDefaultDocPatterns(fileConfig.docPatterns ?? base.docPatterns);
  const restrictAgentStorageToRoots = Boolean(options.roots?.length) || Boolean(fileConfig.roots?.length);

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
    titleOverrides: normalizeTitleOverrides(fileConfig.titleOverrides),
    restrictAgentStorageToRoots
  };
}
