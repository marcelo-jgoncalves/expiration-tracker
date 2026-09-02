/**
 * D-173/item 5 exit criterion: the DocumentType catalog CRUD service methods (D-174) are
 * actually reachable over HTTP, not just unit-tested application-layer methods — same
 * end-to-end-via-real-handlers convention as document-archive-lifecycle.test.ts. Proves both
 * halves of G-V3 for this route family: RBAC actually denies a non-ADMIN write and a
 * malformed body is rejected with 400 (never a 500 "Unknown schema $id", the exact bug class
 * D-167's handoff names for a schema registered but never statically imported).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator, bootstrapWithOrganization } from "../unit/identity/in-memory-store.js";
import { InMemoryOrganizationStore } from "../unit/organization/in-memory-store.js";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle } from "../unit/document-archive/in-memory-store.js";
import { GlobalUserRepository } from "../../src/modules/identity/persistence/global-user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../src/modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../src/modules/identity/application/quota.js";
import { DocumentArchiveService } from "../../src/modules/document-archive/application/document-archive-service.js";
import { DocumentRequestRecurrenceService } from "../../src/modules/document-archive/application/document-request-recurrence-service.js";
import {
  handleCreateDocumentType,
  handleGetDocumentType,
  handleListDocumentTypes,
  handleRenameDocumentType,
  handleDeprecateDocumentType,
  handleReactivateDocumentType,
  type DocumentArchiveHttpDeps,
} from "../../src/modules/document-archive/http/document-archive-handlers.js";
import type { UploadUrlSigner } from "../../src/modules/document/ports/upload-url-signer.js";

function claims(sub: string): ValidatedClaims {
  return { sub, tokenId: `jti-${sub}`, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
}

let idCounter = 0;
function makeIds() {
  return {
    newDocumentId: () => `doc-${++idCounter}`,
    newVersionId: () => `ver-${++idCounter}`,
    newEventId: () => `evt-${++idCounter}`,
    newRequirementId: () => `req-${++idCounter}`,
    newSeriesId: () => `series-${++idCounter}`,
    newDocumentRequestId: () => `docreq-${++idCounter}`,
    newFileId: () => `file-${++idCounter}`,
    newDocumentTypeId: () => `doctype-${++idCounter}`,
  };
}

const noopSigner: UploadUrlSigner = { presignUpload: async () => ({ uploadUrl: "https://s3.example/unused", requiredHeaders: {} }) };

describe("DocumentType catalog HTTP routes (D-173/item 5)", () => {
  let deps: DocumentArchiveHttpDeps;
  let req: { requestId: string; correlationId: string; claims: ValidatedClaims };

  beforeEach(async () => {
    const identityStore = new InMemoryIdentityStore();
    const organizations = new InMemoryOrganizationStore();
    const resolver = new RequestContextResolver(new GlobalUserRepository(identityStore), organizations, makeIdGenerator(), identityStore, "MainTable");
    const quota = new TenantQuotaService(identityStore, "MainTable");

    const store = new InMemoryDocumentArchiveStore();
    const documentArchive = new DocumentArchiveService({ store, tableName: "MainTable", ids: makeIds(), quarantineBucket: "test-quarantine-bucket", signer: noopSigner });
    const recurrence = new DocumentRequestRecurrenceService({ store, tableName: "MainTable", ids: makeIds() });
    deps = { resolver, documentArchive, recurrence, quota };

    const bootstrap = await bootstrapWithOrganization(identityStore, organizations, "MainTable", "sub-A");
    await store.putIfAbsent(seedActiveTenantLifecycle(bootstrap.organizationId));
    req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };
  });

  async function asViewer(): Promise<DocumentArchiveHttpDeps> {
    const realContext = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: undefined });
    const viewerContext = { ...realContext, tenant: { ...realContext.tenant, roles: ["VIEWER"] } };
    const fakeResolver = { resolve: async () => viewerContext };
    return { resolver: fakeResolver, documentArchive: deps.documentArchive, recurrence: deps.recurrence, quota: deps.quota } as unknown as DocumentArchiveHttpDeps;
  }

  it("create -> get -> list -> rename -> deprecate -> reactivate, all via HTTP handlers", async () => {
    const created = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Alvará Sanitário" } });
    expect(created.statusCode).toBe(201);
    const documentTypeId = (created.body["documentType"] as { documentTypeId: string }).documentTypeId;

    const got = await handleGetDocumentType(deps, { ...req, pathParameters: { documentTypeId } });
    expect(got.statusCode).toBe(200);
    expect((got.body["documentType"] as { displayName: string }).displayName).toBe("Alvará Sanitário");

    const listed = await handleListDocumentTypes(deps, { ...req });
    expect(listed.statusCode).toBe(200);
    expect(listed.body["documentTypes"]).toHaveLength(1);

    const renamed = await handleRenameDocumentType(deps, { ...req, pathParameters: { documentTypeId }, body: { expectedVersion: 1, displayName: "Alvará Renovado" } });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.body["documentType"] as { displayName: string }).displayName).toBe("Alvará Renovado");

    const deprecated = await handleDeprecateDocumentType(deps, { ...req, pathParameters: { documentTypeId }, body: { expectedVersion: 2 } });
    expect(deprecated.statusCode).toBe(200);
    expect((deprecated.body["documentType"] as { status: string }).status).toBe("DEPRECATED");

    const listedActive = await handleListDocumentTypes(deps, { ...req });
    expect(listedActive.body["documentTypes"]).toHaveLength(0);
    const listedDeprecated = await handleListDocumentTypes(deps, { ...req, queryStringParameters: { status: "DEPRECATED" } });
    expect(listedDeprecated.body["documentTypes"]).toHaveLength(1);

    const reactivated = await handleReactivateDocumentType(deps, { ...req, pathParameters: { documentTypeId }, body: { expectedVersion: 3 } });
    expect(reactivated.statusCode).toBe(200);
    expect((reactivated.body["documentType"] as { status: string }).status).toBe("ACTIVE");
  });

  it("rejects create with a malformed body (400, not 500 — the schema-registration bug class D-167's handoff names)", async () => {
    const response = await handleCreateDocumentType(deps, { ...req, body: {} as never });
    expect(response.statusCode).toBe(400);
  });

  it("rejects rename with a malformed body (missing expectedVersion) with 400", async () => {
    const created = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Alvará Sanitário" } });
    const documentTypeId = (created.body["documentType"] as { documentTypeId: string }).documentTypeId;
    const response = await handleRenameDocumentType(deps, { ...req, pathParameters: { documentTypeId }, body: { displayName: "X" } as never });
    expect(response.statusCode).toBe(400);
  });

  it("rejects deprecate with a malformed body (non-integer expectedVersion) with 400", async () => {
    const created = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Alvará Sanitário" } });
    const documentTypeId = (created.body["documentType"] as { documentTypeId: string }).documentTypeId;
    const response = await handleDeprecateDocumentType(deps, { ...req, pathParameters: { documentTypeId }, body: { expectedVersion: 1.5 } as never });
    expect(response.statusCode).toBe(400);
  });

  it("a VIEWER is denied (403) creating a DocumentType", async () => {
    const viewerDeps = await asViewer();
    const response = await handleCreateDocumentType(viewerDeps, { ...req, body: { displayName: "Alvará Sanitário" } });
    expect(response.statusCode).toBe(403);
  });

  it("a VIEWER is denied (403) renaming a DocumentType", async () => {
    const created = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Alvará Sanitário" } });
    const documentTypeId = (created.body["documentType"] as { documentTypeId: string }).documentTypeId;
    const viewerDeps = await asViewer();
    const response = await handleRenameDocumentType(viewerDeps, { ...req, pathParameters: { documentTypeId }, body: { expectedVersion: 1, displayName: "X" } });
    expect(response.statusCode).toBe(403);
  });

  it("a VIEWER is denied (403) deprecating a DocumentType", async () => {
    const created = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Alvará Sanitário" } });
    const documentTypeId = (created.body["documentType"] as { documentTypeId: string }).documentTypeId;
    const viewerDeps = await asViewer();
    const response = await handleDeprecateDocumentType(viewerDeps, { ...req, pathParameters: { documentTypeId }, body: { expectedVersion: 1 } });
    expect(response.statusCode).toBe(403);
  });

  it("a VIEWER is denied (403) reactivating a DocumentType", async () => {
    const created = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Alvará Sanitário" } });
    const documentTypeId = (created.body["documentType"] as { documentTypeId: string }).documentTypeId;
    await handleDeprecateDocumentType(deps, { ...req, pathParameters: { documentTypeId }, body: { expectedVersion: 1 } });
    const viewerDeps = await asViewer();
    const response = await handleReactivateDocumentType(viewerDeps, { ...req, pathParameters: { documentTypeId }, body: { expectedVersion: 2 } });
    expect(response.statusCode).toBe(403);
  });

  it("a VIEWER (READ_ONLY_ROLES) CAN read a DocumentType via get and list", async () => {
    const created = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Alvará Sanitário" } });
    const documentTypeId = (created.body["documentType"] as { documentTypeId: string }).documentTypeId;
    const viewerDeps = await asViewer();

    const got = await handleGetDocumentType(viewerDeps, { ...req, pathParameters: { documentTypeId } });
    expect(got.statusCode).toBe(200);

    const listed = await handleListDocumentTypes(viewerDeps, { ...req });
    expect(listed.statusCode).toBe(200);
    expect(listed.body["documentTypes"]).toHaveLength(1);
  });
});
