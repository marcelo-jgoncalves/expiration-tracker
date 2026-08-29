import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryImportStore, activeLifecycleRecord } from "./in-memory-store.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { ImportService, type ImportCommitCommand } from "../../../src/modules/import/application/import-service.js";
import { importJobKey, type ImportJob } from "../../../src/modules/import/domain/import-job.js";
import { defaultSchemaRegistry } from "../../../src/shared/contracts/schema-validator.js";
import { ConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

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

  beforeEach(async () => {
    store = new InMemoryImportStore([activeLifecycleRecord(TENANT)]);
    const identityStore = new InMemoryIdentityStore();
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
    service = new ImportService({
      store,
      tableName: TABLE,
      rawBucket: RAW_BUCKET,
      ids: { newImportJobId: () => `importjob-${++counter}` },
      signer: { presignUpload: async (input) => ({ uploadUrl: `https://s3.example/${input.key}`, requiredHeaders: {} }) },
      quota,
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
  });
});
