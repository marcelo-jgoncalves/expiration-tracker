import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle } from "./in-memory-store.js";
import { advanceDocumentArchiveFileAfterEvidence, buildDocumentArchiveCleanKey } from "../../../src/modules/document-archive/application/advance-file-after-evidence.js";
import { documentFileKey, type DocumentFile } from "../../../src/modules/document-archive/domain/document-file.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import type { DocumentObjectStore } from "../../../src/modules/document/ports/document-object-store.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

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

describe("buildDocumentArchiveCleanKey — D-193 closed clean-key shape (versionId-based, never seq)", () => {
  it("builds document-archive/clean/<tenantId>/<documentId>/<versionId>/<fileId>", () => {
    expect(buildDocumentArchiveCleanKey("t1", "doc1", "ver-5", "file1")).toBe("document-archive/clean/t1/doc1/ver-5/file1");
  });
});

describe("advanceDocumentArchiveFileAfterEvidence — D-193 slice 1, real bug fix end-to-end", () => {
  it("PROMOTES: on the second evidence arriving, copies to clean, verifies, confirms CLEAN, deletes the quarantine object", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    const objects = fakeObjects();
    const outcome = await advanceDocumentArchiveFileAfterEvidence(
      { store, objects, ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET, now: () => "2026-09-01T00:02:00.000Z" },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedObject: OBJECT, malwareEvidence: { object: OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-09-01T00:02:00.000Z" } },
    );
    expect(outcome).toBe("PROMOTED");
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("CLEAN");
    expect(file.cleanObject).toEqual({ bucket: CLEAN_BUCKET, key: "document-archive/clean/t1/doc1/v-1/file1", versionId: "clean-v1" });
    const version = (await store.get(documentVersionKey(TENANT, DOC, SEQ))) as DocumentVersion;
    expect(version.pendingFileScans).toBe(0);
  });

  it("REJECTS on THREATS_FOUND without ever touching the object store", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    let copyCalled = false;
    const objects = fakeObjects({ copyObject: async (s, b, k) => { copyCalled = true; return { bucket: b, key: k, versionId: "clean-v1" }; } });
    const outcome = await advanceDocumentArchiveFileAfterEvidence(
      { store, objects, ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedObject: OBJECT, malwareEvidence: { object: OBJECT, status: "THREATS_FOUND", scanResultId: "s1", observedAt: "2026-09-01T00:02:00.000Z" } },
    );
    expect(outcome).toBe("REJECTED");
    expect(copyCalled).toBe(false);
  });

  it("D-193 tenant fence: rejects the confirm step for a non-ACTIVE tenant and compensates the orphaned clean-bucket copy", async () => {
    const store = new InMemoryDocumentArchiveStore([baseFile(), baseVersion()] as unknown as (Record<string, unknown> & EntityKey)[]); // no tenant lifecycle record
    let deletedClean: unknown;
    const objects = fakeObjects({ deleteObjectVersion: async (ref) => { deletedClean = ref; } });
    const outcome = await advanceDocumentArchiveFileAfterEvidence(
      { store, objects, ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedObject: OBJECT, malwareEvidence: { object: OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-09-01T00:02:00.000Z" } },
    );
    expect(outcome).toBe("IGNORED_TENANT_NOT_ACTIVE");
    expect(deletedClean).toEqual({ bucket: CLEAN_BUCKET, key: "document-archive/clean/t1/doc1/v-1/file1", versionId: "clean-v1" });
  });

  it("throws (never confirms CLEAN) when the clean-bucket copy fails verification, and compensates the orphaned copy", async () => {
    const store = seededStore([baseFile(), baseVersion()]);
    let deletedClean: unknown;
    const objects = fakeObjects({ headObject: async (ref) => (ref.bucket === CLEAN_BUCKET ? { contentLength: 999, mediaType: "application/pdf" } : { contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64) }), deleteObjectVersion: async (ref) => { deletedClean = ref; } });
    await expect(
      advanceDocumentArchiveFileAfterEvidence(
        { store, objects, ids: ids(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
        { tenantId: TENANT, documentId: DOC, seq: SEQ, fileId: FILE, observedObject: OBJECT, malwareEvidence: { object: OBJECT, status: "NO_THREATS_FOUND", scanResultId: "s1", observedAt: "2026-09-01T00:02:00.000Z" } },
      ),
    ).rejects.toThrow(/verification failed/);
    expect(deletedClean).toBeDefined();
    const file = (await store.get(documentFileKey(TENANT, DOC, SEQ, FILE))) as DocumentFile;
    expect(file.scanStatus).toBe("SCANNING"); // never claimed CLEAN.
  });
});
