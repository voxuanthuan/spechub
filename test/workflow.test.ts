import { buildWorkflowMeta, detectArtifact, parseWorkflowHead } from "../src/workflow.js";

describe("detectArtifact", () => {
  it("recognises wayfinder maps, tickets, and tracker specs under .scratch", () => {
    expect(detectArtifact(".scratch/auth-redesign/map.md")).toBe("wayfinder-map");
    expect(detectArtifact(".scratch/auth-redesign/issues/01-provider-choice.md")).toBe("wayfinder-ticket");
    expect(detectArtifact(".scratch/auth-redesign/spec.md")).toBe("feature-spec");
  });

  it("recognises tracker paths nested inside agent worktrees", () => {
    expect(detectArtifact(".claude/worktrees/wt-1/.scratch/effort/issues/02-api-shape.md")).toBe("wayfinder-ticket");
    expect(detectArtifact(".claude/worktrees/wt-1/.scratch/effort/map.md")).toBe("wayfinder-map");
  });

  it("ignores files inside .scratch that do not follow the tracker conventions", () => {
    expect(detectArtifact(".scratch/effort/notes.md")).toBeUndefined();
    expect(detectArtifact(".scratch/effort/issues/deep/extra.md")).toBeUndefined();
  });

  it("recognises ADRs in single- and multi-context layouts", () => {
    expect(detectArtifact("docs/adr/0001-postgres-for-write-model.md")).toBe("adr");
    expect(detectArtifact("src/ordering/docs/adr/0002-event-sourced-orders.md")).toBe("adr");
  });

  it("recognises agent config, domain docs, and the out-of-scope knowledge base", () => {
    expect(detectArtifact("docs/agents/issue-tracker.md")).toBe("agent-config");
    expect(detectArtifact("docs/agents/triage-labels.md")).toBe("agent-config");
    expect(detectArtifact("CONTEXT.md")).toBe("domain-context");
    expect(detectArtifact("CONTEXT-MAP.md")).toBe("domain-context");
    expect(detectArtifact("src/billing/CONTEXT.md")).toBe("domain-context");
    expect(detectArtifact(".out-of-scope/dark-mode.md")).toBe("out-of-scope");
  });

  it("returns undefined for ordinary docs and agent storage", () => {
    expect(detectArtifact("docs/plans/roadmap.md")).toBeUndefined();
    expect(detectArtifact("plan.md")).toBeUndefined();
    expect(detectArtifact(".opencode/agents/review.md")).toBeUndefined();
  });
});

describe("parseWorkflowHead", () => {
  it("classifies an overloaded Status line by value, never by guess", () => {
    expect(parseWorkflowHead("Status: ready-for-agent\n").triageState).toBe("ready-for-agent");
    expect(parseWorkflowHead("Status: wontfix\n").triageState).toBe("wontfix");
    expect(parseWorkflowHead("Status: claimed\n").ticketStatus).toBe("claimed");
    expect(parseWorkflowHead("Status: resolved\n").ticketStatus).toBe("resolved");

    const unknown = parseWorkflowHead("Status: in-progress\n");
    expect(unknown.triageState).toBeUndefined();
    expect(unknown.ticketStatus).toBeUndefined();
  });

  it("parses ticket type and blocked-by numbers", () => {
    const meta = parseWorkflowHead("Type: research\nBlocked by: 01, 02\n");
    expect(meta.ticketType).toBe("research");
    expect(meta.blockedBy).toEqual(["01", "02"]);
  });

  it("accepts hash-prefixed blocker numbers and case-insensitive keys", () => {
    expect(parseWorkflowHead("Blocked by: #3, #7\n").blockedBy).toEqual(["3", "7"]);
    expect(parseWorkflowHead("  status: needs-info\n").triageState).toBe("needs-info");
    expect(parseWorkflowHead("TYPE: grilling\n").ticketType).toBe("grilling");
  });

  it("ignores key lines buried past the header limit", () => {
    const head = `${Array.from({ length: 25 }, (_, index) => `line ${index}`).join("\n")}\nStatus: wontfix\n`;
    expect(parseWorkflowHead(head).triageState).toBeUndefined();
  });

  it("ignores unknown ticket types", () => {
    expect(parseWorkflowHead("Type: documentation\n").ticketType).toBeUndefined();
  });
});

describe("buildWorkflowMeta", () => {
  it("builds full ticket metadata from path and header", () => {
    const meta = buildWorkflowMeta(
      ".scratch/auth-redesign/issues/03-session-storage.md",
      "# Session storage\n\nType: grilling\nStatus: claimed\nBlocked by: 01, 02\n"
    );
    expect(meta).toEqual({
      artifact: "wayfinder-ticket",
      effort: "auth-redesign",
      ticketNumber: "03",
      ticketType: "grilling",
      ticketStatus: "claimed",
      blockedBy: ["01", "02"]
    });
  });

  it("defaults ticket status to open when no Status line is present", () => {
    const meta = buildWorkflowMeta(".scratch/effort/issues/01-first-question.md", "# First question\n");
    expect(meta?.ticketStatus).toBe("open");
    expect(meta?.ticketNumber).toBe("01");
  });

  it("keeps a triage Status on a tracker spec without inventing a ticket status", () => {
    const meta = buildWorkflowMeta(".scratch/effort/spec.md", "Status: needs-triage\n");
    expect(meta).toEqual({ artifact: "feature-spec", effort: "effort", triageState: "needs-triage" });
  });

  it("parses wayfinder maps without ticket fields", () => {
    expect(buildWorkflowMeta(".scratch/effort/map.md", "# Map\n")).toEqual({
      artifact: "wayfinder-map",
      effort: "effort"
    });
  });

  it("returns undefined for documents outside the workflow conventions", () => {
    expect(buildWorkflowMeta("docs/plans/roadmap.md", "Status: wontfix\n")).toBeUndefined();
  });
});
