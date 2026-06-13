import type { CategoryFilter, DateFilter, DocumentMeta, RepoSummary, SpecHubState } from "./types.js";

export function filterDocs(
  docs: DocumentMeta[],
  filters: {
    repo: string;
    query: string;
    category: CategoryFilter;
    date: DateFilter;
    path: string;
    hiddenRepos?: readonly string[];
    state?: SpecHubState;
    favoritesOnly?: boolean;
    tag?: string;
  }
) {
  const now = Date.now();
  const query = filters.query.trim().toLowerCase();
  const pathFilter = filters.path.trim().toLowerCase();
  const maxAge = filters.date === "all" ? null : Number(filters.date) * 24 * 60 * 60 * 1000;
  const hiddenRepoSet = new Set(filters.hiddenRepos ?? filters.state?.hiddenRepos ?? []);
  const favoriteSet = new Set(filters.state?.favorites ?? []);
  const tagFilter = filters.tag && filters.tag !== "all" ? filters.tag : null;

  return docs.filter((doc) => {
    const haystack = `${doc.title} ${doc.repoName} ${doc.relativePath} ${doc.kind} ${doc.category}`.toLowerCase();
    if (filters.repo === "all" && hiddenRepoSet.has(doc.repoName)) return false;
    if (filters.repo !== "all" && doc.repoName !== filters.repo) return false;
    if (filters.favoritesOnly && !favoriteSet.has(doc.absolutePath)) return false;
    if (tagFilter && !(filters.state?.tags[doc.absolutePath] ?? []).includes(tagFilter)) return false;
    if (filters.category !== "all" && doc.category !== filters.category) return false;
    if (query && !haystack.includes(query)) return false;
    if (pathFilter && !doc.relativePath.toLowerCase().includes(pathFilter)) return false;
    if (maxAge && now - new Date(doc.modifiedAt).getTime() > maxAge) return false;
    return true;
  });
}

export function summarizeRepos(docs: DocumentMeta[]): RepoSummary[] {
  const counts = new Map<string, number>();
  for (const doc of docs) counts.set(doc.repoName, (counts.get(doc.repoName) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizeRepoNames(names: unknown[]) {
  return [...new Set(names
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .map((name) => name.trim()))]
    .sort((left, right) => left.localeCompare(right));
}
