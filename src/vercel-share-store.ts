import { del, get, put } from "@vercel/blob";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { ShareCreateLimiter } from "./share-service.js";
import type { ShareStore, StoredShare } from "./share-store.js";
import type { SharedDocument } from "./types.js";

export interface StoredShareMetadata {
  id: string;
  secretHash: string;
  snapshotPath: string;
  createdAt: string;
  updatedAt: string;
  ready: boolean;
}

export interface ShareSnapshotStorage {
  read(pathname: string): Promise<SharedDocument | undefined>;
  write(pathname: string, document: SharedDocument, overwrite: boolean): Promise<void>;
  delete(pathname: string): Promise<void>;
}

export interface ShareMetadataStorage {
  reserve(id: string, metadata: StoredShareMetadata): Promise<boolean>;
  read(id: string): Promise<StoredShareMetadata | undefined>;
  write(id: string, metadata: StoredShareMetadata): Promise<void>;
  delete(id: string): Promise<void>;
}

export function createVercelShareStore(options: {
  snapshots?: ShareSnapshotStorage;
  metadata?: ShareMetadataStorage;
} = {}): ShareStore {
  const snapshots = options.snapshots ?? createVercelBlobSnapshotStorage();
  const metadata = options.metadata ?? createUpstashShareMetadataStorage();

  return {
    async create(share) {
      const snapshotPath = snapshotPathFor(share.id);
      const reserved = await metadata.reserve(share.id, {
        id: share.id,
        secretHash: share.secretHash,
        snapshotPath,
        createdAt: share.createdAt,
        updatedAt: share.updatedAt,
        ready: false
      });
      if (!reserved) return false;

      try {
        await snapshots.write(snapshotPath, share.document, false);
        await metadata.write(share.id, {
          id: share.id,
          secretHash: share.secretHash,
          snapshotPath,
          createdAt: share.createdAt,
          updatedAt: share.updatedAt,
          ready: true
        });
        return true;
      } catch (error) {
        await Promise.allSettled([
          snapshots.delete(snapshotPath),
          metadata.delete(share.id)
        ]);
        throw error;
      }
    },

    async read(id) {
      const stored = await metadata.read(id);
      if (!stored?.ready) return undefined;
      const document = await snapshots.read(stored.snapshotPath);
      if (!document) return undefined;
      return {
        id: stored.id,
        secretHash: stored.secretHash,
        document,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt
      };
    },

    async update(share) {
      const stored = await metadata.read(share.id);
      if (!stored?.ready) throw new Error("Share metadata is missing.");
      await snapshots.write(stored.snapshotPath, share.document, true);
      await metadata.write(share.id, {
        ...stored,
        secretHash: share.secretHash,
        updatedAt: share.updatedAt
      });
    },

    async delete(id) {
      const stored = await metadata.read(id);
      if (!stored) return;
      await snapshots.delete(stored.snapshotPath);
      await metadata.delete(id);
    }
  };
}

export function createVercelBlobSnapshotStorage(): ShareSnapshotStorage {
  return {
    async read(pathname) {
      const result = await get(pathname, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200) return undefined;
      return JSON.parse(await new Response(result.stream).text()) as SharedDocument;
    },

    async write(pathname, document, overwrite) {
      await put(pathname, JSON.stringify(document), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: overwrite,
        cacheControlMaxAge: 60,
        contentType: "application/json"
      });
    },

    async delete(pathname) {
      await del(pathname);
    }
  };
}

export function createUpstashShareMetadataStorage(
  redis = Redis.fromEnv()
): ShareMetadataStorage {
  return {
    async reserve(id, metadata) {
      return await redis.set(metadataKey(id), metadata, { nx: true }) === "OK";
    },

    async read(id) {
      return await redis.get<StoredShareMetadata>(metadataKey(id)) ?? undefined;
    },

    async write(id, metadata) {
      await redis.set(metadataKey(id), metadata);
    },

    async delete(id) {
      await redis.del(metadataKey(id));
    }
  };
}

export function createUpstashShareCreateLimiter(
  redis = Redis.fromEnv()
): ShareCreateLimiter {
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, "1 h"),
    prefix: "spechub:share:create"
  });
  return {
    async allow(identifier) {
      return (await limiter.limit(identifier)).success;
    }
  };
}

function snapshotPathFor(id: string): string {
  return `shares/${id}.json`;
}

function metadataKey(id: string): string {
  return `spechub:share:${id}`;
}
