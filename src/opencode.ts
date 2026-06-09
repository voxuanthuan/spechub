import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";
import { normalizeOverridePath } from "./config.js";
import type { DocumentMeta, SpecHubSource } from "./types.js";

interface RepoHint {
  root: string;
  name: string;
}

interface SessionRow {
  id: string;
  title: string;
  directory?: string;
  time_created?: number;
  time_updated?: number;
}

interface TextPartRow {
  message_id: string;
  message_time_created?: number;
  message_data: string;
  part_id: string;
  part_data: string;
}

const MAX_PLAN_SESSIONS = 200;

export async function scanOpenCodePlanSource(
  source: SpecHubSource,
  titleOverrides: Record<string, string>,
  repoHints: RepoHint[]
): Promise<DocumentMeta[]> {
  const docs = await Promise.all(
    source.roots.map(async (root) => scanOpenCodeDbPath(await resolveOpenCodeDbPath(root), source, titleOverrides, repoHints))
  );
  return docs.flat();
}

export async function readOpenCodePlanContent(dbPath: string, sessionId: string): Promise<string> {
  const db = await openDatabase(dbPath);
  try {
    const session = selectRows<SessionRow>(
      db,
      "SELECT id, title, directory, time_created, time_updated FROM session WHERE id = ? AND agent = 'plan' LIMIT 1",
      [sessionId]
    )[0];
    if (!session) {
      throw new Error(`OpenCode plan session not found: ${sessionId}`);
    }

    const text = readAssistantText(db, sessionId);
    return formatPlanContent(session, text);
  } finally {
    db.close();
  }
}

async function scanOpenCodeDbPath(
  dbPath: string,
  source: SpecHubSource,
  titleOverrides: Record<string, string>,
  repoHints: RepoHint[]
): Promise<DocumentMeta[]> {
  let stats;
  try {
    stats = await stat(dbPath);
  } catch {
    return [];
  }

  const db = await openDatabase(dbPath);
  try {
    if (!hasRequiredTables(db)) return [];
    const sessions = selectRows<SessionRow>(
      db,
      `
        SELECT id, title, directory, time_created, time_updated
        FROM session
        WHERE agent = 'plan'
        ORDER BY COALESCE(time_updated, time_created, 0) DESC
        LIMIT ${MAX_PLAN_SESSIONS}
      `
    );

    return sessions
      .map((session) => {
        const text = readAssistantText(db, session.id);
        if (!text.trim()) return null;
        return createOpenCodePlanMeta(dbPath, session, text, source, titleOverrides, repoHints, stats.mtimeMs);
      })
      .filter((doc): doc is DocumentMeta => Boolean(doc));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

async function openDatabase(dbPath: string) {
  const SQL = await initSqlJs();
  const raw = await readFile(dbPath);
  return new SQL.Database(new Uint8Array(raw));
}

async function resolveOpenCodeDbPath(root: string): Promise<string> {
  const resolved = path.resolve(root);
  if (path.basename(resolved).endsWith(".db")) return resolved;
  return path.join(resolved, "opencode.db");
}

function hasRequiredTables(db: initSqlJs.Database): boolean {
  const rows = selectRows<{ name: string }>(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('session', 'message', 'part')"
  );
  return new Set(rows.map((row) => row.name)).size === 3;
}

function readAssistantText(db: initSqlJs.Database, sessionId: string): string {
  const rows = selectRows<TextPartRow>(
    db,
    `
      SELECT
        message.id AS message_id,
        message.time_created AS message_time_created,
        message.data AS message_data,
        part.id AS part_id,
        part.data AS part_data
      FROM message
      JOIN part ON part.message_id = message.id
      WHERE message.session_id = ?
      ORDER BY message.time_created ASC, part.id ASC
    `,
    [sessionId]
  );

  const chunks: string[] = [];
  for (const row of rows) {
    const message = parseJsonObject(row.message_data);
    if (message.role !== "assistant") continue;
    const part = parseJsonObject(row.part_data);
    if (part.type !== "text" || typeof part.text !== "string") continue;
    const text = part.text.trim();
    if (text) chunks.push(text);
  }
  return chunks.join("\n\n---\n\n");
}

function createOpenCodePlanMeta(
  dbPath: string,
  session: SessionRow,
  text: string,
  source: SpecHubSource,
  titleOverrides: Record<string, string>,
  repoHints: RepoHint[],
  fallbackMtimeMs: number
): DocumentMeta {
  const absolutePath = `${path.resolve(dbPath)}#${session.id}`;
  const title = cleanTitle(session.title) || "OpenCode Plan";
  const directory = typeof session.directory === "string" ? path.resolve(session.directory) : undefined;
  const repo = directory ? { root: directory, name: path.basename(directory) } : inferRepo(text, repoHints);
  const mtimeMs = Number(session.time_updated ?? session.time_created ?? fallbackMtimeMs);

  return {
    id: createHash("sha256").update(absolutePath).digest("hex").slice(0, 20),
    title: titleOverrides[normalizeOverridePath(absolutePath)] ?? title,
    sourceTitle: title,
    kind: "markdown",
    category: source.defaultCategory ?? "plan",
    sourceName: source.name,
    absolutePath,
    relativePath: `${source.name}/${safeFilename(session.id)}.md`,
    repoName: repo?.name ?? source.name,
    repoRoot: repo?.root ?? path.dirname(dbPath),
    modifiedAt: new Date(mtimeMs).toISOString(),
    mtimeMs,
    sizeBytes: Buffer.byteLength(formatPlanContent(session, text), "utf8"),
    contentSource: {
      type: "opencode-db",
      dbPath,
      sessionId: session.id
    }
  };
}

function formatPlanContent(session: SessionRow, text: string): string {
  const title = cleanTitle(session.title) || "OpenCode Plan";
  const metadata = [
    `Session: \`${session.id}\``,
    session.directory ? `Directory: \`${session.directory}\`` : undefined
  ].filter(Boolean);

  return [`# ${title}`, metadata.length ? metadata.join("\n") : undefined, text.trim()].filter(Boolean).join("\n\n");
}

function selectRows<T extends object>(db: initSqlJs.Database, sql: string, params: initSqlJs.BindParams = []): T[] {
  const result = db.exec(sql, params)[0];
  if (!result) return [];
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))
  ) as T[];
}

function parseJsonObject(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function inferRepo(raw: string, repoHints: RepoHint[]): RepoHint | undefined {
  const normalizedRaw = normalizePath(raw);
  const byRootLength = [...repoHints].sort((left, right) => right.root.length - left.root.length);
  const exactRoot = byRootLength.find((repo) => normalizedRaw.includes(repo.root));
  if (exactRoot) return exactRoot;

  return byRootLength.find((repo) => new RegExp(`(^|[^\\w-])${escapeRegExp(repo.name)}([^\\w-]|$)`, "i").test(raw));
}

function cleanTitle(input: string): string {
  return input.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function safeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function normalizePath(input: string): string {
  return input.split(path.sep).join("/");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
