/**
 * D-225/D-241 (ExternalShareLink slice 2/3, backlog P1 item 8) exit criterion: the 3
 * authenticated HTTP routes (create/list/revoke) and the anonymous visitor route are actually
 * reachable end-to-end (real RequestContextResolver/bootstrap), same convention as
 * document-archive-dossier-routes.test.ts. `external-share-link-service.test.ts` already
 * exhaustively covers the service mechanism itself (anti-enumeration, OCC, cap/reconciliation) —
 * this covers the HTTP boundary's own job: RBAC wiring, schema validation, and that the
 * authenticated (create) and anonymous (resolve) Lambdas actually compose through a real token.
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
import { DocumentArchiveGuestRateLimiter } from "../../src/modules/document-archive/application/document-archive-guest-rate-limiter.js";
import { ExternalShareLinkService } from "../../src/modules/document-archive/application/external-share-link-service.js";
import { handleCreateShareLink, handleRevokeShareLink, handleListShareLinks, type DocumentArchiveHttpDeps } from "../../src/modules/document-archive/http/document-archive-handlers.js";
import { handleResolveExternalShare, type ExternalShareHttpDeps } from "../../src/modules/document-archive/http/external-share-handlers.js";
import { documentKey, type Document } from "../../src/modules/document-archive/domain/document.js";
import { documentVersionKey, type DocumentVersion } from "../../src/modules/document-archive/domain/document-version.js";
import { documentFileKey, type DocumentFile } from "../../src/modules/document-archive/domain/document-file.js";
import { documentTypeKey, type DocumentType } from "../../src/modules/document-archive/domain/document-type.js";
import type { ExternalShareLinkFileStore } from "../../src/modules/document-archive/ports/external-share-link-file-store.js";
import type { UploadUrlSigner } from "../../src/modules/document/ports/upload-url-signer.js";
import type { EntityKey } from "../../src/shared/dynamodb/occ.js";
import { authorizedTenantIdFromPersistedEntity } from "../../src/modules/identity/domain/authorization.js";

const PEPPER = "share-link-route-test-pepper";
const IP_AUDIT_PEPPER = "share-link-route-test-ip-audit-pepper";
const NOW = "2026-09-12T00:00:00.000Z";

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
    newRequirementTemplateId: () => "reqtpl_test",
    newRequirementTemplateItemId: () => `reqtplitem_${++idCounter}`,
    newDossierExportRunId: () => `dossier_${++idCounter}`,
    newDocumentTypeFieldId: () => `doctypefield_${++idCounter}`,
    newDocumentTypeFieldOptionId: () => `doctypefieldopt_${++idCounter}`,
    newShareId: () => `share_${++idCounter}`,
  };
}

const noopSigner: UploadUrlSigner = { presignUpload: async () => ({ uploadUrl: "https://s3.example/unused", requiredHeaders: {} }) };

function fakeFileStore(): ExternalShareLinkFileStore {
  return { async presignDownload() { return "https://example.com/presigned-share-download"; } };
}

/** Minimal Document/DocumentVersion(ACCEPTED)/DocumentFile(CLEAN) fixture — the exact referential
 * integrity `createShareLink` requires, same shape `external-share-link-service.test.ts`'s own
 * `seedAcceptedDocument` fixture uses (duplicated here rather than imported, same convention
 * document-archive-dossier-routes.test.ts already establishes for this kind of fixture). */
