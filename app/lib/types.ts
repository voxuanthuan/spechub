export type DocumentKind = "markdown" | "html";
export type DocumentCategory = "plan" | "spec" | "superpowers" | "doc";
export type CategoryFilter = DocumentCategory | "all";

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

export interface WorkflowMeta {
  artifact: WorkflowArtifact;
  effort?: string;
  ticketNumber?: string;
  triageState?: TriageState;
  ticketType?: WayfinderTicketType;
  ticketStatus?: WayfinderTicketStatus;
  blockedBy?: string[];
}

export type TriageStateFilter = TriageState | "all";
export type ArtifactFilter = WorkflowArtifact | "all";
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

export interface ConfigFileSource {
  name: string;
  roots: ConfigRoot[];
}

export interface ConfigInfo {
  configPath: string;
  roots: ConfigRoot[];
  fileSources: ConfigFileSource[];
  explicitRoots: boolean;
  shareServerUrl: string;
  warnings: string[];
}

export interface DraftRoot {
  id: string;
  path: string;
  initial: ConfigRoot | null;
}

export interface DraftFileSource {
  id: string;
  name: string;
  path: string;
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
  workflow?: WorkflowMeta;
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

export interface DocumentShare {
  id: string;
  url: string;
  updatedAt: string;
}

export interface SpecHubState {
  favorites: string[];
  tags: Record<string, string[]>;
  hiddenRepos: string[];
}

export type AnnotationType = "comment" | "highlight" | "deletion";

export type AgentOrigin = "claude-code" | "opencode" | "codex" | "copilot-cli" | "gemini-cli";

export interface Annotation {
  id: string;
  docId: string;
  type: AnnotationType;
  selectedText: string;
  text: string;
  startOffset: number;
  endOffset: number;
  createdAt: number;
}

export interface AgentFeedbackPayload {
  docId: string;
  docTitle: string;
  docPath: string;
  annotations: Annotation[];
  agent: AgentOrigin;
}

export interface AccentTokens {
  accent: string;
  strong: string;
  soft: string;
  line: string;
  softDark: string;
  lineDark: string;
}
