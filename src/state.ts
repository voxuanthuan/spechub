import { access, readFile } from "node:fs/promises";
import { expandHome, mutateJsonFile, normalizeOverridePath } from "./config.js";

export const DEFAULT_STATE_PATH = "~/.config/spechub/state.json";

export interface SpecHubState {
  favorites: string[];
  tags: Record<string, string[]>;
  hiddenRepos: string[];
}

export type SpecHubStatePatch = Partial<SpecHubState>;

const EMPTY_STATE: SpecHubState = {
  favorites: [],
  tags: {},
  hiddenRepos: []
};

export async function readStateFile(statePath = DEFAULT_STATE_PATH): Promise<SpecHubState> {
  const resolvedPath = expandHome(statePath);
  try {
    await access(resolvedPath);
    const raw = await readFile(resolvedPath, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

export async function updateStateFile(statePath: string, patch: SpecHubStatePatch): Promise<SpecHubState> {
  return mutateJsonFile(
    statePath,
    () => readStateFile(statePath),
    (existing) => normalizeState({ ...existing, ...patch })
  );
}

export function parseStatePatch(input: unknown): SpecHubStatePatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("state patch must be an object.");
  }
  const candidate = input as Record<string, unknown>;
  const patch: SpecHubStatePatch = {};

  if ("favorites" in candidate) {
    if (!isStringArray(candidate.favorites)) throw new Error("favorites must be an array of strings.");
    patch.favorites = candidate.favorites;
  }
  if ("hiddenRepos" in candidate) {
    if (!isStringArray(candidate.hiddenRepos)) throw new Error("hiddenRepos must be an array of strings.");
    patch.hiddenRepos = candidate.hiddenRepos;
  }
  if ("tags" in candidate) {
    if (!isStringRecord(candidate.tags)) throw new Error("tags must be a record of string arrays.");
    patch.tags = candidate.tags;
  }

  return patch;
}

function normalizeState(input: unknown): SpecHubState {
  if (!input || typeof input !== "object" || Array.isArray(input)) return emptyState();
  const candidate = input as Partial<SpecHubState>;
  return {
    favorites: normalizePaths(candidate.favorites),
    tags: normalizeTags(candidate.tags),
    hiddenRepos: normalizeNames(candidate.hiddenRepos)
  };
}

function normalizePaths(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(
    input
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => normalizeOverridePath(item.trim()))
  )].sort((left, right) => left.localeCompare(right));
}

function normalizeTags(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const entries = Object.entries(input)
    .map(([rawPath, rawTags]) => [normalizeOverridePath(rawPath), normalizeNames(rawTags)] as const)
    .filter(([, tags]) => tags.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function normalizeNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(
    input
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
  )].sort((left, right) => left.localeCompare(right));
}

function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every((item) => typeof item === "string");
}

function isStringRecord(input: unknown): input is Record<string, string[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  return Object.values(input).every(isStringArray);
}

function emptyState(): SpecHubState {
  return {
    favorites: [],
    tags: {},
    hiddenRepos: []
  };
}
