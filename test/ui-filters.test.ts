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

  it("filters by triage state and workflow artifact, and summarizes state counts", async () => {
    const page = await import("../app/page.js");
    const base = {
      kind: "markdown",
      category: "doc",
      sourceName: "repositories",
      repoName: "repo",
      repoRoot: "/repo",
      modifiedAt: "2026-06-08T00:00:00.000Z",
      sizeBytes: 10
    } as const;
    const docs = [
      {
        ...base,
        id: "ticket-1",
        title: "Provider choice",
        sourceTitle: "Provider choice",
        absolutePath: "/repo/.scratch/auth/issues/01-provider.md",
        relativePath: ".scratch/auth/issues/01-provider.md",
        mtimeMs: Date.now(),
        workflow: { artifact: "wayfinder-ticket", effort: "auth", ticketNumber: "01", triageState: "ready-for-agent", ticketStatus: "open" }
      },
      {
        ...base,
        id: "ticket-2",
        title: "Session storage",
        sourceTitle: "Session storage",
        absolutePath: "/repo/.scratch/auth/issues/02-session.md",
        relativePath: ".scratch/auth/issues/02-session.md",
        mtimeMs: Date.now(),
        workflow: { artifact: "wayfinder-ticket", effort: "auth", ticketNumber: "02", triageState: "needs-info", ticketStatus: "claimed" }
      },
      {
        ...base,
        id: "map-1",
        title: "Auth map",
        sourceTitle: "Auth map",
        absolutePath: "/repo/.scratch/auth/map.md",
        relativePath: ".scratch/auth/map.md",
        mtimeMs: Date.now(),
        workflow: { artifact: "wayfinder-map", effort: "auth" }
      },
      {
        ...base,
        id: "plain-1",
        title: "Roadmap",
        sourceTitle: "Roadmap",
        absolutePath: "/repo/docs/plans/roadmap.md",
        relativePath: "docs/plans/roadmap.md",
        mtimeMs: Date.now()
      }
    ] satisfies Parameters<typeof page.filterDocs>[0];

    const filters = { repo: "all", query: "", category: "all", date: "all", path: "" } as const;

    expect(page.filterDocs(docs, { ...filters, triageState: "ready-for-agent" }).map((doc) => doc.id)).toEqual(["ticket-1"]);
    expect(page.filterDocs(docs, { ...filters, artifact: "wayfinder-map" }).map((doc) => doc.id)).toEqual(["map-1"]);
    expect(page.filterDocs(docs, { ...filters, triageState: "all", artifact: "all" })).toHaveLength(4);
    // Workflow fields participate in free-text search.
    expect(page.filterDocs(docs, { ...filters, query: "needs-info" }).map((doc) => doc.id)).toEqual(["ticket-2"]);
    expect(page.summarizeTriageStates(docs)).toEqual([
      { state: "needs-triage", count: 0 },
      { state: "needs-info", count: 1 },
      { state: "ready-for-agent", count: 1 },
      { state: "ready-for-human", count: 0 },
      { state: "wontfix", count: 0 }
    ]);
  });
});
