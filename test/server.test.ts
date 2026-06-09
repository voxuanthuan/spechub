import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
