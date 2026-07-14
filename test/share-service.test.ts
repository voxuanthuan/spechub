import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createShareService } from "../src/share-service.js";
import type { SharedDocument } from "../src/types.js";

function sharedDocument(content = "# Public plan\n\nReview this."): SharedDocument {
  return {
    schemaVersion: 1,
    title: "Public plan",
    kind: "markdown",
    category: "plan",
    repoName: "spechub",
    relativePath: "docs/plan.md",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    content,
    publishedAt: "2026-01-01T00:01:00.000Z"
  };
}

describe("hosted share service", () => {
  it("creates an unlisted public share without persisting the plaintext secret", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "spechub-share-service-"));
    const app = createShareService({ dataDir, publicUrl: "https://share.example.com" });

    const created = await request(app)
      .post("/api/shares")
      .send({ document: sharedDocument() })
      .expect(201);

    expect(created.body).toMatchObject({
      url: `https://share.example.com/s/${created.body.id}`
    });
    expect(created.body.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(created.body.secret).toMatch(/^[A-Za-z0-9_-]+$/);

    const stored = await readFile(path.join(dataDir, `${created.body.id}.json`), "utf8");
    expect(stored).not.toContain(created.body.secret);

    const viewer = await request(app).get(`/s/${created.body.id}`).expect(200);
    expect(viewer.text).toContain("noindex,nofollow");
    expect(viewer.text).toContain("<h1>Public plan</h1>");
    expect(viewer.text).not.toContain(created.body.secret);
  });

  it("updates and deletes only with the private management secret", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "spechub-share-manage-"));
    const app = createShareService({ dataDir });
    const created = await request(app)
      .post("/api/shares")
      .send({ document: sharedDocument() })
      .expect(201);

    await request(app)
      .put(`/api/shares/${created.body.id}`)
      .send({ secret: "wrong", document: sharedDocument("# Wrong") })
      .expect(403);

    await request(app)
      .put(`/api/shares/${created.body.id}`)
      .send({ secret: created.body.secret, document: sharedDocument("# Updated") })
      .expect(200);

    const data = await request(app).get(`/api/shares/${created.body.id}/data`).expect(200);
    expect(data.body.document.content).toBe("# Updated");
    expect(data.body).not.toHaveProperty("secret");

    await request(app)
      .delete(`/api/shares/${created.body.id}`)
      .send({ secret: "wrong" })
      .expect(403);
    await request(app)
      .delete(`/api/shares/${created.body.id}`)
      .send({ secret: created.body.secret })
      .expect(204);
    await request(app).get(`/api/shares/${created.body.id}/data`).expect(404);
    await request(app).get(`/s/${created.body.id}`).expect(404);
  });

  it("validates snapshots and enforces the content size limit", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "spechub-share-validation-"));
    const app = createShareService({ dataDir });

    await request(app).post("/api/shares").send({ document: { title: "Missing fields" } }).expect(400);
    await request(app)
      .post("/api/shares")
      .send({ document: sharedDocument("x".repeat(2 * 1024 * 1024 + 1)) })
      .expect(413);
  });

  it("supports a distributed creation limiter", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "spechub-share-limiter-"));
    const app = createShareService({
      dataDir,
      createLimiter: {
        async allow() {
          return false;
        }
      }
    });

    await request(app)
      .post("/api/shares")
      .send({ document: sharedDocument() })
      .expect(429, { error: "Too many shares created. Try again later." });
  });

  it("sandboxes shared HTML instead of embedding it into the viewer", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "spechub-share-html-"));
    const app = createShareService({ dataDir });
    const html = {
      ...sharedDocument("<script>document.body.dataset.ready = 'yes'</script><h1>Demo</h1>"),
      kind: "html" as const
    };
    const created = await request(app).post("/api/shares").send({ document: html }).expect(201);

    const viewer = await request(app).get(`/s/${created.body.id}`).expect(200);
    expect(viewer.text).toContain("sandbox=\"allow-scripts\"");
    expect(viewer.text).not.toContain("<script>");

    const raw = await request(app).get(`/s/${created.body.id}/raw`).expect(200);
    expect(raw.headers["content-security-policy"]).toContain("connect-src 'none'");
    expect(raw.text).toContain("<script>");
  });
});
