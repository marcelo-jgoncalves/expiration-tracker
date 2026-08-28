import { describe, expect, it } from "vitest";
import { buildVersionedUpdate, isTransactionCanceled } from "../../../src/shared/dynamodb/occ.js";
import { GSI6PK_PURGE_CLAIMED, GSI6PK_PURGE_PENDING, buildDocumentPurgeGsi6Sk } from "../../../src/modules/document/ports/document-store.js";
import { runPurgeCycle, type DocumentPurgeCandidate, type ReceiptPurgeCandidate } from "../../../src/workers/document-purge/purge.js";
import { FakeDocumentObjectStore, FakeDocumentPurgeStore } from "./document-purge-fakes.js";

const TABLE = "MainTable";
const NOW = "2026-09-27T00:00:00.000Z"; // 30+ days after any purgeAfter used below

function baseDocumentCandidate(overrides: Partial<DocumentPurgeCandidate> = {}): DocumentPurgeCandidate {
  const purgeAfter = "2026-09-01T00:00:00.000Z";
  return {
    entityType: "Document",
    PK: "TENANT#t1#ITEM#item1",
    SK: "DOC#doc1",
    tenantId: "t1",
    documentId: "doc1",
    itemId: "item1",
    version: 3,
    status: "DELETED",
    GSI6PK: GSI6PK_PURGE_PENDING,
    GSI6SK: buildDocumentPurgeGsi6Sk(purgeAfter, "t1", "doc1"),
    purgeAfter,
    deletedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

function seedFullDocumentRow(store: FakeDocumentPurgeStore, candidate: DocumentPurgeCandidate, extra: Record<string, unknown> = {}): void {
  store.seed({
    PK: candidate.PK,
    SK: candidate.SK,
    entityType: "Document",
    tenantId: candidate.tenantId,
    documentId: candidate.documentId,
    itemId: candidate.itemId,
    version: candidate.version,
    status: candidate.status,
    GSI6PK: candidate.GSI6PK,
    GSI6SK: candidate.GSI6SK,
    purgeAfter: candidate.purgeAfter,
    deletedAt: candidate.deletedAt,
    legalHold: candidate.legalHold,
    purgeAttempts: candidate.purgeAttempts,
    ...extra,
  });
}

function deps(store: FakeDocumentPurgeStore, objects: FakeDocumentObjectStore) {
  return { store, objects, tableName: TABLE, now: () => NOW, correlationId: () => "corr-1" };
}

describe("runPurgeCycle - Document candidates", () => {
  it("purges a CLEAN document: deletes cleanObject (never quarantineObject), removes the row, writes a receipt", async () => {
    const cleanObject = { bucket: "clean", key: "clean/t1/item1/doc1", versionId: "clean-v1" };
    const candidate = baseDocumentCandidate({ cleanObject });
    const store = new FakeDocumentPurgeStore();
    seedFullDocumentRow(store, candidate, { cleanObject });
    const objects = new FakeDocumentObjectStore();

    const result = await runPurgeCycle(deps(store, objects), { pendingCandidates: [candidate], claimedCandidates: [] });

    expect(result.documentsPurged).toBe(1);
    expect(objects.deletedVersions).toEqual([cleanObject]);
    expect(store.allItems().find((i) => i.SK === "DOC#doc1")).toBeUndefined();
    const receipt = store.allItems().find((i) => i.entityType === "DocumentPurgeReceipt");
    expect(receipt).toBeDefined();
    expect(receipt?.retentionClass).toBe("DELIVERY_RECORD");
    expect(receipt?.documentId).toBe("doc1");
    expect(receipt?.correlationId).toBe("corr-1");
  });

  it("purges a REJECTED document via uploadEvidence.object, never doc.quarantineObject (versionId always \"\")", async () => {
    const candidate = baseDocumentCandidate({ status: "DELETED" });
    const store = new FakeDocumentPurgeStore();
    const evidenceObject = { bucket: "quarantine", key: "tenant/t1/item/item1/document/doc1/x", versionId: "real-v1" };
    seedFullDocumentRow(store, candidate, {
      quarantineObject: { bucket: "quarantine", key: "tenant/t1/item/item1/document/doc1/x", versionId: "" },
      uploadEvidence: { object: evidenceObject },
    });
    const objects = new FakeDocumentObjectStore();

    const candidateWithEvidence: DocumentPurgeCandidate = { ...candidate, uploadEvidence: { object: evidenceObject } };
    const result = await runPurgeCycle(deps(store, objects), { pendingCandidates: [candidateWithEvidence], claimedCandidates: [] });

    expect(result.documentsPurged).toBe(1);
    expect(objects.deletedVersions).toEqual([evidenceObject]);
  });

  it("purges a document with no evidence at all without any S3 call", async () => {
    const candidate = baseDocumentCandidate();
    const store = new FakeDocumentPurgeStore();
    seedFullDocumentRow(store, candidate);
    const objects = new FakeDocumentObjectStore();

    const result = await runPurgeCycle(deps(store, objects), { pendingCandidates: [candidate], claimedCandidates: [] });

    expect(result.documentsPurged).toBe(1);
    expect(objects.deletedVersions).toEqual([]);
  });

  it("skips the claim (never touches S3) when legalHold is true", async () => {
    const candidate = baseDocumentCandidate({ legalHold: true });
    const store = new FakeDocumentPurgeStore();
    seedFullDocumentRow(store, candidate, { legalHold: true, cleanObject: { bucket: "clean", key: "k", versionId: "v" } });
    const objects = new FakeDocumentObjectStore();

    const result = await runPurgeCycle(deps(store, objects), { pendingCandidates: [candidate], claimedCandidates: [] });

    expect(result.documentsPurged).toBe(0);
    expect(result.claimsSkipped).toBe(1);
    expect(objects.deletedVersions).toEqual([]);
    expect(store.allItems().find((i) => i.SK === "DOC#doc1")).toBeDefined();
  });

  it("skips the claim when the GSI6 pointer read no longer matches the live row (concurrent reconciliation already moved it)", async () => {
    const candidate = baseDocumentCandidate();
    const store = new FakeDocumentPurgeStore();
    seedFullDocumentRow(store, candidate, { GSI6PK: GSI6PK_PURGE_CLAIMED, GSI6SK: "already-claimed-elsewhere" });
    const objects = new FakeDocumentObjectStore();

    const result = await runPurgeCycle(deps(store, objects), { pendingCandidates: [candidate], claimedCandidates: [] });

    expect(result.claimsSkipped).toBe(1);
    expect(objects.deletedVersions).toEqual([]);
  });

  it("skips the claim when purgeAfter is still in the future (defense in depth beyond the caller's query filter)", async () => {
    const candidate = baseDocumentCandidate({ purgeAfter: "2099-01-01T00:00:00.000Z" });
    const store = new FakeDocumentPurgeStore();
    seedFullDocumentRow(store, candidate);
    const objects = new FakeDocumentObjectStore();

    const result = await runPurgeCycle(deps(store, objects), { pendingCandidates: [candidate], claimedCandidates: [] });

    expect(result.claimsSkipped).toBe(1);
  });
});

describe("runPurgeCycle - DocumentPurgeReceipt candidates", () => {
  it("purges a receipt directly from PENDING in one transaction, no claim state, no S3 call", async () => {
    const receipt: ReceiptPurgeCandidate = {
      entityType: "DocumentPurgeReceipt",
      PK: "TENANT#t1#PURGERECEIPT#doc1",
      SK: "META",
      tenantId: "t1",
      documentId: "doc1",
      version: 1,
      GSI6PK: GSI6PK_PURGE_PENDING,
      GSI6SK: "2026-03-01T00:00:00.000Z#TENANT#t1#PURGERECEIPT#doc1",
      purgeAfter: "2026-03-01T00:00:00.000Z",
    };
    const store = new FakeDocumentPurgeStore();
    store.seed({ ...receipt, entityType: "DocumentPurgeReceipt" });
    const objects = new FakeDocumentObjectStore();

    const result = await runPurgeCycle(deps(store, objects), { pendingCandidates: [receipt], claimedCandidates: [] });

    expect(result.receiptsPurged).toBe(1);
    expect(objects.deletedVersions).toEqual([]);
    expect(store.allItems()).toEqual([]);
  });
});

describe("runPurgeCycle - expired lease reconciliation", () => {
  it("reverts an expired claim back to PENDING when purgeAttempts < 5", async () => {
    const candidate = baseDocumentCandidate({ GSI6PK: GSI6PK_PURGE_CLAIMED, GSI6SK: "expired-lease-sk", purgeAttempts: 2 });
    const store = new FakeDocumentPurgeStore();
    seedFullDocumentRow(store, candidate);
    const objects = new FakeDocumentObjectStore();

    const result = await runPurgeCycle(deps(store, objects), { pendingCandidates: [], claimedCandidates: [candidate] });

    expect(result.leasesReverted).toBe(1);
    const row = store.allItems().find((i) => i.SK === "DOC#doc1")!;
    expect(row.GSI6PK).toBe(GSI6PK_PURGE_PENDING);
    expect(row.purgeStatus).toBeUndefined();
  });

  it("marks purgeStatus STUCK and removes both GSI6 pointers once purgeAttempts reaches 5", async () => {
    const candidate = baseDocumentCandidate({ GSI6PK: GSI6PK_PURGE_CLAIMED, GSI6SK: "expired-lease-sk", purgeAttempts: 5 });
    const store = new FakeDocumentPurgeStore();
    seedFullDocumentRow(store, candidate);
    const objects = new FakeDocumentObjectStore();

    const result = await runPurgeCycle(deps(store, objects), { pendingCandidates: [], claimedCandidates: [candidate] });

    expect(result.leasesStuck).toBe(1);
    const row = store.allItems().find((i) => i.SK === "DOC#doc1")!;
    expect(row.purgeStatus).toBe("STUCK");
    expect(row.GSI6PK).toBeUndefined();
    expect(row.GSI6SK).toBeUndefined();
  });
});

describe("D-061 normative invariant: legalHold writes are mutually exclusive with an in-flight purge claim", () => {
  function holdWriteEntry(key: { PK: string; SK: string }, tenantId: string, version: number) {
    return {
      Update: buildVersionedUpdate({
        tableName: TABLE,
        key,
        tenantId,
        expectedVersion: version,
        set: { legalHold: true },
        extraConditions: [{ expression: "attribute_not_exists(GSI6PK) OR GSI6PK <> :purgeClaimed", values: { ":purgeClaimed": GSI6PK_PURGE_CLAIMED } }],
      }),
    };
  }

  it("rejects a hold write once the document is claimed for purge", async () => {
    const candidate = baseDocumentCandidate();
    const store = new FakeDocumentPurgeStore();
    seedFullDocumentRow(store, candidate);
    const objects = new FakeDocumentObjectStore();

    // Claim commits first (version 3 -> 4, GSI6PK -> CLAIMED).
    const result = await runPurgeCycle(deps(store, objects), { pendingCandidates: [candidate], claimedCandidates: [] });
    expect(result.documentsPurged).toBe(1); // no evidence, so it purges immediately (row already gone)

    // Re-seed a claimed-but-not-yet-deleted row to exercise the hold-write rejection in isolation
    // (the scenario above already deleted the row - this asserts the write itself, not the cycle).
    store.seed({ PK: "TENANT#t1#ITEM#item1", SK: "DOC#doc2", entityType: "Document", tenantId: "t1", version: 4, GSI6PK: GSI6PK_PURGE_CLAIMED, GSI6SK: "x" });
    let rejected = false;
    try {
      await store.transactWrite([holdWriteEntry({ PK: "TENANT#t1#ITEM#item1", SK: "DOC#doc2" }, "t1", 4)]);
    } catch (err) {
      rejected = isTransactionCanceled(err);
    }
    expect(rejected).toBe(true);
  });

  it("allows a hold write when the document has no GSI6 pointer at all (the common case)", async () => {
    const store = new FakeDocumentPurgeStore();
    store.seed({ PK: "TENANT#t1#ITEM#item1", SK: "DOC#doc3", entityType: "Document", tenantId: "t1", version: 1 });

    await store.transactWrite([holdWriteEntry({ PK: "TENANT#t1#ITEM#item1", SK: "DOC#doc3" }, "t1", 1)]);

    const row = store.allItems().find((i) => i.SK === "DOC#doc3")!;
    expect(row.legalHold).toBe(true);
  });

  it("if the hold write commits first, the subsequent purge claim fails", async () => {
    const candidate = baseDocumentCandidate();
    const store = new FakeDocumentPurgeStore();
    seedFullDocumentRow(store, candidate);
    const objects = new FakeDocumentObjectStore();

    await store.transactWrite([holdWriteEntry({ PK: candidate.PK, SK: candidate.SK }, candidate.tenantId, candidate.version)]);

    const staleCandidate = { ...candidate }; // worker still holds the version it read BEFORE the hold committed
    const result = await runPurgeCycle(deps(store, objects), { pendingCandidates: [staleCandidate], claimedCandidates: [] });

    expect(result.claimsSkipped).toBe(1);
    expect(objects.deletedVersions).toEqual([]);
  });
});
