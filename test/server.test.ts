import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import request from "supertest";
import { createApp } from "../src/server.js";
import type { DocumentIndex } from "../src/index-service.js";

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
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [root],
        sources: [
          {
            name: "repositories",
            mode: "repositories",
            roots: [root],
            patterns: ["docs/specs/**/*.{md,html}"]
          }
        ]
      })
    );
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

  it("adds a file folder that loads all Markdown/HTML under its path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-server-files-"));
    const folder = path.join(root, "notes");
    await mkdir(path.join(folder, "sub"), { recursive: true });
    await writeFile(path.join(folder, "one.md"), "# One\n");
    await writeFile(path.join(folder, "sub", "two.html"), "<title>Two</title>");
    const configPath = path.join(root, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        roots: [root],
        sources: [{ name: "repositories", mode: "repositories", roots: [root], patterns: ["docs/specs/**/*.{md,html}"] }]
      })
    );
    const app = createApp({ configPath });

    const patched = await request(app)
      .patch("/api/config/files")
      .send({ sources: [{ name: "notes", roots: [folder] }] })
      .expect(200);
    expect(patched.body.fileSources).toEqual([
      { name: "notes", roots: [{ path: folder, expandedPath: folder, exists: true }] }
    ]);

    const onDisk = JSON.parse(await readFile(configPath, "utf8")) as {
      sources: Array<{ name: string; mode: string; roots: string[] }>;
    };
    expect(onDisk.sources.map((source) => source.mode)).toEqual(["repositories", "files"]);
    expect(onDisk.sources[1]).toEqual({ name: "notes", mode: "files", roots: [folder] });

    const list = await request(app).get("/api/docs").expect(200);
    const folderDocs = (list.body.docs as Array<{ sourceName: string; relativePath: string }>)
      .filter((doc) => doc.sourceName === "notes");
    expect(folderDocs.map((doc) => doc.relativePath).sort()).toEqual(["one.md", "sub/two.html"]);
  });

  it("rejects invalid file-folder payloads with 400", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-server-files-invalid-"));
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, JSON.stringify({ roots: [root] }));
    const app = createApp({ configPath });

    await request(app)
      .patch("/api/config/files")
      .send({ sources: "nope" })
      .expect(400);

    await request(app)
      .patch("/api/config/files")
      .send({ sources: [{ name: "notes", roots: [42] }] })
      .expect(400);
  });

  it("persists and clears the public share server URL", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-server-share-config-"));
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, JSON.stringify({ roots: [root] }));
    const app = createApp({ configPath });

    const saved = await request(app)
      .patch("/api/config/share-server")
      .send({ shareServerUrl: "https://share.example.com/" })
      .expect(200);
    expect(saved.body.shareServerUrl).toBe("https://share.example.com");
    expect(JSON.parse(await readFile(configPath, "utf8")).shareServerUrl).toBe("https://share.example.com");

    await request(app)
      .patch("/api/config/share-server")
      .send({ shareServerUrl: "file:///tmp/share" })
      .expect(400);

    const cleared = await request(app)
      .patch("/api/config/share-server")
      .send({ shareServerUrl: "" })
      .expect(200);
    expect(cleared.body.shareServerUrl).toBe("");
    expect(JSON.parse(await readFile(configPath, "utf8")).shareServerUrl).toBeUndefined();
  });

  it("recovers from a corrupt config file with a warning", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-server-corrupt-config-"));
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, "{ not json");
    const app = createApp({ configPath });

    await request(app)
      .get("/api/docs")
      .expect(200)
      .expect((response) => {
        expect(Array.isArray(response.body.docs)).toBe(true);
      });

    await request(app)
      .get("/api/config")
      .expect(200)
      .expect((response) => {
        expect(response.body.warnings[0]).toMatch(/could not be parsed/i);
      });
  });

  it("reads and patches persisted dashboard state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-server-state-"));
    const statePath = path.join(root, "state.json");
    const app = createApp({ roots: [root], statePath });

    await request(app)
      .get("/api/state")
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({ favorites: [], tags: {}, hiddenRepos: [] });
      });

    await request(app)
      .patch("/api/state")
      .send({
        favorites: ["/repo/a.md"],
        tags: { "/repo/a.md": ["api", "plan"] },
        hiddenRepos: ["archive"]
      })
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          favorites: ["/repo/a.md"],
          tags: { "/repo/a.md": ["api", "plan"] },
          hiddenRepos: ["archive"]
        });
      });

    await request(app)
      .get("/api/state")
      .expect(200)
      .expect((response) => {
        expect(response.body.hiddenRepos).toEqual(["archive"]);
      });
  });

  it("rejects invalid dashboard state payloads with 400", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-server-state-invalid-"));
    const statePath = path.join(root, "state.json");
    const app = createApp({ roots: [root], statePath });

    await request(app)
      .patch("/api/state")
      .send({ favorites: "nope" })
      .expect(400);

    await request(app)
      .patch("/api/state")
      .send({ tags: { "/repo/a.md": [1] } })
      .expect(400);
  });

  it("serves SSE events and removes listeners on disconnect", async () => {
    const events = new EventEmitter();
    const index: DocumentIndex = {
      events,
      getDocs: async () => [],
      findById: async () => undefined,
      refresh: async () => [],
      invalidate: () => {},
      startWatching: async () => {},
      close: async () => {}
    };
    const app = createApp({}, index);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected test server address");
    const url = `http://127.0.0.1:${address.port}/api/events`;

    try {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(events.listenerCount("docs-changed")).toBe(1);

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const first = await reader!.read();
      expect(new TextDecoder().decode(first.value)).toContain("event: hello");

      await reader!.cancel();
      await waitFor(() => expect(events.listenerCount("docs-changed")).toBe(0));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (lastError) throw lastError;
}

async function writeOpenCodePlanDb(dbPath: string, repo: string): Promise<void> {
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
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
    "msg_assistant",
    "ses_plan",
    1_700_000_000_002,
    1_700_000_100_000,
    JSON.stringify({ role: "assistant", agent: "plan" })
  );
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(
    "prt_assistant",
    "msg_assistant",
    "ses_plan",
    1_700_000_000_002,
    1_700_000_100_000,
    JSON.stringify({ type: "text", text: "## Final Plan\n\nUse repository path `" + repo + "`." })
  );

  db.close();
}
