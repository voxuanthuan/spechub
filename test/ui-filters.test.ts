describe("dashboard document filters", () => {
  it("filters by document category instead of file format", async () => {
    const page = await import("../app/page.js");
    const docs = [
      {
        id: "spec-1",
        title: "Search Design",
        kind: "markdown",
        category: "spec",
        sourceTitle: "Search Design",
        sourceName: "design.md",
        absolutePath: "/repo/docs/specs/design.md",
        relativePath: "docs/specs/design.md",
        repoName: "repo",
        repoRoot: "/repo",
        modifiedAt: "2026-06-08T00:00:00.000Z",
        mtimeMs: Date.now(),
        sizeBytes: 10
      },
      {
        id: "doc-1",
        title: "Rendered Mock",
        kind: "html",
        category: "doc",
        sourceTitle: "Rendered Mock",
        sourceName: "mock.html",
        absolutePath: "/repo/docs/mock.html",
        relativePath: "docs/mock.html",
        repoName: "repo",
        repoRoot: "/repo",
        modifiedAt: "2026-06-08T00:00:00.000Z",
        mtimeMs: Date.now(),
        sizeBytes: 10
      }
    ] satisfies Parameters<typeof page.filterDocs>[0];

    expect(page.filterDocs(docs, { repo: "all", query: "", category: "spec", date: "all", path: "" })).toHaveLength(1);
    expect(page.filterDocs(docs, { repo: "all", query: "", category: "spec", date: "all", path: "" })[0].id).toBe("spec-1");
  });
});
