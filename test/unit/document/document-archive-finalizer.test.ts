import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle } from "../document-archive/in-memory-store.js";
import { finalizeDocumentArchiveUpload } from "../../../src/workers/upload-finalizer/document-archive-finalizer.js";
import { documentFileKey, type DocumentFile } from "../../../src/modules/document-archive/domain/document-file.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import type { DocumentObjectStore } from "../../../src/modules/document/ports/document-object-store.js";
import type { FeatureFlags, FeatureFlagsReader } from "../../../src/modules/extraction/ports/feature-flags-reader.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

/** D-193 item 8/9 (PROMOTER gate) test double. `enabled: true` by default so every
 * pre-existing test in this file keeps exercising the SAME mechanism it always did - the
 * flag-off/flag-error behavior gets its own dedicated `describe` block below. */
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
    scanStatus: "PENDING_UPLOAD",
    mediaType: "application/pdf",
    contentLength: 100,
    checksumSha256: "a".repeat(64),
    quarantineObject: { ...OBJECT, versionId: "" },
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

describe("finalizeDocumentArchiveUpload — D-193 slice 1 (the handler-level fix for the real stuck-forever bug)", () => {
  it("stays AWAITING on the S3 upload event alone (consolidates the quarantineObject triple)", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const outcome = await finalizeDocumentArchiveUpload(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: ENABLED_FLAGS },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT },
    );
    expect(outcome).toBe("AWAITING");
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("SCANNING");
    expect(file.quarantineObject.versionId).toBe("real-v1");
  });

  it("PROMOTES to CONFIRMED once malware evidence already cleared the file (both evidences present)", async () => {
    const store = seededStore([
      baseFile({ scanStatus: "SCANNING", quarantineObject: OBJECT, malwareEvidence: { object: OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-09-01T00:01:00.000Z" } }),
      baseVersion(),
    ]);
    const outcome = await finalizeDocumentArchiveUpload(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: ENABLED_FLAGS },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT },
    );
    expect(outcome).toBe("CONFIRMED");
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("CLEAN");
  });

  it("rejects on a size mismatch against what reserveFiles() declared", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const outcome = await finalizeDocumentArchiveUpload(
      { store, objects: fakeObjects({ headObject: async () => ({ contentLength: 999, mediaType: "application/pdf", checksumSha256: "a".repeat(64) }) }), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: ENABLED_FLAGS },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT },
    );
    expect(outcome).toBe("REJECTED_INVALID"); // an invalid upload rejects immediately, regardless of malware evidence arrival order.
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.uploadEvidence?.valid).toBe(false);
    expect(file.scanStatus).toBe("REJECTED");
  });

  it("ignores an event for an object that doesn't match this file's own reserved quarantine key (fail-closed)", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const outcome = await finalizeDocumentArchiveUpload(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: ENABLED_FLAGS },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: { ...OBJECT, key: "document-archive/tenant/t1/document/doc1/version/1/file/wrong" } },
    );
    expect(outcome).toBe("IGNORED_UNKNOWN_FILE");
  });

  it("ignores an event for a DocumentFile that doesn't exist at all", async () => {
    const store = seededStore([]);
    const outcome = await finalizeDocumentArchiveUpload(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: ENABLED_FLAGS },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT },
    );
    expect(outcome).toBe("IGNORED_UNKNOWN_FILE");
  });
});

describe("finalizeDocumentArchiveUpload — D-193 item 8/9 (PROMOTER gate)", () => {
  it("G-V3: default OFF - never touches the store/objects at all, even for an otherwise-perfectly-valid upload event", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    let headCalled = false;
    const outcome = await finalizeDocumentArchiveUpload(
      { store, objects: fakeObjects({ headObject: async () => { headCalled = true; return { contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64) }; } }), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: new FakeFeatureFlagsReader(false) },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT },
    );
    expect(outcome).toBe("IGNORED_PROMOTION_DISABLED");
    expect(headCalled).toBe(false);
    // The DocumentFile row itself was never touched either - completely inert, not merely
    // refused at the final promotion step.
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("PENDING_UPLOAD");
    expect(file.uploadEvidence).toBeUndefined();
  });

  it("fail-closed: a FeatureFlagsReader read/parse error is treated identically to the flag being off", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const outcome = await finalizeDocumentArchiveUpload(
      { store, objects: fakeObjects(), ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, featureFlags: new FakeFeatureFlagsReader(true, true) },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, object: OBJECT },
    );
    expect(outcome).toBe("IGNORED_PROMOTION_DISABLED");
  });
});
