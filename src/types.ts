export type DocumentKind = "markdown" | "html";
export type DocumentCategory = "plan" | "spec" | "superpowers" | "doc";
export type SourceMode = "repositories" | "direct" | "files" | "opencode-db" | "worktrees";

/** The five canonical triage state roles from the Matt Pocock engineering skills. */
export type TriageState = "needs-triage" | "needs-info" | "ready-for-agent" | "ready-for-human" | "wontfix";
export type WayfinderTicketType = "research" | "prototype" | "grilling" | "task";
export type WayfinderTicketStatus = "open" | "claimed" | "resolved";

export type WorkflowArtifact =
  | "wayfinder-map"
  | "wayfinder-ticket"
  | "feature-spec"
  | "adr"
  | "domain-context"
  | "agent-config"
  | "out-of-scope";

/**
 * Metadata parsed from Matt Pocock engineering-skills artifacts (local-markdown
 * tracker files, wayfinder maps/tickets, ADRs, domain docs). Present only when a
 * document matches one of those conventions; never written back — SpecHub is a viewer.
 */
export interface WorkflowMeta {
  artifact: WorkflowArtifact;
  /** The `.scratch/<effort>` slug for tracker artifacts. */
  effort?: string;
  /** Leading number of an `issues/NN-slug.md` ticket file. */
  ticketNumber?: string;
  /** Parsed from a `Status:` line whose value is one of the five triage roles. */
  triageState?: TriageState;
  /** Parsed from a `Type:` line (research/prototype/grilling/task). */
  ticketType?: WayfinderTicketType;
  /** Parsed from a `Status:` line (`claimed`/`resolved`); tickets default to `open`. */
  ticketStatus?: WayfinderTicketStatus;
  /** Parsed from a `Blocked by: NN, NN` line. */
  blockedBy?: string[];
}

export type DocumentContentSource =
  | { type: "file" }
  | { type: "opencode-db"; dbPath: string; sessionId: string };

export interface SpecHubSource {
  name: string;
  mode: SourceMode;
  roots: string[];
  /** Glob patterns for `repositories`/`direct`/`worktrees` modes. `files` mode ignores this. */
  patterns?: string[];
  inferRepoFromContent?: boolean;
  defaultCategory?: DocumentCategory;
  /**
   * `files`-mode scoping. When set, only files matching at least one of these
   * relative globs are kept (instead of the all-markdown/html default).
   */
  include?: string[];
  /** `files`-mode scoping. Relative globs whose matches are always dropped. */
  exclude?: string[];
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
  workflow?: WorkflowMeta;
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
