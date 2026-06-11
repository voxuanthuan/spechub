import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDocumentIndex } from "../src/index-service.js";

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "spechub-index-"));
  const repo = path.join(root, "repo");
  await mkdir(path.join(repo, "docs", "specs"), { recursive: true });
  await writeFile(path.join(repo, "package.json"), "{}");
  return { root, repo };
}

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (lastError) throw lastError;
}

describe("createDocumentIndex", () => {
  it("caches scans until refresh or debounced invalidation", async () => {
    const { root, repo } = await fixtureRoot();
    const firstPath = path.join(repo, "docs", "specs", "first.md");
    const secondPath = path.join(repo, "docs", "specs", "second.md");
    await writeFile(firstPath, "# First\n");

    const index = createDocumentIndex({ roots: [root] }, { debounceMs: 25 });
    try {
      const first = await index.getDocs();
      expect(first.map((doc) => doc.title)).toEqual(["First"]);

      await writeFile(secondPath, "# Second\n");
      await expect(index.getDocs()).resolves.toHaveLength(1);

      const refreshed = await index.refresh();
      expect(refreshed.map((doc) => doc.title).sort()).toEqual(["First", "Second"]);

      await writeFile(path.join(repo, "docs", "specs", "third.md"), "# Third\n");
      index.invalidate();
      await waitFor(async () => {
        const docs = await index.getDocs();
        expect(docs.map((doc) => doc.title).sort()).toEqual(["First", "Second", "Third"]);
      });
    } finally {
      await index.close();
    }
  });

  it("emits docs-changed when a watched markdown file is added", async () => {
    const { root, repo } = await fixtureRoot();
    await writeFile(path.join(repo, "docs", "specs", "first.md"), "# First\n");

    const index = createDocumentIndex({ roots: [root] }, { debounceMs: 25 });
    const versions: number[] = [];
    index.events.on("docs-changed", (event) => versions.push(event.version));
    try {
      await index.getDocs();
      await index.startWatching();
      await writeFile(path.join(repo, "docs", "specs", "watched.md"), "# Watched\n");

      await waitFor(async () => {
        expect(versions.length).toBeGreaterThan(0);
        const docs = await index.getDocs();
        expect(docs.map((doc) => doc.title)).toContain("Watched");
      }, 5_000);
    } finally {
      await index.close();
    }
  }, 10_000);
});
