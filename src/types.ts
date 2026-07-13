export type DocumentKind = "markdown" | "html";
export type DocumentCategory = "plan" | "spec" | "superpowers" | "doc";
export type SourceMode = "repositories" | "direct" | "opencode-db" | "worktrees";

export type DocumentContentSource =
  | { type: "file" }
  | { type: "opencode-db"; dbPath: string; sessionId: string };

export interface SpecHubSource {
  name: string;
  mode: SourceMode;
  roots: string[];
  patterns: string[];
  inferRepoFromContent?: boolean;
  defaultCategory?: DocumentCategory;
}

export interface SpecHubConfig {
  roots: string[];
  ignorePatterns: string[];
  docPatterns: string[];
  sources: SpecHubSource[];
  titleOverrides: Record<string, string>;
  shareServerUrl?: string;
  /**
   * When true, docs from agent storage outside the configured roots are filtered
   * to those belonging to a repo under `roots`. Runtime-only; not persisted to config.json.
   */
  restrictAgentStorageToRoots?: boolean;
  maxPlanSessions?: number;
  watchDepth?: number;
}

export type RuntimeSpecHubConfig = Partial<SpecHubConfig> & {
  configPath?: string;
  explicitRoots?: boolean;
  statePath?: string;
  shareStateDir?: string;
};

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
  contentSource?: DocumentContentSource;
}

export interface DocumentDetail extends DocumentMeta {
  rawUrl: string;
  renderedHtml?: string;
}

export interface SharedDocument {
  schemaVersion: 1;
  title: string;
  kind: DocumentKind;
  category: DocumentCategory;
  repoName: string;
  relativePath: string;
  modifiedAt: string;
  content: string;
  publishedAt: string;
}

export interface DocumentShare {
  id: string;
  url: string;
  secret: string;
  serverUrl?: string;
  updatedAt: string;
}

export interface PublicDocumentShare {
  id: string;
  url: string;
  updatedAt: string;
}
