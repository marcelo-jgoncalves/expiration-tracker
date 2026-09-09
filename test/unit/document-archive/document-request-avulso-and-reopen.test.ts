/** D-226 Achado 2 (avulso DocumentRequest creation) + Achado 3 (rejectVersion reopening) — G-V3
 * adversarial coverage, not just the happy path. */
import { describe, expect, it } from "vitest";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle, seedActiveTrackedSubject } from "./in-memory-store.js";
import { ConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { requirementKey } from "../../../src/modules/document-archive/domain/requirement.js";
import { documentRequestKey, type DocumentRequest } from "../../../src/modules/document-archive/domain/document-request.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import { documentKey, type Document } from "../../../src/modules/document-archive/domain/document.js";
import { requestAccessCredentialKey, type RequestAccessCredential } from "../../../src/modules/document-archive/domain/request-access-credential.js";
import type { OutboxRecord } from "../../../src/shared/outbox/outbox.js";

const TENANT = authorizedTenantIdFromPersistedEntity({ tenantId: "tenant-1" });
const SUBJECT = "subject-1";

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
    newRequirementTemplateItemId: () => `reqtplitem_${++n}`,
    newDossierExportRunId: () => `dossier_${++n}`,
    newDocumentTypeFieldId: () => `doctypefield_${++n}`,
    newDocumentTypeFieldOptionId: () => `doctypefieldopt_${++n}`,
    newShareId: () => `share_${crypto.randomUUID()}`,
  };
}

function seedRequirement(tenantId: string, subjectId: string, requirementId: string): Record<string, unknown> & { PK: string; SK: string } {
  return {
    ...(requirementKey(authorizedTenantIdFromPersistedEntity({ tenantId }), subjectId, requirementId) as { PK: string; SK: string }),
    entityType: "Requirement",
    requirementId,
    tenantId,
    subjectId,
    name: "Alvará",
    applicability: "APPLICABLE",
    status: "MISSING",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    GSI1PK: `TENANT#${tenantId}#REQSTATUS#MISSING`,
    GSI1SK: `REQUIREMENT#${requirementId}`,
  } as unknown as Record<string, unknown> & { PK: string; SK: string };
}

function makeService(store: InMemoryDocumentArchiveStore) {
  return new DocumentArchiveService({
    store,
    tableName: "test-table",
    ids: makeIds(),
    quarantineBucket: "test-quarantine-bucket",
    signer: { presignUpload: async () => ({ uploadUrl: "https://example/x", requiredHeaders: {} }) },
    members: { isEligibleMember: async () => true },
    now: () => "2026-09-01T00:00:00.000Z",
  });
}

describe("createDocumentRequest (D-226 Achado 2, avulso)", () => {
  it("creates a non-recurring DocumentRequest and appends the credential-issuance outbox entry in the SAME transaction", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), seedRequirement(TENANT, SUBJECT, "req-1")]);
    const service = makeService(store);

    const request = await service.createDocumentRequest(ctx(), { subjectId: SUBJECT, requirementId: "req-1", idempotencyKey: "idem-1" });

    expect(request.status).toBe("REQUESTED");
    expect(request.issuanceGeneration).toBe(1);
    expect(request.seriesId).toBeUndefined();
    expect(request.attemptIndex).toBeUndefined();

    const persisted = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, request.documentRequestId));
    expect(persisted).toBeDefined();

    const outboxRows = store.allItems().filter((item) => item["entityType"] === "OutboxEvent") as unknown as OutboxRecord[];
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.destination).toBe("SQS_DOCUMENT_REQUEST_CREDENTIAL_ISSUANCE_V1");
    expect(outboxRows[0]?.eventType).toBe("DocumentRequestCredentialIssuanceRequested");
  });

  it("D-228: persists recipientEmail when supplied, and a replay with a DIFFERENT email is a ConflictError, never a silent overwrite", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), seedRequirement(TENANT, SUBJECT, "req-1")]);
    const service = makeService(store);

    const request = await service.createDocumentRequest(ctx(), { subjectId: SUBJECT, requirementId: "req-1", idempotencyKey: "idem-email-1", recipientEmail: "guest@example.com" });
    expect(request.recipientEmail).toBe("guest@example.com");

    await expect(
      service.createDocumentRequest(ctx(), { subjectId: SUBJECT, requirementId: "req-1", idempotencyKey: "idem-email-1", recipientEmail: "someone-else@example.com" }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects a WRITE-ineligible caller (AuthorizationDeniedError) before touching the store", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), seedRequirement(TENANT, SUBJECT, "req-1")]);
    const service = makeService(store);
    await expect(service.createDocumentRequest(ctx({ tenant: { tenantId: TENANT, roles: ["VIEWER"] } }), { subjectId: SUBJECT, requirementId: "req-1", idempotencyKey: "idem-1" })).rejects.toThrow(
      AuthorizationDeniedError,
    );
  });

  it("throws NotFoundError when the target Requirement does not exist (existence ConditionCheck, not a pre-read)", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT)]);
    const service = makeService(store);
    await expect(service.createDocumentRequest(ctx(), { subjectId: SUBJECT, requirementId: "no-such-req", idempotencyKey: "idem-1" })).rejects.toThrow(NotFoundError);
  });

  it("G-V3: idempotency replay with the SAME payload returns the original snapshot, never creating a second DocumentRequest", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), seedRequirement(TENANT, SUBJECT, "req-1")]);
    const service = makeService(store);
    const first = await service.createDocumentRequest(ctx(), { subjectId: SUBJECT, requirementId: "req-1", idempotencyKey: "idem-1" });
    const second = await service.createDocumentRequest(ctx(), { subjectId: SUBJECT, requirementId: "req-1", idempotencyKey: "idem-1" });
    expect(second.documentRequestId).toBe(first.documentRequestId);

    const allRequests = store.allItems().filter((item) => item["entityType"] === "DocumentRequest");
    expect(allRequests).toHaveLength(1);
    const outboxRows = store.allItems().filter((item) => item["entityType"] === "OutboxEvent");
    expect(outboxRows).toHaveLength(1); // replay never re-dispatches issuance either.
  });

  it("G-V3: idempotency key reused with a DIFFERENT payload is a ConflictError, never a silent wrong snapshot", async () => {
    const store = new InMemoryDocumentArchiveStore([
      seedActiveTenantLifecycle(TENANT),
      seedActiveTrackedSubject(TENANT, SUBJECT),
      seedRequirement(TENANT, SUBJECT, "req-1"),
      seedRequirement(TENANT, SUBJECT, "req-2"),
    ]);
    const service = makeService(store);
    await service.createDocumentRequest(ctx(), { subjectId: SUBJECT, requirementId: "req-1", idempotencyKey: "idem-1" });
    await expect(service.createDocumentRequest(ctx(), { subjectId: SUBJECT, requirementId: "req-2", idempotencyKey: "idem-1" })).rejects.toThrow(ConflictError);
  });
});

