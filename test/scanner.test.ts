import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
    await mkdir(path.join(alpha, "docs", "supperspowers", "specs"), { recursive: true });
    await mkdir(path.join(alpha, "docs"), { recursive: true });
    await mkdir(path.join(alpha, "node_modules", "docs", "specs"), { recursive: true });
    await mkdir(path.join(beta, "specs"), { recursive: true });
    await mkdir(path.join(beta, "docs", "plans"), { recursive: true });

    await writeFile(path.join(alpha, "package.json"), "{}");
    await writeFile(path.join(alpha, "docs", "superpowers", "plans", "roadmap.md"), "# Roadmap\n");
    await writeFile(path.join(alpha, "docs", "supperspowers", "specs", "typo.html"), "<h1>Typo Path</h1>");
    await writeFile(path.join(alpha, "docs", "global-search-refactor-changes.html"), "<h1>Global Search Refactor</h1>");
    await writeFile(path.join(alpha, "node_modules", "docs", "specs", "noise.md"), "# Noise\n");
    await writeFile(path.join(beta, "package.json"), "{}");
    await writeFile(path.join(beta, "specs", "api.html"), "<title>API Contract</title>");
    await writeFile(path.join(beta, "docs", "plans", "migration.md"), "# Migration\n");
    await writeFile(path.join(beta, "plan.md"), "# Root Plan\n");
    await writeFile(path.join(beta, "notes.md"), "# Notes\n");

    const docs = await scanDocuments({ roots: [root] });

    expect(docs.map((doc) => doc.relativePath).sort()).toEqual([
      "docs/global-search-refactor-changes.html",
      "docs/plans/migration.md",
      "docs/superpowers/plans/roadmap.md",
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
});
