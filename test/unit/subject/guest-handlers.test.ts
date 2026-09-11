/**
 * HTTP-handler-level coverage for `src/modules/subject/http/guest-handlers.ts` - previously
 * exercised only indirectly through `GuestSubmissionService` (`guest-upload-flow.test.ts`), never
 * through the actual `{statusCode, body}` HTTP wrapper. D-266's own lesson (a schema-registration
 * gap invisible to service-level tests alone) is the reason this exists: Block 7 (D-267) adds a
 * new route (`GET /guest/document-requests/{token}/info`, `guest-documents-handler.ts`) that
 * dispatches to the SAME `handleGetGuestRequest` as the pre-existing bare route - this proves the
 * handler itself produces the correct HTTP shape, independent of which routeKey a Lambda entry
 * maps to it.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemorySubjectStore, makeSubjectIdGenerator, makeItemLookup, activeLifecycleRecord } from "./in-memory-store.js";
import { SubjectService } from "../../../src/modules/subject/application/subject-service.js";
import { RequirementService } from "../../../src/modules/subject/application/requirement-service.js";
import { DocumentRequestService } from "../../../src/modules/subject/application/document-request-service.js";
import { GuestSubmissionService } from "../../../src/modules/subject/application/guest-submission-service.js";
import { GuestRateLimiter } from "../../../src/modules/subject/application/guest-rate-limiter.js";
import { handleGetGuestRequest, handleStartGuestSubmission, type GuestHttpDeps } from "../../../src/modules/subject/http/guest-handlers.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { UploadUrlSigner } from "../../../src/modules/document/ports/upload-url-signer.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";

const PEPPER = "test-pepper";
const QUARANTINE_BUCKET = "quarantine-bucket";

function ctx(): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "tenant-1", roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
  };
}

function fakeSigner(): UploadUrlSigner {
  return {
    presignUpload: async (input) => ({ uploadUrl: `https://signed.example/${input.key}`, requiredHeaders: { "Content-Type": input.mediaType } }),
  };
}

describe("guest-handlers.ts HTTP wrapper (A10/G01, Block 7)", () => {
  let deps: GuestHttpDeps;
  let documentRequests: DocumentRequestService;
  let subjectId: string;
  let assignmentId: string;

  beforeEach(async () => {
    const store = new InMemorySubjectStore([activeLifecycleRecord("tenant-1")]);
    const ids = makeSubjectIdGenerator();
    const subjects = new SubjectService({ store, tableName: "MainTable", ids, now: () => "2026-09-10T12:00:00.000Z" });
    const requirements = new RequirementService({ store, tableName: "MainTable", ids, itemLookup: makeItemLookup(new Set()), now: () => "2026-09-10T12:00:00.000Z" });
    documentRequests = new DocumentRequestService({ store, tableName: "MainTable", ids, guestTokenPepper: PEPPER, shardConfig: defaultShardConfig(), initialInviteEmailEnabled: false, now: () => "2026-09-10T12:00:00.000Z" });
    const guestSubmissions = new GuestSubmissionService({
      store,
      tableName: "MainTable",
      quarantineBucket: QUARANTINE_BUCKET,
      ids,
      signer: fakeSigner(),
      rateLimiter: new GuestRateLimiter(store, () => "2026-09-10T12:00:00.000Z"),
      guestTokenPepper: PEPPER,
      now: () => "2026-09-10T12:00:00.000Z",
    });
    deps = { guestSubmissions };

    const subject = await subjects.createSubject(ctx(), { type: "VENDOR", displayName: "ACME" });
    subjectId = subject.subjectId;
    const assignment = await requirements.assignRequirement(ctx(), subjectId, { requirementName: "Seguro RC" });
    assignmentId = assignment.assignmentId;
  });

  it("handleGetGuestRequest returns 200 with the request info, wrapped under {request}", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    const response = await handleGetGuestRequest(deps, { pathParameters: { token: created.guestToken } });
    expect(response.statusCode).toBe(200);
    expect((response.body["request"] as { requirementName: string }).requirementName).toBe("Seguro RC");
  });

  it("handleGetGuestRequest returns the SAME shape on a second call (the /info alias route dispatches to this exact function - proves it's stable/idempotent to call twice, as G01's page load + fetch would)", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    const first = await handleGetGuestRequest(deps, { pathParameters: { token: created.guestToken } });
    const second = await handleGetGuestRequest(deps, { pathParameters: { token: created.guestToken } });
    expect(second.statusCode).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("handleGetGuestRequest maps an invalid token to 401, never a distinguishable status", async () => {
    const response = await handleGetGuestRequest(deps, { pathParameters: { token: "not-a-real-token" } });
    expect(response.statusCode).toBe(401);
  });

  it("handleGetGuestRequest 400s when the token path parameter is missing", async () => {
    const response = await handleGetGuestRequest(deps, {});
    expect(response.statusCode).toBe(400);
  });

  it("handleStartGuestSubmission returns 201 with a presigned upload URL", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    const response = await handleStartGuestSubmission(deps, {
      pathParameters: { token: created.guestToken },
      body: { fileName: "seguro.pdf", mediaType: "application/pdf", contentLength: 1000, checksumSha256: "a".repeat(64) },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body["uploadUrl"]).toBeDefined();
  });

  it("handleStartGuestSubmission 400s when the request body is missing", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    const response = await handleStartGuestSubmission(deps, { pathParameters: { token: created.guestToken } });
    expect(response.statusCode).toBe(400);
  });
});
