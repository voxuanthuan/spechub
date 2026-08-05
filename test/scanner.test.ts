import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_DOC_PATTERNS, defaultConfig, resolveConfig } from "../src/config.js";
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

  it("uses title-cased slugs for Claude plans without headings", async () => {
    const root = await fixtureRoot();
    const claude = path.join(root, ".claude");
    await mkdir(path.join(claude, "plans"), { recursive: true });
    await writeFile(path.join(claude, "plans", "improve-spechub-cryptic-quail.md"), "Implement the next phase.\n");

    const docs = await scanDocuments({
      roots: [path.join(root, "workspace")],
      sources: [
        {
          ...defaultConfig().sources.find((source) => source.name === "claude")!,
          roots: [claude]
        }
      ]
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      title: "Improve Spechub Cryptic Quail",
      sourceTitle: "Improve Spechub Cryptic Quail",
      sourceName: "claude",
      category: "plan",
      relativePath: "plans/improve-spechub-cryptic-quail.md"
    });
  });

  it("infers Claude plan repositories by repo name and falls back to the source name", async () => {
    const root = await fixtureRoot();
    const workspace = path.join(root, "workspace");
    const repo = path.join(workspace, "spechub");
    const claude = path.join(root, ".claude");
    await mkdir(repo, { recursive: true });
    await mkdir(path.join(claude, "plans"), { recursive: true });
    await writeFile(path.join(repo, "package.json"), "{}");
    await writeFile(
      path.join(claude, "plans", "repo-name-only.md"),
      "# Repo Name Only\n\nUpdate spechub without mentioning its absolute path.\n"
    );
    await writeFile(
      path.join(claude, "plans", "unknown-repo.md"),
      "# Unknown Repo\n\nNo workspace project is named here.\n"
    );

    const docs = await scanDocuments({
      roots: [workspace],
      sources: [
        {
          ...defaultConfig().sources.find((source) => source.name === "claude")!,
          roots: [claude]
        }
      ]
    });

    expect(docs).toHaveLength(2);
    expect(docs.find((doc) => doc.relativePath === "plans/repo-name-only.md")).toMatchObject({
      repoName: "spechub",
      sourceName: "claude",
      category: "plan"
    });
    expect(docs.find((doc) => doc.relativePath === "plans/unknown-repo.md")).toMatchObject({
      repoName: "claude",
      sourceName: "claude",
      category: "plan"
    });
  });

  it("indexes workspace-local Claude plans outside discovered repositories", async () => {
    const root = await fixtureRoot();
    const workspace = path.join(root, "workspace");
    const work = path.join(workspace, "work");
    const repo = path.join(work, "b2b-app");
    const claudePlans = path.join(work, ".claude", "plans");
    const planPath = path.join(claudePlans, "abundant-noodling-pizza.md");

    await mkdir(repo, { recursive: true });
    await mkdir(claudePlans, { recursive: true });
    await writeFile(path.join(repo, "package.json"), "{}");
    await writeFile(
      planPath,
      "# Plan: Port split debtor/seller global search\n\nApply this in b2b-app using the existing search-box files.\n"
    );

    const docs = await scanDocuments({ roots: [workspace] });
    const plan = docs.find((doc) => doc.absolutePath === planPath);

    expect(plan).toMatchObject({
      title: "Plan: Port split debtor/seller global search",
      sourceName: "claude",
      relativePath: "plans/abundant-noodling-pizza.md",
      category: "plan"
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
      "windsurf",
      "worktrees"
    ]);
    expect(sourceByName.get("worktrees")).toMatchObject({
      mode: "worktrees",
      roots: [path.join(os.homedir(), ".herdr", "worktrees")]
    });
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

  it("filters agent-storage plans to repos under roots when scoped", async () => {
    const root = await fixtureRoot();
    const workspace = path.join(root, "workspace");
    const inScopeRepo = path.join(workspace, "core-api");
    const outScopeRepo = path.join(root, "external", "legacy-api");
    const claudePlans = path.join(root, ".claude", "plans");
    await mkdir(inScopeRepo, { recursive: true });
    await mkdir(outScopeRepo, { recursive: true });
    await mkdir(claudePlans, { recursive: true });
    await writeFile(path.join(inScopeRepo, "package.json"), "{}");
    await writeFile(path.join(outScopeRepo, "package.json"), "{}");
    await writeFile(
      path.join(claudePlans, "in-scope.md"),
      `# In Scope Plan\n\nUpdate \`${inScopeRepo}\` resolvers.\n`
    );
    await writeFile(
      path.join(claudePlans, "out-of-scope.md"),
      `# Out Of Scope Plan\n\nUpdate \`${outScopeRepo}\` resolvers.\n`
    );

    const source = {
      ...defaultConfig().sources.find((entry) => entry.name === "claude")!,
      roots: [path.join(root, ".claude")]
    };

    const scoped = await scanDocuments({
      roots: [workspace],
      sources: [source],
      restrictAgentStorageToRoots: true
    });
    expect(scoped.map((doc) => doc.relativePath)).toEqual(["plans/in-scope.md"]);
    expect(scoped[0]).toMatchObject({ repoName: "core-api", sourceName: "claude" });

    const unscoped = await scanDocuments({
      roots: [workspace],
      sources: [source]
    });
    expect(unscoped.map((doc) => doc.relativePath).sort()).toEqual([
      "plans/in-scope.md",
      "plans/out-of-scope.md"
    ]);
  });

  it("groups worktree specs under the original repository", async () => {
    const root = await fixtureRoot();
    const worktrees = path.join(root, ".herdr", "worktrees");
    const featureA = path.join(worktrees, "core-app", "feature-grap-19325", "docs", "specs");
    const featureB = path.join(worktrees, "core-app", "bugfix-42", "docs", "plans");
    const otherRepo = path.join(worktrees, "web-ui", "feature-login", "specs");
    await mkdir(featureA, { recursive: true });
    await mkdir(featureB, { recursive: true });
    await mkdir(otherRepo, { recursive: true });
    await writeFile(path.join(featureA, "sync.md"), "# Grapple Sync Spec\n");
    await writeFile(path.join(featureB, "cleanup.md"), "# Cleanup Plan\n");
    await writeFile(path.join(otherRepo, "login.html"), "<title>Login Flow</title>");

    const docs = await scanDocuments({
      sources: [
        {
          name: "worktrees",
          mode: "worktrees",
          roots: [worktrees],
          patterns: [...DEFAULT_DOC_PATTERNS]
        }
      ]
    });

    expect(docs.map((doc) => doc.repoName).sort()).toEqual(["core-app", "core-app", "web-ui"]);
    expect(docs.find((doc) => doc.relativePath === "docs/specs/sync.md")).toMatchObject({
      repoName: "core-app",
      sourceName: "worktrees",
      title: "Grapple Sync Spec",
      category: "spec"
    });
    expect(docs.find((doc) => doc.relativePath === "docs/plans/cleanup.md")).toMatchObject({
      repoName: "core-app",
      category: "plan"
    });
    expect(docs.find((doc) => doc.relativePath === "specs/login.html")).toMatchObject({
      repoName: "web-ui",
      kind: "html",
      title: "Login Flow",
      category: "spec"
    });
  });

  it("ignores noisy folders when scanning worktrees", async () => {
    const root = await fixtureRoot();
    const worktrees = path.join(root, ".herdr", "worktrees");
    const specs = path.join(worktrees, "core-app", "feature-x", "docs", "specs");
    const nested = path.join(worktrees, "core-app", "feature-x", "node_modules", "pkg", "docs", "specs");
    await mkdir(specs, { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(specs, "real.md"), "# Real Spec\n");
    await writeFile(path.join(nested, "noise.md"), "# Noise\n");

    const docs = await scanDocuments({
      sources: [
        {
          name: "worktrees",
          mode: "worktrees",
          roots: [worktrees],
          patterns: [...DEFAULT_DOC_PATTERNS]
        }
      ]
    });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ repoName: "core-app", relativePath: "docs/specs/real.md" });
  });

  it("groups Claude worktree specs nested in .claude/worktrees under the repository", async () => {
    const root = await fixtureRoot();
    const repo = path.join(root, "core-app");
    const mainSpec = path.join(repo, "docs", "specs");
    const worktreeSpec = path.join(repo, ".claude", "worktrees", "worktree-login", "docs", "specs");
    const worktreePlan = path.join(repo, ".claude", "worktrees", "worktree-login", "docs", "plans");
    await mkdir(mainSpec, { recursive: true });
    await mkdir(worktreeSpec, { recursive: true });
    await mkdir(worktreePlan, { recursive: true });
    await writeFile(path.join(repo, "package.json"), "{}");
    await writeFile(path.join(mainSpec, "api.md"), "# Main API Spec\n");
    await writeFile(path.join(worktreeSpec, "login.md"), "# Login Spec\n");
    await writeFile(path.join(worktreePlan, "rollout.md"), "# Rollout Plan\n");

    const docs = await scanDocuments({ roots: [root] });

    expect(docs.map((doc) => doc.relativePath).sort()).toEqual([
      ".claude/worktrees/worktree-login/docs/plans/rollout.md",
      ".claude/worktrees/worktree-login/docs/specs/login.md",
      "docs/specs/api.md"
    ]);
    expect(docs.every((doc) => doc.repoName === "core-app")).toBe(true);
    expect(docs.find((doc) => doc.relativePath === ".claude/worktrees/worktree-login/docs/specs/login.md")).toMatchObject({
      title: "Login Spec",
      category: "spec"
    });
    expect(docs.find((doc) => doc.relativePath === ".claude/worktrees/worktree-login/docs/plans/rollout.md")).toMatchObject({
      title: "Rollout Plan",
      category: "plan"
    });
  });
});

