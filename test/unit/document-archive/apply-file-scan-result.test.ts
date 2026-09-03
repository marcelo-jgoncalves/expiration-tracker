import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { applyFileScanResult, applyFileScanTimeout, confirmFileScanClean } from "../../../src/modules/document-archive/application/apply-file-scan-result.js";
import { documentFileKey, type DocumentFile } from "../../../src/modules/document-archive/domain/document-file.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

function seededStore(items: readonly (EntityKey & object)[]): InMemoryDocumentArchiveStore {
  return new InMemoryDocumentArchiveStore(items as unknown as (Record<string, unknown> & EntityKey)[]);
}

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

const TABLE = "MainTable";
const TENANT = "t1";
const DOC = "doc1";
const SEQ = 1;
const FILE = "file1";
const PLACEHOLDER = { bucket: "quarantine-bucket", key: "document-archive/tenant/t1/document/doc1/version/1/file/file1", versionId: "" };

function baseFile(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    ...documentFileKey(TENANT, DOC, SEQ, FILE),
    entityType: "DocumentFile",
    tenantId: TENANT,
    documentId: DOC,
    versionId: "v-1",
    seq: SEQ,
    fileId: FILE,
    role: "PRINCIPAL",
    scanStatus: "PENDING_UPLOAD",
    mediaType: "application/pdf",
    contentLength: 100,
    checksumSha256: "a".repeat(64),
    quarantineObject: PLACEHOLDER,
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
    pendingFileScans: 1,
    infectedFileScans: 0,
    principalFileId: FILE,
    totalFiles: 1,
    fileSetSealed: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("applyFileScanResult — D-163 §1/§5 symmetric evidence correlation + terminal transition", () => {
  it("stays AWAITING and consolidates the triple when only upload evidence arrives first", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const observed = { bucket: PLACEHOLDER.bucket, key: PLACEHOLDER.key, versionId: "real-v1" };
    const outcome = await applyFileScanResult(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedObject: observed, uploadEvidence: { object: observed, contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: true, observedAt: "2026-09-01T00:01:00.000Z" } },
    );
    expect(outcome).toEqual({ outcome: "AWAITING" });
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("SCANNING");
    expect(file.quarantineObject.versionId).toBe("real-v1"); // consolidated from the observed triple, not fabricated.
  });

  it("D-163 §1: GuardDuty (malware) arriving BEFORE the S3 upload event also consolidates the triple from its own observed object", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const observed = { bucket: PLACEHOLDER.bucket, key: PLACEHOLDER.key, versionId: "real-v1" };
    const outcome = await applyFileScanResult(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedObject: observed, malwareEvidence: { object: observed, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-09-01T00:01:00.000Z" } },
    );
    expect(outcome).toEqual({ outcome: "AWAITING" });
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.quarantineObject.versionId).toBe("real-v1");
  });

  it("a second event whose triple does not match the already-consolidated one is ignored (IGNORED_WRONG_VERSION), never re-consolidated", async () => {
    const store = seededStore([baseFile({ scanStatus: "SCANNING", quarantineObject: { ...PLACEHOLDER, versionId: "real-v1" } }), baseVersion()]);
    const outcome = await applyFileScanResult(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedObject: { ...PLACEHOLDER, versionId: "stale-v0" }, malwareEvidence: { object: { ...PLACEHOLDER, versionId: "stale-v0" }, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-09-01T00:02:00.000Z" } },
    );
    expect(outcome).toEqual({ outcome: "IGNORED_WRONG_VERSION" });
  });

  it("REJECT on THREATS_FOUND: decrements pendingFileScans, increments infectedFileScans, removes GSI8 pointer, emits FILE_REJECTED_INFECTED", async () => {
    const observed = { ...PLACEHOLDER, versionId: "real-v1" };
    const store = seededStore([baseFile({ scanStatus: "SCANNING", quarantineObject: observed, GSI8PK: "WORK#DOCUMENT_FILE_RECONCILIATION", GSI8SK: "2026-09-01T00:00:00.000Z#TENANT#t1#file1" }), baseVersion()]);
    const outcome = await applyFileScanResult(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedObject: observed, malwareEvidence: { object: observed, status: "THREATS_FOUND", scanResultId: "s1", observedAt: "2026-09-01T00:02:00.000Z" } },
    );
    expect(outcome).toEqual({ outcome: "REJECTED", status: "REJECTED" });
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("REJECTED");
    expect(file.GSI8PK).toBeUndefined();
    expect(file.GSI8SK).toBeUndefined();
    const version = (await store.get(documentVersionKey(TENANT, DOC, SEQ))) as DocumentVersion;
    expect(version.pendingFileScans).toBe(0);
    expect(version.infectedFileScans).toBe(1);
    const events = (await store.queryByPk(`TENANT#${TENANT}#DOCUMENT#${DOC}`, "VERSION#000001#EVENT#")) as unknown as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "FILE_REJECTED_INFECTED", fileId: FILE, fromFileScanStatus: "SCANNING", toFileScanStatus: "REJECTED" });
  });

  it("REJECT on invalid upload (not malware): decrements pendingFileScans only - never infectedFileScans, never emits FILE_REJECTED_INFECTED", async () => {
    const observed = { ...PLACEHOLDER, versionId: "real-v1" };
    const store = seededStore([baseFile({ scanStatus: "SCANNING", quarantineObject: observed }), baseVersion()]);
    const outcome = await applyFileScanResult(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedObject: observed, uploadEvidence: { object: observed, contentLength: 999, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: false, observedAt: "2026-09-01T00:02:00.000Z" } },
    );
    expect(outcome).toEqual({ outcome: "REJECTED", status: "REJECTED" });
    const version = (await store.get(documentVersionKey(TENANT, DOC, SEQ))) as DocumentVersion;
    expect(version.pendingFileScans).toBe(0);
    expect(version.infectedFileScans).toBe(0);
    const events = (await store.queryByPk(`TENANT#${TENANT}#DOCUMENT#${DOC}`, "VERSION#000001#EVENT#")) as unknown as Array<Record<string, unknown>>;
    expect(events).toHaveLength(0);
  });

  it("PROMOTE never claims CLEAN itself - returns READY_TO_PROMOTE with the source object, leaves counters untouched", async () => {
    const observed = { ...PLACEHOLDER, versionId: "real-v1" };
    const store = seededStore([
      baseFile({ scanStatus: "SCANNING", quarantineObject: observed, uploadEvidence: { object: observed, contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: true, observedAt: "2026-09-01T00:01:00.000Z" } }),
      baseVersion(),
    ]);
    const outcome = await applyFileScanResult(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedObject: observed, malwareEvidence: { object: observed, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-09-01T00:02:00.000Z" } },
    );
    expect(outcome).toEqual({ outcome: "READY_TO_PROMOTE", sourceObject: observed });
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("SCANNING"); // never CLEAN from this call alone.
    expect(file.cleanObject).toBeUndefined();
    const version = (await store.get(documentVersionKey(TENANT, DOC, SEQ))) as DocumentVersion;
    expect(version.pendingFileScans).toBe(1); // untouched until confirmFileScanClean.
  });

  it("ignores late/duplicate evidence once the file is already terminal (CLEAN) - idempotent replay", async () => {
    const observed = { ...PLACEHOLDER, versionId: "real-v1" };
    const store = seededStore([baseFile({ scanStatus: "CLEAN", quarantineObject: observed, cleanObject: { bucket: "clean-bucket", key: "clean/file1", versionId: "c1" } }), baseVersion({ pendingFileScans: 0 })]);
    const outcome = await applyFileScanResult(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedObject: observed, malwareEvidence: { object: observed, status: "THREATS_FOUND", scanResultId: "s2", observedAt: "2026-09-01T00:03:00.000Z" } },
    );
    expect(outcome).toEqual({ outcome: "IGNORED_STALE" });
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("CLEAN"); // never reopened.
  });
});

