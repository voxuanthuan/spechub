import { Redis } from "@upstash/redis";
import { createShareService } from "./share-service.js";
import {
  createUpstashShareCreateLimiter,
  createUpstashShareMetadataStorage,
  createVercelBlobSnapshotStorage,
  createVercelShareStore
} from "./vercel-share-store.js";

export function createVercelShareService() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured."
    );
  }
  const redis = new Redis({ url: redisUrl, token: redisToken });
  return createShareService({
    store: createVercelShareStore({
      snapshots: createVercelBlobSnapshotStorage(),
      metadata: createUpstashShareMetadataStorage(redis)
    }),
    createLimiter: createUpstashShareCreateLimiter(redis),
    trustProxy: 1
  });
}
