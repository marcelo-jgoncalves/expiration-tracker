/** Exercises the REAL defaultSchemaRegistry every Lambda imports (same regression pattern as
 * document/http/document-handlers.test.ts - a schema added to disk but never registered in
 * the static import list would otherwise go unnoticed until a real Lambda cold start). */
import { describe, expect, it } from "vitest";
import { InMemoryImportStore, activeLifecycleRecord } from "./in-memory-store.js";
import { InMemoryIdentityStore, makeIdGenerator, bootstrapWithOrganization } from "../identity/in-memory-store.js";
import { InMemoryOrganizationStore } from "../organization/in-memory-store.js";
import { GlobalUserRepository } from "../../../src/modules/identity/persistence/global-user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { ImportService } from "../../../src/modules/import/application/import-service.js";
import type { ImportJob } from "../../../src/modules/import/domain/import-job.js";
import { handleGetImportJob, handleReserveImport, handleRequestImportCommit, type ImportHttpDeps } from "../../../src/modules/import/http/import-handlers.js";

const TABLE = "MainTable";
const RAW_BUCKET = "import-raw-bucket";
const VALID_SHA256 = "a".repeat(64);
const NOW = "2026-08-23T12:00:00.000Z";

// W3-07 (D-070 chunk 8/N): ImportService.reserveImport's job creation now fences its own
// transactWrite via TenantBusinessMutation, which reads TenantLifecycleRecord from the
// ImportStore's OWN map - a real DynamoDB table shares the record with identityStore's
// bootstrap write, but these two in-memory fakes are separate Maps. Pre-resolving the default
// `claims()` identity once (same idempotent login every test already relies on) lets us learn
// the bootstrapped tenantId and mirror the ACTIVE lifecycle record into the ImportStore too.
async function buildDeps(): Promise<{ deps: ImportHttpDeps; store: InMemoryImportStore }> {
  const identityStore = new InMemoryIdentityStore();
  const organizations = new InMemoryOrganizationStore();
  // Wave B2B-5 (D-095): bootstrapUser() no longer auto-provisions a tenant - seed a real
  // Organization+Membership for "cognito-sub-1" before resolve() can succeed below.
  await bootstrapWithOrganization(identityStore, organizations, TABLE, "cognito-sub-1");
  const resolver = new RequestContextResolver(new GlobalUserRepository(identityStore), organizations, makeIdGenerator(), identityStore, TABLE);
  const quota = new TenantQuotaService(identityStore, TABLE);
  const bootstrapped = await resolver.resolve({ claims: claims(), requestId: "bootstrap", correlationId: "bootstrap", organizationIdHint: undefined });
  const store = new InMemoryImportStore([activeLifecycleRecord(bootstrapped.tenant.tenantId)]);
  let counter = 0;
  const imports = new ImportService({
    store,
    tableName: TABLE,
    rawBucket: RAW_BUCKET,
    ids: { newImportJobId: () => `importjob-${++counter}` },
    signer: { presignUpload: async (input) => ({ uploadUrl: `https://s3.example/${input.key}`, requiredHeaders: {} }) },
    quota,
    now: () => NOW,
  });
  return { deps: { resolver, imports, quota }, store };
}

function claims(overrides: Partial<ValidatedClaims> = {}): ValidatedClaims {
  return { sub: "cognito-sub-1", tokenId: "jti-1", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides };
}

describe("import-handlers.ts - real defaultSchemaRegistry wiring", () => {
  it("handleReserveImport accepts a valid body through the REAL schema registry every Lambda imports", async () => {
    const { deps } = await buildDeps();
    const response = await handleReserveImport(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      headers: { "idempotency-key": "idem-1" },
      body: { contentLength: 1000, checksumSha256: VALID_SHA256 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body["jobId"]).toBeTruthy();
    expect(response.body["uploadUrl"]).toBeTruthy();
  });

  it("handleReserveImport rejects a body that fails schema validation (extra unknown field)", async () => {
    const { deps } = await buildDeps();
    const response = await handleReserveImport(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      headers: { "idempotency-key": "idem-1" },
      body: { contentLength: 1000, checksumSha256: VALID_SHA256, unexpected: "nope" } as never,
    });
    expect(response.statusCode).toBe(400);
  });

  it("handleReserveImport requires an Idempotency-Key header", async () => {
    const { deps } = await buildDeps();
    const response = await handleReserveImport(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      body: { contentLength: 1000, checksumSha256: VALID_SHA256 },
    });
    expect(response.statusCode).toBe(400);
  });

  it("handleGetImportJob returns 404 for an unknown jobId", async () => {
    const { deps } = await buildDeps();
    const response = await handleGetImportJob(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      pathParameters: { jobId: "does-not-exist" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("handleGetImportJob returns the job for a known jobId", async () => {
    const { deps } = await buildDeps();
    const reserved = await handleReserveImport(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      headers: { "idempotency-key": "idem-1" },
      body: { contentLength: 1000, checksumSha256: VALID_SHA256 },
    });
    const jobId = reserved.body["jobId"] as string;

    const response = await handleGetImportJob(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      pathParameters: { jobId },
    });
    expect(response.statusCode).toBe(200);
    expect((response.body["job"] as ImportJob).jobId).toBe(jobId);
  });

  it("handleRequestImportCommit requires an If-Match header", async () => {
    const { deps } = await buildDeps();
    const response = await handleRequestImportCommit(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      pathParameters: { jobId: "job-1" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("handleRequestImportCommit returns 409 when the job is not yet PREVIEW_READY", async () => {
    const { deps } = await buildDeps();
    // reserveImport leaves the job in status UPLOADED, never PREVIEW_READY (only the parse
    // worker advances it there) - exactly the precondition this handler must reject.
    const reserved = await handleReserveImport(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      headers: { "idempotency-key": "idem-1" },
      body: { contentLength: 1000, checksumSha256: VALID_SHA256 },
    });
    const jobId = reserved.body["jobId"] as string;

    const response = await handleRequestImportCommit(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      pathParameters: { jobId },
      headers: { "if-match": "1" },
    });
    expect(response.statusCode).toBe(409);
  });
});
