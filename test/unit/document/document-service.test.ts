import { describe, expect, it } from "vitest";
import { InMemoryDocumentStore } from "./in-memory-store.js";
import { DocumentService } from "../../../src/modules/document/application/document-service.js";
import type { UploadUrlSigner } from "../../../src/modules/document/ports/upload-url-signer.js";
import type { DocumentIdGenerator } from "../../../src/modules/document/application/id-generator.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

const TABLE = "MainTable";
const BUCKET = "quarantine-bucket";
const VALID_SHA256 = "a".repeat(64);

function ctx(): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "t1", roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
  };
}

function fakeSigner(): UploadUrlSigner {
  let calls = 0;
  return {
    async presignUpload(input) {
      calls += 1;
      return { uploadUrl: `https://s3.example/${input.bucket}/${input.key}?call=${calls}`, requiredHeaders: { "x-amz-checksum-sha256": input.checksumSha256 } };
    },
  };
}

let counter = 0;
function fakeIds(): DocumentIdGenerator {
  return {
    newDocumentId: () => `doc-${++counter}`,
    newUploadSlotId: () => `slot-${++counter}`,
  };
}

function buildService() {
  const store = new InMemoryDocumentStore();
  const service = new DocumentService({ store, tableName: TABLE, quarantineBucket: BUCKET, ids: fakeIds(), signer: fakeSigner(), now: () => "2026-08-22T00:00:00.000Z" });
  return { store, service };
}

describe("DocumentService.reserveUpload", () => {
  it("creates a Document(PENDING_UPLOAD) and UploadSlot(RESERVED) atomically and returns a presigned URL", async () => {
    const { store, service } = buildService();
    const result = await service.reserveUpload(ctx(), "item1", { fileName: "contract.pdf", mediaType: "application/pdf", contentLength: 1000, checksumSha256: VALID_SHA256 }, "idem-1");

    expect(result.documentId).toBeTruthy();
    expect(result.uploadSlotId).toBeTruthy();
    expect(result.uploadUrl).toContain(BUCKET);

    const items = store.allItems();
    const doc = items.find((i) => i["entityType"] === "Document");
    const slot = items.find((i) => i["entityType"] === "UploadSlot");
    expect(doc?.["status"]).toBe("PENDING_UPLOAD");
    expect(slot?.["status"]).toBe("RESERVED");
    expect(doc?.["quarantineObject"]).toBeDefined();
  });

  it("never embeds the original file name in the quarantine object key (tenantId/itemId/documentId ARE embedded deliberately - see quarantine-key.ts)", async () => {
    const { store, service } = buildService();
    const result = await service.reserveUpload(ctx(), "item1", { fileName: "sensitive-name-joão.pdf", mediaType: "application/pdf", contentLength: 1000, checksumSha256: VALID_SHA256 }, "idem-2");
    const doc = store.allItems().find((i) => i["entityType"] === "Document") as { quarantineObject: { key: string } } | undefined;
    expect(doc?.quarantineObject.key).not.toContain("joão");
    expect(doc?.quarantineObject.key).not.toContain("sensitive-name");
    // tenantId/itemId/documentId are deliberately embedded - the S3 event that later reaches
    // UploadFinalizerWorker/MalwareResultWorker carries no application context beyond
    // bucket/key/versionId, so the key itself is what lets those workers resolve the document.
    expect(doc?.quarantineObject.key).toContain("t1");
    expect(doc?.quarantineObject.key).toContain("item1");
    expect(doc?.quarantineObject.key).toContain(result.documentId);
  });

  it("rejects unsupported media types", async () => {
    const { service } = buildService();
    await expect(
      service.reserveUpload(ctx(), "item1", { fileName: "x.exe", mediaType: "application/x-msdownload", contentLength: 100, checksumSha256: VALID_SHA256 }, "idem-3"),
    ).rejects.toThrow(/media type/i);
  });

  it("rejects contentLength over the 10MiB limit", async () => {
    const { service } = buildService();
    await expect(
      service.reserveUpload(ctx(), "item1", { fileName: "big.pdf", mediaType: "application/pdf", contentLength: 11 * 1024 * 1024, checksumSha256: VALID_SHA256 }, "idem-4"),
    ).rejects.toThrow(/10MiB/);
  });

  it("rejects a malformed checksum", async () => {
    const { service } = buildService();
    await expect(
      service.reserveUpload(ctx(), "item1", { fileName: "x.pdf", mediaType: "application/pdf", contentLength: 100, checksumSha256: "not-a-checksum" }, "idem-5"),
    ).rejects.toThrow(/checksumSha256/);
  });

  it("retrying the exact same idempotency key returns the SAME documentId/uploadSlotId, never new ones", async () => {
    const { service } = buildService();
    const first = await service.reserveUpload(ctx(), "item1", { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 100, checksumSha256: VALID_SHA256 }, "idem-6");
    const second = await service.reserveUpload(ctx(), "item1", { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 100, checksumSha256: VALID_SHA256 }, "idem-6");
    expect(second.documentId).toBe(first.documentId);
    expect(second.uploadSlotId).toBe(first.uploadSlotId);
  });

  it("retry still issues a fresh presigned URL (URLs are short-lived, not stored/replayed verbatim)", async () => {
    const { service } = buildService();
    const first = await service.reserveUpload(ctx(), "item1", { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 100, checksumSha256: VALID_SHA256 }, "idem-7");
    const second = await service.reserveUpload(ctx(), "item1", { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 100, checksumSha256: VALID_SHA256 }, "idem-7");
    expect(second.uploadUrl).not.toBe(first.uploadUrl);
  });
});

