/**
 * M10 cluster 4 (D-049): cobertura dedicada da automação do convite inicial em
 * DocumentRequestService.createDocumentRequest - kill switch, preferência de tenant,
 * override por chamada, rate limit bloqueando ANTES da criação, falha de SES best-effort.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemorySubjectStore, makeSubjectIdGenerator } from "./in-memory-store.js";
import { SubjectService } from "../../../src/modules/subject/application/subject-service.js";
import { RequirementService } from "../../../src/modules/subject/application/requirement-service.js";
import { DocumentRequestService } from "../../../src/modules/subject/application/document-request-service.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import { QuotaExceededError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { EmailProviderAdapter, EmailSendInput, EmailSendResult } from "../../../src/modules/notification/ports/email-provider.js";

const TENANT = "tenant-1";
const NOW = "2026-08-23T12:00:00.000Z";

class FakeEmailProvider implements EmailProviderAdapter {
  sent: EmailSendInput[] = [];
  shouldFail = false;
  async send(input: EmailSendInput): Promise<EmailSendResult> {
    this.sent.push(input);
    if (this.shouldFail) throw new Error("simulated SES failure");
    return { providerMessageId: `msg-${this.sent.length}` };
  }
}

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: TENANT, roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

describe("DocumentRequestService - automated initial invite (D-049)", () => {
  let store: InMemorySubjectStore;
  let subjects: SubjectService;
  let requirements: RequirementService;
  let emailProvider: FakeEmailProvider;
  let subjectId: string;
  let assignmentId: string;

  async function makeService(overrides: Partial<{ initialInviteEmailEnabled: boolean }> = {}): Promise<DocumentRequestService> {
    return new DocumentRequestService({
      store,
      tableName: "MainTable",
      ids: makeSubjectIdGenerator(),
      guestTokenPepper: "test-pepper",
      shardConfig: defaultShardConfig(),
      initialInviteEmailEnabled: overrides.initialInviteEmailEnabled ?? true,
      emailProvider,
      guestUploadBaseUrl: "https://app.example.invalid/guest/document-requests",
      now: () => NOW,
    });
  }

  beforeEach(async () => {
    store = new InMemorySubjectStore();
    emailProvider = new FakeEmailProvider();
    const ids = makeSubjectIdGenerator();
    subjects = new SubjectService({ store, tableName: "MainTable", ids, now: () => NOW });
    requirements = new RequirementService({ store, tableName: "MainTable", ids, itemLookup: { itemExists: async () => true }, now: () => NOW });
    const subject = await subjects.createSubject(ctx(), { type: "VENDOR", displayName: "ACME" });
    subjectId = subject.subjectId;
    const assignment = await requirements.assignRequirement(ctx(), subjectId, { requirementName: "Certidão negativa" });
    assignmentId = assignment.assignmentId;
  });

  it("stays MANUAL by default (no preference configured, no override) - never sends automatically", async () => {
    const service = await makeService();
    const result = await service.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "vendor@example.com" });
    expect(result.initialInviteDeliveryStatus).toBeUndefined();
    expect(emailProvider.sent).toHaveLength(0);
  });

  it("per-call override EMAIL sends automatically even without a tenant preference configured", async () => {
    const service = await makeService();
    const result = await service.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "vendor@example.com", initialInviteDelivery: "EMAIL" });
    expect(result.initialInviteDeliveryStatus).toBe("SENT");
    expect(emailProvider.sent).toHaveLength(1);
    expect(emailProvider.sent[0]?.to).toBe("vendor@example.com");
    expect(emailProvider.sent[0]?.templateId).toBe("document-request-initial-invite");
    const link = (emailProvider.sent[0]?.renderContext["guestLink"] as string) ?? "";
    expect(link).toContain(result.guestToken);
  });

  it("tenant preference EMAIL sends automatically without needing a per-call override", async () => {
    const service = await makeService();
    await service.setDocumentRequestDeliveryPreference(ctx(), "EMAIL");
    const result = await service.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "vendor@example.com" });
    expect(result.initialInviteDeliveryStatus).toBe("SENT");
  });

  it("per-call override MANUAL wins over a tenant preference of EMAIL (real use case: bulk import wants to review before sending)", async () => {
    const service = await makeService();
    await service.setDocumentRequestDeliveryPreference(ctx(), "EMAIL");
    const result = await service.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "vendor@example.com", initialInviteDelivery: "MANUAL" });
    expect(result.initialInviteDeliveryStatus).toBeUndefined();
    expect(emailProvider.sent).toHaveLength(0);
  });

  it("kill switch OFF blocks automated sending even when EMAIL was explicitly requested - request is still created, never an error", async () => {
    const service = await makeService({ initialInviteEmailEnabled: false });
    const result = await service.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "vendor@example.com", initialInviteDelivery: "EMAIL" });
    expect(result.initialInviteDeliveryStatus).toBe("DISABLED_BY_KILL_SWITCH");
    expect(emailProvider.sent).toHaveLength(0);
    expect(result.request.status).toBe("REQUESTED"); // creation itself never blocked by the kill switch
  });

  it("SES failure marks the outcome FAILED but the DocumentRequest is still created with a usable token (best-effort, never rolled back)", async () => {
    const service = await makeService();
    emailProvider.shouldFail = true;
    const result = await service.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "vendor@example.com", initialInviteDelivery: "EMAIL" });
    expect(result.initialInviteDeliveryStatus).toBe("FAILED");
    expect(result.guestToken).toBeTruthy();
    expect(result.request.status).toBe("REQUESTED");
  });

  it("exceeding the per-recipient rate limit blocks CREATION entirely (429, fail-closed) - never creates a partial request", async () => {
    const service = await makeService();
    for (let i = 0; i < 3; i++) {
      await requirements.assignRequirement(ctx(), subjectId, { requirementName: `Req ${i}` });
    }
    const assignments = await store.queryByPk<{ PK: string; SK: string; assignmentId: string; entityType: string }>(`TENANT#${TENANT}#SUBJECT#${subjectId}`, "REQASSIGN#");
    // Excludes the original `assignmentId` from `beforeEach` - it must stay untouched so the
    // final assertion below can prove no request was created under it.
    const freshAssignments = assignments.filter((a) => a.entityType === "RequirementAssignment" && a.assignmentId !== assignmentId);
    expect(freshAssignments).toHaveLength(3);

    // 3 successful EMAIL requests to the SAME recipient (per-recipient limit).
    for (let i = 0; i < 3; i++) {
      await service.createDocumentRequest(ctx(), subjectId, freshAssignments[i]!.assignmentId, { recipientEmail: "vendor@example.com", initialInviteDelivery: "EMAIL" });
    }
    expect(emailProvider.sent).toHaveLength(3);

    await expect(
      service.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "vendor@example.com", initialInviteDelivery: "EMAIL" }),
    ).rejects.toBeInstanceOf(QuotaExceededError);

    // No 4th DocumentRequest was created for this assignment - creation itself was blocked.
    // Exact match on `assignmentId` (not just the SK prefix) - the fake ID generator's shared
    // module-level counter can make one assignmentId a literal string-prefix of another
    // (e.g. "assignment-1" vs "assignment-10"), which would make prefix-only matching a false
    // positive here.
    const requests = await store.queryByPk<{ PK: string; SK: string; entityType: string; assignmentId: string }>(`TENANT#${TENANT}#SUBJECT#${subjectId}`, "REQASSIGN#");
    expect(requests.filter((r) => r.entityType === "DocumentRequest" && r.assignmentId === assignmentId)).toHaveLength(0);
  });

  it("getDocumentRequestDeliveryPreference/setDocumentRequestDeliveryPreference require ADMIN_ROLES (tenant:configure-document-request-delivery)", async () => {
    const service = await makeService();
    const memberCtx = ctx({ tenant: { tenantId: TENANT, roles: ["MEMBER"] } });
    await expect(service.setDocumentRequestDeliveryPreference(memberCtx, "EMAIL")).rejects.toThrow();
    await expect(service.getDocumentRequestDeliveryPreference(memberCtx)).rejects.toThrow();

    await service.setDocumentRequestDeliveryPreference(ctx(), "EMAIL"); // OWNER - allowed
    expect(await service.getDocumentRequestDeliveryPreference(ctx())).toBe("EMAIL");
  });
});
