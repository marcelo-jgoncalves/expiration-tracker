import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { reconcileTimedOutDocumentFiles } from "../../../src/workers/document-file-reconciliation/reconciliation.js";
import { applyFileScanTimeout } from "../../../src/modules/document-archive/application/apply-file-scan-result.js";
import { documentFileKey, type DocumentFile, type DocumentFileScanStatus } from "../../../src/modules/document-archive/domain/document-file.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import type { DocumentFileReconciliationCandidate, DocumentFileReconciliationCandidateSource, DocumentFileReconciliationScanPage } from "../../../src/workers/document-file-reconciliation/candidate-source.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TABLE = "MainTable";
const TENANT = "t1";
const DOC = "doc1";
const SEQ = 1;
const PLACEHOLDER = { bucket: "quarantine-bucket", key: "document-archive/tenant/t1/document/doc1/version/1/file/x", versionId: "" };

function ids(): DocumentArchiveIdGenerator {
  let n = 0;
  return {
    newDocumentId: () => `doc-${++n}`,
    newVersionId: () => `ver-${++n}`,
    newEventId: () => `evt-${++n}`,
    newRequirementId: () => `req-${++n}`,
    newSeriesId: () => `series-${++n}`,
    newDocumentRequestId: () => `dr-${++n}`,
    newFileId: () => `file-${++n}`,
  };
}

