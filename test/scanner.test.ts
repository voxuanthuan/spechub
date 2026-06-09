import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { defaultConfig } from "../src/config.js";
import { scanDocuments } from "../src/scanner.js";

async function fixtureRoot() {
  return mkdtemp(path.join(tmpdir(), "spechub-scan-"));
}

describe("scanDocuments", () => {
  it("indexes AI/spec Markdown and HTML files across repos while ignoring noisy folders", async () => {
    const root = await fixtureRoot();
    const alpha = path.join(root, "alpha");
    const beta = path.join(root, "groups", "beta");
    await mkdir(path.join(alpha, "docs", "superpowers", "plans"), { recursive: true });
    await mkdir(path.join(alpha, "docs", "superpowers", "specs"), { recursive: true });
    await mkdir(path.join(alpha, "docs", "supperpowers", "specs"), { recursive: true });
    await mkdir(path.join(alpha, "docs", "supperspowers", "specs"), { recursive: true });
    await mkdir(path.join(alpha, ".opencode", "agents"), { recursive: true });
    await mkdir(path.join(alpha, "docs"), { recursive: true });
    await mkdir(path.join(alpha, "node_modules", "docs", "specs"), { recursive: true });
    await mkdir(path.join(beta, "specs"), { recursive: true });
    await mkdir(path.join(beta, "docs", "plans"), { recursive: true });

    await writeFile(path.join(alpha, "package.json"), "{}");
    await writeFile(path.join(alpha, "docs", "superpowers", "plans", "roadmap.md"), "# Roadmap\n");
    await writeFile(path.join(alpha, "docs", "superpowers", "specs", "connect-sync.md"), "# Connect Sync Design\n");
    await writeFile(path.join(alpha, "docs", "supperpowers", "specs", "legacy-spelling.md"), "# Legacy Spelling Spec\n");
    await writeFile(path.join(alpha, "docs", "supperspowers", "specs", "typo.html"), "<h1>Typo Path</h1>");
    await writeFile(path.join(alpha, ".opencode", "agents", "review.md"), "# OpenCode Review Agent\n");
    await writeFile(path.join(alpha, "docs", "global-search-refactor-changes.html"), "<h1>Global Search Refactor</h1>");
    await writeFile(path.join(alpha, "node_modules", "docs", "specs", "noise.md"), "# Noise\n");
    await writeFile(path.join(beta, "package.json"), "{}");
    await writeFile(path.join(beta, "specs", "api.html"), "<title>API Contract</title>");
    await writeFile(path.join(beta, "docs", "plans", "migration.md"), "# Migration\n");
    await writeFile(path.join(beta, "plan.md"), "# Root Plan\n");
    await writeFile(path.join(beta, "notes.md"), "# Notes\n");

    const docs = await scanDocuments({ roots: [root] });

    expect(docs.map((doc) => doc.relativePath).sort()).toEqual([
      ".opencode/agents/review.md",
      "docs/global-search-refactor-changes.html",
      "docs/plans/migration.md",
      "docs/superpowers/plans/roadmap.md",
      "docs/superpowers/specs/connect-sync.md",
      "docs/supperpowers/specs/legacy-spelling.md",
      "docs/supperspowers/specs/typo.html",
      "plan.md",
      "specs/api.html"
    ]);
    expect(docs.find((doc) => doc.relativePath === "docs/superpowers/plans/roadmap.md")).toMatchObject({
      repoName: "alpha",
      kind: "markdown",
      title: "Roadmap",
      category: "plan"
    });
    expect(docs.find((doc) => doc.relativePath === "docs/superpowers/specs/connect-sync.md")).toMatchObject({
      repoName: "alpha",
      kind: "markdown",
      title: "Connect Sync Design",
      category: "spec"
    });
    expect(docs.find((doc) => doc.relativePath === "docs/supperpowers/specs/legacy-spelling.md")).toMatchObject({
      repoName: "alpha",
      title: "Legacy Spelling Spec",
      category: "spec"
    });
    expect(docs.find((doc) => doc.relativePath === ".opencode/agents/review.md")).toMatchObject({
      repoName: "alpha",
      title: "OpenCode Review Agent",
      category: "doc"
    });
    expect(docs.find((doc) => doc.relativePath === "specs/api.html")).toMatchObject({
      repoName: "beta",
      kind: "html",
      title: "API Contract",
      category: "spec"
    });
  });

  it("honors explicit repo roots and custom ignore patterns", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "docs", "specs"), { recursive: true });
    await mkdir(path.join(root, "archive", "docs", "specs"), { recursive: true });
    await writeFile(path.join(root, "docs", "specs", "active.md"), "# Active Spec\n");
    await writeFile(path.join(root, "archive", "docs", "specs", "old.md"), "# Old Spec\n");

    const docs = await scanDocuments({
      roots: [root],
      ignorePatterns: ["archive"]
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      repoName: path.basename(root),
      title: "Active Spec",
      relativePath: "docs/specs/active.md"
    });
  });

  it("scans direct sources without repository discovery", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, ".codex", "plans"), { recursive: true });
    await writeFile(path.join(root, ".codex", "plans", "global.md"), "# Global Plan\n");

    const docs = await scanDocuments({
      sources: [
        {
          name: "global-codex",
          mode: "direct",
          roots: [path.join(root, ".codex")],
          patterns: ["**/*.md"]
        }
      ]
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      title: "Global Plan",
      sourceName: "global-codex",
      repoName: "global-codex",
      relativePath: "plans/global.md",
      category: "plan"
    });
  });

  it("uses title overrides by expanded absolute path", async () => {
    const root = await fixtureRoot();
    const repo = path.join(root, "repo");
    const docPath = path.join(repo, "docs", "specs", "api.md");
    await mkdir(path.dirname(docPath), { recursive: true });
    await writeFile(path.join(repo, "package.json"), "{}");
    await writeFile(docPath, "# Original Title\n");

    const docs = await scanDocuments({
      roots: [root],
      titleOverrides: {
        [docPath]: "Readable API Spec"
      }
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      title: "Readable API Spec",
      sourceTitle: "Original Title"
    });
  });

  it("groups flat Claude plans by repository inferred from plan content", async () => {
    const root = await fixtureRoot();
    const workspace = path.join(root, "workspace");
    const repo = path.join(workspace, "core-api");
    const claudePlans = path.join(root, ".claude", "plans");
    await mkdir(path.join(repo, "src"), { recursive: true });
    await mkdir(claudePlans, { recursive: true });
    await writeFile(path.join(repo, "package.json"), "{}");
    await writeFile(
      path.join(claudePlans, "harmonic-chasing-token.md"),
      `# Plan: Port global search\n\n## Backend changes — \`${repo}\`\n\nImplement the sync handlers.\n`
    );

    const docs = await scanDocuments({
      roots: [workspace],
      sources: [
        {
          name: "claude-plans",
          mode: "direct",
          roots: [claudePlans],
          patterns: ["*.md"],
          inferRepoFromContent: true,
          defaultCategory: "plan"
        }
      ]
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      title: "Plan: Port global search",
      repoName: "core-api",
      sourceName: "claude-plans",
      category: "plan",
      relativePath: "harmonic-chasing-token.md"
    });
  });

  it("includes common agent folders in the default source list", () => {
    const sourceByName = new Map(defaultConfig().sources.map((source) => [source.name, source]));

    expect([...sourceByName.keys()]).toEqual([
      "repositories",
      "opencode",
      "opencode-plan-sessions",
      "codex",
      "claude",
      "cursor",
      "augment",
      "windsurf"
    ]);
    expect(sourceByName.get("opencode")).toMatchObject({
      mode: "direct",
      roots: [
        path.join(os.homedir(), ".opencode"),
        path.join(os.homedir(), ".config", "opencode"),
        path.join(os.homedir(), ".local", "share", "opencode")
      ],
      patterns: [
        "agents/**/*.{md,markdown,html}",
        "plans/**/*.{md,markdown,html}",
        "plan/**/*.{md,markdown,html}",
        "specs/**/*.{md,markdown,html}",
        "spec/**/*.{md,markdown,html}",
        "docs/**/*.{md,markdown,html}",
        "reports/**/*.{md,markdown,html}"
      ],
      inferRepoFromContent: true,
      defaultCategory: "plan"
    });
    expect(sourceByName.get("claude")).toMatchObject({
      mode: "direct",
      roots: [path.join(os.homedir(), ".claude")],
      patterns: [
        "agents/**/*.{md,markdown,html}",
        "plans/**/*.{md,markdown,html}",
        "plan/**/*.{md,markdown,html}",
        "specs/**/*.{md,markdown,html}",
        "spec/**/*.{md,markdown,html}",
        "docs/**/*.{md,markdown,html}",
        "reports/**/*.{md,markdown,html}"
      ]
    });
    expect(sourceByName.get("opencode-plan-sessions")).toMatchObject({
      mode: "opencode-db",
      roots: [path.join(os.homedir(), ".local", "share", "opencode")],
      patterns: [],
      inferRepoFromContent: true,
      defaultCategory: "plan"
    });
  });

  it("scans agent plans while ignoring tool internals", async () => {
    const root = await fixtureRoot();
    const opencodeConfig = path.join(root, ".opencode");
    const opencodeData = path.join(root, ".local", "share", "opencode");
    const claude = path.join(root, ".claude");
    const codex = path.join(root, ".codex");

    await mkdir(path.join(opencodeConfig, "commands"), { recursive: true });
    await mkdir(path.join(opencodeConfig, "agents"), { recursive: true });
    await mkdir(path.join(opencodeConfig, "node_modules", "@standard-schema", "spec"), { recursive: true });
    await mkdir(path.join(opencodeData, "plans"), { recursive: true });
    await mkdir(path.join(opencodeData, "storage", "session_diff"), { recursive: true });
    await mkdir(path.join(claude, "plans"), { recursive: true });
    await mkdir(path.join(claude, "skills", "planner"), { recursive: true });
    await mkdir(path.join(codex, "docs", "specs"), { recursive: true });
    await mkdir(path.join(codex, "skills", "planner"), { recursive: true });
    await mkdir(path.join(codex, "memories"), { recursive: true });

    await writeFile(path.join(opencodeConfig, "commands", "plan.md"), "# OpenCode Command\n");
    await writeFile(path.join(opencodeConfig, "agents", "review.md"), "# OpenCode Review Agent\n");
    await writeFile(path.join(opencodeConfig, "node_modules", "@standard-schema", "spec", "README.md"), "# Package Spec\n");
    await writeFile(path.join(opencodeData, "plans", "checkout.md"), "# OpenCode Plan\n");
    await writeFile(path.join(opencodeData, "storage", "session_diff", "ses_123.json"), "{}");
    await writeFile(path.join(claude, "plans", "migration.md"), "# Claude Plan\n");
    await writeFile(path.join(claude, "skills", "planner", "SKILL.md"), "# Claude Skill\n");
    await writeFile(path.join(codex, "docs", "specs", "api.md"), "# Codex API Spec\n");
    await writeFile(path.join(codex, "skills", "planner", "SKILL.md"), "# Codex Skill\n");
    await writeFile(path.join(codex, "memories", "raw_memories.md"), "# Codex Memory\n");

    const docs = await scanDocuments({
      roots: [path.join(root, "workspace")],
      sources: [
        {
          ...defaultConfig().sources.find((source) => source.name === "opencode")!,
          roots: [opencodeConfig, opencodeData]
        },
        {
          ...defaultConfig().sources.find((source) => source.name === "claude")!,
          roots: [claude]
        },
        {
          ...defaultConfig().sources.find((source) => source.name === "codex")!,
          roots: [codex]
        }
      ]
    });

    expect(docs.map((doc) => doc.title).sort()).toEqual([
      "Claude Plan",
      "Codex API Spec",
      "OpenCode Plan",
      "OpenCode Review Agent"
    ]);
    expect(docs.map((doc) => doc.relativePath).sort()).toEqual([
      "agents/review.md",
      "docs/specs/api.md",
      "plans/checkout.md",
      "plans/migration.md"
    ]);
  });

  it("prefers the containing folder over content matches when naming a repo", async () => {
    const root = await fixtureRoot();
    const workspace = path.join(root, "work");
    const grappleRepo = path.join(workspace, "grapple-b2b-app");
    const siblingRepo = path.join(workspace, "B2B-app");
    const grappleDoc = path.join(grappleRepo, "docs", "superpowers", "specs", "sync.md");
    await mkdir(path.dirname(grappleDoc), { recursive: true });
    await mkdir(siblingRepo, { recursive: true });
    await writeFile(path.join(grappleRepo, "package.json"), "{}");
    await writeFile(path.join(siblingRepo, "package.json"), "{}");
    await writeFile(
      grappleDoc,
      `# B2B-app: V2 Grapple Connect Sync History\n\nReferences \`${siblingRepo}\` and the B2B-app project throughout.\n`
    );

    const docs = await scanDocuments({
      roots: [workspace],
      sources: [
        {
          name: "stray-direct",
          mode: "direct",
          roots: [workspace],
          patterns: ["**/docs/**/*.md"],
          inferRepoFromContent: true,
          defaultCategory: "spec"
        }
      ]
    });

    const indexed = docs.find((doc) => doc.absolutePath === grappleDoc);
    expect(indexed).toBeDefined();
    expect(indexed?.repoName).toBe("grapple-b2b-app");
  });

  it("indexes OpenCode /plan sessions from SQLite storage", async () => {
    const root = await fixtureRoot();
    const dataRoot = path.join(root, ".local", "share", "opencode");
    const workspace = path.join(root, "workspace");
    const repo = path.join(workspace, "core-api");
    await mkdir(dataRoot, { recursive: true });
    await mkdir(repo, { recursive: true });
    await writeFile(path.join(repo, "package.json"), "{}");
    await writeOpenCodeDb(path.join(dataRoot, "opencode.db"), repo);

    const docs = await scanDocuments({
      roots: [workspace],
      sources: [
        {
          name: "opencode-plan-sessions",
          mode: "opencode-db",
          roots: [dataRoot],
          patterns: [],
          inferRepoFromContent: true,
          defaultCategory: "plan"
        }
      ]
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      title: "Review import mutation",
      sourceTitle: "Review import mutation",
      sourceName: "opencode-plan-sessions",
      repoName: "core-api",
      repoRoot: repo,
      relativePath: "opencode-plan-sessions/ses_plan.md",
      category: "plan",
      kind: "markdown",
      contentSource: {
        type: "opencode-db",
        dbPath: path.join(dataRoot, "opencode.db"),
        sessionId: "ses_plan"
      }
    });
    expect(docs[0].sizeBytes).toBeGreaterThan(0);
  });
});

