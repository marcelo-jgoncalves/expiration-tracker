import { describe, expect, it } from "vitest";
import { InMemoryDocumentStore } from "./in-memory-store.js";
import { DocumentDeletionService } from "../../../src/modules/document/application/document-deletion-service.js";
import { documentKey, type Document } from "../../../src/modules/document/domain/document.js";
import { NotFoundError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

const TABLE = "MainTable";

function ctx(): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "t1", roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
  };
}

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
    status: "CLEAN",
    quarantineObject: { bucket: "q", key: "k", versionId: "v1" },
    retentionClass: "USER_DOCUMENT",
    version: 1,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("DocumentDeletionService.deleteDocument", () => {
  it("marks a document DELETED with deletedAt and purgeAfter set", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseDocument());
    const service = new DocumentDeletionService({ store, tableName: TABLE, now: () => "2026-08-22T10:00:00.000Z" });

    await service.deleteDocument(ctx(), "item1", "doc1");

    const doc = (await store.get(documentKey("t1", "item1", "doc1"))) as Document;
    expect(doc.status).toBe("DELETED");
    expect(doc.deletedAt).toBe("2026-08-22T10:00:00.000Z");
    expect(doc.purgeAfter).toBeTruthy();
  });

  it("is idempotent - deleting an already-DELETED document is a no-op, not an error", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseDocument({ status: "DELETED", deletedAt: "2026-08-22T09:00:00.000Z" }));
    const service = new DocumentDeletionService({ store, tableName: TABLE, now: () => "2026-08-22T10:00:00.000Z" });

    await expect(service.deleteDocument(ctx(), "item1", "doc1")).resolves.toBeUndefined();
    const doc = (await store.get(documentKey("t1", "item1", "doc1"))) as Document;
    expect(doc.deletedAt).toBe("2026-08-22T09:00:00.000Z"); // unchanged, not re-stamped.
  });

  it("throws NotFoundError for a document that doesn't exist", async () => {
    const store = new InMemoryDocumentStore();
    const service = new DocumentDeletionService({ store, tableName: TABLE });
    await expect(service.deleteDocument(ctx(), "item1", "missing")).rejects.toThrow(NotFoundError);
  });
});
