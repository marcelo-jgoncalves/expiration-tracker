import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryImportStore, activeLifecycleRecord, FakeImportObjectStore } from "./in-memory-store.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { ImportService, type ImportCommitCommand } from "../../../src/modules/import/application/import-service.js";
import { importJobKey, type ImportJob, type ColumnMapping } from "../../../src/modules/import/domain/import-job.js";
import { ValidationError } from "../../../src/shared/errors/app-error.js";
import { defaultSchemaRegistry } from "../../../src/shared/contracts/schema-validator.js";
import { ConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { tenantQuotaKey, type TenantQuotaRecord } from "../../../src/modules/identity/application/quota.js";

const TENANT = "tenant-1";
const TABLE = "MainTable";
const RAW_BUCKET = "import-raw-bucket";
const VALID_SHA256 = "a".repeat(64);
const NOW = "2026-08-23T12:00:00.000Z";

function ctx(): RequestContext {
  return ctxFor(TENANT);
}

function ctxFor(tenantId: string): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId, roles: ["OWNER"] },
    auth: { issuedAt: NOW, expiresAt: "2026-08-23T13:00:00.000Z", tokenId: "jti-1" },
  };
}

describe("ImportService (M11, D-042)", () => {
  let store: InMemoryImportStore;
  let service: ImportService;
  let identityStore: InMemoryIdentityStore;
  let objectStore: FakeImportObjectStore;

  beforeEach(async () => {
    store = new InMemoryImportStore([activeLifecycleRecord(TENANT)]);
    identityStore = new InMemoryIdentityStore();
    // W3-07 fence (D-068/D-069 follow-up): quota.consume() now requires a
    // TenantLifecycleRecord to exist for the tenant.
    await identityStore.putIfAbsent({
      ...tenantLifecycleKey(TENANT),
      entityType: "TenantLifecycleRecord",
      tenantId: TENANT,
      status: "ACTIVE",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    });
    const quota = new TenantQuotaService(identityStore, "MainTable", () => NOW);
    let counter = 0;
    objectStore = new FakeImportObjectStore();
    service = new ImportService({
      store,
      tableName: TABLE,
      rawBucket: RAW_BUCKET,
      ids: { newImportJobId: () => `importjob-${++counter}` },
      signer: { presignUpload: async (input) => ({ uploadUrl: `https://s3.example/${input.key}`, requiredHeaders: {} }) },
      quota,
      objectStore,
      now: () => NOW,
    });
  });

  it("reserveImport creates a job in status UPLOADED and returns a presigned upload URL", async () => {
    const result = await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-1");
    expect(result.jobId).toBeTruthy();
    expect(result.uploadUrl).toContain(result.jobId);

    const job = await service.getImportJob(ctx(), result.jobId);
    expect(job.status).toBe("UPLOADED");
  });

  it("reserveImport is idempotent - the same Idempotency-Key returns the SAME jobId, never a second job", async () => {
    const first = await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-1");
    const second = await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-1");
    expect(second.jobId).toBe(first.jobId);

    const jobs = store.allItems().filter((i) => i["entityType"] === "ImportJob");
    expect(jobs).toHaveLength(1);
  });

  it("D-076/Codex-round-3 fix: a replayed reserveImport with the SAME Idempotency-Key does NOT consume quota a second time (idempotency.begin() now runs BEFORE quota.consume(), short-circuiting the replay before quota is ever touched)", async () => {
    await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-replay");
    await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-replay");
    await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-replay");

    const countQuota = await identityStore.get<TenantQuotaRecord>(tenantQuotaKey(TENANT, "IMPORT_COUNT", "current"));
    const bytesQuota = await identityStore.get<TenantQuotaRecord>(tenantQuotaKey(TENANT, "IMPORT_BYTES", "current"));
    expect(countQuota?.count).toBe(1);
    expect(bytesQuota?.count).toBe(1);
  });

  it("D-076/Codex-round-3 fix: a second concurrent caller reusing the SAME Idempotency-Key with a DIFFERENT request (genuine key-reuse conflict) never touches quota at all - it loses the race at idempotency.begin(), before quota.consume() is reached", async () => {
    await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-conflict");

    await expect(service.reserveImport(ctx(), { contentLength: 2048, checksumSha256: VALID_SHA256 }, "idem-conflict")).rejects.toThrow(
      /already in progress/i,
    );

    // Only the FIRST (winning) call's reservation is present - the losing caller leaked nothing.
    const countQuota = await identityStore.get<TenantQuotaRecord>(tenantQuotaKey(TENANT, "IMPORT_COUNT", "current"));
    const bytesQuota = await identityStore.get<TenantQuotaRecord>(tenantQuotaKey(TENANT, "IMPORT_BYTES", "current"));
    expect(countQuota?.count).toBe(1);
    expect(bytesQuota?.count).toBe(1);
  });

  it("getImportJob throws NotFoundError for an unknown jobId", async () => {
    await expect(service.getImportJob(ctx(), "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cross-tenant: tenant B cannot read or commit tenant A's real import job", async () => {
    const { jobId } = await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-cross-1");

    await expect(service.getImportJob(ctxFor("tenant-2"), jobId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.requestCommit(ctxFor("tenant-2"), jobId, 1)).rejects.toBeInstanceOf(NotFoundError);

    const stillThere = await service.getImportJob(ctx(), jobId);
    expect(stillThere.status).toBe("UPLOADED");
  });

  it("requestCommit throws ConflictError when the job is not PREVIEW_READY", async () => {
    const { jobId } = await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-1");
    await expect(service.requestCommit(ctx(), jobId, 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it("requestCommit writes a SELF-CONTAINED SQS_IMPORT_COMMIT_V1 outbox record - tenantId must survive since the relay/sweeper only forwards `payload` (== event.data), never the outer DomainEvent", async () => {
    const { jobId } = await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-1");
    const job = await store.get<ImportJob>(importJobKey(TENANT, jobId));
    await store.update<ImportJob>({ ...job!, status: "PREVIEW_READY" });

    await service.requestCommit(ctx(), jobId, job!.version);

    const outboxRecords = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
    expect(outboxRecords).toHaveLength(1);
    expect(outboxRecords[0]?.["destination"]).toBe("SQS_IMPORT_COMMIT_V1");

    const payload = outboxRecords[0]?.["payload"] as ImportCommitCommand;
    expect(payload.tenantId).toBe(TENANT);
    expect(payload.data.jobId).toBe(jobId);
    expect(payload.commandType).toBe("import.commit.v1");

    // A payload real teria que passar pela MESMA validação que o worker roda em produção.
    const { valid, errors } = defaultSchemaRegistry.validate("https://expiration-tracker/schemas/queues/import-commit.v1.json", payload);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);

    const updatedJob = await store.get<ImportJob>(importJobKey(TENANT, jobId));
    expect(updatedJob?.status).toBe("COMMITTING");
  });

  // W3-07 (D-070 chunk 8/N): the ImportJob creation Put (real admission point gating a NEW
  // presigned upload URL) now fences through TenantBusinessMutation.
  describe("W3-07 tenant lifecycle fence", () => {
    it("tenant ACTIVE -> reserveImport issues a presigned upload URL (control case)", async () => {
      const result = await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-active");
      expect(result.uploadUrl).toBeTruthy();
    });

    it("tenant DELETING -> reserveImport's ImportJob creation is rejected by the fence, no presign issued, no row left behind", async () => {
      const lifecycleKey = tenantLifecycleKey(TENANT);
      const existing = await store.get<{ PK: string; SK: string; version: number } & Record<string, unknown>>(lifecycleKey);
      await store.update({ ...existing, ...lifecycleKey, status: "DELETING", version: (existing?.version ?? 1) + 1 } as never);

      await expect(service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-deleting")).rejects.toThrow(/not ACTIVE/i);

      const jobs = store.allItems().filter((i) => i["entityType"] === "ImportJob");
      expect(jobs).toHaveLength(0);
    });

    it("D-076 item 3 mitigation: tenant DELETING -> reserveImport's fence rejection RELEASES the IMPORT_COUNT/IMPORT_BYTES quota consumed just before the fenced write, instead of leaking it for an admission that never happened", async () => {
      const lifecycleKey = tenantLifecycleKey(TENANT);
      const existing = await store.get<{ PK: string; SK: string; version: number } & Record<string, unknown>>(lifecycleKey);
      await store.update({ ...existing, ...lifecycleKey, status: "DELETING", version: (existing?.version ?? 1) + 1 } as never);

      await expect(service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-quota-release")).rejects.toThrow(
        /not ACTIVE/i,
      );

      const countQuota = await identityStore.get<TenantQuotaRecord>(tenantQuotaKey(TENANT, "IMPORT_COUNT", "current"));
      const bytesQuota = await identityStore.get<TenantQuotaRecord>(tenantQuotaKey(TENANT, "IMPORT_BYTES", "current"));
      // consume() ran once (count=1) before the fenced write rejected; release() must bring both
      // back to 0 - without the mitigation these would be stuck at 1 despite zero rows admitted.
      expect(countQuota?.count).toBe(0);
      expect(bytesQuota?.count).toBe(0);
    });

    it("D-076 item 3 mitigation: tenant DELETING -> reserveImport's fence rejection ABORTS the idempotency record, so a retry with the SAME Idempotency-Key succeeds (as a fresh reservation) once the tenant is ACTIVE again, instead of being stuck behind a permanently IN_PROGRESS key", async () => {
      const lifecycleKey = tenantLifecycleKey(TENANT);
      const deletingRecord = await store.get<{ PK: string; SK: string; version: number } & Record<string, unknown>>(lifecycleKey);
      await store.update({ ...deletingRecord, ...lifecycleKey, status: "DELETING", version: (deletingRecord?.version ?? 1) + 1 } as never);

      await expect(service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-retry-after-deleting")).rejects.toThrow(
        /not ACTIVE/i,
      );

      // Tenant recovers to ACTIVE (e.g. a mistaken/aborted deletion, or this is a fresh tenant
      // reusing a key namespace) - without abort(), begin() would see the stale IN_PROGRESS
      // record and throw ConcurrentOperationError forever, even though nothing was ever admitted.
      const activeAgain = await store.get<{ PK: string; SK: string; version: number } & Record<string, unknown>>(lifecycleKey);
      await store.update({ ...activeAgain, ...lifecycleKey, status: "ACTIVE", version: (activeAgain?.version ?? 1) + 1 } as never);

      const retry = await service.reserveImport(ctx(), { contentLength: 1024, checksumSha256: VALID_SHA256 }, "idem-retry-after-deleting");
      expect(retry.jobId).toBeTruthy();

      const job = await service.getImportJob(ctx(), retry.jobId);
      expect(job.status).toBe("UPLOADED");
    });
  });

  // D-192 slice 9 (bulk-import-documents-requirements-scoping/estado-final-consolidado.md §3):
  // GET /import-jobs/{jobId}/schema and POST /import-jobs/{jobId}/mapping.
  describe("getImportJobSchema / submitImportMapping (D-192 slice 9)", () => {
    function rawKey(tenantId: string, jobId: string): string {
      return `tenant/${tenantId}/imports/${jobId}/raw.csv`;
    }

    async function seedDocumentJob(jobId: string): Promise<ImportJob> {
      const job: ImportJob = {
        PK: `TENANT#${TENANT}#IMPORTJOB#${jobId}`,
        SK: "META",
        entityType: "ImportJob",
        jobId,
        tenantId: TENANT,
        targetEntityType: "Document",
        status: "AWAITING_MAPPING",
        createdByUserId: "user-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
      };
      await store.putIfAbsent(job);
      return job;
    }

    it("getImportJobSchema returns FIELD_CATALOG fields + sniffed headers/sample rows for a Document job", async () => {
      const jobId = "docjob-1";
      await seedDocumentJob(jobId);
      objectStore.seed(RAW_BUCKET, rawKey(TENANT, jobId), "Subject,Doc Type,Has Validity\nACME,Contract,true\n");

      const result = await service.getImportJobSchema(ctx(), jobId);
      expect(result.targetEntityType).toBe("Document");
      expect(result.fields.map((f) => f.field)).toContain("subjectRef");
      expect(result.headers).toEqual(["Subject", "Doc Type", "Has Validity"]);
      expect(result.sampleRows).toEqual([["ACME", "Contract", "true"]]);
    });

    it("getImportJobSchema throws ConflictError once the job is past AWAITING_MAPPING/UPLOADED", async () => {
      const jobId = "docjob-2";
      const job = await seedDocumentJob(jobId);
      await store.update<ImportJob>({ ...job, status: "PARSING" });
      await expect(service.getImportJobSchema(ctx(), jobId)).rejects.toBeInstanceOf(ConflictError);
    });

    it("submitImportMapping rejects a mapping whose targetKind does not match the job's targetEntityType", async () => {
      const jobId = "docjob-3";
      const job = await seedDocumentJob(jobId);
      objectStore.seed(RAW_BUCKET, rawKey(TENANT, jobId), "Subject,Doc Type,Has Validity\n");
      const mapping: ColumnMapping = { schemaVersion: 1, targetKind: "Requirement", columns: { subjectRef: "Subject", subjectRefKind: "EXTERNAL_ID", name: "Name" } };
      await expect(service.submitImportMapping(ctx(), jobId, mapping, job.version)).rejects.toBeInstanceOf(ValidationError);
    });

    it("submitImportMapping rejects a mapping referencing a column not present in the uploaded CSV header (G-V3: mapping-validation-rejects-mismatched-headers)", async () => {
      const jobId = "docjob-4";
      const job = await seedDocumentJob(jobId);
      objectStore.seed(RAW_BUCKET, rawKey(TENANT, jobId), "Subject,Doc Type,Has Validity\n");
      const mapping: ColumnMapping = {
        schemaVersion: 1,
        targetKind: "Document",
        columns: { subjectRef: "Subject", subjectRefKind: "EXTERNAL_ID", documentTypeRef: "Does Not Exist Column", documentTypeRefKind: "DISPLAY_NAME", hasValidity: "Has Validity" },
      };
      await expect(service.submitImportMapping(ctx(), jobId, mapping, job.version)).rejects.toBeInstanceOf(ValidationError);
    });

    it("submitImportMapping rejects a mapping missing a required field for the job's targetEntityType", async () => {
      const jobId = "docjob-5";
      const job = await seedDocumentJob(jobId);
      objectStore.seed(RAW_BUCKET, rawKey(TENANT, jobId), "Subject,Doc Type,Has Validity\n");
      const mapping = { schemaVersion: 1, targetKind: "Document", columns: { subjectRef: "Subject", subjectRefKind: "EXTERNAL_ID" } } as unknown as ColumnMapping;
      await expect(service.submitImportMapping(ctx(), jobId, mapping, job.version)).rejects.toBeInstanceOf(ValidationError);
    });

    it("submitImportMapping on a valid mapping transitions AWAITING_MAPPING->PARSING and dispatches SQS_IMPORT_PARSE_V1 in the SAME transaction", async () => {
      const jobId = "docjob-6";
      const job = await seedDocumentJob(jobId);
      objectStore.seed(RAW_BUCKET, rawKey(TENANT, jobId), "Subject,Doc Type,Has Validity\nACME,Contract,true\n");
      const mapping: ColumnMapping = {
        schemaVersion: 1,
        targetKind: "Document",
        columns: { subjectRef: "Subject", subjectRefKind: "EXTERNAL_ID", documentTypeRef: "Doc Type", documentTypeRefKind: "DISPLAY_NAME", hasValidity: "Has Validity" },
      };

      const result = await service.submitImportMapping(ctx(), jobId, mapping, job.version);
      expect(result.status).toBe("PARSING");

      const updated = await store.get<ImportJob>(importJobKey(TENANT, jobId));
      expect(updated?.status).toBe("PARSING");
      expect(updated?.columnMapping).toEqual(mapping);
      expect(updated?.columnMappingSha256).toBeTruthy();

      const outboxRecords = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
      expect(outboxRecords).toHaveLength(1);
      expect(outboxRecords[0]?.["destination"]).toBe("SQS_IMPORT_PARSE_V1");
      const payload = outboxRecords[0]?.["payload"] as { tenantId: string; jobId: string };
      expect(payload.tenantId).toBe(TENANT);
      expect(payload.jobId).toBe(jobId);
    });

    it("submitImportMapping on a job still UPLOADED (file not yet delivered) stays UPLOADED, mapping-only write, no outbox dispatch", async () => {
      const jobId = "docjob-7";
      const job: ImportJob = {
        PK: `TENANT#${TENANT}#IMPORTJOB#${jobId}`,
        SK: "META",
        entityType: "ImportJob",
        jobId,
        tenantId: TENANT,
        targetEntityType: "Document",
        status: "UPLOADED",
        createdByUserId: "user-1",
        expiresAt: "2099-01-01T00:00:00.000Z",
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
      };
      await store.putIfAbsent(job);
      // File genuinely hasn't arrived yet - objectStore has nothing seeded for this key.
      const mapping: ColumnMapping = {
        schemaVersion: 1,
        targetKind: "Document",
        columns: { subjectRef: "Subject", subjectRefKind: "EXTERNAL_ID", documentTypeRef: "Doc Type", documentTypeRefKind: "DISPLAY_NAME", hasValidity: "Has Validity" },
      };

      const result = await service.submitImportMapping(ctx(), jobId, mapping, job.version);
      expect(result.status).toBe("UPLOADED");

      const updated = await store.get<ImportJob>(importJobKey(TENANT, jobId));
      expect(updated?.status).toBe("UPLOADED");
      expect(updated?.columnMapping).toEqual(mapping);

      const outboxRecords = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
      expect(outboxRecords).toHaveLength(0);
    });

    // G-V3 adversarial: concurrent double-POST /mapping - one wins, the other loses the OCC claim.
    it("adversarial: two concurrent submitImportMapping calls with the SAME expectedVersion - exactly one wins, the loser gets ConflictError", async () => {
      const jobId = "docjob-8";
      const job = await seedDocumentJob(jobId);
      objectStore.seed(RAW_BUCKET, rawKey(TENANT, jobId), "Subject,Doc Type,Has Validity\nACME,Contract,true\n");
      const mapping: ColumnMapping = {
        schemaVersion: 1,
        targetKind: "Document",
        columns: { subjectRef: "Subject", subjectRefKind: "EXTERNAL_ID", documentTypeRef: "Doc Type", documentTypeRefKind: "DISPLAY_NAME", hasValidity: "Has Validity" },
      };

      const results = await Promise.allSettled([
        service.submitImportMapping(ctx(), jobId, mapping, job.version),
        service.submitImportMapping(ctx(), jobId, mapping, job.version),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

      // Only ONE outbox record was ever produced - the loser never got far enough to dispatch.
      const outboxRecords = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
      expect(outboxRecords).toHaveLength(1);
    });
  });
});