async function writeOpenCodeDb(dbPath: string, repo: string): Promise<void> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      agent TEXT,
      time_created INTEGER,
      time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT NOT NULL
    );
  `);
  db.run("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)", [
    "ses_plan",
    repo,
    "Review import mutation",
    "plan",
    1_700_000_000_000,
    1_700_000_100_000
  ]);
  db.run("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)", [
    "ses_build",
    repo,
    "Build work",
    "build",
    1_700_000_000_000,
    1_700_000_100_000
  ]);
  db.run("INSERT INTO message VALUES (?, ?, ?, ?, ?)", [
    "msg_user",
    "ses_plan",
    1_700_000_000_001,
    1_700_000_000_001,
    JSON.stringify({ role: "user", agent: "plan" })
  ]);
  db.run("INSERT INTO message VALUES (?, ?, ?, ?, ?)", [
    "msg_assistant",
    "ses_plan",
    1_700_000_000_002,
    1_700_000_100_000,
    JSON.stringify({ role: "assistant", agent: "plan" })
  ]);
  db.run("INSERT INTO message VALUES (?, ?, ?, ?, ?)", [
    "msg_build",
    "ses_build",
    1_700_000_000_003,
    1_700_000_100_000,
    JSON.stringify({ role: "assistant", agent: "build" })
  ]);
  db.run("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)", [
    "prt_user",
    "msg_user",
    "ses_plan",
    1_700_000_000_001,
    1_700_000_000_001,
    JSON.stringify({ type: "text", text: "Plan the import mutation" })
  ]);
  db.run("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)", [
    "prt_assistant",
    "msg_assistant",
    "ses_plan",
    1_700_000_000_002,
    1_700_000_100_000,
    JSON.stringify({ type: "text", text: "## Final Plan\n\nUse repository path `" + repo + "` and update the GraphQL resolver." })
  ]);
  db.run("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)", [
    "prt_build",
    "msg_build",
    "ses_build",
    1_700_000_000_003,
    1_700_000_100_000,
    JSON.stringify({ type: "text", text: "Not a plan session" })
  ]);

  await writeFile(dbPath, db.export());
  db.close();
}