async function seedShareableDocument(store: InMemoryDocumentArchiveStore, rawTenantId: string): Promise<{ documentId: string }> {
  const tenantId = authorizedTenantIdFromPersistedEntity({ tenantId: rawTenantId });
  const documentId = "doc-share-1";
  const versionId = "ver-share-1";
  const fileId = "file-share-1";

  const documentType: DocumentType = {
    ...documentTypeKey(tenantId, "ALVARA"),
    entityType: "DocumentType",
    documentTypeId: "ALVARA",
    tenantId,
    displayName: "Alvará de Funcionamento",
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    GSI1PK: `TENANT#${tenantId}#DOCTYPESTATUS#ACTIVE`,
    GSI1SK: `NAME#alvara#DOCTYPE#ALVARA`,
  };
  await store.putIfAbsent(documentType as unknown as Record<string, unknown> & EntityKey);

  const document: Document = {
    ...documentKey(tenantId, documentId),
    entityType: "Document",
    documentId,
    tenantId,
    subjectId: "subject-1",
    documentTypeId: "ALVARA",
    status: "ACTIVE",
    hasValidity: true,
    currentVersionId: versionId,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    GSI1PK: `TENANT#${tenantId}#DOCSTATUS#ACTIVE`,
    GSI1SK: `UPDATED#${NOW}#DOCUMENT#${documentId}`,
    GSI2PK: `TENANT#${tenantId}#SUBJECT#subject-1#DOC`,
    GSI2SK: `DOCTYPE#ALVARA#DOCUMENT#${documentId}`,
  };
  await store.putIfAbsent(document as unknown as Record<string, unknown> & EntityKey);

  const version: DocumentVersion = {
    ...documentVersionKey(tenantId, documentId, 1),
    entityType: "DocumentVersion",
    versionId,
    documentId,
    tenantId,
    seq: 1,
    state: "ACCEPTED",
    origin: "MANUAL_UPLOAD",
    issuedAt: "2026-01-01T00:00:00.000Z",
    pendingFileScans: 0,
    infectedFileScans: 0,
    principalFileId: fileId,
    totalFiles: 1,
    fileSetSealed: true,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
  await store.putIfAbsent(version as unknown as Record<string, unknown> & EntityKey);

  const file: DocumentFile = {
    ...documentFileKey(tenantId, documentId, 1, fileId),
    entityType: "DocumentFile",
    tenantId,
    documentId,
    versionId,
    seq: 1,
    fileId,
    role: "PRINCIPAL",
    scanStatus: "CLEAN",
    mediaType: "application/pdf",
    contentLength: 1234,
    checksumSha256: "a".repeat(64),
    quarantineObject: { bucket: "quarantine-bucket", key: `q/${fileId}`, versionId: "qv1" },
    cleanObject: { bucket: "clean-bucket", key: `c/${fileId}`, versionId: "cv1" },
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
  await store.putIfAbsent(file as unknown as Record<string, unknown> & EntityKey);

  return { documentId };
}

describe("ExternalShareLink HTTP routes (D-225/D-241 slice 2/3)", () => {
  let deps: DocumentArchiveHttpDeps;
  let anonymousDeps: ExternalShareHttpDeps;
  let req: { requestId: string; correlationId: string; claims: ValidatedClaims };
  let documentId: string;

  beforeEach(async () => {
    const identityStore = new InMemoryIdentityStore();
    const organizations = new InMemoryOrganizationStore();
    const resolver = new RequestContextResolver(new GlobalUserRepository(identityStore), organizations, makeIdGenerator(), identityStore, "MainTable");
    const quota = new TenantQuotaService(identityStore, "MainTable");

    const store = new InMemoryDocumentArchiveStore();
    const documentArchive = new DocumentArchiveService({ store, tableName: "MainTable", ids: makeIds(), quarantineBucket: "test-quarantine-bucket", signer: noopSigner, members: { isEligibleMember: async () => true } });
    const recurrence = new DocumentRequestRecurrenceService({ store, tableName: "MainTable", ids: makeIds() });
    // Tenant Lambda: created WITHOUT rateLimiter/fileStore/ipAuditPepper - never resolves the
    // anonymous route, same composition shape buildDocumentArchiveDeps uses in production.
    const shareLinks = new ExternalShareLinkService({ store, tableName: "MainTable", ids: makeIds(), pepper: PEPPER, now: () => NOW });
    deps = { resolver, documentArchive, recurrence, quota, shareLinks };

    // Anonymous Lambda: the FULL service, same composition shape buildExternalShareAnonymousDeps
    // uses in production - a SEPARATE ExternalShareLinkService instance (as it would be, running
    // in a separate Lambda process), sharing only the underlying store/pepper.
    const anonymousShareLinks = new ExternalShareLinkService({
      store,
      tableName: "MainTable",
      ids: makeIds(),
      rateLimiter: new DocumentArchiveGuestRateLimiter(store, () => NOW),
      fileStore: fakeFileStore(),
      pepper: PEPPER,
      ipAuditPepper: IP_AUDIT_PEPPER,
      now: () => NOW,
    });
    anonymousDeps = { shareLinks: anonymousShareLinks };

    const bootstrap = await bootstrapWithOrganization(identityStore, organizations, "MainTable", "sub-A");
    const tenantId = bootstrap.organizationId;
    await store.putIfAbsent(seedActiveTenantLifecycle(tenantId));
    ({ documentId } = await seedShareableDocument(store, tenantId));
    req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };
  });

  it("create -> list -> resolve (anonymous) -> revoke -> resolve fails, end to end via real HTTP handlers", async () => {
    const created = await handleCreateShareLink(deps, { ...req, pathParameters: { documentId } });
    expect(created.statusCode).toBe(201);
    const { link, shareId, token } = created.body as { link: { version: number }; shareId: string; token: string };
    expect(token.split(".")).toHaveLength(2); // already split - selector.secret, ready for the {token} path segment

    const listed = await handleListShareLinks(deps, { ...req, pathParameters: { documentId }, queryStringParameters: { status: "ACTIVE" } });
    expect(listed.statusCode).toBe(200);
    expect((listed.body["links"] as unknown[])).toHaveLength(1);

    const resolved = await handleResolveExternalShare(anonymousDeps, { pathParameters: { shareId, token }, sourceIp: "203.0.113.1" });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.body["downloadUrl"]).toBe("https://example.com/presigned-share-download");

    const revoked = await handleRevokeShareLink(deps, { ...req, pathParameters: { documentId, shareId }, body: { expectedVersion: link.version } });
    expect(revoked.statusCode).toBe(204);

    const resolvedAfterRevoke = await handleResolveExternalShare(anonymousDeps, { pathParameters: { shareId, token }, sourceIp: "203.0.113.1" });
    expect(resolvedAfterRevoke.statusCode).toBe(401);
  });

  it("rejects resolving a well-formed but wrong token with the same generic 401 (anti-enumeration)", async () => {
    await handleCreateShareLink(deps, { ...req, pathParameters: { documentId } });
    const wrongSelector = "a".repeat(32);
    const wrongSecret = "b".repeat(64);
    const response = await handleResolveExternalShare(anonymousDeps, {
      pathParameters: { shareId: "share_nope", token: `${wrongSelector}.${wrongSecret}` },
      sourceIp: "203.0.113.1",
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an anonymous resolve request missing the token path parameter with a real 400", async () => {
    const response = await handleResolveExternalShare(anonymousDeps, { pathParameters: { shareId: "share_nope" }, sourceIp: "203.0.113.1" });
    expect(response.statusCode).toBe(400);
  });

  it("every anonymous resolve response carries Cache-Control: no-store and Referrer-Policy: no-referrer (Decision 3)", async () => {
    const response = await handleResolveExternalShare(anonymousDeps, { pathParameters: { shareId: "share_nope" }, sourceIp: "203.0.113.1" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("rejects a create request with an invalid ttlDays with a real 400 (never reaching the service)", async () => {
    const response = await handleCreateShareLink(deps, { ...req, pathParameters: { documentId }, body: { ttlDays: 999 } });
    expect(response.statusCode).toBe(400);
  });

  it("returns 404 creating a share link for a Document that doesn't exist", async () => {
    const response = await handleCreateShareLink(deps, { ...req, pathParameters: { documentId: "nope" } });
    expect(response.statusCode).toBe(404);
  });

  it("denies a VIEWER role with a real 403 (RBAC: docarchive:share-link-* is ADMIN_ROLES exclusively)", async () => {
    const realContext = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: undefined });
    const viewerContext = { ...realContext, tenant: { ...realContext.tenant, roles: ["VIEWER"] } };
    const fakeResolver = { resolve: async () => viewerContext };
    const viewerDeps = { ...deps, resolver: fakeResolver } as unknown as DocumentArchiveHttpDeps;

    const createResponse = await handleCreateShareLink(viewerDeps, { ...req, pathParameters: { documentId } });
    expect(createResponse.statusCode).toBe(403);

    const listResponse = await handleListShareLinks(viewerDeps, { ...req, pathParameters: { documentId }, queryStringParameters: { status: "ACTIVE" } });
    expect(listResponse.statusCode).toBe(403);

    const revokeResponse = await handleRevokeShareLink(viewerDeps, { ...req, pathParameters: { documentId, shareId: "share-1" }, body: { expectedVersion: 1 } });
    expect(revokeResponse.statusCode).toBe(403);
  });
});