describe("confirmFileScanClean — PROMOTE confirmation step, called only after the caller's own copy+verify", () => {
  it("confirms CLEAN, sets cleanObject, removes GSI8 pointer, decrements pendingFileScans", async () => {
    const observed = { ...PLACEHOLDER, versionId: "real-v1" };
    const store = seededStore([baseFile({ scanStatus: "SCANNING", quarantineObject: observed, GSI8PK: "WORK#DOCUMENT_FILE_RECONCILIATION", GSI8SK: "2026-09-01T00:00:00.000Z#TENANT#t1#file1" }), baseVersion()]);
    const outcome = await confirmFileScanClean(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, cleanObject: { bucket: "clean-bucket", key: "clean/file1", versionId: "c1" } },
    );
    expect(outcome).toBe("CONFIRMED");
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("CLEAN");
    expect(file.cleanObject).toEqual({ bucket: "clean-bucket", key: "clean/file1", versionId: "c1" });
    expect(file.GSI8PK).toBeUndefined();
    expect(file.GSI8SK).toBeUndefined();
    const version = (await store.get(documentVersionKey(TENANT, DOC, SEQ))) as DocumentVersion;
    expect(version.pendingFileScans).toBe(0);
  });

  it("ignores a confirmation for a file that is already terminal (e.g. concurrently rejected) - never resurrects it", async () => {
    const observed = { ...PLACEHOLDER, versionId: "real-v1" };
    const store = seededStore([baseFile({ scanStatus: "REJECTED", quarantineObject: observed }), baseVersion({ pendingFileScans: 0, infectedFileScans: 1 })]);
    const outcome = await confirmFileScanClean(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, cleanObject: { bucket: "clean-bucket", key: "clean/file1", versionId: "c1" } },
    );
    expect(outcome).toBe("IGNORED_STALE");
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("REJECTED");
    expect(file.cleanObject).toBeUndefined();
  });
});

