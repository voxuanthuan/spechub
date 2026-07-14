import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createShareService, startShareServer } from "../src/share-service.js";
import { createApp } from "../src/server.js";

describe("local document sharing routes", () => {
  it("publishes, refreshes, and unshares a sanitized snapshot", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-local-share-"));
    const repo = path.join(root, "private-workspace", "repo");
    const documentPath = path.join(repo, "docs", "specs", "plan.md");
    const shareDataDir = path.join(root, "remote-data");
    const shareStateDir = path.join(root, "local-state");
    await mkdir(path.dirname(documentPath), { recursive: true });
    await writeFile(path.join(repo, "package.json"), "{}");
    await writeFile(documentPath, "# Initial plan\n\nPublic content.");

    const { server: shareServer, url: shareServerUrl } = await startShareServer({
      dataDir: shareDataDir,
      publicUrl: "https://review.example.com",
      host: "127.0.0.1",
      port: 0
    });
    const app = createApp({ roots: [root], shareServerUrl, shareStateDir });

    try {
      const list = await request(app).get("/api/docs").expect(200);
      const doc = list.body.docs[0];
      const created = await request(app).post(`/api/docs/${doc.id}/share`).expect(200);
      expect(created.body.share.url).toBe(`https://review.example.com/s/${created.body.share.id}`);

      const status = await request(app).get(`/api/docs/${doc.id}/share`).expect(200);
      expect(status.body.share).toEqual(created.body.share);
      expect(status.body.share).not.toHaveProperty("secret");

      const remoteApp = createShareService({ dataDir: shareDataDir });
      const remote = await request(remoteApp).get(`/api/shares/${created.body.share.id}/data`).expect(200);
      expect(remote.body.document).toMatchObject({
        title: "Initial plan",
        repoName: "repo",
        relativePath: "docs/specs/plan.md",
        content: "# Initial plan\n\nPublic content."
      });
      expect(JSON.stringify(remote.body)).not.toContain(root);
      expect(JSON.stringify(remote.body)).not.toContain("absolutePath");
      expect(JSON.stringify(remote.body)).not.toContain("repoRoot");

      await writeFile(documentPath, "# Updated plan\n\nNew public content.");
      await request(app).get("/api/docs?refresh=1").expect(200);
      await request(app).post(`/api/docs/${doc.id}/share`).expect(200);
      const updated = await request(remoteApp).get(`/api/shares/${created.body.share.id}/data`).expect(200);
      expect(updated.body.document.content).toContain("Updated plan");

      const reconfiguredApp = createApp({
        roots: [root],
        shareServerUrl: "http://127.0.0.1:1",
        shareStateDir
      });
      await request(reconfiguredApp).post(`/api/docs/${doc.id}/share`).expect(200);
      await request(reconfiguredApp).delete(`/api/docs/${doc.id}/share`).expect(204);

      await request(remoteApp).get(`/api/shares/${created.body.share.id}/data`).expect(404);
      await request(app).get(`/api/docs/${doc.id}/share`).expect(200, { share: null });
    } finally {
      await new Promise<void>((resolve, reject) => shareServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("returns an actionable error when no share server is configured", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spechub-local-share-config-"));
    const repo = path.join(root, "repo");
    await mkdir(path.join(repo, "docs", "specs"), { recursive: true });
    await writeFile(path.join(repo, "package.json"), "{}");
    await writeFile(path.join(repo, "docs", "specs", "plan.md"), "# Plan");
    const app = createApp({ roots: [root], shareStateDir: path.join(root, "state") });
    const list = await request(app).get("/api/docs").expect(200);

    const response = await request(app).post(`/api/docs/${list.body.docs[0].id}/share`).expect(503);
    expect(response.body.error).toMatch(/configure a share server url/i);
  });
});
