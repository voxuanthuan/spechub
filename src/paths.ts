import os from "node:os";
import path from "node:path";

export interface RepoHint {
  root: string;
  name: string;
}

export function normalizePath(input: string): string {
  return input.split(path.sep).join("/");
}

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findHintByPath(absolutePath: string, repoHints: RepoHint[]): RepoHint | undefined {
  if (repoHints.length === 0) return undefined;
  const normalized = normalizePath(path.resolve(absolutePath));
  return [...repoHints]
    .sort((left, right) => right.root.length - left.root.length)
    .find((repo) => normalized === repo.root || normalized.startsWith(`${repo.root}/`));
}

export function inferRepoFromContent(raw: string, repoHints: RepoHint[]): RepoHint | undefined {
  const normalizedRaw = normalizePath(raw);
  const byRootLength = [...repoHints].sort((left, right) => right.root.length - left.root.length);
  const exactRoot = byRootLength.find((repo) => normalizedRaw.includes(repo.root));
  if (exactRoot) return exactRoot;

  return byRootLength.find((repo) => new RegExp(`(^|[^\\w-])${escapeRegExp(repo.name)}([^\\w-]|$)`, "i").test(raw));
}
