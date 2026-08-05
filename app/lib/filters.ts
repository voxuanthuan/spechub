import type {
  ArtifactFilter,
  CategoryFilter,
  DateFilter,
  DocumentMeta,
  RepoSummary,
  SpecHubState,
  TriageState,
  TriageStateFilter
} from "./types.js";

/** Canonical display order for triage state chips — matches the /triage state machine. */
export const TRIAGE_STATE_ORDER: TriageState[] = [
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix"
];

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
    triageState?: TriageStateFilter;
    artifact?: ArtifactFilter;
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
    const workflow = doc.workflow;
    const haystack = `${doc.title} ${doc.repoName} ${doc.relativePath} ${doc.kind} ${doc.category} ${workflow?.artifact ?? ""} ${workflow?.triageState ?? ""} ${workflow?.ticketType ?? ""} ${workflow?.ticketStatus ?? ""} ${workflow?.effort ?? ""}`.toLowerCase();
    if (filters.repo === "all" && hiddenRepoSet.has(doc.repoName)) return false;
    if (filters.repo !== "all" && doc.repoName !== filters.repo) return false;
    if (filters.favoritesOnly && !favoriteSet.has(doc.absolutePath)) return false;
    if (tagFilter && !(filters.state?.tags[doc.absolutePath] ?? []).includes(tagFilter)) return false;
    if (filters.category !== "all" && doc.category !== filters.category) return false;
    if (filters.triageState && filters.triageState !== "all" && workflow?.triageState !== filters.triageState) return false;
    if (filters.artifact && filters.artifact !== "all" && workflow?.artifact !== filters.artifact) return false;
    if (query && !haystack.includes(query)) return false;
    if (pathFilter && !doc.relativePath.toLowerCase().includes(pathFilter)) return false;
    if (maxAge && now - new Date(doc.modifiedAt).getTime() > maxAge) return false;
    return true;
  });
}

export interface TriageStateSummary {
  state: TriageState;
  count: number;
}

/** Counts per triage state, in canonical order, for the state chips row. */
export function summarizeTriageStates(docs: DocumentMeta[]): TriageStateSummary[] {
  const counts = new Map<TriageState, number>();
  for (const doc of docs) {
    const state = doc.workflow?.triageState;
    if (state) counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return TRIAGE_STATE_ORDER.map((state) => ({ state, count: counts.get(state) ?? 0 }));
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