describe("DocumentService.getDocument/listDocuments (BLOCKER-A)", () => {
  it("getDocument returns the document reserved via reserveUpload", async () => {
    const { service } = buildService();
    const reserved = await service.reserveUpload(ctx(), "item1", { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 100, checksumSha256: VALID_SHA256 }, "idem-get-1");
    const document = await service.getDocument(ctx(), "item1", reserved.documentId);
    expect(document.documentId).toBe(reserved.documentId);
    expect(document.status).toBe("PENDING_UPLOAD");
  });

  it("getDocument throws NotFoundError for a document that never existed", async () => {
    const { service } = buildService();
    await expect(service.getDocument(ctx(), "item1", "no-such-doc")).rejects.toThrow(/not found/i);
  });

  it("getDocument throws NotFoundError for a DELETED document (soft-deleted rows never surface, same convention as ExpirationService.readActiveItem)", async () => {
    const { store, service } = buildService();
    const reserved = await service.reserveUpload(ctx(), "item1", { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 100, checksumSha256: VALID_SHA256 }, "idem-get-2");
    const doc = store.allItems().find((i) => i["entityType"] === "Document") as Record<string, unknown> & { PK: string; SK: string };
    await store.update({ ...doc, status: "DELETED" });
    await expect(service.getDocument(ctx(), "item1", reserved.documentId)).rejects.toThrow(/not found/i);
  });

  it("listDocuments returns every non-deleted document under the item, excludes DELETED", async () => {
    const { store, service } = buildService();
    const first = await service.reserveUpload(ctx(), "item1", { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 100, checksumSha256: VALID_SHA256 }, "idem-list-1");
    const second = await service.reserveUpload(ctx(), "item1", { fileName: "b.pdf", mediaType: "application/pdf", contentLength: 100, checksumSha256: VALID_SHA256 }, "idem-list-2");
    const secondDoc = store.allItems().find((i) => i["entityType"] === "Document" && i["documentId"] === second.documentId) as Record<string, unknown> & { PK: string; SK: string };
    await store.update({ ...secondDoc, status: "DELETED" });

    const documents = await service.listDocuments(ctx(), "item1");
    expect(documents.map((d) => d.documentId)).toEqual([first.documentId]);
  });

  it("listDocuments never returns another item's documents (partition isolation)", async () => {
    const { service } = buildService();
    await service.reserveUpload(ctx(), "item1", { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 100, checksumSha256: VALID_SHA256 }, "idem-list-3");
    const documents = await service.listDocuments(ctx(), "item2");
    expect(documents).toEqual([]);
  });
});
