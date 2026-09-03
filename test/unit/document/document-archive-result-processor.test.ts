import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle } from "../document-archive/in-memory-store.js";
import { processDocumentArchiveMalwareResult } from "../../../src/workers/malware-result/document-archive-result-processor.js";
import { documentFileKey, type DocumentFile } from "../../../src/modules/document-archive/domain/document-file.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import type { DocumentObjectStore } from "../../../src/modules/document/ports/document-object-store.js";
import type { FeatureFlags, FeatureFlagsReader } from "../../../src/modules/extraction/ports/feature-flags-reader.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

/** D-193 item 8/9 (PROMOTER gate) test double - same shape as
 * `document-archive-finalizer.test.ts`'s own copy of this fake. */
class FakeFeatureFlagsReader implements FeatureFlagsReader {
  constructor(
    private readonly enabled: boolean = true,
    private readonly throwOnRead: boolean = false,
  ) {}
  async getFlags(): Promise<FeatureFlags> {
    if (this.throwOnRead) throw new Error("AppConfig unreachable (simulated)");
    return {
      AI_EXTRACTION: false,
      OCR: false,
      WHATSAPP: false,
      EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: this.enabled,
      DOCUMENT_ARCHIVE_PROMOTION_ENABLED: this.enabled,
    };
  }
}
const ENABLED_FLAGS = new FakeFeatureFlagsReader(true);

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
const OBJECT = { bucket: "quarantine-bucket", key: "document-archive/tenant/t1/document/doc1/version/1/file/file1", versionId: "real-v1" };

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
    scanStatus: "SCANNING",
    mediaType: "application/pdf",
    contentLength: 100,
    checksumSha256: "a".repeat(64),
    quarantineObject: OBJECT,
    uploadEvidence: { object: OBJECT, contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64), valid: true, observedAt: "2026-09-01T00:01:00.000Z" },
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

function fakeObjects(overrides: Partial<DocumentObjectStore> = {}): DocumentObjectStore {
  return {
    headObject: async () => ({ contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64) }),
    copyObject: async (_s, destBucket, destKey) => ({ bucket: destBucket, key: destKey, versionId: "clean-v1" }),
    deleteObjectVersion: async () => undefined,
    ...overrides,
  };
}

function seededStore(items: readonly (EntityKey & object)[]): InMemoryDocumentArchiveStore {
  return new InMemoryDocumentArchiveStore([...items, seedActiveTenantLifecycle(TENANT)] as unknown as (Record<string, unknown> & EntityKey)[]);
}

describe("processDocumentArchiveMalwareResult — D-193 slice 1", () => {
  it("PROMOTES to APPLIED when this finding is the second, deciding half of the evidence", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const outcome = await processDocumentArchiveMalwareResult(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: ENABLED_FLAGS },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1" },
    );
    expect(outcome).toBe("APPLIED");
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("CLEAN");
  });

  it("infection: still reports APPLIED (the finding was applied, resulting in REJECTED)", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const outcome = await processDocumentArchiveMalwareResult(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: ENABLED_FLAGS },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT, status: "THREATS_FOUND", scanResultId: "s1" },
    );
    expect(outcome).toBe("APPLIED");
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("REJECTED");
  });

  it("dedupes a repeated GuardDuty finding by scanResultId", async () => {
    const store = seededStore([baseFile({ malwareEvidence: { object: OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-09-01T00:01:00.000Z" } }), baseVersion()]);
    const outcome = await processDocumentArchiveMalwareResult(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: ENABLED_FLAGS },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1" },
    );
    expect(outcome).toBe("IGNORED_DUPLICATE_SCAN");
  });

  it("fail-closed: a finding for a different bucket/key than the one this file reserved is ignored", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const outcome = await processDocumentArchiveMalwareResult(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: ENABLED_FLAGS },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: { ...OBJECT, key: "document-archive/tenant/t1/document/doc1/version/1/file/wrong" }, status: "NO_THREATS_FOUND", scanResultId: "s1" },
    );
    expect(outcome).toBe("IGNORED_WRONG_OBJECT");
  });

  it("ignores a finding for a DocumentFile that doesn't exist", async () => {
    const store = seededStore([]);
    const outcome = await processDocumentArchiveMalwareResult(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: ENABLED_FLAGS },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1" },
    );
    expect(outcome).toBe("IGNORED_UNKNOWN_FILE");
  });
});

describe("processDocumentArchiveMalwareResult — D-193 item 8/9 (PROMOTER gate)", () => {
  it("G-V3: default OFF - never touches the store at all, even for an otherwise-decisive finding", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const outcome = await processDocumentArchiveMalwareResult(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: new FakeFeatureFlagsReader(false) },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1" },
    );
    expect(outcome).toBe("IGNORED_PROMOTION_DISABLED");
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("SCANNING"); // untouched - not even the malwareEvidence half was recorded.
    expect(file.malwareEvidence).toBeUndefined();
  });

  it("fail-closed: a FeatureFlagsReader read/parse error is treated identically to the flag being off", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const outcome = await processDocumentArchiveMalwareResult(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: new FakeFeatureFlagsReader(true, true) },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1" },
    );
    expect(outcome).toBe("IGNORED_PROMOTION_DISABLED");
  });
});
