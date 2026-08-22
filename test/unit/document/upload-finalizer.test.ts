import { describe, expect, it } from "vitest";
import { InMemoryDocumentStore } from "./in-memory-store.js";
import { finalizeUpload } from "../../../src/workers/upload-finalizer/finalizer.js";
import { documentKey, type Document } from "../../../src/modules/document/domain/document.js";
import type { DocumentObjectStore } from "../../../src/modules/document/ports/document-object-store.js";
import type { PdfParser } from "../../../src/modules/document/ports/pdf-parser.js";

const TABLE = "MainTable";
const CLEAN_BUCKET = "clean-bucket";
const OBJECT = { bucket: "quarantine-bucket", key: "quarantine/doc1/slot1/abc", versionId: "v1" };

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
    quarantineObject: OBJECT,
    retentionClass: "USER_DOCUMENT",
    version: 1,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function fakeParser(outcome: "VALID" | "INVALID_STRUCTURE" = "VALID"): PdfParser {
  return { parse: async () => ({ outcome, pageCount: 1 }) };
}

function fakeObjects(overrides: Partial<DocumentObjectStore> = {}): DocumentObjectStore {
  return {
    headObject: async () => ({ contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64) }),
    copyObject: async (_s, destBucket, destKey) => ({ bucket: destBucket, key: destKey, versionId: "clean-v1" }),
    deleteObjectVersion: async () => undefined,
    ...overrides,
  };
}

describe("finalizeUpload", () => {
  it("confirms slot, transitions to SCANNING then stays there awaiting malware result, on a valid matching object", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseDocument());
    const outcome = await finalizeUpload(
      { store, objects: fakeObjects(), parser: fakeParser(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, now: () => "2026-08-22T00:05:00.000Z" },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", object: OBJECT },
    );
    expect(outcome).toBe("CONFIRMED");
    const doc = (await store.get(documentKey("t1", "item1", "doc1"))) as Document;
    expect(doc.status).toBe("SCANNING");
    expect(doc.uploadEvidence?.valid).toBe(true);
  });

  it("rejects when the observed size doesn't match what was declared at reservation", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseDocument());
    const badObjects = fakeObjects({ headObject: async () => ({ contentLength: 999, mediaType: "application/pdf", checksumSha256: "a".repeat(64) }) });
    const outcome = await finalizeUpload(
      { store, objects: badObjects, parser: fakeParser(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", object: OBJECT },
    );
    expect(outcome).toBe("REJECTED_INVALID");
    const doc = (await store.get(documentKey("t1", "item1", "doc1"))) as Document;
    expect(doc.status).toBe("REJECTED");
    expect(doc.uploadEvidence?.valid).toBe(false);
  });

  it("rejects when the PDF sandbox parser reports invalid structure, even though size/checksum matched", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseDocument());
    const outcome = await finalizeUpload(
      { store, objects: fakeObjects(), parser: fakeParser("INVALID_STRUCTURE"), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", object: OBJECT },
    );
    expect(outcome).toBe("REJECTED_INVALID");
  });

  it("ignores an event for an object that doesn't match the reserved quarantine key (fail-closed)", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseDocument());
    const outcome = await finalizeUpload(
      { store, objects: fakeObjects(), parser: fakeParser(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", object: { ...OBJECT, key: "quarantine/wrong-key" } },
    );
    expect(outcome).toBe("IGNORED_UNKNOWN_SLOT");
  });

  it("ignores an event for a document that doesn't exist at all", async () => {
    const store = new InMemoryDocumentStore();
    const outcome = await finalizeUpload(
      { store, objects: fakeObjects(), parser: fakeParser(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "missing", object: OBJECT },
    );
    expect(outcome).toBe("IGNORED_UNKNOWN_SLOT");
  });

  it("ignores a redelivered event for a document already past SCANNING (terminal)", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseDocument({ status: "CLEAN" }));
    const outcome = await finalizeUpload(
      { store, objects: fakeObjects(), parser: fakeParser(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", object: OBJECT },
    );
    expect(outcome).toBe("IGNORED_STALE");
  });

  it("returns REJECTED_INVALID when HeadObject can't find the object at all", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseDocument());
    const outcome = await finalizeUpload(
      { store, objects: fakeObjects({ headObject: async () => undefined }), parser: fakeParser(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", object: OBJECT },
    );
    expect(outcome).toBe("REJECTED_INVALID");
  });
});
