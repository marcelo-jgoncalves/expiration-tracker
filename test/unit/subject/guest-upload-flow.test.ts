import { describe, expect, it, beforeEach } from "vitest";
import { InMemorySubjectStore, makeSubjectIdGenerator, makeItemLookup } from "./in-memory-store.js";
import { SubjectService } from "../../../src/modules/subject/application/subject-service.js";
import { RequirementService } from "../../../src/modules/subject/application/requirement-service.js";
import { DocumentRequestService } from "../../../src/modules/subject/application/document-request-service.js";
import { GuestSubmissionService, GuestTokenInvalidError } from "../../../src/modules/subject/application/guest-submission-service.js";
import { GuestRateLimiter } from "../../../src/modules/subject/application/guest-rate-limiter.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { UploadUrlSigner } from "../../../src/modules/document/ports/upload-url-signer.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";

const PEPPER = "test-pepper";
const QUARANTINE_BUCKET = "quarantine-bucket";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "tenant-1", roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

function fakeSigner(): UploadUrlSigner {
  return {
    presignUpload: async (input) => ({
      uploadUrl: `https://signed.example/${input.key}`,
      requiredHeaders: { "Content-Type": input.mediaType },
    }),
  };
}

describe("Guest upload flow (DocumentRequest -> GuestSubmissionService)", () => {
  let store: InMemorySubjectStore;
  let subjects: SubjectService;
  let requirements: RequirementService;
  let documentRequests: DocumentRequestService;
  let guestSubmissions: GuestSubmissionService;
  let subjectId: string;
  let assignmentId: string;

  beforeEach(async () => {
    store = new InMemorySubjectStore();
    const ids = makeSubjectIdGenerator();
    subjects = new SubjectService({ store, tableName: "MainTable", ids, now: () => "2026-08-23T12:00:00.000Z" });
    requirements = new RequirementService({ store, tableName: "MainTable", ids, itemLookup: makeItemLookup(new Set()), now: () => "2026-08-23T12:00:00.000Z" });
    documentRequests = new DocumentRequestService({ store, tableName: "MainTable", ids, guestTokenPepper: PEPPER, shardConfig: defaultShardConfig(), initialInviteEmailEnabled: false, now: () => "2026-08-23T12:00:00.000Z" });
    guestSubmissions = new GuestSubmissionService({
      store,
      tableName: "MainTable",
      quarantineBucket: QUARANTINE_BUCKET,
      ids,
      signer: fakeSigner(),
      rateLimiter: new GuestRateLimiter(store, () => "2026-08-23T12:00:00.000Z"),
      guestTokenPepper: PEPPER,
      now: () => "2026-08-23T12:00:00.000Z",
    });

    const subject = await subjects.createSubject(ctx(), { type: "VENDOR", displayName: "ACME" });
    subjectId = subject.subjectId;
    const assignment = await requirements.assignRequirement(ctx(), subjectId, { requirementName: "Seguro RC" });
    assignmentId = assignment.assignmentId;
  });

  it("issues a guest token once at creation time and never again on subsequent reads", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    expect(created.guestToken).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{64}$/);
    expect(created.request.status).toBe("REQUESTED");

    const fetched = await documentRequests.getDocumentRequest(ctx(), subjectId, created.request.documentRequestId);
    expect((fetched as unknown as Record<string, unknown>)["guestToken"]).toBeUndefined();
  });

  it("guest can read request info with a valid token, without ever seeing internal tenant/subject/assignment IDs", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    const info = await guestSubmissions.getRequestInfo(created.guestToken);
    expect(info.requirementName).toBe("Seguro RC");
    expect(Object.keys(info)).not.toContain("tenantId");
    expect(Object.keys(info)).not.toContain("subjectId");
  });

  it("W5-01/GTR-01: getRequestInfo falls back to a generic requester name when no resolver is wired (no UserProfile.requesterDisplayName ever captured)", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    const info = await guestSubmissions.getRequestInfo(created.guestToken);
    expect(info.requesterDisplayName).toBe("Solicitante não identificado");
  });

  it("W5-01/GTR-01: getRequestInfo surfaces the resolved UserProfile.requesterDisplayName of the request's creator", async () => {
    const resolvingGuestSubmissions = new GuestSubmissionService({
      store,
      tableName: "MainTable",
      quarantineBucket: QUARANTINE_BUCKET,
      ids: makeSubjectIdGenerator(),
      signer: fakeSigner(),
      rateLimiter: new GuestRateLimiter(store, () => "2026-08-23T12:00:00.000Z"),
      guestTokenPepper: PEPPER,
      now: () => "2026-08-23T12:00:00.000Z",
      resolveRequesterDisplayName: async (input) => (input.userId === "user-1" ? "Empresa Alfa Ltda." : undefined),
    });
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    const info = await resolvingGuestSubmissions.getRequestInfo(created.guestToken);
    expect(info.requesterDisplayName).toBe("Empresa Alfa Ltda.");
  });

  it("getRequestInfo marks the request OPENED on first read", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    await guestSubmissions.getRequestInfo(created.guestToken);
    const request = await documentRequests.getDocumentRequest(ctx(), subjectId, created.request.documentRequestId);
    expect(request.status).toBe("OPENED");
    expect(request.lastOpenedAt).toBeDefined();
  });

  it("startSubmission creates a PENDING_UPLOAD DocumentSubmission with a submission-anchored quarantine key, never colliding with the item-anchored format", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    const result = await guestSubmissions.startSubmission(created.guestToken, {
      fileName: "seguro.pdf",
      mediaType: "application/pdf",
      contentLength: 1000,
      checksumSha256: "a".repeat(64),
    });
    expect(result.submissionId).toBeDefined();
    expect(result.uploadUrl).toContain(`tenant/tenant-1/subject/${subjectId}/assignment/${assignmentId}/submission/`);
    expect(result.uploadUrl).not.toContain("/item/"); // nunca colide com o formato de M6

    const request = await documentRequests.getDocumentRequest(ctx(), subjectId, created.request.documentRequestId);
    expect(request.status).toBe("SUBMITTED");
    expect(request.submissionCount).toBe(1);
    expect(request.lastSubmissionId).toBe(result.submissionId);
  });

  it("rejects a malformed token with the generic GuestTokenInvalidError, never distinguishing why", async () => {
    await expect(guestSubmissions.getRequestInfo("not-a-real-token")).rejects.toBeInstanceOf(GuestTokenInvalidError);
  });

  it("rejects a well-formed but non-existent token with the same generic error", async () => {
    await expect(guestSubmissions.getRequestInfo(`${"a".repeat(32)}.${"b".repeat(64)}`)).rejects.toBeInstanceOf(GuestTokenInvalidError);
  });

  it("rejects a valid selector with the wrong secret, using timingSafeEqual under the hood", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    const selector = created.guestToken.split(".")[0];
    const forged = `${selector}.${"0".repeat(64)}`;
    await expect(guestSubmissions.getRequestInfo(forged)).rejects.toBeInstanceOf(GuestTokenInvalidError);
  });

  it("rejects a revoked token", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    await documentRequests.revokeDocumentRequest(ctx(), subjectId, created.request.documentRequestId, created.request.version);
    await expect(guestSubmissions.getRequestInfo(created.guestToken)).rejects.toBeInstanceOf(GuestTokenInvalidError);
  });

  it("rejects an expired token", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    const expiredGuestSubmissions = new GuestSubmissionService({
      store,
      tableName: "MainTable",
      quarantineBucket: QUARANTINE_BUCKET,
      ids: makeSubjectIdGenerator(),
      signer: fakeSigner(),
      rateLimiter: new GuestRateLimiter(store, () => "2099-01-01T00:00:00.000Z"),
      guestTokenPepper: PEPPER,
      now: () => "2099-01-01T00:00:00.000Z", // muito depois do TTL de 14 dias
    });
    await expect(expiredGuestSubmissions.getRequestInfo(created.guestToken)).rejects.toBeInstanceOf(GuestTokenInvalidError);
  });

  it("enforces a per-token rate limit (30/60s), independent of tenant quota, without leaking a distinguishable error from an invalid token (anti-enumeration)", async () => {
    const created = await documentRequests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "fornecedor@example.com" });
    // As 30 primeiras chamadas consomem exatamente o limite real do serviço (30/60s).
    for (let i = 0; i < 30; i++) {
      await guestSubmissions.getRequestInfo(created.guestToken);
    }
    // Achado real de revisão adversarial (Codex): o rate limit é consumido por selectorHash
    // ANTES da checagem de existência do pointer, e QUALQUER falha nele vira o mesmo
    // GuestTokenInvalidError genérico - nunca um QuotaExceededError distinguível (isso
    // permitiria a um atacante diferenciar "token existe mas está sem quota" de "token não
    // existe", vazando a validade do selector).
    await expect(guestSubmissions.getRequestInfo(created.guestToken)).rejects.toBeInstanceOf(GuestTokenInvalidError);
  });
});
