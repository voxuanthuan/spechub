import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
});
