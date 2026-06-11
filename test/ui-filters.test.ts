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

  it("excludes hidden repositories from all browsing while allowing direct hidden repo selection", async () => {
    const page = await import("../app/page.js");
    const docs = [
      {
        id: "visible-1",
        title: "Visible Design",
        kind: "markdown",
        category: "spec",
        sourceTitle: "Visible Design",
        sourceName: "design.md",
        absolutePath: "/workspace/visible/docs/specs/design.md",
        relativePath: "docs/specs/design.md",
        repoName: "visible",
        repoRoot: "/workspace/visible",
        modifiedAt: "2026-06-08T00:00:00.000Z",
        mtimeMs: Date.now(),
        sizeBytes: 10
      },
      {
        id: "hidden-1",
        title: "Hidden Plan",
        kind: "markdown",
        category: "plan",
        sourceTitle: "Hidden Plan",
        sourceName: "plan.md",
        absolutePath: "/workspace/hidden/docs/plans/plan.md",
        relativePath: "docs/plans/plan.md",
        repoName: "hidden",
        repoRoot: "/workspace/hidden",
        modifiedAt: "2026-06-08T00:00:00.000Z",
        mtimeMs: Date.now(),
        sizeBytes: 10
      }
    ] satisfies Parameters<typeof page.filterDocs>[0];

    expect(page.filterDocs(docs, { repo: "all", query: "", category: "all", date: "all", path: "", hiddenRepos: ["hidden"] }).map((doc) => doc.id)).toEqual(["visible-1"]);
    expect(page.filterDocs(docs, { repo: "hidden", query: "", category: "all", date: "all", path: "", hiddenRepos: ["hidden"] }).map((doc) => doc.id)).toEqual(["hidden-1"]);
    expect(page.filterDocs(docs, { repo: "all", query: "", category: "all", date: "all", path: "", hiddenRepos: [] })).toHaveLength(2);
  });

  it("filters by favorites and tags using absolute paths", async () => {
    const page = await import("../app/page.js");
    const docs = [
      {
        id: "a",
        title: "API Design",
        kind: "markdown",
        category: "spec",
        sourceTitle: "API Design",
        sourceName: "design.md",
        absolutePath: "/workspace/repo/docs/api.md",
        relativePath: "docs/api.md",
        repoName: "repo",
        repoRoot: "/workspace/repo",
        modifiedAt: "2026-06-08T00:00:00.000Z",
        mtimeMs: Date.now(),
        sizeBytes: 10
      },
      {
        id: "b",
        title: "Migration Plan",
        kind: "markdown",
        category: "plan",
        sourceTitle: "Migration Plan",
        sourceName: "plan.md",
        absolutePath: "/workspace/repo/docs/migration.md",
        relativePath: "docs/migration.md",
        repoName: "repo",
        repoRoot: "/workspace/repo",
        modifiedAt: "2026-06-08T00:00:00.000Z",
        mtimeMs: Date.now(),
        sizeBytes: 10
      }
    ] satisfies Parameters<typeof page.filterDocs>[0];
    const state = {
      favorites: ["/workspace/repo/docs/migration.md"],
      tags: {
        "/workspace/repo/docs/api.md": ["api", "backend"],
        "/workspace/repo/docs/migration.md": ["release"]
      },
      hiddenRepos: []
    };

    expect(page.filterDocs(docs, {
      repo: "all",
      query: "",
      category: "all",
      date: "all",
      path: "",
      state,
      favoritesOnly: true,
      tag: "all"
    }).map((doc) => doc.id)).toEqual(["b"]);
    expect(page.filterDocs(docs, {
      repo: "all",
      query: "",
      category: "all",
      date: "all",
      path: "",
      state,
      favoritesOnly: false,
      tag: "backend"
    }).map((doc) => doc.id)).toEqual(["a"]);
  });
});
