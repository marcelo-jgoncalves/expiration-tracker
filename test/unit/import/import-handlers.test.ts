/** Exercises the REAL defaultSchemaRegistry every Lambda imports (same regression pattern as
 * document/http/document-handlers.test.ts - a schema added to disk but never registered in
 * the static import list would otherwise go unnoticed until a real Lambda cold start). */
import { describe, expect, it } from "vitest";
import { InMemoryImportStore } from "./in-memory-store.js";
import { InMemoryIdentityStore, makeIdGenerator } from "../identity/in-memory-store.js";
import { IdentityMappingRepository } from "../../../src/modules/identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { ImportService } from "../../../src/modules/import/application/import-service.js";
import type { ImportJob } from "../../../src/modules/import/domain/import-job.js";
import { handleGetImportJob, handleReserveImport, handleRequestImportCommit, type ImportHttpDeps } from "../../../src/modules/import/http/import-handlers.js";

const TABLE = "MainTable";
const RAW_BUCKET = "import-raw-bucket";
const VALID_SHA256 = "a".repeat(64);
const NOW = "2026-08-23T12:00:00.000Z";

function buildDeps(): { deps: ImportHttpDeps; store: InMemoryImportStore } {
  const identityStore = new InMemoryIdentityStore();
  const resolver = new RequestContextResolver(new IdentityMappingRepository(identityStore), new UserRepository(identityStore), makeIdGenerator());
  const quota = new TenantQuotaService(identityStore);
  const store = new InMemoryImportStore();
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
    const { deps } = buildDeps();
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
    const { deps } = buildDeps();
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
    const { deps } = buildDeps();
    const response = await handleReserveImport(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      body: { contentLength: 1000, checksumSha256: VALID_SHA256 },
    });
    expect(response.statusCode).toBe(400);
  });

  it("handleGetImportJob returns 404 for an unknown jobId", async () => {
    const { deps } = buildDeps();
    const response = await handleGetImportJob(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      pathParameters: { jobId: "does-not-exist" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("handleGetImportJob returns the job for a known jobId", async () => {
    const { deps } = buildDeps();
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
    const { deps } = buildDeps();
    const response = await handleRequestImportCommit(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      pathParameters: { jobId: "job-1" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("handleRequestImportCommit returns 409 when the job is not yet PREVIEW_READY", async () => {
    const { deps } = buildDeps();
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
