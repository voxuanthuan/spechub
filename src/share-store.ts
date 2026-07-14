import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SharedDocument } from "./types.js";

export interface StoredShare {
  id: string;
  secretHash: string;
  document: SharedDocument;
  createdAt: string;
  updatedAt: string;
}

export interface ShareStore {
  create(share: StoredShare): Promise<boolean>;
  read(id: string): Promise<StoredShare | undefined>;
  update(share: StoredShare): Promise<void>;
  delete(id: string): Promise<void>;
}

export function createFileShareStore(dataDir: string): ShareStore {
  return {
    async create(share) {
      await mkdir(dataDir, { recursive: true });
      try {
        await writeFile(sharePath(share.id, dataDir), serializeShare(share), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        });
        return true;
      } catch (error) {
        if (isNodeError(error, "EEXIST")) return false;
        throw error;
      }
    },

    async read(id) {
      if (!isShareId(id)) return undefined;
      try {
        return JSON.parse(await readFile(sharePath(id, dataDir), "utf8")) as StoredShare;
      } catch (error) {
        if (isNodeError(error, "ENOENT")) return undefined;
        throw error;
      }
    },

    async update(share) {
      await mkdir(dataDir, { recursive: true });
      const filePath = sharePath(share.id, dataDir);
      const tempPath = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(tempPath, serializeShare(share), { encoding: "utf8", mode: 0o600 });
      await rename(tempPath, filePath);
    },

    async delete(id) {
      await unlink(sharePath(id, dataDir));
    }
  };
}

function serializeShare(share: StoredShare): string {
  return `${JSON.stringify(share, null, 2)}\n`;
}

function sharePath(id: string, dataDir: string): string {
  return path.join(dataDir, `${id}.json`);
}

function isShareId(value: string): boolean {
  return /^[A-Za-z0-9_-]{12}$/.test(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