describe("applyFileScanTimeout — D-163 §6/round4-claude-final.md §3, reconciliation worker's terminal transition", () => {
  const GSI8_PTR = { GSI8PK: "WORK#DOCUMENT_FILE_RECONCILIATION", GSI8SK: "2026-09-01T00:10:00.000Z#TENANT#t1#file1" };

  it("times out an overdue file: sets scanStatus=TIMEOUT, removes the GSI8 pointer, decrements pendingFileScans", async () => {
    const store = seededStore([baseFile({ scanStatus: "SCANNING", ...GSI8_PTR }), baseVersion()]);
    const outcome = await applyFileScanTimeout(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedGsi8Pointer: GSI8_PTR },
    );
    expect(outcome).toBe("TIMED_OUT");
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("TIMEOUT");
    expect(file.GSI8PK).toBeUndefined();
    expect(file.GSI8SK).toBeUndefined();
    const version = (await store.get(documentVersionKey(TENANT, DOC, SEQ))) as DocumentVersion;
    expect(version.pendingFileScans).toBe(0);
  });

  it("skips a candidate whose GSI8 pointer no longer matches what the scan observed (deadline changed, or already terminal) - never double-processed", async () => {
    // File already moved to CLEAN (with GSI8 pointer removed) between the scan and this call -
    // same mutation the exact-pointer condition is supposed to catch even if the caller had
    // observed the STALE candidate's old pointer value.
    const store = seededStore([baseFile({ scanStatus: "CLEAN", cleanObject: { bucket: "clean-bucket", key: "clean/file1", versionId: "c1" } }), baseVersion({ pendingFileScans: 0 })]);
    const outcome = await applyFileScanTimeout(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedGsi8Pointer: GSI8_PTR },
    );
    expect(outcome).toBe("IGNORED_STALE");
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("CLEAN"); // never reopened toward TIMEOUT.
  });

  it("skips a candidate whose GSI8 pointer changed (new deadline written concurrently) even though scanStatus is still non-terminal - the exact-pointer condition, not just scanStatus, closes this race", async () => {
    const currentPointer = { GSI8PK: "WORK#DOCUMENT_FILE_RECONCILIATION", GSI8SK: "2026-09-01T00:20:00.000Z#TENANT#t1#file1" };
    const store = seededStore([baseFile({ scanStatus: "SCANNING", ...currentPointer }), baseVersion()]);
    // The scan observed the OLD pointer (a stale candidate from a previous page/attempt) - the
    // transaction's extraConditions must fail even though scanStatus alone would still allow it.
    const outcome = await applyFileScanTimeout(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedGsi8Pointer: GSI8_PTR },
    );
    expect(outcome).toBe("IGNORED_STALE");
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("SCANNING"); // untouched - the concurrent pointer update wins.
    expect(file.GSI8SK).toBe(currentPointer.GSI8SK);
  });

  it("is idempotent against a file already terminal by the time it's processed (no GSI8 pointer at all)", async () => {
    const store = seededStore([baseFile({ scanStatus: "REJECTED" }), baseVersion({ pendingFileScans: 0, infectedFileScans: 1 })]);
    const outcome = await applyFileScanTimeout(
      { store, tableName: TABLE, ids: ids() },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedGsi8Pointer: GSI8_PTR },
    );
    expect(outcome).toBe("IGNORED_STALE");
  });
});