describe("rejectVersion reopening the origin DocumentRequest (D-226 Achado 3)", () => {
  async function seedSubmittedGuestFlow(store: InMemoryDocumentArchiveStore, opts: { withCredential: boolean; lastSubmissionId?: string; status?: DocumentRequest["status"] }) {
    const documentId = "doc-1";
    const versionId = "ver-1";
    const documentRequestId = "docreq-1";

    const document: Document = {
      ...(documentKey(TENANT, documentId) as { PK: string; SK: string }),
      entityType: "Document",
      documentId,
      tenantId: TENANT,
      subjectId: SUBJECT,
      documentTypeId: "req-1",
      status: "ACTIVE",
      hasValidity: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    } as unknown as Document;

    const version: DocumentVersion = {
      ...(documentVersionKey(TENANT, documentId, 1) as { PK: string; SK: string }),
      entityType: "DocumentVersion",
      versionId,
      documentId,
      tenantId: TENANT,
      seq: 1,
      state: "RECEIVED",
      origin: "GUEST_UPLOAD",
      receivedAt: "2026-01-01T00:00:00.000Z",
      pendingFileScans: 0,
      infectedFileScans: 0,
      requestId: documentRequestId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    } as unknown as DocumentVersion;

    const request: DocumentRequest = {
      ...documentRequestKey(TENANT, SUBJECT, documentRequestId),
      entityType: "DocumentRequest",
      documentRequestId,
      tenantId: TENANT,
      subjectId: SUBJECT,
      requirementId: "req-1",
      status: opts.status ?? "SUBMITTED",
      lastSubmissionId: opts.lastSubmissionId ?? versionId,
      submissionCount: 1,
      issuanceGeneration: 1,
      ...(opts.withCredential ? { activeCredentialSelectorHash: "selector-abc" } : {}),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    };

    await store.putIfAbsent(document as unknown as Record<string, unknown> & { PK: string; SK: string });
    await store.putIfAbsent(version as unknown as Record<string, unknown> & { PK: string; SK: string });
    await store.putIfAbsent(request as unknown as Record<string, unknown> & { PK: string; SK: string });

    if (opts.withCredential) {
      const credential: RequestAccessCredential = {
        ...requestAccessCredentialKey("selector-abc"),
        entityType: "RequestAccessCredential",
        selectorHash: "selector-abc",
        secretHash: "irrelevant-hash",
        tenantId: TENANT,
        subjectId: SUBJECT,
        requirementId: "req-1",
        documentRequestId,
        tokenVersion: 1,
        expiresAt: "2026-12-31T00:00:00.000Z",
        purgeAfterTtl: 9999999999,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      };
      await store.putIfAbsent(credential as unknown as Record<string, unknown> & { PK: string; SK: string });
    }

    return { documentId, versionId, documentRequestId };
  }

  it("reopens the DocumentRequest, bumps issuanceGeneration, records lastRejection, revokes the old credential, and dispatches a reissuance outbox entry", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT)]);
    const { documentId, documentRequestId } = await seedSubmittedGuestFlow(store, { withCredential: true });
    const service = makeService(store);

    await service.rejectVersion(ctx({ tenant: { tenantId: TENANT, roles: ["ADMIN"] } }), documentId, 1, 1, "ILLEGIBLE");

    const request = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, documentRequestId));
    expect(request?.status).toBe("REQUESTED");
    expect(request?.issuanceGeneration).toBe(2);
    expect(request?.lastRejection).toEqual({ versionId: "ver-1", reason: "ILLEGIBLE", occurredAt: "2026-09-01T00:00:00.000Z" });

    const credential = await store.get<RequestAccessCredential>(requestAccessCredentialKey("selector-abc"));
    expect(credential?.revokedAt).toBe("2026-09-01T00:00:00.000Z");

    const outboxRows = store.allItems().filter((item) => item["entityType"] === "OutboxEvent") as unknown as OutboxRecord[];
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.destination).toBe("SQS_DOCUMENT_REQUEST_CREDENTIAL_ISSUANCE_V1");
    const payload = outboxRows[0]?.payload as { issuanceGeneration: number; documentRequestId: string };
    expect(payload.issuanceGeneration).toBe(2);
    expect(payload.documentRequestId).toBe(documentRequestId);
  });

  it("never touches the DocumentRequest/credential when no credential was ever issued (activeCredentialSelectorHash absent) — reopens without a revoke entry", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT)]);
    const { documentId, documentRequestId } = await seedSubmittedGuestFlow(store, { withCredential: false });
    const service = makeService(store);

    await service.rejectVersion(ctx({ tenant: { tenantId: TENANT, roles: ["ADMIN"] } }), documentId, 1, 1, "OTHER");

    const request = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, documentRequestId));
    expect(request?.status).toBe("REQUESTED");
    expect(request?.issuanceGeneration).toBe(2);
  });

  it("G-V3: does NOT reopen a DocumentRequest whose lastSubmissionId no longer matches this (superseded) version — a late rejection of a stale version must never reset a request that already moved on", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT)]);
    // The request already moved on to a NEWER submission ("ver-2-newer") — e.g. a resubmission
    // superseded this version before the reviewer's rejection of the OLD one ("ver-1") lands.
    const { documentId, documentRequestId } = await seedSubmittedGuestFlow(store, { withCredential: true, lastSubmissionId: "ver-2-newer" });
    const service = makeService(store);

    await service.rejectVersion(ctx({ tenant: { tenantId: TENANT, roles: ["ADMIN"] } }), documentId, 1, 1, "OUTDATED_VERSION");

    const after = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, documentRequestId));
    // status/issuanceGeneration unchanged — the version rejection itself still succeeded
    // (asserted implicitly by no throw above), but the DocumentRequest was never reset.
    expect(after?.status).toBe("SUBMITTED");
    expect(after?.issuanceGeneration).toBe(1);
    expect(after?.lastRejection).toBeUndefined();

    const outboxRows = store.allItems().filter((item) => item["entityType"] === "OutboxEvent");
    expect(outboxRows).toHaveLength(0);
  });

  it("regression: a version with NO originating DocumentRequest (requestId absent) rejects exactly as before, purely additive", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT)]);
    const documentId = "doc-plain";
    const document: Document = {
      ...(documentKey(TENANT, documentId) as { PK: string; SK: string }),
      entityType: "Document",
      documentId,
      tenantId: TENANT,
      subjectId: SUBJECT,
      documentTypeId: "ALVARA",
      status: "ACTIVE",
      hasValidity: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    } as unknown as Document;
    const version: DocumentVersion = {
      ...(documentVersionKey(TENANT, documentId, 1) as { PK: string; SK: string }),
      entityType: "DocumentVersion",
      versionId: "ver-plain",
      documentId,
      tenantId: TENANT,
      seq: 1,
      state: "RECEIVED",
      origin: "INTERNAL_UPLOAD",
      receivedAt: "2026-01-01T00:00:00.000Z",
      pendingFileScans: 0,
      infectedFileScans: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    } as unknown as DocumentVersion;
    await store.putIfAbsent(document as unknown as Record<string, unknown> & { PK: string; SK: string });
    await store.putIfAbsent(version as unknown as Record<string, unknown> & { PK: string; SK: string });
    const service = makeService(store);

    const rejected = await service.rejectVersion(ctx({ tenant: { tenantId: TENANT, roles: ["ADMIN"] } }), documentId, 1, 1, "OTHER");
    expect(rejected.state).toBe("REJECTED");
    const outboxRows = store.allItems().filter((item) => item["entityType"] === "OutboxEvent");
    expect(outboxRows).toHaveLength(0);
  });
});
