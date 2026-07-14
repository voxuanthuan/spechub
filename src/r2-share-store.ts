import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import type { SharedDocument } from "./types.js";
import type { ShareSnapshotStorage } from "./vercel-share-store.js";

export interface CloudflareR2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface R2ObjectStorage {
  read(bucket: string, key: string): Promise<string | undefined>;
  write(bucket: string, key: string, body: string, overwrite: boolean): Promise<void>;
  delete(bucket: string, key: string): Promise<void>;
}

export function createR2SnapshotStorage(options: {
  bucket: string;
  objects: R2ObjectStorage;
}): ShareSnapshotStorage {
  return {
    async read(pathname) {
      const stored = await options.objects.read(options.bucket, pathname);
      if (stored === undefined) return undefined;
      return JSON.parse(stored) as SharedDocument;
    },
    async write(pathname, document, overwrite) {
      await options.objects.write(
        options.bucket,
        pathname,
        JSON.stringify(document),
        overwrite
      );
    },
    async delete(pathname) {
      await options.objects.delete(options.bucket, pathname);
    }
  };
}

export function createCloudflareR2ObjectStorage(
  config: CloudflareR2Config
): R2ObjectStorage {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  return {
    async read(bucket, key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!response.Body) return undefined;
        return await response.Body.transformToString();
      } catch (error) {
        if (isMissingObject(error)) return undefined;
        throw error;
      }
    },
    async write(bucket, key, body, overwrite) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: "application/json",
          IfNoneMatch: overwrite ? undefined : "*"
        })
      );
    },
    async delete(bucket, key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
  };
}

function isMissingObject(error: unknown): boolean {
  if (error instanceof NoSuchKey) return true;
  return (
    error instanceof Error &&
    (error.name === "NoSuchKey" || error.name === "NotFound")
  );
}
