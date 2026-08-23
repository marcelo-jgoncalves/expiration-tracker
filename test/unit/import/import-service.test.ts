import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryImportStore } from "./in-memory-store.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { ImportService, type ImportCommitCommand } from "../../../src/modules/import/application/import-service.js";
import { importJobKey, type ImportJob } from "../../../src/modules/import/domain/import-job.js";
import { defaultSchemaRegistry } from "../../../src/shared/contracts/schema-validator.js";
import { ConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

const TENANT = "tenant-1";
const TABLE = "MainTable";
const RAW_BUCKET = "import-raw-bucket";
const VALID_SHA256 = "a".repeat(64);
const NOW = "2026-08-23T12:00:00.000Z";

function ctx(): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: TENANT, roles: ["OWNER"] },
    auth: { issuedAt: NOW, expiresAt: "2026-08-23T13:00:00.000Z", tokenId: "jti-1" },
  };
}

describe("ImportService (M11, D-042)", () => {
  let store: InMemoryImportStore;
  let service: ImportService;

  beforeEach(() => {
    store = new InMemoryImportStore();
    const quota = new TenantQuotaService(new InMemoryIdentityStore(), () => NOW);
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
});
