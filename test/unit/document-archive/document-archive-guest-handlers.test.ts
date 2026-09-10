/**
 * HTTP-level coverage for `document-archive-guest-handlers.ts` — ADR-0013 (D-265), Codex review
 * round 2 residual finding: nothing previously called `handleSubmitEvidence`/`handleConfirmUpload`
 * themselves (every existing test called `GuestDocumentAccessService`'s methods directly), so a
 * schema forgotten from `defaultSchemaRegistry`'s static import list (Round 1's actual BLOCKER)
 * would never be caught by any test — `validateAgainstSchema`/`defaultSchemaRegistry` are a
 * MODULE-LEVEL import inside the handlers file, never injected, so only a test that calls the
 * handler functions themselves exercises the real production registry. These tests prove a
 * genuinely valid request completes end to end through the HTTP layer, not just the service layer.
 */
import { describe, expect, it } from "vitest";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";
import { GuestDocumentAccessService } from "../../../src/modules/document-archive/application/guest-document-access-service.js";
import { DocumentArchiveGuestRateLimiter } from "../../../src/modules/document-archive/application/document-archive-guest-rate-limiter.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore, seedActiveDocumentType } from "./in-memory-store.js";
import { documentRequestKey, type DocumentRequest } from "../../../src/modules/document-archive/domain/document-request.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { handleSubmitEvidence, handleConfirmUpload, type GuestArchiveHttpDeps } from "../../../src/modules/document-archive/http/document-archive-guest-handlers.js";
import type { UploadUrlSigner, PresignUploadInput, PresignUploadResult } from "../../../src/modules/document/ports/upload-url-signer.js";

const PEPPER = "test-pepper-value";
const TENANT = authorizedTenantIdFromPersistedEntity({ tenantId: "tenant-1" });
const SUBJECT = "subject-1";
const REQUIREMENT = "requirement-1";
const NOW = "2026-09-01T00:00:00.000Z";
const GUEST_SESSION_COOKIE_NAME = "__Host-et_docarchive_guest_session";
const GUEST_CSRF_COOKIE_NAME = "__Host-et_docarchive_guest_csrf";

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

function makeSigner(): UploadUrlSigner {
  return {
    presignUpload: async (input: PresignUploadInput): Promise<PresignUploadResult> => ({
      uploadUrl: `https://s3.example/${input.bucket}/${input.key}?sig=fake`,
      requiredHeaders: { "x-amz-checksum-sha256": input.checksumSha256 },
    }),
  };
}

async function setup() {
  const store = new InMemoryDocumentArchiveStore();
  const tenantRecord: TenantLifecycleRecord = {
    ...(tenantLifecycleKey(TENANT) as { PK: string; SK: "LIFECYCLE" }),
    entityType: "TenantLifecycleRecord",
    tenantId: TENANT,
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
  await store.putIfAbsent(tenantRecord);
  const request: DocumentRequest = {
    ...documentRequestKey(TENANT, SUBJECT, "docreq-1"),
    entityType: "DocumentRequest",
    documentRequestId: "docreq-1",
    tenantId: TENANT,
    subjectId: SUBJECT,
    requirementId: REQUIREMENT,
    status: "REQUESTED",
    deadline: "2026-12-31T00:00:00.000Z",
    submissionCount: 0,
    issuanceGeneration: 1,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
  await store.putIfAbsent(request);
  await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));

  const rateLimiter = new DocumentArchiveGuestRateLimiter(store, () => NOW);
  const guestAccess = new GuestDocumentAccessService({
    store,
    tableName: "test-table",
    ids: makeIds(),
    rateLimiter,
    pepper: PEPPER,
    quarantineBucket: "test-quarantine-bucket",
    signer: makeSigner(),
    now: () => NOW,
  });
  const deps: GuestArchiveHttpDeps = { guestAccess };

  const credential = await guestAccess.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
  const session = await guestAccess.startGuestSession(credential.token, { ip: "1.1.1.1" });
  return { deps, session };
}