async function writeOpenCodeDb(dbPath: string, repo: string): Promise<void> {
  const db = new Database(dbPath);
  db.exec(`
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
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run(
    "ses_plan",
    repo,
    "Review import mutation",
    "plan",
    1_700_000_000_000,
    1_700_000_100_000
  );
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run(
    "ses_build",
    repo,
    "Build work",
    "build",
    1_700_000_000_000,
    1_700_000_100_000
  );
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
    "msg_user",
    "ses_plan",
    1_700_000_000_001,
    1_700_000_000_001,
    JSON.stringify({ role: "user", agent: "plan" })
  );
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
    "msg_assistant",
    "ses_plan",
    1_700_000_000_002,
    1_700_000_100_000,
    JSON.stringify({ role: "assistant", agent: "plan" })
  );
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
    "msg_build",
    "ses_build",
    1_700_000_000_003,
    1_700_000_100_000,
    JSON.stringify({ role: "assistant", agent: "build" })
  );
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(
    "prt_user",
    "msg_user",
    "ses_plan",
    1_700_000_000_001,
    1_700_000_000_001,
    JSON.stringify({ type: "text", text: "Plan the import mutation" })
  );
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(
    "prt_assistant",
    "msg_assistant",
    "ses_plan",
    1_700_000_000_002,
    1_700_000_100_000,
    JSON.stringify({ type: "text", text: "## Final Plan\n\nUse repository path `" + repo + "` and update the GraphQL resolver." })
  );
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(
    "prt_build",
    "msg_build",
    "ses_build",
    1_700_000_000_003,
    1_700_000_100_000,
    JSON.stringify({ type: "text", text: "Not a plan session" })
  );

  db.close();
}

describe("scanDocuments files mode (load all md/html under a path)", () => {
  it("loads every markdown and HTML file under the root, grouped by source name", async () => {
    const root = await fixtureRoot();
    const issues = path.join(root, "issues");
    await mkdir(path.join(issues, "subdir"), { recursive: true });
    await writeFile(path.join(issues, "01-provider-choice.md"), "# Provider choice\n");
    await writeFile(path.join(issues, "02-session-storage.md"), "# Session storage\n");
    await writeFile(path.join(issues, "map.html"), "<title>Map</title>");
    await writeFile(path.join(issues, "subdir", "03-deep.md"), "# Deep\n");
    await writeFile(path.join(issues, "notes.txt"), "not a doc");
    await writeFile(path.join(issues, "package.json"), "{}");

    const docs = await scanDocuments({
      sources: [
        {
          name: "psr-issues",
          mode: "files",
          roots: [issues]
        }
      ]
    });

    expect(docs.map((doc) => doc.relativePath).sort()).toEqual([
      "01-provider-choice.md",
      "02-session-storage.md",
      "map.html",
      "subdir/03-deep.md"
    ]);
    expect(docs.every((doc) => doc.repoName === "psr-issues" && doc.sourceName === "psr-issues")).toBe(true);
    expect(docs.find((doc) => doc.relativePath === "01-provider-choice.md")).toMatchObject({
      title: "Provider choice",
      kind: "markdown"
    });
    expect(docs.find((doc) => doc.relativePath === "map.html")).toMatchObject({
      title: "Map",
      kind: "html"
    });
  });

  it("honors exclude globs to scope the loaded files", async () => {
    const root = await fixtureRoot();
    const issues = path.join(root, "issues");
    await mkdir(issues, { recursive: true });
    await writeFile(path.join(issues, "01-provider-choice.md"), "# Provider choice\n");
    await writeFile(path.join(issues, "01-provider-choice-draft.md"), "# Draft\n");

    const docs = await scanDocuments({
      sources: [
        {
          name: "psr-issues",
          mode: "files",
          roots: [issues],
          exclude: ["**/*-draft.md"]
        }
      ]
    });

    expect(docs.map((doc) => doc.relativePath)).toEqual(["01-provider-choice.md"]);
  });

  it("uses include globs to narrow which files belong to the group", async () => {
    const root = await fixtureRoot();
    const issues = path.join(root, "issues");
    await mkdir(issues, { recursive: true });
    await writeFile(path.join(issues, "01-provider-choice.md"), "# Provider choice\n");
    await writeFile(path.join(issues, "map.html"), "<title>Map</title>");

    const docs = await scanDocuments({
      sources: [
        {
          name: "psr-issues",
          mode: "files",
          roots: [issues],
          include: ["**/*.md"]
        }
      ]
    });

    expect(docs.map((doc) => doc.relativePath)).toEqual(["01-provider-choice.md"]);
  });

  it("returns no documents for a missing root", async () => {
    const root = await fixtureRoot();
    const docs = await scanDocuments({
      sources: [
        {
          name: "missing",
          mode: "files",
          roots: [path.join(root, "does-not-exist")]
        }
      ]
    });
    expect(docs).toEqual([]);
  });

  it("keeps an explicit files source outside the workspace roots when both are configured", async () => {
    const root = await fixtureRoot();
    const workspace = path.join(root, "workspace");
    const research = path.join(root, "research");
    await mkdir(path.join(workspace, "repo"), { recursive: true });
    await mkdir(path.join(workspace, "repo", "docs", "specs"), { recursive: true });
    await mkdir(research, { recursive: true });
    await writeFile(path.join(workspace, "repo", "package.json"), "{}");
    await writeFile(path.join(workspace, "repo", "docs", "specs", "api.md"), "# API\n");
    await writeFile(path.join(research, "02-findings.md"), "# Findings\n");

    const configPath = path.join(root, "config.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          roots: [workspace],
          sources: [
            { name: "repositories", mode: "repositories", roots: [workspace] },
            { name: "research", mode: "files", roots: [research] }
          ]
        },
        null,
        2
      )
    );

    const config = await resolveConfig({ configPath });
    expect(config.restrictAgentStorageToRoots).toBe(false);

    const docs = await scanDocuments(config);
    expect(docs.find((doc) => doc.relativePath === "02-findings.md")).toMatchObject({
      sourceName: "research",
      repoName: "research"
    });
    expect(docs.find((doc) => doc.relativePath === "docs/specs/api.md")).toMatchObject({
      repoName: "repo"
    });
  });
});

describe("scanDocuments workflow awareness (Matt Pocock skills layout)", () => {
  it("indexes tracker artifacts, domain docs, ADRs, and the out-of-scope KB with parsed metadata", async () => {
    const root = await fixtureRoot();
    const repo = path.join(root, "gamma");
    await mkdir(path.join(repo, ".scratch", "auth-redesign", "issues"), { recursive: true });
    await mkdir(path.join(repo, ".out-of-scope"), { recursive: true });
    await mkdir(path.join(repo, "docs", "adr"), { recursive: true });
    await mkdir(path.join(repo, "docs", "agents"), { recursive: true });

    await writeFile(path.join(repo, "package.json"), "{}");
    await writeFile(path.join(repo, ".scratch", "auth-redesign", "map.md"), "# Auth Redesign Map\n\n## Destination\n\nShip the new auth flow.\n");
    await writeFile(path.join(repo, ".scratch", "auth-redesign", "spec.md"), "# Auth Redesign Spec\n\nStatus: ready-for-agent\n");
    await writeFile(
      path.join(repo, ".scratch", "auth-redesign", "issues", "01-provider-choice.md"),
      "# Provider choice\n\nType: grilling\nStatus: resolved\n"
    );
    await writeFile(
      path.join(repo, ".scratch", "auth-redesign", "issues", "02-session-storage.md"),
      "# Session storage\n\nType: research\nBlocked by: 01\n"
    );
    await writeFile(path.join(repo, ".out-of-scope", "dark-mode.md"), "# Dark Mode\n\nRejected.\n");
    await writeFile(path.join(repo, "CONTEXT.md"), "# Glossary\n\n**Effort** — one wayfinding journey.\n");
    await writeFile(path.join(repo, "docs", "adr", "0001-postgres.md"), "# ADR 0001: Postgres\n");
    await writeFile(path.join(repo, "docs", "agents", "issue-tracker.md"), "# Issue tracker: Local Markdown\n");

    const docs = await scanDocuments({ roots: [root] });
    const byPath = new Map(docs.map((doc) => [doc.relativePath, doc]));

    expect(byPath.get(".scratch/auth-redesign/map.md")?.workflow).toEqual({
      artifact: "wayfinder-map",
      effort: "auth-redesign"
    });
    expect(byPath.get(".scratch/auth-redesign/spec.md")?.workflow).toEqual({
      artifact: "feature-spec",
      effort: "auth-redesign",
      triageState: "ready-for-agent"
    });
    expect(byPath.get(".scratch/auth-redesign/spec.md")?.category).toBe("spec");
    expect(byPath.get(".scratch/auth-redesign/issues/01-provider-choice.md")?.workflow).toEqual({
      artifact: "wayfinder-ticket",
      effort: "auth-redesign",
      ticketNumber: "01",
      ticketType: "grilling",
      ticketStatus: "resolved"
    });
    expect(byPath.get(".scratch/auth-redesign/issues/02-session-storage.md")?.workflow).toEqual({
      artifact: "wayfinder-ticket",
      effort: "auth-redesign",
      ticketNumber: "02",
      ticketType: "research",
      ticketStatus: "open",
      blockedBy: ["01"]
    });
    expect(byPath.get(".out-of-scope/dark-mode.md")?.workflow?.artifact).toBe("out-of-scope");
    expect(byPath.get("CONTEXT.md")?.workflow?.artifact).toBe("domain-context");
    expect(byPath.get("docs/adr/0001-postgres.md")?.workflow?.artifact).toBe("adr");
    expect(byPath.get("docs/agents/issue-tracker.md")?.workflow?.artifact).toBe("agent-config");
  });
});

