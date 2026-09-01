/**
 * D-143 Nucleus 1 exit criterion: a Document manageable end-to-end via the full HTTP pipeline
 * (resolver -> service -> authorize() -> OCC transaction), create through the
 * upload/review/accept flow and a renewal (supersede), with role-based access enforced.
 * Mirrors test/integration/expiration-lifecycle.test.ts's convention of exercising real
 * handlers end-to-end rather than units in isolation.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator, bootstrapWithOrganization } from "../unit/identity/in-memory-store.js";
import { InMemoryOrganizationStore } from "../unit/organization/in-memory-store.js";
import { InMemoryDocumentArchiveStore } from "../unit/document-archive/in-memory-store.js";
import { UserRepository } from "../../src/modules/identity/persistence/user-repository.js";
import { GlobalUserRepository } from "../../src/modules/identity/persistence/global-user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../src/modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../src/modules/identity/application/quota.js";
import { DocumentArchiveService } from "../../src/modules/document-archive/application/document-archive-service.js";
import {
  handleAcceptVersion,
  handleClaimReview,
  handleCommitUpload,
  handleCreateDocument,
  handleGetDocument,
  handleListVersions,
  handleRejectVersion,
  handleReserveUpload,
  type DocumentArchiveHttpDeps,
} from "../../src/modules/document-archive/http/document-archive-handlers.js";

function claims(sub: string): ValidatedClaims {
  return {
    sub,
    tokenId: `jti-${sub}`,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

let idCounter = 0;
function makeIds() {
  return {
    newDocumentId: () => `doc-${++idCounter}`,
    newVersionId: () => `ver-${++idCounter}`,
    newEventId: () => `evt-${++idCounter}`,
  };
}

describe("Document Archive end-to-end lifecycle (D-143 Nucleus 1)", () => {
  let deps: DocumentArchiveHttpDeps;
  let req: { requestId: string; correlationId: string; claims: ValidatedClaims };

  beforeEach(async () => {
    const identityStore = new InMemoryIdentityStore();
    const organizations = new InMemoryOrganizationStore();
    const users = new UserRepository(identityStore);
    const resolver = new RequestContextResolver(users, new GlobalUserRepository(identityStore), organizations, makeIdGenerator(), identityStore, "MainTable");
    const quota = new TenantQuotaService(identityStore, "MainTable");

    const store = new InMemoryDocumentArchiveStore();
    const documentArchive = new DocumentArchiveService({ store, tableName: "MainTable", ids: makeIds() });
    deps = { resolver, documentArchive, quota };

    await bootstrapWithOrganization(identityStore, organizations, "MainTable", "sub-A");
    req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };
  });

  it("create -> reserveUpload -> commitUpload -> claimReview -> acceptVersion, all via HTTP handlers", async () => {
    const created = await handleCreateDocument(deps, { ...req, body: { subjectId: "subject-1", documentType: "ALVARA", hasValidity: true } });
    expect(created.statusCode).toBe(201);
    const documentId = (created.body["document"] as { documentId: string }).documentId;

    const draft = await handleReserveUpload(deps, { ...req, pathParameters: { documentId }, body: { origin: "MANUAL_UPLOAD" } });
    expect(draft.statusCode).toBe(201);
    const version = draft.body["version"] as { seq: number; version: number; versionId: string };
    expect(version.seq).toBe(1);

    const received = await handleCommitUpload(deps, {
      ...req,
      pathParameters: { documentId, seq: String(version.seq) },
      body: { expectedVersion: version.version },
    });
    expect(received.statusCode).toBe(200);
    const receivedVersion = received.body["version"] as { version: number; state: string };
    expect(receivedVersion.state).toBe("RECEIVED");

    const underReview = await handleClaimReview(deps, {
      ...req,
      pathParameters: { documentId, seq: String(version.seq) },
      body: { expectedVersion: receivedVersion.version },
    });
    expect(underReview.statusCode).toBe(200);
    const underReviewVersion = underReview.body["version"] as { version: number };

    const accepted = await handleAcceptVersion(deps, {
      ...req,
      pathParameters: { documentId, seq: String(version.seq) },
      body: { expectedVersion: underReviewVersion.version, clientRequestToken: "req-token-1" },
    });
    expect(accepted.statusCode).toBe(200);
    expect((accepted.body["acceptedVersionId"] as string)).toBe(version.versionId);

    const getResponse = await handleGetDocument(deps, { ...req, pathParameters: { documentId } });
    expect((getResponse.body["document"] as { currentVersionId: string }).currentVersionId).toBe(version.versionId);

    const listResponse = await handleListVersions(deps, { ...req, pathParameters: { documentId } });
    const versions = listResponse.body["versions"] as Array<{ state: string }>;
    expect(versions).toHaveLength(1);
    expect(versions[0]!.state).toBe("ACCEPTED");
  });

  it("a rejected version stays in history (never removable) and a corrected re-upload becomes the accepted current version", async () => {
    const created = await handleCreateDocument(deps, { ...req, body: { subjectId: "subject-1", documentType: "ALVARA", hasValidity: true } });
    const documentId = (created.body["document"] as { documentId: string }).documentId;

    const draft1 = await handleReserveUpload(deps, { ...req, pathParameters: { documentId }, body: { origin: "MANUAL_UPLOAD" } });
    const v1 = draft1.body["version"] as { seq: number; version: number };
    const received1 = await handleCommitUpload(deps, { ...req, pathParameters: { documentId, seq: String(v1.seq) }, body: { expectedVersion: v1.version } });
    const receivedVersion1 = received1.body["version"] as { version: number };

    const rejected = await handleRejectVersion(deps, {
      ...req,
      pathParameters: { documentId, seq: String(v1.seq) },
      body: { expectedVersion: receivedVersion1.version, reason: "ILLEGIBLE" },
    });
    expect(rejected.statusCode).toBe(200);
    expect((rejected.body["version"] as { state: string }).state).toBe("REJECTED");

    const draft2 = await handleReserveUpload(deps, { ...req, pathParameters: { documentId }, body: { origin: "MANUAL_UPLOAD" } });
    const v2 = draft2.body["version"] as { seq: number; version: number; versionId: string };
    expect(v2.seq).toBe(2);
    const received2 = await handleCommitUpload(deps, { ...req, pathParameters: { documentId, seq: String(v2.seq) }, body: { expectedVersion: v2.version } });
    const receivedVersion2 = received2.body["version"] as { version: number };
    const underReview2 = await handleClaimReview(deps, {
      ...req,
      pathParameters: { documentId, seq: String(v2.seq) },
      body: { expectedVersion: receivedVersion2.version },
    });
    const underReviewVersion2 = underReview2.body["version"] as { version: number };
    const accepted2 = await handleAcceptVersion(deps, {
      ...req,
      pathParameters: { documentId, seq: String(v2.seq) },
      body: { expectedVersion: underReviewVersion2.version, clientRequestToken: "req-token-2" },
    });
    expect(accepted2.statusCode).toBe(200);

    const listResponse = await handleListVersions(deps, { ...req, pathParameters: { documentId } });
    const versions = listResponse.body["versions"] as Array<{ seq: number; state: string }>;
    expect(versions.find((v) => v.seq === 1)?.state).toBe("REJECTED");
    expect(versions.find((v) => v.seq === 2)?.state).toBe("ACCEPTED");
  });

  it("rejects a request body that fails schema validation (400), never reaching the service", async () => {
    const response = await handleCreateDocument(deps, { ...req, body: { subjectId: "subject-1" } as never });
    expect(response.statusCode).toBe(400);
  });

  it("maps a real AuthorizationDeniedError (VIEWER attempting docarchive:create) to HTTP 403 through withErrorMapping", async () => {
    // Resolve the REAL, already-bootstrapped tenant context first (so TenantQuotaService's own
    // TenantLifecycleRecord fence sees a real ACTIVE tenant, same as `cross-tenant.test.ts`'s
    // convention), then override roles to VIEWER - a role downgrade of a real resolved
    // principal, not a synthetic tenant with no lifecycle record.
    const realContext = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: undefined });
    const viewerContext = { ...realContext, tenant: { ...realContext.tenant, roles: ["VIEWER"] } };
    const fakeResolver = { resolve: async () => viewerContext };
    const viewerDeps = { resolver: fakeResolver, documentArchive: deps.documentArchive, quota: deps.quota } as unknown as DocumentArchiveHttpDeps;

    const response = await handleCreateDocument(viewerDeps, { ...req, body: { subjectId: "subject-1", documentType: "ALVARA", hasValidity: true } });
    expect(response.statusCode).toBe(403);
  });
});