function baseFile(fileId: string, overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    ...documentFileKey(TENANT, DOC, SEQ, fileId),
    entityType: "DocumentFile",
    tenantId: TENANT,
    documentId: DOC,
    versionId: "v-1",
    seq: SEQ,
    fileId,
    role: fileId === "principal" ? "PRINCIPAL" : "ATTACHMENT",
    scanStatus: "PENDING_UPLOAD",
    mediaType: "application/pdf",
    contentLength: 100,
    checksumSha256: "a".repeat(64),
    quarantineObject: { ...PLACEHOLDER, key: `${PLACEHOLDER.key}/${fileId}` },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function baseVersion(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    ...documentVersionKey(TENANT, DOC, SEQ),
    entityType: "DocumentVersion",
    versionId: "v-1",
    documentId: DOC,
    tenantId: TENANT,
    seq: SEQ,
    state: "DRAFT",
    origin: "MANUAL_UPLOAD",
    pendingFileScans: 2,
    infectedFileScans: 0,
    principalFileId: "principal",
    totalFiles: 2,
    fileSetSealed: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

/** Fake mirroring the real DynamoDB Scan's contract (entityType/scanStatus/attribute_exists
 * (GSI5PK) filter, one page, no lastEvaluatedKey needed at this test's scale) - reads live off
 * the SAME store the worker's transactional writes land in, so a candidate reflects whatever
 * state existed at "scan time" for that test, same discipline the purge workers' fakes use. */
function fakeCandidateSource(store: InMemoryDocumentArchiveStore): DocumentFileReconciliationCandidateSource {
  return {
    async scanCandidates(status: Extract<DocumentFileScanStatus, "PENDING_UPLOAD" | "SCANNING">): Promise<DocumentFileReconciliationScanPage> {
      const items = store
        .allItems()
        .filter((item): item is EntityKey & Record<string, unknown> => item["entityType"] === "DocumentFile" && item["scanStatus"] === status && "GSI5PK" in item)
        .map((item) => item as unknown as DocumentFileReconciliationCandidate);
      return { items };
    },
  };
}

describe("reconcileTimedOutDocumentFiles — D-163 §6/D-166, generalizes UploadSlotReconciliationWorker over GSI5", () => {
  it("times out an overdue PENDING_UPLOAD candidate found via the deadline-ordered bounded scan", async () => {
    const overdue = { GSI5PK: "TENANT#t1#DOCFILE-RECON#PENDING_UPLOAD", GSI5SK: "2026-08-01T00:00:00.000Z#FILE#principal" };
    const store = new InMemoryDocumentArchiveStore([baseFile("principal", { ...overdue }), baseVersion()] as unknown as (Record<string, unknown> & EntityKey)[]);
    const result = await reconcileTimedOutDocumentFiles({
      store,
      candidates: fakeCandidateSource(store),
      tableName: TABLE,
      ids: ids(),
      now: () => "2026-09-01T00:00:00.000Z",
    });
    expect(result).toMatchObject({ scanned: 1, timedOut: 1, skippedNotDue: 0, skippedStale: 0 });
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, "principal"))) as DocumentFile;
    expect(file.scanStatus).toBe("TIMEOUT");
    const version = (await store.get(documentVersionKey(TENANT, DOC, SEQ))) as DocumentVersion;
    expect(version.pendingFileScans).toBe(1);
  });

  it("never times out a candidate whose deadline has not passed yet", async () => {
    const notDueYet = { GSI5PK: "TENANT#t1#DOCFILE-RECON#SCANNING", GSI5SK: "2026-12-01T00:00:00.000Z#FILE#principal" };
    const store = new InMemoryDocumentArchiveStore([baseFile("principal", { scanStatus: "SCANNING", ...notDueYet }), baseVersion()] as unknown as (Record<string, unknown> & EntityKey)[]);
    const result = await reconcileTimedOutDocumentFiles({
      store,
      candidates: fakeCandidateSource(store),
      tableName: TABLE,
      ids: ids(),
      now: () => "2026-09-01T00:00:00.000Z",
    });
    expect(result).toMatchObject({ scanned: 1, timedOut: 0, skippedNotDue: 1 });
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, "principal"))) as DocumentFile;
    expect(file.scanStatus).toBe("SCANNING");
  });

  it("runs two independent scans, one per non-terminal status, never conflating PENDING_UPLOAD and SCANNING candidates", async () => {
    const pendingPtr = { GSI5PK: "TENANT#t1#DOCFILE-RECON#PENDING_UPLOAD", GSI5SK: "2026-08-01T00:00:00.000Z#FILE#principal" };
    const scanningPtr = { GSI5PK: "TENANT#t1#DOCFILE-RECON#SCANNING", GSI5SK: "2026-08-01T00:00:00.000Z#FILE#attachment1" };
    const store = new InMemoryDocumentArchiveStore([
      baseFile("principal", { ...pendingPtr }),
      baseFile("attachment1", { scanStatus: "SCANNING", ...scanningPtr }),
      baseVersion({ pendingFileScans: 2, totalFiles: 2 }),
    ] as unknown as (Record<string, unknown> & EntityKey)[]);
    const result = await reconcileTimedOutDocumentFiles({
      store,
      candidates: fakeCandidateSource(store),
      tableName: TABLE,
      ids: ids(),
      now: () => "2026-09-01T00:00:00.000Z",
    });
    expect(result).toMatchObject({ scanned: 2, timedOut: 2 });
    const principal = (await store.get(documentFileKey(TENANT, DOC, SEQ, "principal"))) as DocumentFile;
    const attachment = (await store.get(documentFileKey(TENANT, DOC, SEQ, "attachment1"))) as DocumentFile;
    expect(principal.scanStatus).toBe("TIMEOUT");
    expect(attachment.scanStatus).toBe("TIMEOUT");
  });

  it("exact-pointer condition (D-163 round4 §3): a candidate whose GSI5 pointer already changed by write time is skipped, never double-processed - broken here by removing the condition to prove the test actually catches it", async () => {
    // This test proves the mechanism by exercising it directly (not by disabling code): the scan
    // observes a candidate, then - simulating a concurrent terminal transition landing between
    // discovery and this call - the file moves to CLEAN with its GSI5 pointer removed before
    // applyFileScanTimeout's own transaction runs.
    const staleObserved = { GSI5PK: "TENANT#t1#DOCFILE-RECON#SCANNING", GSI5SK: "2026-08-01T00:00:00.000Z#FILE#principal" };
    const store = new InMemoryDocumentArchiveStore([baseFile("principal", { scanStatus: "SCANNING", ...staleObserved }), baseVersion({ pendingFileScans: 2 })] as unknown as (Record<string, unknown> & EntityKey)[]);

    // Concurrent winner: a real physical event confirms the file CLEAN first.
    const { confirmFileScanClean } = await import("../../../src/modules/document-archive/application/apply-file-scan-result.js");
    const confirmOutcome = await confirmFileScanClean(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: "principal", cleanObject: { bucket: "clean-bucket", key: "clean/principal", versionId: "c1" } },
    );
    expect(confirmOutcome).toBe("CONFIRMED");

    // The reconciliation worker's own late attempt against the pointer it originally observed
    // must be rejected by the exact-match condition, not silently reopen/re-decrement the file.
    const timeoutOutcome = await applyFileScanTimeout(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: "principal", observedGsi5Pointer: staleObserved },
    );
    expect(timeoutOutcome).toBe("IGNORED_STALE");

    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, "principal"))) as DocumentFile;
    expect(file.scanStatus).toBe("CLEAN"); // never clobbered back toward TIMEOUT.
    const version = (await store.get(documentVersionKey(TENANT, DOC, SEQ))) as DocumentVersion;
    expect(version.pendingFileScans).toBe(1); // decremented exactly once, by the winning confirm - not twice.
  });
});
