import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/server.js";
import {
  addAnnotation,
  formatFeedbackForAgent,
  readAnnotations,
  removeAnnotation,
  type StoredAnnotation
} from "../src/annotations.js";

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "spechub-ann-"));
  await mkdir(path.join(root, "repo", "docs", "specs"), { recursive: true });
  await writeFile(path.join(root, "repo", "package.json"), "{}");
  await writeFile(path.join(root, "repo", "docs", "specs", "plan.md"), "# Plan\n\nSome content");
  return root;
}

function makeAnnotation(overrides: Partial<StoredAnnotation> = {}): StoredAnnotation {
  return {
    id: "ann-1",
    docId: "test-doc",
    type: "comment",
    selectedText: "selected",
    text: "feedback",
    startOffset: 0,
    endOffset: 8,
    createdAt: Date.now(),
    ...overrides
  };
}

describe("annotation storage", () => {
  it("reads empty when no annotations exist", async () => {
    const result = await readAnnotations("nonexistent-doc-id");
    expect(result).toEqual([]);
  });

  it("adds and reads annotations", async () => {
    const docId = `test-add-${Date.now()}`;
    const annotation = makeAnnotation({ docId });
    await addAnnotation(docId, annotation);
    const stored = await readAnnotations(docId);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("ann-1");
    expect(stored[0].selectedText).toBe("selected");
  });

  it("removes annotations by id", async () => {
    const docId = `test-remove-${Date.now()}`;
    await addAnnotation(docId, makeAnnotation({ id: "a1", docId }));
    await addAnnotation(docId, makeAnnotation({ id: "a2", docId }));
    const before = await readAnnotations(docId);
    expect(before).toHaveLength(2);
    await removeAnnotation(docId, "a1");
    const after = await readAnnotations(docId);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe("a2");
  });
});

describe("formatFeedbackForAgent", () => {
  it("generates structured Markdown feedback", () => {
    const result = formatFeedbackForAgent({
      docId: "doc-1",
      docTitle: "Test Plan",
      docPath: "/path/to/plan.md",
      annotations: [makeAnnotation({ type: "comment", selectedText: "hello", text: "fix this" })],
      agent: "claude-code"
    });
    expect(result).toContain("# Feedback for Claude Code");
    expect(result).toContain("**Document:** Test Plan");
    expect(result).toContain("> hello");
    expect(result).toContain("fix this");
  });

  it("handles multi-line selectedText in blockquotes", () => {
    const result = formatFeedbackForAgent({
      docId: "doc-2",
      docTitle: "Multi",
      docPath: "/path",
      annotations: [makeAnnotation({ selectedText: "line1\nline2\nline3" })],
      agent: "opencode"
    });
    expect(result).toContain("> line1\n> line2\n> line3");
  });
});

describe("annotation server routes", () => {
  it("CRUD annotations via API endpoints", async () => {
    const root = await fixtureRoot();
    const app = createApp({ roots: [root] });

    const list = await request(app).get("/api/docs").expect(200);
    const doc = list.body.docs[0];

    const getEmpty = await request(app).get(`/api/docs/${doc.id}/annotations`).expect(200);
    expect(getEmpty.body.annotations).toEqual([]);

    const created = await request(app)
      .post(`/api/docs/${doc.id}/annotations`)
      .send({ id: "ann-test-1", type: "highlight", selectedText: "Plan", text: "", startOffset: 2, endOffset: 6, createdAt: Date.now() })
      .expect(200);
    expect(created.body.annotation.id).toBe("ann-test-1");

    const getAfter = await request(app).get(`/api/docs/${doc.id}/annotations`).expect(200);
    expect(getAfter.body.annotations).toHaveLength(1);

    await request(app).delete(`/api/docs/${doc.id}/annotations/ann-test-1`).expect(200);

    const getDeleted = await request(app).get(`/api/docs/${doc.id}/annotations`).expect(200);
    expect(getDeleted.body.annotations).toEqual([]);
  });

  it("returns 404 for annotations on unknown doc", async () => {
    const root = await fixtureRoot();
    const app = createApp({ roots: [root] });
    await request(app).get("/api/docs/nonexistent/annotations").expect(404);
  });

  it("returns 400 for invalid annotation payload", async () => {
    const root = await fixtureRoot();
    const app = createApp({ roots: [root] });

    const list = await request(app).get("/api/docs").expect(200);
    const doc = list.body.docs[0];

    await request(app)
      .post(`/api/docs/${doc.id}/annotations`)
      .send({ bad: "payload" })
      .expect(400);
  });

  it("generates agent feedback", async () => {
    const root = await fixtureRoot();
    const app = createApp({ roots: [root] });

    const result = await request(app)
      .post("/api/agent/feedback")
      .send({
        docId: "doc-1",
        docTitle: "Test",
        docPath: "/path",
        annotations: [makeAnnotation()],
        agent: "codex"
      })
      .expect(200);
    expect(result.body.formatted).toContain("Feedback for Codex");
  });

  it("returns 400 for invalid feedback payload", async () => {
    const root = await fixtureRoot();
    const app = createApp({ roots: [root] });
    await request(app).post("/api/agent/feedback").send({}).expect(400);
  });
});
