import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import request from "supertest";
import { createApp } from "../src/server.js";

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "spechub-server-"));
  await mkdir(path.join(root, "repo", "docs", "specs"), { recursive: true });
  await writeFile(path.join(root, "repo", "package.json"), "{}");
  await writeFile(path.join(root, "repo", "docs", "specs", "design.md"), "# Design\n\nBody");
  await writeFile(path.join(root, "repo", "docs", "specs", "mock.html"), "<!doctype html><title>Mock</title><h1>Mockup</h1>");
  return root;
}

describe("server routes", () => {
  it("serves dashboard, document list, Markdown detail, HTML detail, and raw files", async () => {
    const root = await fixtureRoot();
    const app = createApp({ roots: [root] });

    await request(app).get("/").expect(200).expect("Content-Type", /html/);

    const list = await request(app).get("/api/docs").expect(200);
    expect(list.body.docs).toHaveLength(2);

    const md = list.body.docs.find((doc: { relativePath: string }) => doc.relativePath.endsWith("design.md"));
    const html = list.body.docs.find((doc: { relativePath: string }) => doc.relativePath.endsWith("mock.html"));
    expect(md).toBeTruthy();
    expect(html).toBeTruthy();

    const mdDetail = await request(app).get(`/api/docs/${md.id}`).expect(200);
    expect(mdDetail.body.doc.renderedHtml).toContain("<h1>Design</h1>");
    expect(mdDetail.body.doc.rawUrl).toBe(`/raw/${md.id}`);

    const htmlDetail = await request(app).get(`/api/docs/${html.id}`).expect(200);
    expect(htmlDetail.body.doc).toMatchObject({
      kind: "html",
      rawUrl: `/raw/${html.id}`
    });

    await request(app).get(`/raw/${html.id}`).expect(200).expect("Content-Type", /html/);
    await request(app).get("/api/docs/not-found").expect(404);
  });

  it("updates and clears document title overrides without editing source files", async () => {
    const root = await fixtureRoot();
    const configPath = path.join(root, "spechub-config.json");
    const app = createApp({ roots: [root], configPath });

    const list = await request(app).get("/api/docs").expect(200);
    const md = list.body.docs.find((doc: { relativePath: string }) => doc.relativePath.endsWith("design.md"));
    expect(md).toBeTruthy();

    await request(app)
      .patch(`/api/docs/${md.id}/title`)
      .send({ title: "Renamed Design" })
      .expect(200);

    const renamed = await request(app).get(`/api/docs/${md.id}`).expect(200);
    expect(renamed.body.doc.title).toBe("Renamed Design");
    expect(renamed.body.doc.sourceTitle).toBe("Design");

    await request(app)
      .patch(`/api/docs/${md.id}/title`)
      .send({ title: "" })
      .expect(200);

    const restored = await request(app).get(`/api/docs/${md.id}`).expect(200);
    expect(restored.body.doc.title).toBe("Design");
  });

  it("serves OpenCode plan session documents from SQLite storage", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-server-opencode-"));
    const dataRoot = path.join(root, "opencode");
    const repo = path.join(root, "workspace", "core-api");
    await mkdir(dataRoot, { recursive: true });
    await mkdir(repo, { recursive: true });
    await writeFile(path.join(repo, "package.json"), "{}");
    await writeOpenCodePlanDb(path.join(dataRoot, "opencode.db"), repo);

    const app = createApp({
      roots: [path.join(root, "workspace")],
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

    const list = await request(app).get("/api/docs").expect(200);
    expect(list.body.docs).toHaveLength(1);

    const doc = list.body.docs[0];
    const detail = await request(app).get(`/api/docs/${doc.id}`).expect(200);
    expect(detail.body.doc.renderedHtml).toContain("<h2>Final Plan</h2>");

    await request(app)
      .get(`/raw/${doc.id}`)
      .expect(200)
      .expect("Content-Type", /text\/markdown/)
      .expect((response) => {
        expect(response.text).toContain("# Review import mutation");
        expect(response.text).toContain("Use repository path");
      });
  });

  it("returns workspace settings with existence flags and overrides warning", async () => {
    const root = await fixtureRoot();
    const missing = path.join(root, "does-not-exist");
    const configPath = path.join(root, "spechub-config.json");
    await writeFile(
      configPath,
      JSON.stringify({ roots: [path.join(root, "repo"), missing] }, null, 2)
    );

    const app = createApp({ configPath });
    const response = await request(app).get("/api/config").expect(200);
    expect(response.body.configPath).toBe(configPath);
    expect(response.body.explicitRoots).toBe(false);
    expect(response.body.warnings).toEqual([]);
    expect(response.body.roots).toEqual([
      { path: path.join(root, "repo"), expandedPath: path.join(root, "repo"), exists: true },
      { path: missing, expandedPath: missing, exists: false }
    ]);

    const overridden = createApp({
      configPath,
      roots: [path.join(root, "repo")],
      explicitRoots: true
    });
    const overrideResponse = await request(overridden).get("/api/config").expect(200);
    expect(overrideResponse.body.explicitRoots).toBe(true);
    expect(overrideResponse.body.warnings).toHaveLength(1);
    expect(overrideResponse.body.warnings[0]).toMatch(/--roots/);
  });

  it("persists workspace roots via PATCH and reflects them in /api/docs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-server-roots-"));
    const repoA = path.join(root, "repo-a");
    const repoB = path.join(root, "repo-b");
    await mkdir(path.join(repoA, "docs", "specs"), { recursive: true });
    await mkdir(path.join(repoB, "docs", "specs"), { recursive: true });
    await writeFile(path.join(repoA, "package.json"), "{}");
    await writeFile(path.join(repoB, "package.json"), "{}");
    await writeFile(path.join(repoA, "docs", "specs", "a.md"), "# A\n");
    await writeFile(path.join(repoB, "docs", "specs", "b.md"), "# B\n");

    const configPath = path.join(root, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [repoA],
        sources: [
          { name: "repositories", mode: "repositories", roots: [repoA], patterns: ["docs/**/*.md"] }
        ]
      })
    );
    const app = createApp({ configPath });

    const first = await request(app).get("/api/docs").expect(200);
    const firstPaths = (first.body.docs as Array<{ relativePath: string }>).map((doc) => doc.relativePath);
    expect(firstPaths).toContain("docs/specs/a.md");
    expect(firstPaths).not.toContain("docs/specs/b.md");

    const patched = await request(app)
      .patch("/api/config/roots")
      .send({ roots: [repoB] })
      .expect(200);
    expect(patched.body.roots).toEqual([
      { path: repoB, expandedPath: repoB, exists: true }
    ]);

    const after = await request(app).get("/api/docs").expect(200);
    const afterPaths = (after.body.docs as Array<{ relativePath: string }>).map((doc) => doc.relativePath);
    expect(afterPaths).toContain("docs/specs/b.md");
    expect(afterPaths).not.toContain("docs/specs/a.md");

    const onDisk = JSON.parse(await readFile(configPath, "utf8")) as {
      roots: string[];
      sources: Array<{ name: string; roots: string[] }>;
    };
    expect(onDisk.roots).toEqual([repoB]);
    expect(onDisk.sources[0]).toMatchObject({ name: "repositories", roots: [repoB] });
  });

  it("rejects invalid roots payloads with 400", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-server-roots-invalid-"));
    const configPath = path.join(root, "config.json");
    const app = createApp({ configPath });

    await request(app)
      .patch("/api/config/roots")
      .send({ roots: "nope" })
      .expect(400);

    await request(app)
      .patch("/api/config/roots")
      .send({ roots: ["   ", ""] })
      .expect(400);
  });
});

async function writeOpenCodePlanDb(dbPath: string, repo: string): Promise<void> {
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
  db.run("INSERT INTO message VALUES (?, ?, ?, ?, ?)", [
    "msg_assistant",
    "ses_plan",
    1_700_000_000_002,
    1_700_000_100_000,
    JSON.stringify({ role: "assistant", agent: "plan" })
  ]);
  db.run("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)", [
    "prt_assistant",
    "msg_assistant",
    "ses_plan",
    1_700_000_000_002,
    1_700_000_100_000,
    JSON.stringify({ type: "text", text: "## Final Plan\n\nUse repository path `" + repo + "`." })
  ]);

  await writeFile(dbPath, db.export());
  db.close();
}
