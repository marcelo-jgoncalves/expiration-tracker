import { describe, expect, it } from "vitest";
import { InMemoryDocumentStore } from "./in-memory-store.js";
import { advanceAfterEvidence } from "../../../src/modules/document/application/advance-after-evidence.js";
import { documentKey, type Document } from "../../../src/modules/document/domain/document.js";
import type { DocumentObjectStore } from "../../../src/modules/document/ports/document-object-store.js";

const TABLE = "MainTable";
const CLEAN_BUCKET = "clean-bucket";
const QUARANTINE_OBJECT = { bucket: "quarantine-bucket", key: "quarantine/doc1/slot1/abc", versionId: "v1" };

function baseDocument(overrides: Partial<Document> = {}): Document {
  return {
    ...documentKey("t1", "item1", "doc1"),
    entityType: "Document",
    tenantId: "t1",
    itemId: "item1",
    documentId: "doc1",
    uploadSlotId: "slot1",
    fileName: "a.pdf",
    mediaType: "application/pdf",
    contentLength: 100,
    checksumSha256: "a".repeat(64),
    status: "PENDING_UPLOAD",
    quarantineObject: QUARANTINE_OBJECT,
    retentionClass: "USER_DOCUMENT",
    version: 1,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function fakeObjectStore(overrides: Partial<DocumentObjectStore> = {}): DocumentObjectStore {
  return {
    headObject: async () => ({ contentLength: 100, mediaType: "application/pdf" }),
    copyObject: async (_source, destBucket, destKey) => ({ bucket: destBucket, key: destKey, versionId: "clean-v1" }),
    deleteObjectVersion: async () => undefined,
    ...overrides,
  };
}

describe("advanceAfterEvidence — corrida real entre upload e malware", () => {
  it("stays AWAITING when only upload evidence exists (upload arrived first)", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(
      baseDocument({ status: "SCANNING", uploadEvidence: { object: QUARANTINE_OBJECT, contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: true, observedAt: "2026-08-22T00:01:00.000Z" } }),
    );
    const outcome = await advanceAfterEvidence(
      { store, objects: fakeObjectStore(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", expectedObject: QUARANTINE_OBJECT },
    );
    expect(outcome).toBe("AWAITING");
  });

  it("stays AWAITING when only malware-clean evidence exists (malware arrived first, before upload confirmation)", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(
      baseDocument({ status: "PENDING_UPLOAD", malwareEvidence: { object: QUARANTINE_OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-08-22T00:01:00.000Z" } }),
    );
    const outcome = await advanceAfterEvidence(
      { store, objects: fakeObjectStore(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", expectedObject: QUARANTINE_OBJECT },
    );
    expect(outcome).toBe("AWAITING");
  });

  it("promotes to CLEAN once BOTH evidences are present (upload-then-malware order)", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(
      baseDocument({
        status: "SCANNING",
        uploadEvidence: { object: QUARANTINE_OBJECT, contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: true, observedAt: "2026-08-22T00:01:00.000Z" },
        malwareEvidence: { object: QUARANTINE_OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-08-22T00:02:00.000Z" },
      }),
    );
    const outcome = await advanceAfterEvidence(
      { store, objects: fakeObjectStore(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", expectedObject: QUARANTINE_OBJECT },
    );
    expect(outcome).toBe("PROMOTED");
    const doc = (await store.get(documentKey("t1", "item1", "doc1"))) as Document;
    expect(doc.status).toBe("CLEAN");
    expect(doc.cleanObject?.bucket).toBe(CLEAN_BUCKET);
  });

  it("real bug found via Camada 3 (2026-08-22): promotion copies from the evidence's real object reference, never doc.quarantineObject (whose versionId is always \"\" - reserveUpload sets it before the real object exists, and copying with an empty versionId crashes S3 with 'Version id cannot be the empty string')", async () => {
    const store = new InMemoryDocumentStore();
    const emptyVersionPlaceholder = { bucket: QUARANTINE_OBJECT.bucket, key: QUARANTINE_OBJECT.key, versionId: "" };
    const realObject = { ...QUARANTINE_OBJECT, versionId: "real-s3-version-id" };
    await store.putIfAbsent(
      baseDocument({
        status: "SCANNING",
        quarantineObject: emptyVersionPlaceholder,
        uploadEvidence: { object: realObject, contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: true, observedAt: "2026-08-22T00:01:00.000Z" },
        malwareEvidence: { object: realObject, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-08-22T00:02:00.000Z" },
      }),
    );
    let copiedFrom: { bucket: string; key: string; versionId: string } | undefined;
    const outcome = await advanceAfterEvidence(
      { store, objects: fakeObjectStore({ copyObject: async (source, destBucket, destKey) => { copiedFrom = source; return { bucket: destBucket, key: destKey, versionId: "clean-v1" }; } }), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", expectedObject: realObject },
    );
    expect(outcome).toBe("PROMOTED");
    expect(copiedFrom?.versionId).toBe("real-s3-version-id");
  });

  it("promotes to CLEAN once both evidences are present (malware-then-upload order) - both orders converge", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(
      baseDocument({
        status: "SCANNING",
        malwareEvidence: { object: QUARANTINE_OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-08-22T00:01:00.000Z" },
        uploadEvidence: { object: QUARANTINE_OBJECT, contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: true, observedAt: "2026-08-22T00:02:00.000Z" },
      }),
    );
    const outcome = await advanceAfterEvidence(
      { store, objects: fakeObjectStore(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", expectedObject: QUARANTINE_OBJECT },
    );
    expect(outcome).toBe("PROMOTED");
  });

  it("rejects immediately on THREATS_FOUND even without upload evidence yet", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseDocument({ status: "PENDING_UPLOAD", malwareEvidence: { object: QUARANTINE_OBJECT, status: "THREATS_FOUND", scanResultId: "s1", observedAt: "2026-08-22T00:01:00.000Z" } }));
    const outcome = await advanceAfterEvidence(
      { store, objects: fakeObjectStore(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", expectedObject: QUARANTINE_OBJECT },
    );
    expect(outcome).toBe("REJECTED");
    const doc = (await store.get(documentKey("t1", "item1", "doc1"))) as Document;
    expect(doc.status).toBe("REJECTED");
    expect(doc.cleanObject).toBeUndefined();
  });

  it("rejects when upload evidence exists but is marked invalid, even if malware comes back clean (real bug found during implementation: presence of evidence was wrongly treated as validity)", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(
      baseDocument({
        status: "SCANNING",
        uploadEvidence: { object: QUARANTINE_OBJECT, contentLength: 999, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: false, observedAt: "2026-08-22T00:01:00.000Z" },
        malwareEvidence: { object: QUARANTINE_OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-08-22T00:02:00.000Z" },
      }),
    );
    const outcome = await advanceAfterEvidence(
      { store, objects: fakeObjectStore(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", expectedObject: QUARANTINE_OBJECT },
    );
    expect(outcome).toBe("REJECTED");
    const doc = (await store.get(documentKey("t1", "item1", "doc1"))) as Document;
    expect(doc.status).toBe("REJECTED");
    expect(doc.cleanObject).toBeUndefined();
  });

  it("never promotes when copy verification fails (size mismatch on the clean object)", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(
      baseDocument({
        status: "SCANNING",
        uploadEvidence: { object: QUARANTINE_OBJECT, contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: true, observedAt: "2026-08-22T00:01:00.000Z" },
        malwareEvidence: { object: QUARANTINE_OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-08-22T00:02:00.000Z" },
      }),
    );
    const brokenObjects = fakeObjectStore({ headObject: async () => ({ contentLength: 50, mediaType: "application/pdf" }) });
    await expect(
      advanceAfterEvidence({ store, objects: brokenObjects, tableName: TABLE, cleanBucket: CLEAN_BUCKET }, { tenantId: "t1", itemId: "item1", documentId: "doc1", expectedObject: QUARANTINE_OBJECT }),
    ).rejects.toThrow(/verification failed/);
    const doc = (await store.get(documentKey("t1", "item1", "doc1"))) as Document;
    expect(doc.status).toBe("SCANNING"); // never advanced to CLEAN on unverified copy.
  });

  it("ignores late/duplicate evidence once the document is already terminal (CLEAN)", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseDocument({ status: "CLEAN", cleanObject: { bucket: CLEAN_BUCKET, key: "clean/t1/doc1", versionId: "v1" } }));
    const outcome = await advanceAfterEvidence(
      { store, objects: fakeObjectStore(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", expectedObject: QUARANTINE_OBJECT },
    );
    expect(outcome).toBe("IGNORED_STALE");
  });

  it("never fails promotion when quarantine cleanup delete fails - CLEAN is confirmed regardless (best-effort cleanup)", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(
      baseDocument({
        status: "SCANNING",
        uploadEvidence: { object: QUARANTINE_OBJECT, contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: true, observedAt: "2026-08-22T00:01:00.000Z" },
        malwareEvidence: { object: QUARANTINE_OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-08-22T00:02:00.000Z" },
      }),
    );
    const flakyObjects = fakeObjectStore({
      deleteObjectVersion: async () => {
        throw new Error("simulated delete failure");
      },
    });
    const outcome = await advanceAfterEvidence({ store, objects: flakyObjects, tableName: TABLE, cleanBucket: CLEAN_BUCKET }, { tenantId: "t1", itemId: "item1", documentId: "doc1", expectedObject: QUARANTINE_OBJECT });
    expect(outcome).toBe("PROMOTED");
  });
});
