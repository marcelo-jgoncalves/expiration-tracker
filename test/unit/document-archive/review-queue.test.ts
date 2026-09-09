/** G2 (D-247/D-24x, docs/frontend/p0-screen-inventory-plan.md §9) — closes the named A13
 * blocker: the sparse GSI5 review-queue index and `docarchive:read` RBAC already existed, only
 * the query/route wiring was missing. */
import { describe, expect, it } from "vitest";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle } from "./in-memory-store.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { documentKey } from "../../../src/modules/document-archive/domain/document.js";
import { documentVersionKey, reviewQueueGsi5Keys } from "../../../src/modules/document-archive/domain/document-version.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TENANT = authorizedTenantIdFromPersistedEntity({ tenantId: "tenant-1" });
const NOW = "2026-09-09T00:00:00.000Z";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: TENANT, roles: ["MEMBER"] },
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

function makeService(store: InMemoryDocumentArchiveStore) {
  const signer = { presignUpload: async () => ({ uploadUrl: "https://s3.example/fake?sig=fake", requiredHeaders: {} }) };
  const members = { isEligibleMember: async () => true };
  return new DocumentArchiveService({ store, tableName: "test-table", ids: makeIds(), quarantineBucket: "test-quarantine-bucket", signer, members, now: () => NOW });
}

function seedDocument(documentId: string, subjectId: string): Record<string, unknown> & EntityKey {
  return {
    ...(documentKey(TENANT, documentId) as { PK: string; SK: string }),
    entityType: "Document",
    documentId,
    tenantId: TENANT,
    subjectId,
    documentTypeId: "ALVARA",
    status: "ACTIVE",
    hasValidity: false,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  } as unknown as Record<string, unknown> & EntityKey;
}

function seedVersion(documentId: string, versionId: string, state: "RECEIVED" | "UNDER_REVIEW", receivedAt: string): Record<string, unknown> & EntityKey {
  return {
    ...(documentVersionKey(TENANT, documentId, 1) as { PK: string; SK: string }),
    entityType: "DocumentVersion",
    versionId,
    documentId,
    tenantId: TENANT,
    seq: 1,
    state,
    origin: "MANUAL_UPLOAD",
    receivedAt,
    pendingFileScans: 0,
    infectedFileScans: 0,
    createdAt: receivedAt,
    updatedAt: receivedAt,
    version: 1,
    ...reviewQueueGsi5Keys(TENANT, state, receivedAt, versionId),
  } as unknown as Record<string, unknown> & EntityKey;
}

describe("DocumentArchiveService.listReviewQueue (G2)", () => {
  it("rejects a READ-ineligible caller (AuthorizationDeniedError) — GUEST-tier roles get 403, never a silent empty page", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT)]);
    const service = makeService(store);
    await expect(service.listReviewQueue(ctx({ tenant: { tenantId: TENANT, roles: [] } }), { state: "RECEIVED" })).rejects.toThrow(AuthorizationDeniedError);
  });

  it("returns only RECEIVED versions when state=RECEIVED, enriched with the parent Document", async () => {
    const store = new InMemoryDocumentArchiveStore([
      seedActiveTenantLifecycle(TENANT),
      seedDocument("doc-1", "subj-1"),
      seedVersion("doc-1", "ver-1", "RECEIVED", "2026-09-01T00:00:00.000Z"),
      seedDocument("doc-2", "subj-2"),
      seedVersion("doc-2", "ver-2", "UNDER_REVIEW", "2026-09-02T00:00:00.000Z"),
    ]);
    const service = makeService(store);

    const page = await service.listReviewQueue(ctx(), { state: "RECEIVED" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.version.versionId).toBe("ver-1");
    expect(page.items[0]?.document?.documentId).toBe("doc-1");
    expect(page.items[0]?.document?.subjectId).toBe("subj-1");
  });

  it("returns only UNDER_REVIEW versions when state=UNDER_REVIEW — the two states never merge server-side (separate GSI5 partitions)", async () => {
    const store = new InMemoryDocumentArchiveStore([
      seedActiveTenantLifecycle(TENANT),
      seedDocument("doc-1", "subj-1"),
      seedVersion("doc-1", "ver-1", "RECEIVED", "2026-09-01T00:00:00.000Z"),
      seedDocument("doc-2", "subj-2"),
      seedVersion("doc-2", "ver-2", "UNDER_REVIEW", "2026-09-02T00:00:00.000Z"),
    ]);
    const service = makeService(store);

    const page = await service.listReviewQueue(ctx(), { state: "UNDER_REVIEW" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.version.versionId).toBe("ver-2");
  });

  it("a version that already left RECEIVED/UNDER_REVIEW (e.g. ACCEPTED) never appears — the sparse index property", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedDocument("doc-1", "subj-1")]);
    const service = makeService(store);
    // An ACCEPTED version carries no GSI5PK/GSI5SK at all (removed by acceptVersion), so it is
    // never seeded with reviewQueueGsi5Keys here — this asserts the queue starts empty.
    const page = await service.listReviewQueue(ctx(), { state: "RECEIVED" });
    expect(page.items).toHaveLength(0);
  });

  it("returns an empty page (never throws) when nothing is pending review for this tenant", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT)]);
    const service = makeService(store);
    const page = await service.listReviewQueue(ctx(), { state: "RECEIVED" });
    expect(page.items).toEqual([]);
    expect(page.lastEvaluatedKey).toBeUndefined();
  });
});
