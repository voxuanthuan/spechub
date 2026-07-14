import { Redis } from "@upstash/redis";
import {
  createCloudflareR2ObjectStorage,
  createR2SnapshotStorage,
  type CloudflareR2Config
} from "./r2-share-store.js";
import { createShareService } from "./share-service.js";
import {
  createUpstashShareCreateLimiter,
  createUpstashShareMetadataStorage,
  createVercelBlobSnapshotStorage,
  createVercelShareStore,
  type ShareSnapshotStorage
} from "./vercel-share-store.js";

export interface SnapshotStorageFactories {
  createVercelBlob(): ShareSnapshotStorage;
  createCloudflareR2(config: CloudflareR2Config & { bucket: string }): ShareSnapshotStorage;
}

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

const defaultSnapshotStorageFactories: SnapshotStorageFactories = {
  createVercelBlob: createVercelBlobSnapshotStorage,
  createCloudflareR2(config) {
    return createR2SnapshotStorage({
      bucket: config.bucket,
      objects: createCloudflareR2ObjectStorage(config)
    });
  }
};

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
      snapshots: createShareSnapshotStorage(),
      metadata: createUpstashShareMetadataStorage(redis)
    }),
    createLimiter: createUpstashShareCreateLimiter(redis),
    trustProxy: 1
  });
}

export function createShareSnapshotStorage(
  environment: EnvironmentValues = process.env,
  factories: SnapshotStorageFactories = defaultSnapshotStorageFactories
): ShareSnapshotStorage {
  const backend = environment.SPECHUB_SHARE_STORAGE ?? "vercel-blob";
  if (backend === "vercel-blob") return factories.createVercelBlob();
  if (backend !== "cloudflare-r2") {
    throw new Error(
      "SPECHUB_SHARE_STORAGE must be either \"vercel-blob\" or \"cloudflare-r2\"."
    );
  }

  const accountId = requiredEnvironmentValue(environment, "CLOUDFLARE_R2_ACCOUNT_ID");
  const accessKeyId = requiredEnvironmentValue(
    environment,
    "CLOUDFLARE_R2_ACCESS_KEY_ID"
  );
  const secretAccessKey = requiredEnvironmentValue(
    environment,
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY"
  );
  const bucket = requiredEnvironmentValue(environment, "CLOUDFLARE_R2_BUCKET");

  return factories.createCloudflareR2({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket
  });
}

function requiredEnvironmentValue(
  environment: EnvironmentValues,
  name: string
): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} must be configured for Cloudflare R2.`);
  return value;
}
