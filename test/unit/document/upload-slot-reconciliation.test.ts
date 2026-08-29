import { describe, expect, it } from "vitest";
import { InMemoryDocumentStore } from "./in-memory-store.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { reconcileExpiredUploadSlots } from "../../../src/workers/upload-slot-reconciliation/reconciliation.js";
import { documentKey, type Document } from "../../../src/modules/document/domain/document.js";
import { uploadSlotKey, type UploadSlot } from "../../../src/modules/document/domain/upload-slot.js";
import type { Gsi6QueryInput, Page, UploadSlotReconciliationSource, EntityKey } from "../../../src/modules/document/ports/document-store.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

const TABLE = "MainTable";

function baseSlot(overrides: Partial<UploadSlot> = {}): UploadSlot {
  return {
    ...uploadSlotKey("t1", "slot1"),
    entityType: "UploadSlot",
    tenantId: "t1",
    uploadSlotId: "slot1",
    documentId: "doc1",
    itemId: "item1",
    status: "RESERVED",
    quarantineKey: "quarantine/doc1/slot1/abc",
    reservedAt: "2026-08-22T00:00:00.000Z",
    expiresAt: "2026-08-22T00:10:00.000Z",
    retentionClass: "TRANSIENT",
    purgeAfter: "2026-08-23T00:00:00.000Z",
    version: 1,
    updatedAt: "2026-08-22T00:00:00.000Z",
    // Real bug found via Camada 3 verification against AWS real (2026-08-25): reserveUpload
    // never actually wrote these two fields - mirrored here now that it does, so this
    // fixture matches the real production shape instead of an idealized one.
    GSI6PK: "RECON#UPLOAD#PENDING",
    GSI6SK: "2026-08-22T00:10:00.000Z#TENANT#t1#SLOT#slot1",
    ...overrides,
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
    status: "PENDING_UPLOAD",
    quarantineObject: { bucket: "quarantine-bucket", key: "quarantine/doc1/slot1/abc", versionId: "v1" },
    retentionClass: "USER_DOCUMENT",
    version: 1,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function fakeCandidateSource(slots: UploadSlot[]): UploadSlotReconciliationSource {
  return {
    async queryExpiredSlots<T extends EntityKey = Record<string, unknown> & EntityKey>(_input: Gsi6QueryInput): Promise<Page<T>> {
      return { items: slots as unknown as T[] };
    },
  };
}

describe("reconcileExpiredUploadSlots", () => {
  it("expires a RESERVED slot, releases quota, and times out the still-pending document", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseSlot());
    await store.putIfAbsent(baseDocument());

    const identityStore = new InMemoryIdentityStore();
    // W3-07 fence (D-068/D-069 follow-up): quota.consume() now requires a
    // TenantLifecycleRecord to exist for the tenant.
    await identityStore.putIfAbsent({
      ...tenantLifecycleKey("t1"),
      entityType: "TenantLifecycleRecord",
      tenantId: "t1",
      status: "ACTIVE",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      version: 1,
    });
    const quota = new TenantQuotaService(identityStore, "MainTable", () => "2026-08-22T00:15:00.000Z");
    await quota.consume({ tenantId: "t1", quotaType: "UPLOAD_COUNT", window: "current", limit: 1, windowSeconds: 60 });

    const result = await reconcileExpiredUploadSlots({
      store,
      candidates: fakeCandidateSource([baseSlot()]),
      quota,
      tableName: TABLE,
      now: () => "2026-08-22T00:15:00.000Z",
    });

    expect(result).toEqual({ slotsExpired: 1, documentsTimedOut: 0, errors: 0 });
    const slot = (await store.get(uploadSlotKey("t1", "slot1"))) as UploadSlot;
    expect(slot.status).toBe("EXPIRED");
    // Real bug found via Camada 3 (2026-08-25): the GSI6 discovery pointer must be removed
    // the moment the slot leaves RESERVED, or it stays visible to every future sweep forever.
    expect(slot.GSI6PK).toBeUndefined();
    expect(slot.GSI6SK).toBeUndefined();
    const doc = (await store.get(documentKey("t1", "item1", "doc1"))) as Document;
    expect(doc.status).toBe("TIMEOUT");

    // Quota was released - a new consume() in the same window should succeed again.
    await expect(quota.consume({ tenantId: "t1", quotaType: "UPLOAD_COUNT", window: "current", limit: 1, windowSeconds: 60 })).resolves.toBeUndefined();
  });

  it("never times out a document that already reached a terminal state (CLEAN) before the sweep ran", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseSlot());
    await store.putIfAbsent(baseDocument({ status: "CLEAN", cleanObject: { bucket: "clean", key: "k", versionId: "v" } }));
    const identityStore = new InMemoryIdentityStore();
    const quota = new TenantQuotaService(identityStore, "MainTable", () => "2026-08-22T00:15:00.000Z");

    await reconcileExpiredUploadSlots({ store, candidates: fakeCandidateSource([baseSlot()]), quota, tableName: TABLE, now: () => "2026-08-22T00:15:00.000Z" });

    const doc = (await store.get(documentKey("t1", "item1", "doc1"))) as Document;
    expect(doc.status).toBe("CLEAN"); // untouched.
  });

  it("skips a slot that isn't RESERVED anymore (already processed by a concurrent sweep)", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseSlot({ status: "EXPIRED" }));
    const identityStore = new InMemoryIdentityStore();
    const quota = new TenantQuotaService(identityStore, "MainTable", () => "2026-08-22T00:15:00.000Z");

    const result = await reconcileExpiredUploadSlots({ store, candidates: fakeCandidateSource([baseSlot({ status: "EXPIRED" })]), quota, tableName: TABLE, now: () => "2026-08-22T00:15:00.000Z" });
    expect(result.slotsExpired).toBe(1); // processOneSlot returns cleanly (no-op) and still counts as "handled".
  });

  it("continues sweeping remaining slots when one slot's processing throws, and counts it as an error", async () => {
    const store = new InMemoryDocumentStore();
    await store.putIfAbsent(baseSlot({ uploadSlotId: "slot-bad", documentId: "doc-bad" })); // no matching Document -> get() returns undefined, handled gracefully, not an error actually.
    await store.putIfAbsent(baseSlot({ uploadSlotId: "slot-good", documentId: "doc-good", version: 999 })); // wrong version -> ConditionalCheckFailed is swallowed, not an error either.
    const identityStore = new InMemoryIdentityStore();
    const quota = new TenantQuotaService(identityStore, "MainTable", () => "2026-08-22T00:15:00.000Z");

    const result = await reconcileExpiredUploadSlots({
      store,
      candidates: fakeCandidateSource([baseSlot({ uploadSlotId: "slot-bad", documentId: "doc-bad" }), baseSlot({ uploadSlotId: "slot-good", documentId: "doc-good" })]),
      quota,
      tableName: TABLE,
      now: () => "2026-08-22T00:15:00.000Z",
    });
    expect(result.slotsExpired).toBe(2);
    expect(result.errors).toBe(0);
  });
});
