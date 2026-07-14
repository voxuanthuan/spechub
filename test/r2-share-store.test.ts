import type { SharedDocument } from "../src/types.js";
import {
  createR2SnapshotStorage,
  type R2ObjectStorage
} from "../src/r2-share-store.js";
import {
  createShareSnapshotStorage,
  type SnapshotStorageFactories
} from "../src/vercel-share-service.js";
import type { ShareSnapshotStorage } from "../src/vercel-share-store.js";

function sharedDocument(title = "R2 plan"): SharedDocument {
  return {
    schemaVersion: 1,
    title,
    kind: "markdown",
    category: "plan",
    repoName: "spechub",
    relativePath: "docs/r2-plan.md",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    content: "# R2 plan",
    publishedAt: "2026-01-01T00:01:00.000Z"
  };
}

class MemoryR2Objects implements R2ObjectStorage {
  readonly objects = new Map<string, string>();

  async read(bucket: string, key: string): Promise<string | undefined> {
    return this.objects.get(`${bucket}/${key}`);
  }

  async write(
    bucket: string,
    key: string,
    body: string,
    overwrite: boolean
  ): Promise<void> {
    const objectKey = `${bucket}/${key}`;
    if (!overwrite && this.objects.has(objectKey)) {
      throw new Error("R2 object already exists.");
    }
    this.objects.set(objectKey, body);
  }

  async delete(bucket: string, key: string): Promise<void> {
    this.objects.delete(`${bucket}/${key}`);
  }
}

function emptySnapshotStorage(): ShareSnapshotStorage {
  return {
    async read() {
      return undefined;
    },
    async write() {},
    async delete() {}
  };
}

describe("Cloudflare R2 snapshot storage", () => {
  it("stores, reads, updates, and deletes private snapshot JSON by path", async () => {
    const objects = new MemoryR2Objects();
    const storage = createR2SnapshotStorage({
      bucket: "spechub-share",
      objects
    });
    const pathname = "shares/AbCdEf123_-x.json";

    await storage.write(pathname, sharedDocument(), false);
    expect(await storage.read(pathname)).toEqual(sharedDocument());

    await expect(
      storage.write(pathname, sharedDocument("Collision"), false)
    ).rejects.toThrow("R2 object already exists.");

    await storage.write(pathname, sharedDocument("Updated plan"), true);
    expect(await storage.read(pathname)).toEqual(sharedDocument("Updated plan"));

    await storage.delete(pathname);
    expect(await storage.read(pathname)).toBeUndefined();
  });

  it("selects R2 with complete credentials and preserves Blob as the default", () => {
    const blobStorage = emptySnapshotStorage();
    const r2Storage = emptySnapshotStorage();
    const factories: SnapshotStorageFactories = {
      createVercelBlob: vi.fn(() => blobStorage),
      createCloudflareR2: vi.fn(() => r2Storage)
    };

    expect(createShareSnapshotStorage({}, factories)).toBe(blobStorage);
    expect(createShareSnapshotStorage({
      SPECHUB_SHARE_STORAGE: "cloudflare-r2",
      CLOUDFLARE_R2_ACCOUNT_ID: "account-id",
      CLOUDFLARE_R2_ACCESS_KEY_ID: "access-key-id",
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret-access-key",
      CLOUDFLARE_R2_BUCKET: "spechub-share"
    }, factories)).toBe(r2Storage);
    expect(factories.createCloudflareR2).toHaveBeenCalledWith({
      accountId: "account-id",
      accessKeyId: "access-key-id",
      secretAccessKey: "secret-access-key",
      bucket: "spechub-share"
    });
  });

  it("rejects incomplete or unsupported snapshot storage configuration", () => {
    const factories: SnapshotStorageFactories = {
      createVercelBlob: emptySnapshotStorage,
      createCloudflareR2: emptySnapshotStorage
    };

    expect(() => createShareSnapshotStorage({
      SPECHUB_SHARE_STORAGE: "cloudflare-r2"
    }, factories)).toThrow(
      "CLOUDFLARE_R2_ACCOUNT_ID must be configured for Cloudflare R2."
    );
    expect(() => createShareSnapshotStorage({
      SPECHUB_SHARE_STORAGE: "unsupported"
    }, factories)).toThrow(
      "SPECHUB_SHARE_STORAGE must be either \"vercel-blob\" or \"cloudflare-r2\"."
    );
  });
});
