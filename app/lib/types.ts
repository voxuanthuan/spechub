export type DocumentKind = "markdown" | "html";
export type DocumentCategory = "plan" | "spec" | "superpowers" | "doc";
export type CategoryFilter = DocumentCategory | "all";
export type DateFilter = "all" | "1" | "3" | "7" | "30";
export type Accent = "Green" | "Blue" | "Violet" | "Amber";
export type Density = "compact" | "regular" | "comfy";
export type ActiveView = "documents" | "prompts";
export type RepoSummary = { name: string; count: number };

export interface ConfigRoot {
  path: string;
  expandedPath: string;
  exists: boolean;
}

export interface ConfigInfo {
  configPath: string;
  roots: ConfigRoot[];
  explicitRoots: boolean;
  warnings: string[];
}

export interface DraftRoot {
  id: string;
  path: string;
  initial: ConfigRoot | null;
}

export interface DocumentMeta {
  id: string;
  title: string;
  sourceTitle: string;
  kind: DocumentKind;
  category: DocumentCategory;
  sourceName: string;
  absolutePath: string;
  relativePath: string;
  repoName: string;
  repoRoot: string;
  modifiedAt: string;
  mtimeMs: number;
  sizeBytes: number;
}

export interface DocumentDetail extends DocumentMeta {
  rawUrl?: string;
  rawContent?: string;
  renderedHtml?: string;
}

export interface DocumentPayload {
  docs: DocumentMeta[];
  repos: Array<{ name: string; count: number }>;
}

export interface SpecHubState {
  favorites: string[];
  tags: Record<string, string[]>;
  hiddenRepos: string[];
}

export interface AccentTokens {
  accent: string;
  strong: string;
  soft: string;
  line: string;
  softDark: string;
  lineDark: string;
}
