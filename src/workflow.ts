import { normalizePath } from "./paths.js";
import type {
  TriageState,
  WayfinderTicketStatus,
  WayfinderTicketType,
  WorkflowArtifact,
  WorkflowMeta
} from "./types.js";

/**
 * Workflow awareness for the Matt Pocock engineering skills. Detects their file
 * conventions (local-markdown tracker under `.scratch/`, wayfinder maps/tickets,
 * ADRs, domain docs, `.out-of-scope/` knowledge base) and parses the tracker key
 * lines (`Status:` / `Type:` / `Blocked by:`) those skills write near the top of
 * each file. Read-only: this module never writes workflow state.
 */

const TRIAGE_STATES: ReadonlySet<string> = new Set([
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix"
]);
const TICKET_TYPES: ReadonlySet<string> = new Set(["research", "prototype", "grilling", "task"]);
const TICKET_STATUSES: ReadonlySet<string> = new Set(["claimed", "resolved"]);

/** Tracker key lines live "near the top" of the file by convention — don't scan deeper. */
const HEADER_LINE_LIMIT = 20;

export function detectArtifact(relativePath: string): WorkflowArtifact | undefined {
  const segments = normalizePath(relativePath).split("/").filter(Boolean);
  if (segments.length === 0) return undefined;
  const base = segments[segments.length - 1];

  // Local-markdown issue tracker: .scratch/<effort>/{map.md,spec.md,issues/NN-slug.md}.
  // Matched by segment (not prefix) so nested worktree paths like
  // `.claude/worktrees/<wt>/.scratch/<effort>/...` are recognised too.
  const scratchIndex = segments.indexOf(".scratch");
  if (scratchIndex !== -1) {
    const rest = segments.slice(scratchIndex + 1);
    if (rest.length === 2 && rest[1].toLowerCase() === "map.md") return "wayfinder-map";
    if (rest.length === 2 && rest[1].toLowerCase() === "spec.md") return "feature-spec";
    if (rest.length === 3 && rest[1] === "issues") return "wayfinder-ticket";
    return undefined;
  }

  // Rejected-feature knowledge base: .out-of-scope/<concept>.md.
  if (segments.includes(".out-of-scope")) return "out-of-scope";

  // ADRs live in an `adr` directory directly under a `docs` directory:
  // docs/adr/, src/<context>/docs/adr/, or the worktree-nested variants.
  for (let index = 1; index < segments.length - 1; index += 1) {
    if (segments[index] === "adr" && segments[index - 1] === "docs") return "adr";
  }

  // Per-repo skill configuration written by /setup-matt-pocock-skills: docs/agents/*.
  for (let index = 1; index < segments.length - 1; index += 1) {
    if (segments[index] === "agents" && segments[index - 1] === "docs") return "agent-config";
  }

  // Domain glossary / context map (root or per-context under src/<context>/).
  if (base === "CONTEXT.md" || base === "CONTEXT-MAP.md") return "domain-context";

  return undefined;
}

export function parseWorkflowHead(
  head: string
): Pick<WorkflowMeta, "triageState" | "ticketType" | "ticketStatus" | "blockedBy"> {
  const meta: Pick<WorkflowMeta, "triageState" | "ticketType" | "ticketStatus" | "blockedBy"> = {};
  const lines = head.split("\n").slice(0, HEADER_LINE_LIMIT);
  for (const line of lines) {
    const match = line.match(/^\s*(Status|Type|Blocked by)\s*:\s*(\S.*?)\s*$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2];
    const token = value.split(/[\s,]+/)[0]?.toLowerCase().replace(/\.$/, "") ?? "";
    if (key === "status") {
      // The `Status:` line is overloaded by convention: triage roles for triage,
      // claimed/resolved for wayfinding. Classify by value; never guess.
      if (TRIAGE_STATES.has(token)) meta.triageState = token as TriageState;
      else if (TICKET_STATUSES.has(token)) meta.ticketStatus = token as WayfinderTicketStatus;
    } else if (key === "type") {
      if (TICKET_TYPES.has(token)) meta.ticketType = token as WayfinderTicketType;
    } else {
      const blockedBy = value.match(/#?\d+/g)?.map((entry) => entry.replace(/^#/, ""));
      if (blockedBy?.length) meta.blockedBy = blockedBy;
    }
  }
  return meta;
}

export function buildWorkflowMeta(relativePath: string, head: string): WorkflowMeta | undefined {
  const normalized = normalizePath(relativePath);
  const artifact = detectArtifact(normalized);
  if (!artifact) return undefined;

  const meta: WorkflowMeta = { artifact, ...parseWorkflowHead(head) };

  const segments = normalized.split("/").filter(Boolean);
  const scratchIndex = segments.indexOf(".scratch");
  if (scratchIndex !== -1 && segments.length > scratchIndex + 1) {
    meta.effort = segments[scratchIndex + 1];
    if (artifact === "wayfinder-ticket") {
      const numberMatch = segments[segments.length - 1].match(/^(\d+)/);
      if (numberMatch) meta.ticketNumber = numberMatch[1];
      meta.ticketStatus = meta.ticketStatus ?? "open";
    }
  }

  return meta;
}
