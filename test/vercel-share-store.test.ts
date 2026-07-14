import request from "supertest";
import { createShareService } from "../src/share-service.js";
import type { StoredShare } from "../src/share-store.js";
import {
  createVercelShareStore,
  type ShareMetadataStorage,
  type ShareSnapshotStorage,
  type StoredShareMetadata
} from "../src/vercel-share-store.js";
import type { SharedDocument } from "../src/types.js";

function sharedDocument(title = "Public plan"): SharedDocument {
  return {
    schemaVersion: 1,
    title,
    kind: "markdown",
    category: "plan",
    repoName: "spechub",
    relativePath: "docs/plan.md",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    content: "# Public plan",
    publishedAt: "2026-01-01T00:01:00.000Z"
  };
}

function storedShare(document = sharedDocument()): StoredShare {
  return {
    id: "AbCdEf123_-x",
    secretHash: "hashed-management-secret",
    document,
    createdAt: "2026-01-01T00:01:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z"
  };
}

class MemorySnapshots implements ShareSnapshotStorage {
  readonly documents = new Map<string, SharedDocument>();
  failWrites = false;

  async read(pathname: string): Promise<SharedDocument | undefined> {
    return this.documents.get(pathname);
  }

  async write(pathname: string, document: SharedDocument, overwrite: boolean): Promise<void> {
    if (this.failWrites) throw new Error("Snapshot storage failed.");
    if (!overwrite && this.documents.has(pathname)) throw new Error("Snapshot already exists.");
    this.documents.set(pathname, structuredClone(document));
  }

  async delete(pathname: string): Promise<void> {
    this.documents.delete(pathname);
  }
}

class MemoryMetadata implements ShareMetadataStorage {
  readonly shares = new Map<string, StoredShareMetadata>();

  async reserve(id: string, metadata: StoredShareMetadata): Promise<boolean> {
    if (this.shares.has(id)) return false;
    this.shares.set(id, structuredClone(metadata));
    return true;
  }

  async read(id: string): Promise<StoredShareMetadata | undefined> {
    return this.shares.get(id);
  }

  async write(id: string, metadata: StoredShareMetadata): Promise<void> {
    this.shares.set(id, structuredClone(metadata));
  }

  async delete(id: string): Promise<void> {
    this.shares.delete(id);
  }
}

describe("Vercel share store", () => {
  it("keeps sanitized snapshots in Blob storage and management hashes in Upstash metadata", async () => {
    const snapshots = new MemorySnapshots();
    const metadata = new MemoryMetadata();
    const store = createVercelShareStore({ snapshots, metadata });
    const share = storedShare();

    expect(await store.create(share)).toBe(true);

    const storedMetadata = metadata.shares.get(share.id);
    const storedSnapshot = snapshots.documents.get(`shares/${share.id}.json`);
    expect(storedMetadata).toMatchObject({
      id: share.id,
      secretHash: share.secretHash,
      ready: true
    });
    expect(storedMetadata).not.toHaveProperty("document");
    expect(storedSnapshot).toEqual(share.document);
    expect(storedSnapshot).not.toHaveProperty("secretHash");
    expect(await store.read(share.id)).toEqual(share);
  });

  it("updates the existing snapshot and removes both storage records", async () => {
    const snapshots = new MemorySnapshots();
    const metadata = new MemoryMetadata();
    const store = createVercelShareStore({ snapshots, metadata });
    const share = storedShare();
    await store.create(share);

    const updated = {
      ...share,
      document: sharedDocument("Updated plan"),
      updatedAt: "2026-01-01T01:00:00.000Z"
    };
    await store.update(updated);

    expect(await store.read(share.id)).toEqual(updated);
    expect(metadata.shares.get(share.id)?.snapshotPath).toBe(`shares/${share.id}.json`);

    await store.delete(share.id);
    expect(await store.read(share.id)).toBeUndefined();
    expect(metadata.shares.size).toBe(0);
    expect(snapshots.documents.size).toBe(0);
  });

  it("cleans up reserved metadata when Blob persistence fails", async () => {
    const snapshots = new MemorySnapshots();
    snapshots.failWrites = true;
    const metadata = new MemoryMetadata();
    const store = createVercelShareStore({ snapshots, metadata });

    await expect(store.create(storedShare())).rejects.toThrow("Snapshot storage failed.");
    expect(metadata.shares.size).toBe(0);
    expect(snapshots.documents.size).toBe(0);
  });

  it("reports a collision without overwriting an existing reservation", async () => {
    const snapshots = new MemorySnapshots();
    const metadata = new MemoryMetadata();
    const store = createVercelShareStore({ snapshots, metadata });
    const share = storedShare();

    expect(await store.create(share)).toBe(true);
    expect(await store.create({ ...share, document: sharedDocument("Collision") })).toBe(false);
    expect(await store.read(share.id)).toEqual(share);
  });

  it("preserves the public create, update, read, and delete contract", async () => {
    const snapshots = new MemorySnapshots();
    const metadata = new MemoryMetadata();
    const app = createShareService({
      store: createVercelShareStore({ snapshots, metadata }),
      publicUrl: "https://share.example.com",
      createLimiter: {
        async allow() {
          return true;
        }
      }
    });

    const created = await request(app)
      .post("/api/shares")
      .send({ document: sharedDocument() })
      .expect(201);
    expect(created.body.url).toBe(`https://share.example.com/s/${created.body.id}`);

    const publicData = await request(app)
      .get(`/api/shares/${created.body.id}/data`)
      .expect(200);
    expect(publicData.body).not.toHaveProperty("secret");
    expect(publicData.body).not.toHaveProperty("secretHash");

    await request(app)
      .put(`/api/shares/${created.body.id}`)
      .send({
        secret: created.body.secret,
        document: sharedDocument("Updated through Vercel")
      })
      .expect(200);
    await request(app)
      .get(`/s/${created.body.id}`)
      .expect(200, /<meta name="robots" content="noindex,nofollow">/)
      .expect(200, /Updated through Vercel/);

    await request(app)
      .delete(`/api/shares/${created.body.id}`)
      .send({ secret: created.body.secret })
      .expect(204);
    await request(app)
      .get(`/api/shares/${created.body.id}/data`)
      .expect(404);
  });
});
