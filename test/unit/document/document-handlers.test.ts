/** Exercises the REAL defaultSchemaRegistry every Lambda imports (same regression pattern as
 * notification/preferences-handlers.test.ts, which caught a real production bug: a schema
 * added to disk but never registered in the static import list). */
import { describe, expect, it, vi } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator } from "../identity/in-memory-store.js";
import { InMemoryDocumentStore } from "./in-memory-store.js";
import { IdentityMappingRepository } from "../../../src/modules/identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { DocumentService } from "../../../src/modules/document/application/document-service.js";
import { DocumentDeletionService } from "../../../src/modules/document/application/document-deletion-service.js";
import { handleDeleteDocument, handleGetDocument, handleListDocuments, handleReserveUpload, type DocumentHttpDeps } from "../../../src/modules/document/http/document-handlers.js";
import * as securityAudit from "../../../src/shared/observability/security-audit.js";

const TABLE = "MainTable";
const BUCKET = "quarantine-bucket";
const VALID_SHA256 = "a".repeat(64);

function buildDeps(): DocumentHttpDeps {
  const identityStore = new InMemoryIdentityStore();
  const resolver = new RequestContextResolver(new IdentityMappingRepository(identityStore), new UserRepository(identityStore), makeIdGenerator(), identityStore, TABLE);
  const quota = new TenantQuotaService(identityStore);
  const documentStore = new InMemoryDocumentStore();
  const documents = new DocumentService({
    store: documentStore,
    tableName: TABLE,
    quarantineBucket: BUCKET,
    ids: { newDocumentId: () => "doc-1", newUploadSlotId: () => "slot-1" },
    signer: { presignUpload: async (input) => ({ uploadUrl: `https://s3.example/${input.key}`, requiredHeaders: {} }) },
  });
  const deletion = new DocumentDeletionService({ store: documentStore, tableName: TABLE });
  return { resolver, documents, deletion, quota };
}

function claims(overrides: Partial<ValidatedClaims> = {}): ValidatedClaims {
  return { sub: "cognito-sub-1", tokenId: "jti-1", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides };
}

describe("document-handlers.ts - real defaultSchemaRegistry wiring", () => {
  it("handleReserveUpload accepts a valid body through the REAL schema registry every Lambda imports", async () => {
    const deps = buildDeps();
    const response = await handleReserveUpload(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      pathParameters: { itemId: "item1" },
      headers: { "idempotency-key": "idem-1" },
      body: { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 1000, checksumSha256: VALID_SHA256 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body["documentId"]).toBeTruthy();
    expect(response.body["uploadUrl"]).toBeTruthy();
  });

  it("handleReserveUpload rejects a body that fails schema validation (extra unknown field)", async () => {
    const deps = buildDeps();
    const response = await handleReserveUpload(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      pathParameters: { itemId: "item1" },
      headers: { "idempotency-key": "idem-1" },
      body: { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 1000, checksumSha256: VALID_SHA256, unexpected: "nope" } as never,
    });
    expect(response.statusCode).toBe(400);
  });

  it("handleReserveUpload requires an Idempotency-Key header", async () => {
    const deps = buildDeps();
    const response = await handleReserveUpload(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      pathParameters: { itemId: "item1" },
      body: { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 1000, checksumSha256: VALID_SHA256 },
    });
    expect(response.statusCode).toBe(400);
  });

  it("handleDeleteDocument returns 404 for a document that doesn't exist", async () => {
    const deps = buildDeps();
    const response = await handleDeleteDocument(deps, { requestId: "r1", correlationId: "c1", claims: claims(), pathParameters: { itemId: "item1", documentId: "missing" } });
    expect(response.statusCode).toBe(404);
  });

  it("emits exactly one security.authorization_denied event on a real authorize() denial, without changing the 403 response", async () => {
    const auditSpy = vi.spyOn(securityAudit, "auditAuthorizationDenied");
    const deps = buildDeps();
    const noRoleResolver = {
      resolve: async () => ({ tenant: { tenantId: "tenant-x", roles: [] }, principal: { userId: "user-x" }, requestId: "r1" }),
    } as unknown as DocumentHttpDeps["resolver"];

    const response = await handleReserveUpload(
      { ...deps, resolver: noRoleResolver },
      { requestId: "r1", correlationId: "c1", claims: claims(), pathParameters: { itemId: "item1" }, headers: { "idempotency-key": "idem-2" }, body: { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 1000, checksumSha256: VALID_SHA256 } },
    );

    expect(response.statusCode).toBe(403);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith({ reason: "NO_MEMBERSHIP", action: "document:reserve-upload" });
    auditSpy.mockRestore();
  });

  it("handleGetDocument returns the reserved document (BLOCKER-A)", async () => {
    const deps = buildDeps();
    const reserved = await handleReserveUpload(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      pathParameters: { itemId: "item1" },
      headers: { "idempotency-key": "idem-get-1" },
      body: { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 1000, checksumSha256: VALID_SHA256 },
    });
    const response = await handleGetDocument(deps, { requestId: "r1", correlationId: "c1", claims: claims(), pathParameters: { itemId: "item1", documentId: reserved.body["documentId"] as string } });
    expect(response.statusCode).toBe(200);
    expect(response.body["documentId"]).toBe(reserved.body["documentId"]);
  });

  it("handleGetDocument returns 404 for a document that doesn't exist (BLOCKER-A)", async () => {
    const deps = buildDeps();
    const response = await handleGetDocument(deps, { requestId: "r1", correlationId: "c1", claims: claims(), pathParameters: { itemId: "item1", documentId: "missing" } });
    expect(response.statusCode).toBe(404);
  });

  it("handleListDocuments returns every document reserved under the item (BLOCKER-A)", async () => {
    const deps = buildDeps();
    await handleReserveUpload(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      pathParameters: { itemId: "item1" },
      headers: { "idempotency-key": "idem-list-1" },
      body: { fileName: "a.pdf", mediaType: "application/pdf", contentLength: 1000, checksumSha256: VALID_SHA256 },
    });
    const response = await handleListDocuments(deps, { requestId: "r1", correlationId: "c1", claims: claims(), pathParameters: { itemId: "item1" } });
    expect(response.statusCode).toBe(200);
    expect((response.body["documents"] as unknown[]).length).toBe(1);
  });

  it("handleListDocuments returns an empty list for an item with no documents (BLOCKER-A)", async () => {
    const deps = buildDeps();
    const response = await handleListDocuments(deps, { requestId: "r1", correlationId: "c1", claims: claims(), pathParameters: { itemId: "item-empty" } });
    expect(response.statusCode).toBe(200);
    expect(response.body["documents"]).toEqual([]);
  });
});