describe("document-archive-guest-handlers.ts — HTTP-level (ADR-0013/D-265)", () => {
  it("handleSubmitEvidence: a genuinely valid body reaches the service and returns 201 (proves the schema is registered in defaultSchemaRegistry)", async () => {
    const { deps, session } = await setup();
    const response = await handleSubmitEvidence(deps, {
      pathParameters: { token: "irrelevant-for-resolution" },
      headers: {
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${session.session.token}; ${GUEST_CSRF_COOKIE_NAME}=${session.session.csrfToken}`,
        "x-csrf-token": session.session.csrfToken,
      },
      sourceIp: "1.1.1.1",
      body: {
        fileName: "certidao.pdf",
        documentTypeId: "ALVARA",
        mediaType: "application/pdf",
        contentLength: 1024,
        checksumSha256: "a".repeat(64),
        idempotencyKey: "idem-http-1",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body["fileId"]).toBeDefined();
    expect(response.body["uploadUrl"]).toBeDefined();
  });

  it("handleSubmitEvidence: a body failing the new mediaType/contentLength/checksumSha256 constraints is rejected (proves the new fields are actually enforced)", async () => {
    const { deps, session } = await setup();
    const response = await handleSubmitEvidence(deps, {
      pathParameters: { token: "irrelevant-for-resolution" },
      headers: {
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${session.session.token}; ${GUEST_CSRF_COOKIE_NAME}=${session.session.csrfToken}`,
        "x-csrf-token": session.session.csrfToken,
      },
      sourceIp: "1.1.1.1",
      body: {
        fileName: "certidao.pdf",
        documentTypeId: "ALVARA",
        mediaType: "application/zip",
        contentLength: 1024,
        checksumSha256: "a".repeat(64),
        idempotencyKey: "idem-http-2",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body["code"]).toBe("GUEST_ACCESS_INVALID");
  });

  it("handleConfirmUpload: a genuinely valid body reaches the service and returns 200 with {extended:true} (proves the confirm schema is registered in defaultSchemaRegistry)", async () => {
    const { deps, session } = await setup();
    const submit = await handleSubmitEvidence(deps, {
      pathParameters: { token: "irrelevant-for-resolution" },
      headers: {
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${session.session.token}; ${GUEST_CSRF_COOKIE_NAME}=${session.session.csrfToken}`,
        "x-csrf-token": session.session.csrfToken,
      },
      sourceIp: "1.1.1.1",
      body: { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "a".repeat(64), idempotencyKey: "idem-http-3" },
    });
    expect(submit.statusCode).toBe(201);

    const confirm = await handleConfirmUpload(deps, {
      pathParameters: { token: "irrelevant-for-resolution" },
      headers: {
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${session.session.token}; ${GUEST_CSRF_COOKIE_NAME}=${session.session.csrfToken}`,
        "x-csrf-token": session.session.csrfToken,
      },
      sourceIp: "1.1.1.1",
      body: { idempotencyKey: "idem-http-3" },
    });

    expect(confirm.statusCode).toBe(200);
    expect(confirm.body).toEqual({ extended: true });
  });

  it("handleConfirmUpload: a missing idempotencyKey is rejected with the generic guest error, not a schema-detail leak", async () => {
    const { deps, session } = await setup();
    const response = await handleConfirmUpload(deps, {
      pathParameters: { token: "irrelevant-for-resolution" },
      headers: {
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${session.session.token}; ${GUEST_CSRF_COOKIE_NAME}=${session.session.csrfToken}`,
        "x-csrf-token": session.session.csrfToken,
      },
      sourceIp: "1.1.1.1",
      body: {} as unknown as { idempotencyKey: string },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body["code"]).toBe("GUEST_ACCESS_INVALID");
    expect(response.body["details"]).toBeUndefined();
  });

  it("handleSubmitEvidence/handleConfirmUpload: a missing body collapses to the same generic error as an invalid one (Codex round 1 medium finding)", async () => {
    const { deps, session } = await setup();
    const headers = {
      cookie: `${GUEST_SESSION_COOKIE_NAME}=${session.session.token}; ${GUEST_CSRF_COOKIE_NAME}=${session.session.csrfToken}`,
      "x-csrf-token": session.session.csrfToken,
    };
    const submitNoBody = await handleSubmitEvidence(deps, { pathParameters: { token: "t" }, headers, sourceIp: "1.1.1.1" });
    const confirmNoBody = await handleConfirmUpload(deps, { pathParameters: { token: "t" }, headers, sourceIp: "1.1.1.1" });
    expect(submitNoBody.statusCode).toBe(401);
    expect(submitNoBody.body["code"]).toBe("GUEST_ACCESS_INVALID");
    expect(confirmNoBody.statusCode).toBe(401);
    expect(confirmNoBody.body["code"]).toBe("GUEST_ACCESS_INVALID");
  });
});
