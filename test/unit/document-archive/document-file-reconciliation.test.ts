import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle } from "./in-memory-store.js";
import { reconcileTimedOutDocumentFiles } from "../../../src/workers/document-file-reconciliation/reconciliation.js";
import { applyFileScanTimeout, confirmFileScanClean } from "../../../src/modules/document-archive/application/apply-file-scan-result.js";
import { documentFileGsi8Keys, documentFileKey, type DocumentFile } from "../../../src/modules/document-archive/domain/document-file.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import type { DocumentFileGsi8Candidate, DocumentFileGsi8Page, DocumentFileReconciliationCandidateSource } from "../../../src/workers/document-file-reconciliation/candidate-source.js";
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
    newDocumentTypeId: () => `doctype-${++n}`,
  newRequirementTemplateId: () => "reqtpl_test",
  newRequirementTemplateItemId: () => `reqtplitem_${crypto.randomUUID()}`,
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

/** Fake mirroring the real DynamoDB GSI8 Query's contract (`GSI8PK = "WORK#..." AND GSI8SK <
 * :before`, ordered by due date, `documentId`/`seq`/`fileId` parsed off the base PK/SK) - reads
 * live off the SAME store the worker's transactional writes land in, same discipline the purge
 * workers' fakes use. */
function fakeCandidateSource(store: InMemoryDocumentArchiveStore): DocumentFileReconciliationCandidateSource {
  return {
    async queryDue(input: { before: string }): Promise<DocumentFileGsi8Page> {
      const items: DocumentFileGsi8Candidate[] = store
        .allItems()
        .filter((item): item is EntityKey & Record<string, unknown> => item["entityType"] === "DocumentFile" && typeof item["GSI8SK"] === "string" && (item["GSI8SK"] as string) < input.before)
        .map((item) => {
          const gsi8sk = item["GSI8SK"] as string;
          const file = item as unknown as DocumentFile;
          return { PK: file.PK, SK: file.SK, dueAtIso: gsi8sk.split("#TENANT#")[0]!, tenantId: file.tenantId, documentId: file.documentId, seq: file.seq, fileId: file.fileId };
        })
        .sort((a, b) => a.dueAtIso.localeCompare(b.dueAtIso));
      return { items };
    },
  };
}

describe("reconcileTimedOutDocumentFiles — D-179 slice 3, migrated off the base-table Scan onto a GSI8 Query", () => {
  it("times out an overdue PENDING_UPLOAD candidate found via the due-ordered GSI8 query", async () => {
    const gsi8 = documentFileGsi8Keys({ dueAtIso: "2026-08-01T00:00:00.000Z", tenantId: TENANT, fileId: "principal" });
    const store = new InMemoryDocumentArchiveStore([baseFile("principal", { ...gsi8 }), baseVersion()] as unknown as (Record<string, unknown> & EntityKey)[]);
    const result = await reconcileTimedOutDocumentFiles({
      store,
      candidates: fakeCandidateSource(store),
      tableName: TABLE,
      ids: ids(),
      now: () => "2026-09-01T00:00:00.000Z",
    });
    expect(result).toMatchObject({ scanned: 1, timedOut: 1, skippedNotDue: 0, skippedStale: 0 });
    expect(result.oldestCandidateAgeSeconds).toBeGreaterThan(0);
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, "principal"))) as DocumentFile;
    expect(file.scanStatus).toBe("TIMEOUT");
    const version = (await store.get(documentVersionKey(TENANT, DOC, SEQ))) as DocumentVersion;
    expect(version.pendingFileScans).toBe(1);
  });

  it("never times out a candidate whose deadline has not passed yet", async () => {
    const gsi8 = documentFileGsi8Keys({ dueAtIso: "2026-12-01T00:00:00.000Z", tenantId: TENANT, fileId: "principal" });
    const store = new InMemoryDocumentArchiveStore([baseFile("principal", { scanStatus: "SCANNING", ...gsi8 }), baseVersion()] as unknown as (Record<string, unknown> & EntityKey)[]);
    const result = await reconcileTimedOutDocumentFiles({
      store,
      candidates: fakeCandidateSource(store),
      tableName: TABLE,
      ids: ids(),
      now: () => "2026-09-01T00:00:00.000Z",
    });
    // The fake's own `GSI8SK < before` filter already excludes this (mirroring the real Query's
    // KeyConditionExpression) - queryDue() never even returns it, so it's never scanned at all.
    expect(result).toMatchObject({ scanned: 0, timedOut: 0, skippedNotDue: 0 });
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, "principal"))) as DocumentFile;
    expect(file.scanStatus).toBe("SCANNING");
  });

  it("a single GSI8 query covers both PENDING_UPLOAD and SCANNING candidates together - no separate per-status pass needed, unlike the old GSI5 mechanism", async () => {
    const pendingGsi8 = documentFileGsi8Keys({ dueAtIso: "2026-08-01T00:00:00.000Z", tenantId: TENANT, fileId: "principal" });
    const scanningGsi8 = documentFileGsi8Keys({ dueAtIso: "2026-08-02T00:00:00.000Z", tenantId: TENANT, fileId: "attachment1" });
    const store = new InMemoryDocumentArchiveStore([
      baseFile("principal", { ...pendingGsi8 }),
      baseFile("attachment1", { scanStatus: "SCANNING", ...scanningGsi8 }),
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

  it("exact-pointer condition: a candidate whose GSI8 pointer already changed by write time is skipped, never double-processed", async () => {
    // This test proves the mechanism by exercising it directly (not by disabling code): the query
    // observes a candidate, then - simulating a concurrent terminal transition landing between
    // discovery and this call - the file moves to CLEAN with its GSI8 pointer removed before
    // applyFileScanTimeout's own transaction runs.
    const gsi8 = documentFileGsi8Keys({ dueAtIso: "2026-08-01T00:00:00.000Z", tenantId: TENANT, fileId: "principal" });
    const store = new InMemoryDocumentArchiveStore([
      baseFile("principal", { scanStatus: "SCANNING", ...gsi8 }),
      baseVersion({ pendingFileScans: 2 }),
      seedActiveTenantLifecycle(TENANT),
    ] as unknown as (Record<string, unknown> & EntityKey)[]);

    // Concurrent winner: a real physical event confirms the file CLEAN first.
    const confirmOutcome = await confirmFileScanClean(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: "principal", cleanObject: { bucket: "clean-bucket", key: "clean/principal", versionId: "c1" } },
    );
    expect(confirmOutcome).toBe("CONFIRMED");

    // The reconciliation worker's own late attempt against the pointer it originally observed
    // must be rejected by the exact-match condition, not silently reopen/re-decrement the file.
    const timeoutOutcome = await applyFileScanTimeout(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: "principal", observedGsi8Pointer: gsi8 },
    );
    expect(timeoutOutcome).toBe("IGNORED_STALE");

    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, "principal"))) as DocumentFile;
    expect(file.scanStatus).toBe("CLEAN"); // never clobbered back toward TIMEOUT.
    const version = (await store.get(documentVersionKey(TENANT, DOC, SEQ))) as DocumentVersion;
    expect(version.pendingFileScans).toBe(1); // decremented exactly once, by the winning confirm - not twice.
  });
});
