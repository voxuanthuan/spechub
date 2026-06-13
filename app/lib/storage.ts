import type { Accent, ActiveView, Density, SpecHubState } from "./types.js";
import { normalizeRepoNames } from "./filters.js";

export function readStoredAccent(): Accent {
  const stored = window.localStorage.getItem("spechub:accent");
  return stored === "Blue" || stored === "Violet" || stored === "Amber" ? stored : "Green";
}

export function readStoredDensity(): Density {
  const stored = window.localStorage.getItem("spechub:density");
  return stored === "compact" || stored === "comfy" ? stored : "regular";
}

export function readStoredView(): ActiveView {
  return window.localStorage.getItem("spechub:view") === "prompts" ? "prompts" : "documents";
}

export function readStoredHiddenRepos(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem("spechub:hidden-repos") ?? "[]");
    return Array.isArray(parsed) ? normalizeRepoNames(parsed) : [];
  } catch {
    return [];
  }
}

export function emptySpecHubState(hiddenRepos: string[] = []): SpecHubState {
  return {
    favorites: [],
    tags: {},
    hiddenRepos
  };
}

export function normalizeClientState(state: SpecHubState): SpecHubState {
  const tags = Object.fromEntries(
    Object.entries(state.tags)
      .map(([key, value]) => [key, normalizeRepoNames(value)] as const)
      .filter(([, value]) => value.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
  return {
    favorites: normalizeRepoNames(state.favorites),
    tags,
    hiddenRepos: normalizeRepoNames(state.hiddenRepos)
  };
}

export function createDraftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
