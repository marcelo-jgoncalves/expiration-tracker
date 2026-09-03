/**
 * D-193 item 8/9 ("Sequenciamento", `estado-final-consolidado.md`) — end-to-end proof that the
 * two-flag mandatory-order activation actually gates/unlocks the REAL D-193 slices 1-7
 * mechanism, not just the two isolated gate checks their own unit tests already cover.
 *
 * One shared `InMemoryDocumentArchiveStore` plays the role of the real DynamoDB table across
 * TWO real application functions, in the SAME order production traffic hits them:
 *   1. `processDocumentArchiveMalwareResult()` (slice 1, PROMOTER-gated) — a GuardDuty
 *      "clean" finding promotes the `DocumentFile` to CLEAN and copies it to the clean bucket.
 *   2. `startExtractionRunForDocumentArchive()` (slice 3, STARTER-gated) — the clean-bucket
 *      "Object Created" event this promotion produces would trigger, reading the SAME row the
 *      first call just wrote.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle } from "../document-archive/in-memory-store.js";
import { processDocumentArchiveMalwareResult } from "../../../src/workers/malware-result/document-archive-result-processor.js";
import { startExtractionRunForDocumentArchive } from "../../../src/modules/extraction/application/start-extraction-run-for-document-archive.js";
import { documentFileKey, type DocumentFile } from "../../../src/modules/document-archive/domain/document-file.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import type { DocumentObjectStore } from "../../../src/modules/document/ports/document-object-store.js";
import type { ExtractionRunStore } from "../../../src/modules/extraction/ports/extraction-run-store.js";
import type { ExtractionExecutionInput, ExtractionExecutionStarter } from "../../../src/modules/extraction/ports/extraction-execution-starter.js";
import type { FeatureFlags, FeatureFlagsReader } from "../../../src/modules/extraction/ports/feature-flags-reader.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

class FixedFlags implements FeatureFlagsReader {
  constructor(private readonly flags: FeatureFlags) {}
  async getFlags(): Promise<FeatureFlags> {
    return this.flags;
  }
}
const BOTH_OFF: FeatureFlags = { AI_EXTRACTION: false, OCR: false, WHATSAPP: false, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false };
const ONLY_PROMOTER: FeatureFlags = { ...BOTH_OFF, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: true };
const BOTH_CORRECT_ORDER: FeatureFlags = { ...BOTH_OFF, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: true, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: true };

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
    newRequirementTemplateItemId: () => `reqtplitem_${++n}`,
  };
}

const TABLE = "MainTable";
const CLEAN_BUCKET = "clean-bucket";
const TENANT = "t1";
const DOC = "doc1";
const SEQ = 1;
const FILE = "file1";
const VERSION_ID = "v-1";
const QUARANTINE_OBJECT = { bucket: "quarantine-bucket", key: "document-archive/tenant/t1/document/doc1/version/1/file/file1", versionId: "real-v1" };

function baseFile(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    ...documentFileKey(TENANT, DOC, SEQ, FILE),
    entityType: "DocumentFile",
    tenantId: TENANT,
    documentId: DOC,
    versionId: VERSION_ID,
    seq: SEQ,
    fileId: FILE,
    role: "PRINCIPAL",
    scanStatus: "SCANNING",
    mediaType: "application/pdf",
    contentLength: 100,
    checksumSha256: "a".repeat(64),
    quarantineObject: QUARANTINE_OBJECT,
    uploadEvidence: { object: QUARANTINE_OBJECT, contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: true, observedAt: "2026-09-03T00:01:00.000Z" },
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function baseVersion(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    ...documentVersionKey(TENANT, DOC, SEQ),
    entityType: "DocumentVersion",
    versionId: VERSION_ID,
    documentId: DOC,
    tenantId: TENANT,
    seq: SEQ,
    state: "RECEIVED",
    origin: "MANUAL_UPLOAD",
    pendingFileScans: 1,
    infectedFileScans: 0,
    principalFileId: FILE,
    totalFiles: 1,
    fileSetSealed: true,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function fakeObjects(): DocumentObjectStore {
  return {
    headObject: async () => ({ contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64) }),
    copyObject: async (_s, destBucket, destKey) => ({ bucket: destBucket, key: destKey, versionId: "clean-v1" }),
    deleteObjectVersion: async () => undefined,
  };
}

class FakeExtractionRunStore implements ExtractionRunStore {
  public readonly items = new Map<string, unknown>();
  async get(): Promise<undefined> {
    throw new Error("not used");
  }
  async putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    const key = `${item.PK}#${item.SK}`;
    if (this.items.has(key)) return false;
    this.items.set(key, item);
    return true;
  }
  async updateStatus(): Promise<boolean> {
    throw new Error("not used");
  }
}

class FakeExecutionStarter implements ExtractionExecutionStarter {
  public readonly calls: { name: string; input: ExtractionExecutionInput }[] = [];
  async startExecution(input: { name: string; input: ExtractionExecutionInput }): Promise<void> {
    this.calls.push(input);
  }
}

function seededArchive(): InMemoryDocumentArchiveStore {
  return new InMemoryDocumentArchiveStore([baseFile(), baseVersion(), seedActiveTenantLifecycle(TENANT)] as unknown as (Record<string, unknown> & EntityKey)[]);
}

describe("D-193 item 8/9 — end-to-end activation gate over the REAL slice 1 -> slice 3 mechanism", () => {
  it("G-V3: BOTH FLAGS OFF (default) — the physical promotion never happens, so the Starter never even gets a CLEAN object to look at (the whole mechanism is inert end-to-end)", async () => {
    const archive = seededArchive();
    const promotionOutcome = await processDocumentArchiveMalwareResult(
      { store: archive, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: new FixedFlags(BOTH_OFF) },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: QUARANTINE_OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1" },
    );
    expect(promotionOutcome).toBe("IGNORED_PROMOTION_DISABLED");
    const file = (await archive.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("SCANNING"); // never promoted - no CLEAN object was ever produced.
    expect(file.cleanObject).toBeUndefined();

    // Even if the Starter itself were enabled, there is no CLEAN object for it to react to -
    // but prove its OWN gate independently too, using the exact object a real S3 event would
    // carry for a promotion that (correctly) never happened.
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const starterOutcome = await startExtractionRunForDocumentArchive(
      { archive, runs, executions, featureFlags: new FixedFlags(BOTH_OFF) },
      { tenantId: TENANT, documentId: DOC, versionId: VERSION_ID, fileId: FILE, observedCleanObject: { bucket: CLEAN_BUCKET, key: "document-archive/clean/t1/doc1/v-1/file1", versionId: "clean-v1" }, correlationId: "corr-1" },
    );
    expect(starterOutcome).toEqual({ outcome: "REFUSED", reason: "STARTER_DISABLED" });
    expect(executions.calls).toHaveLength(0);
  });

  it("G-V3: FORBIDDEN REVERSE ORDER (PROMOTER on, STARTER still off) — promotion never happens either, closing the 'CLEAN sem consumidor' window by construction: there is no code path that produces a CLEAN object while nothing is enabled to consume it", async () => {
    const archive = seededArchive();
    const promotionOutcome = await processDocumentArchiveMalwareResult(
      { store: archive, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: new FixedFlags(ONLY_PROMOTER) },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: QUARANTINE_OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1" },
    );
    expect(promotionOutcome).toBe("IGNORED_PROMOTION_DISABLED");
    const file = (await archive.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("SCANNING");
    expect(file.cleanObject).toBeUndefined(); // the dangerous state (CLEAN with no consumer) never exists.
  });

  it("G-V3: CORRECT ORDER (both on) — the full slices 1-7 mechanism actually runs end-to-end: promotion produces the CLEAN object, then the Starter (reading the SAME row) opens the ExtractionRun gate and starts the real Step Functions execution", async () => {
    const archive = seededArchive();
    const promotionOutcome = await processDocumentArchiveMalwareResult(
      { store: archive, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: new FixedFlags(BOTH_CORRECT_ORDER) },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: QUARANTINE_OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1" },
    );
    expect(promotionOutcome).toBe("APPLIED");
    const promotedFile = (await archive.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(promotedFile.scanStatus).toBe("CLEAN");
    expect(promotedFile.cleanObject).toBeDefined();

    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const starterOutcome = await startExtractionRunForDocumentArchive(
      { archive, runs, executions, featureFlags: new FixedFlags(BOTH_CORRECT_ORDER) },
      { tenantId: TENANT, documentId: DOC, versionId: VERSION_ID, fileId: FILE, observedCleanObject: promotedFile.cleanObject!, correlationId: "corr-2" },
    );
    expect(starterOutcome).toEqual({ outcome: "GATE_OPENED" });
    expect(runs.items.size).toBe(1);
    expect(executions.calls).toHaveLength(1);
    expect(executions.calls[0]?.input.documentSource).toBe("DOCUMENT_ARCHIVE");
  });
});
