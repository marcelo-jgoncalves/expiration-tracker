/** storage-quota-scoping (D-2xx, docs/architecture/reviews/storage-quota-scoping/). Covers:
 * (1) the pure projection/enforcement functions in domain/storage-quota.ts, (2) reserveFiles()
 * blocking/allowing uploads against the quota with reservedBytes accounted for, (3)
 * confirmFileScanClean() moving reservedBytes -> usedBytes, (4) applyFileScanResult's REJECT
 * branch and applyFileScanTimeout releasing reservedBytes, (5) RBAC on the read route
 * (getStorageQuotaUsage). Same fixture conventions as document-archive-service.test.ts /
 * review-queue.test.ts / apply-file-scan-result.test.ts. */
import { describe, expect, it } from "vitest";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import { applyFileScanResult, applyFileScanTimeout, confirmFileScanClean, type ApplyFileScanResultDeps } from "../../../src/modules/document-archive/application/apply-file-scan-result.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore, seedActiveDocumentType, seedActiveTenantLifecycle, seedActiveTrackedSubject } from "./in-memory-store.js";
import { QuotaExceededError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { UploadUrlSigner } from "../../../src/modules/document/ports/upload-url-signer.js";
import {
  defaultStorageQuota,
  projectStorageQuotaUsage,
  storageQuotaKey,
  wouldExceedStorageQuota,
  DEFAULT_STORAGE_QUOTA_BYTES,
  type TenantStorageQuota,
} from "../../../src/modules/document-archive/domain/storage-quota.js";

const TENANT = authorizedTenantIdFromPersistedEntity({ tenantId: "tenant-1" });
const NOW = "2026-09-09T00:00:00.000Z";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "tenant-1", roles: ["MEMBER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

function makeIds(): DocumentArchiveIdGenerator {
  let n = 0;
  return {
    newDocumentId: () => `doc-${++n}`,
    newVersionId: () => `ver-${++n}`,
    newEventId: () => `evt-${++n}`,
    newRequirementId: () => `req-${++n}`,
    newSeriesId: () => `series-${++n}`,
    newDocumentRequestId: () => `docreq-${++n}`,
    newFileId: () => `file-${++n}`,
    newDocumentTypeId: () => `doctype-${++n}`,
    newRequirementTemplateId: () => "reqtpl_test",
    newRequirementTemplateItemId: () => `reqtplitem_${crypto.randomUUID()}`,
    newDossierExportRunId: () => `dossier_${crypto.randomUUID()}`,
    newDocumentTypeFieldId: () => `doctypefield_${crypto.randomUUID()}`,
    newDocumentTypeFieldOptionId: () => `doctypefieldopt_${crypto.randomUUID()}`,
    newShareId: () => `share_${crypto.randomUUID()}`,
  };
}

function makeSigner(): UploadUrlSigner {
  return { presignUpload: async (input) => ({ uploadUrl: `https://s3.example/${input.bucket}/${input.key}?sig=fake`, requiredHeaders: {} }) };
}

function makeService(store: InMemoryDocumentArchiveStore) {
  return new DocumentArchiveService({
    store,
    tableName: "test-table",
    ids: makeIds(),
    quarantineBucket: "test-quarantine-bucket",
    signer: makeSigner(),
    members: { isEligibleMember: async () => true },
    now: () => NOW,
  });
}

function baseStore(extra: (Record<string, unknown> & { PK: string; SK: string })[] = []) {
  return new InMemoryDocumentArchiveStore([
    seedActiveDocumentType(TENANT, "ALVARA"),
    seedActiveTenantLifecycle(TENANT),
    seedActiveTrackedSubject(TENANT, "s1"),
    ...extra,
  ]);
}

function seedQuota(overrides: Partial<TenantStorageQuota> = {}): Record<string, unknown> & { PK: string; SK: string } {
  return { ...defaultStorageQuota(TENANT, NOW), ...overrides } as unknown as Record<string, unknown> & { PK: string; SK: string };
}

describe("storage-quota domain — pure functions", () => {
  it("defaultStorageQuota() starts at zero usage with the documented default limit", () => {
    const quota = defaultStorageQuota(TENANT, NOW);
    expect(quota.limitBytes).toBe(DEFAULT_STORAGE_QUOTA_BYTES);
    expect(quota.usedBytes).toBe(0);
    expect(quota.reservedBytes).toBe(0);
  });

  it("projectStorageQuotaUsage reports OK well under the warning threshold", () => {
    const usage = projectStorageQuotaUsage({ limitBytes: 1000, usedBytes: 100, reservedBytes: 0 });
    expect(usage.warningLevel).toBe("OK");
    expect(usage.availableBytes).toBe(900);
    expect(usage.usedPercent).toBeCloseTo(0.1);
  });

  it("projectStorageQuotaUsage reports WARNING at/above 80% committed (usedBytes+reservedBytes)", () => {
    const usage = projectStorageQuotaUsage({ limitBytes: 1000, usedBytes: 750, reservedBytes: 50 });
    expect(usage.warningLevel).toBe("WARNING");
  });

  it("projectStorageQuotaUsage reports CRITICAL at/above 95% committed", () => {
    const usage = projectStorageQuotaUsage({ limitBytes: 1000, usedBytes: 950, reservedBytes: 0 });
    expect(usage.warningLevel).toBe("CRITICAL");
  });

  it("projectStorageQuotaUsage reports OVER once committed bytes reach the limit, availableBytes floors at zero", () => {
    const usage = projectStorageQuotaUsage({ limitBytes: 1000, usedBytes: 1000, reservedBytes: 0 });
    expect(usage.warningLevel).toBe("OVER");
    expect(usage.availableBytes).toBe(0);
  });

  it("wouldExceedStorageQuota accounts for BOTH usedBytes and reservedBytes, not usedBytes alone — closes the oversubscription gap", () => {
    // usedBytes alone (500) would fit 400 more under a 1000 limit, but reservedBytes (400)
    // already in-flight means only 100 more actually fits.
    expect(wouldExceedStorageQuota({ limitBytes: 1000, usedBytes: 500, reservedBytes: 400 }, 100)).toBe(false);
    expect(wouldExceedStorageQuota({ limitBytes: 1000, usedBytes: 500, reservedBytes: 400 }, 101)).toBe(true);
  });
});

describe("DocumentArchiveService.reserveFiles — storage quota enforcement", () => {
  it("allows a reservation comfortably under quota and increments reservedBytes (not usedBytes)", async () => {
    const store = baseStore([seedQuota({ limitBytes: 1_000_000 })]);
    const service = makeService(store);
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const draft = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");

    await service.reserveFiles(ctx(), doc.documentId, draft.seq, draft.version, [{ role: "PRINCIPAL", mediaType: "application/pdf", contentLength: 500_000, checksumSha256: "a".repeat(64) }]);

    const quota = await store.get<TenantStorageQuota>(storageQuotaKey(TENANT));
    expect(quota?.reservedBytes).toBe(500_000);
    expect(quota?.usedBytes).toBe(0);
  });

  it("hard-blocks (QuotaExceededError) a reservation that would push committed bytes over the limit — fail closed", async () => {
    const store = baseStore([seedQuota({ limitBytes: 1000, usedBytes: 900 })]);
    const service = makeService(store);
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const draft = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");

    await expect(
      service.reserveFiles(ctx(), doc.documentId, draft.seq, draft.version, [{ role: "PRINCIPAL", mediaType: "application/pdf", contentLength: 200, checksumSha256: "a".repeat(64) }]),
    ).rejects.toThrow(QuotaExceededError);

    // No DocumentFile row should have been created and no presigned URL issued for a rejected batch.
    const quota = await store.get<TenantStorageQuota>(storageQuotaKey(TENANT));
    expect(quota?.reservedBytes).toBe(0);
  });

  it("blocks a reservation that fits under usedBytes alone but not once reservedBytes (an in-flight upload) is counted", async () => {
    const store = baseStore([seedQuota({ limitBytes: 1000, usedBytes: 100, reservedBytes: 850 })]);
    const service = makeService(store);
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const draft = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");

    await expect(
      service.reserveFiles(ctx(), doc.documentId, draft.seq, draft.version, [{ role: "PRINCIPAL", mediaType: "application/pdf", contentLength: 60, checksumSha256: "a".repeat(64) }]),
    ).rejects.toThrow(QuotaExceededError);
  });

  it("auto-provisions a default quota row on first use (no pre-seeded TenantStorageQuota)", async () => {
    const store = baseStore();
    const service = makeService(store);
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const draft = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");

    await service.reserveFiles(ctx(), doc.documentId, draft.seq, draft.version, [{ role: "PRINCIPAL", mediaType: "application/pdf", contentLength: 10, checksumSha256: "a".repeat(64) }]);
    const quota = await store.get<TenantStorageQuota>(storageQuotaKey(TENANT));
    expect(quota?.limitBytes).toBe(DEFAULT_STORAGE_QUOTA_BYTES);
    expect(quota?.reservedBytes).toBe(10);
  });
});

describe("confirmFileScanClean / applyFileScanResult — storage quota lifecycle accounting", () => {
  function scanDeps(store: InMemoryDocumentArchiveStore): ApplyFileScanResultDeps {
    return { store, tableName: "test-table", ids: makeIds(), now: () => NOW };
  }

  async function reserveOneFile(service: DocumentArchiveService, store: InMemoryDocumentArchiveStore, contentLength: number) {
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const draft = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
    const [reserved] = await service.reserveFiles(ctx(), doc.documentId, draft.seq, draft.version, [{ role: "PRINCIPAL", mediaType: "application/pdf", contentLength, checksumSha256: "a".repeat(64) }]);
    return { documentId: doc.documentId, seq: draft.seq, file: reserved!.file };
  }

  it("confirmFileScanClean moves the file's bytes from reservedBytes to usedBytes (net zero to the committed total)", async () => {
    const store = baseStore([seedQuota({ limitBytes: 1_000_000 })]);
    const service = makeService(store);
    const { documentId, seq, file } = await reserveOneFile(service, store, 12_345);

    const outcome = await confirmFileScanClean(scanDeps(store), {
      tenantId: TENANT,
      documentId,
      seq,
      fileId: file.fileId,
      cleanObject: { bucket: "clean-bucket", key: "clean-key", versionId: "v1" },
    });
    expect(outcome).toBe("CONFIRMED");

    const quota = await store.get<TenantStorageQuota>(storageQuotaKey(TENANT));
    expect(quota?.usedBytes).toBe(12_345);
    expect(quota?.reservedBytes).toBe(0);
  });

  it("a REJECTED file (invalid upload evidence) releases its reservedBytes without ever touching usedBytes", async () => {
    const store = baseStore([seedQuota({ limitBytes: 1_000_000 })]);
    const service = makeService(store);
    const { documentId, seq, file } = await reserveOneFile(service, store, 5_000);

    const outcome = await applyFileScanResult(scanDeps(store), {
      tenantId: TENANT,
      documentId,
      seq,
      fileId: file.fileId,
      observedObject: file.quarantineObject,
      uploadEvidence: { valid: false, object: file.quarantineObject, contentLength: 5_000, mediaType: file.mediaType, checksumSha256: file.checksumSha256, observedAt: NOW },
    });
    expect(outcome.outcome).toBe("REJECTED");

    const quota = await store.get<TenantStorageQuota>(storageQuotaKey(TENANT));
    expect(quota?.reservedBytes).toBe(0);
    expect(quota?.usedBytes).toBe(0);
  });

  it("applyFileScanTimeout also releases reservedBytes for a file that never got physical evidence", async () => {
    const store = baseStore([seedQuota({ limitBytes: 1_000_000 })]);
    const service = makeService(store);
    const { documentId, seq, file } = await reserveOneFile(service, store, 7_000);
    const quotaAfterReserve = await store.get<TenantStorageQuota>(storageQuotaKey(TENANT));
    expect(quotaAfterReserve?.reservedBytes).toBe(7_000);
    expect(file.GSI8PK).toBeDefined();
    expect(file.GSI8SK).toBeDefined();

    const outcome = await applyFileScanTimeout(scanDeps(store), {
      tenantId: TENANT,
      documentId,
      seq,
      fileId: file.fileId,
      observedGsi8Pointer: { GSI8PK: file.GSI8PK!, GSI8SK: file.GSI8SK! },
    });
    expect(outcome).toBe("TIMED_OUT");
    const quota = await store.get<TenantStorageQuota>(storageQuotaKey(TENANT));
    expect(quota?.reservedBytes).toBe(0);
    expect(quota?.usedBytes).toBe(0);
  });
});

describe("DocumentArchiveService.getStorageQuotaUsage — RBAC + projection", () => {
  it("rejects a caller with no roles (AuthorizationDeniedError) — same docarchive:read tier as listReviewQueue", async () => {
    const store = baseStore([seedQuota({ limitBytes: 1000, usedBytes: 100 })]);
    const service = makeService(store);
    await expect(service.getStorageQuotaUsage(ctx({ tenant: { tenantId: "tenant-1", roles: [] } }))).rejects.toThrow(AuthorizationDeniedError);
  });

  it("VIEWER (READ_ONLY_ROLES) can read storage usage, matching every other tenant-wide summary's tier", async () => {
    const store = baseStore([seedQuota({ limitBytes: 1000, usedBytes: 300, reservedBytes: 100 })]);
    const service = makeService(store);
    const usage = await service.getStorageQuotaUsage(ctx({ tenant: { tenantId: "tenant-1", roles: ["VIEWER"] } }));
    expect(usage.limitBytes).toBe(1000);
    expect(usage.usedBytes).toBe(300);
    expect(usage.reservedBytes).toBe(100);
    expect(usage.availableBytes).toBe(600);
  });

  it("auto-provisions the default quota on first read (no upload ever happened for this tenant)", async () => {
    const store = baseStore();
    const service = makeService(store);
    const usage = await service.getStorageQuotaUsage(ctx());
    expect(usage.limitBytes).toBe(DEFAULT_STORAGE_QUOTA_BYTES);
    expect(usage.usedBytes).toBe(0);
    expect(usage.warningLevel).toBe("OK");
  });
});
