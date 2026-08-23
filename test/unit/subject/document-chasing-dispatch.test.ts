import { describe, expect, it, beforeEach } from "vitest";
import { InMemorySubjectStore } from "./in-memory-store.js";
import { dispatchChasingOccurrence, type ChasingDispatchDeps } from "../../../src/workers/document-chasing-dispatch/dispatch.js";
import { documentChasingOccurrenceKey, type DocumentChasingOccurrence, type DocumentChasingIntent, type DocumentChasingTier } from "../../../src/modules/subject/domain/document-chasing.js";
import { documentRequestKey, type DocumentRequest, type DocumentRequestStatus } from "../../../src/modules/subject/domain/document-request.js";
import { requirementAssignmentKey, type RequirementAssignment } from "../../../src/modules/subject/domain/requirement-assignment.js";
import { guestTokenPointerKey, issueGuestToken, epochSecondsFromIso } from "../../../src/modules/subject/domain/guest-token.js";
import type { ChasingDispatchCommand } from "../../../src/modules/subject/application/document-chasing-producer.js";
import type { EmailProviderAdapter, EmailSendInput, EmailSendResult } from "../../../src/modules/notification/ports/email-provider.js";

const TENANT = "tenant-1";
const SUBJECT = "subject-1";
const ASSIGNMENT = "assignment-1";
const DOCREQ = "docreq-1";
const OCC_ID = "chase-occ-1";
const SCHEDULED_AT = "2026-08-23T12:00:00.000Z";
const PEPPER = "test-pepper";

class FakeEmailProvider implements EmailProviderAdapter {
  sent: EmailSendInput[] = [];
  shouldFail = false;

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    this.sent.push(input);
    if (this.shouldFail) throw new Error("simulated SES failure");
    return { providerMessageId: `msg-${this.sent.length}` };
  }
}

function command(tier: DocumentChasingTier, overrides: Partial<ChasingDispatchCommand["data"]> = {}): ChasingDispatchCommand {
  return {
    messageVersion: 1,
    messageId: "evt-1",
    createdAt: SCHEDULED_AT,
    correlationId: "cor-1",
    commandType: "document-chasing.dispatch.v1",
    tenantId: TENANT,
    deduplicationKey: `${TENANT}|${OCC_ID}|2`,
    data: {
      subjectId: SUBJECT,
      assignmentId: ASSIGNMENT,
      documentRequestId: DOCREQ,
      occurrenceId: OCC_ID,
      occurrenceVersion: 2,
      tier,
      scheduledAt: SCHEDULED_AT,
      documentRequestVersion: 1,
      ...overrides,
    },
  };
}

describe("dispatchChasingOccurrence (D-039/D-046/D-048)", () => {
  let store: InMemorySubjectStore;
  let emailProvider: FakeEmailProvider;
  let deps: ChasingDispatchDeps;

  async function seedOccurrence(tier: DocumentChasingTier, status: "CLAIMED" | "SCHEDULED" | "TRIGGERED" = "CLAIMED"): Promise<DocumentChasingOccurrence> {
    const occurrence: DocumentChasingOccurrence = {
      ...documentChasingOccurrenceKey(TENANT, SUBJECT, ASSIGNMENT, DOCREQ, SCHEDULED_AT, OCC_ID),
      entityType: "DocumentChasingOccurrence",
      occurrenceId: OCC_ID,
      tenantId: TENANT,
      subjectId: SUBJECT,
      assignmentId: ASSIGNMENT,
      documentRequestId: DOCREQ,
      tier,
      scheduledAt: SCHEDULED_AT,
      documentRequestVersion: 1,
      shard: "00",
      shardFnVersion: 1,
      status,
      version: 2,
      createdAt: SCHEDULED_AT,
      updatedAt: SCHEDULED_AT,
    };
    await store.putIfAbsent(occurrence);
    return occurrence;
  }

  async function seedRequest(status: DocumentRequestStatus = "REQUESTED", version = 1): Promise<DocumentRequest> {
    const issued = issueGuestToken(PEPPER);
    const request: DocumentRequest = {
      ...documentRequestKey(TENANT, SUBJECT, ASSIGNMENT, DOCREQ),
      entityType: "DocumentRequest",
      documentRequestId: DOCREQ,
      tenantId: TENANT,
      subjectId: SUBJECT,
      assignmentId: ASSIGNMENT,
      recipientEmail: "fornecedor@example.com",
      recipientDisplayName: "Fornecedor ACME",
      requestedByUserId: "user-1",
      requestedAt: SCHEDULED_AT,
      deadline: "2026-09-06T12:00:00.000Z",
      status,
      tokenSelectorHash: issued.selectorHash,
      tokenVersion: 1,
      tokenExpiresAt: "2026-09-06T12:00:00.000Z",
      submissionCount: 0,
      createdAt: SCHEDULED_AT,
      updatedAt: SCHEDULED_AT,
      version,
    };
    await store.putIfAbsent(request);
    await store.putIfAbsent({
      ...guestTokenPointerKey(issued.selectorHash),
      entityType: "GuestTokenPointer",
      selectorHash: issued.selectorHash,
      secretHash: issued.secretHash,
      tenantId: TENANT,
      subjectId: SUBJECT,
      assignmentId: ASSIGNMENT,
      documentRequestId: DOCREQ,
      tokenVersion: 1,
      expiresAt: request.tokenExpiresAt,
      purgeAfterTtl: epochSecondsFromIso(request.tokenExpiresAt),
      createdAt: SCHEDULED_AT,
      updatedAt: SCHEDULED_AT,
      version: 1,
    });
    return request;
  }

  async function seedAssignment(): Promise<RequirementAssignment> {
    const assignment: RequirementAssignment = {
      ...requirementAssignmentKey(TENANT, SUBJECT, ASSIGNMENT),
      entityType: "RequirementAssignment",
      assignmentId: ASSIGNMENT,
      tenantId: TENANT,
      subjectId: SUBJECT,
      requirementName: "Certidão negativa",
      status: "MISSING",
      version: 1,
      createdAt: SCHEDULED_AT,
      updatedAt: SCHEDULED_AT,
    };
    await store.putIfAbsent(assignment);
    return assignment;
  }

  beforeEach(() => {
    store = new InMemorySubjectStore();
    emailProvider = new FakeEmailProvider();
    deps = {
      store,
      tableName: "MainTable",
      now: () => "2026-08-23T12:00:30.000Z",
      newIntentId: () => "intent-1",
      guestTokenPepper: PEPPER,
      emailProvider,
      resolveInternalUserEmail: async () => "internal-user@tenant.example",
      guestUploadBaseUrl: "https://app.example.invalid/guest/document-requests",
      correlationId: () => "cor-1",
    };
  });

  it("T7: rotates the guest token, sends the external email with the new link, marks SENT", async () => {
    const request = await seedRequest();
    await seedAssignment();
    await seedOccurrence("T7");

    const outcome = await dispatchChasingOccurrence(deps, command("T7"));

    expect(outcome.kind).toBe("SENT");
    expect(emailProvider.sent).toHaveLength(1);
    expect(emailProvider.sent[0]?.to).toBe("fornecedor@example.com");
    expect(emailProvider.sent[0]?.templateId).toBe("document-request-chasing");
    const link = (emailProvider.sent[0]?.renderContext["guestLink"] as string) ?? "";
    expect(link).toContain(deps.guestUploadBaseUrl);
    expect(link).not.toContain(request.tokenSelectorHash); // never re-sends the ORIGINAL token

    const updatedRequest = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, ASSIGNMENT, DOCREQ));
    expect(updatedRequest?.tokenVersion).toBe(2);
    expect(updatedRequest?.tokenSelectorHash).not.toBe(request.tokenSelectorHash);

    const occurrenceRow = await store.get<DocumentChasingOccurrence>(documentChasingOccurrenceKey(TENANT, SUBJECT, ASSIGNMENT, DOCREQ, SCHEDULED_AT, OCC_ID));
    expect(occurrenceRow?.status).toBe("TRIGGERED");

    const intent = await store.get<DocumentChasingIntent>({ PK: `TENANT#${TENANT}#SUBJECT#${SUBJECT}`, SK: `REQASSIGN#${ASSIGNMENT}#DOCREQ#${DOCREQ}#CHASINGINTENT#intent-1` });
    expect(intent?.status).toBe("SENT");
    expect(intent?.recipient).toEqual({ kind: "EXTERNAL_EMAIL_SNAPSHOT", email: "fornecedor@example.com" });
  });

  it("EXPIRED: never rotates the token, notifies the internal user instead of the external recipient", async () => {
    await seedRequest();
    await seedAssignment();
    await seedOccurrence("EXPIRED");

    const outcome = await dispatchChasingOccurrence(deps, command("EXPIRED"));

    expect(outcome.kind).toBe("SENT");
    expect(emailProvider.sent).toHaveLength(1);
    expect(emailProvider.sent[0]?.to).toBe("internal-user@tenant.example");
    expect(emailProvider.sent[0]?.templateId).toBe("document-request-chasing-expired-internal");
    expect(JSON.stringify(emailProvider.sent[0]?.renderContext)).not.toMatch(/https?:\/\//); // never a link

    const updatedRequest = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, ASSIGNMENT, DOCREQ));
    expect(updatedRequest?.tokenVersion).toBe(1); // unchanged - no rotation on EXPIRED

    const intent = await store.get<DocumentChasingIntent>({ PK: `TENANT#${TENANT}#SUBJECT#${SUBJECT}`, SK: `REQASSIGN#${ASSIGNMENT}#DOCREQ#${DOCREQ}#CHASINGINTENT#intent-1` });
    expect(intent?.recipient).toEqual({ kind: "INTERNAL_USER", userId: "user-1" });
  });

  it("cancels the occurrence when the DocumentRequest is no longer active (already SUBMITTED)", async () => {
    await seedRequest("SUBMITTED");
    await seedAssignment();
    await seedOccurrence("T7");

    const outcome = await dispatchChasingOccurrence(deps, command("T7"));

    expect(outcome).toEqual({ kind: "CANCELLED_STALE", reason: "REQUEST_NOT_ACTIVE" });
    expect(emailProvider.sent).toHaveLength(0);
    const occurrenceRow = await store.get<DocumentChasingOccurrence>(documentChasingOccurrenceKey(TENANT, SUBJECT, ASSIGNMENT, DOCREQ, SCHEDULED_AT, OCC_ID));
    expect(occurrenceRow?.status).toBe("CANCELLED");
  });

  it("cancels the occurrence when the DocumentRequest version has moved on since materialization", async () => {
    await seedRequest("REQUESTED", 2); // version 2, but the occurrence/command still expect 1
    await seedAssignment();
    await seedOccurrence("T7");

    const outcome = await dispatchChasingOccurrence(deps, command("T7"));

    expect(outcome).toEqual({ kind: "CANCELLED_STALE", reason: "REQUEST_VERSION_MISMATCH" });
  });

  it("cancels the occurrence when scheduled outside the dispatch tolerance", async () => {
    await seedRequest();
    await seedAssignment();
    await seedOccurrence("T7");
    deps.toleranceMs = 1000; // 1s tolerance, but now() is 30s after scheduledAt in the fixture

    const outcome = await dispatchChasingOccurrence(deps, command("T7"));

    expect(outcome).toEqual({ kind: "CANCELLED_STALE", reason: "OUT_OF_TOLERANCE" });
  });

  it("is a no-op (SKIPPED_NOT_CLAIMED) when the occurrence isn't CLAIMED", async () => {
    await seedRequest();
    await seedAssignment();
    await seedOccurrence("T7", "SCHEDULED");

    const outcome = await dispatchChasingOccurrence(deps, command("T7"));
    expect(outcome).toEqual({ kind: "SKIPPED_NOT_CLAIMED" });
  });

  it("reports ALREADY_TRIGGERED when the occurrence was already dispatched (at-least-once delivery)", async () => {
    await seedRequest();
    await seedAssignment();
    await seedOccurrence("T7", "TRIGGERED");

    const outcome = await dispatchChasingOccurrence(deps, command("T7"));
    expect(outcome).toEqual({ kind: "ALREADY_TRIGGERED" });
  });

  it("SES failure marks the intent FAILED but the occurrence stays TRIGGERED (transaction already committed, best-effort send)", async () => {
    await seedRequest();
    await seedAssignment();
    await seedOccurrence("T3");
    emailProvider.shouldFail = true;

    const outcome = await dispatchChasingOccurrence(deps, command("T3"));

    expect(outcome.kind).toBe("SEND_FAILED");
    const occurrenceRow = await store.get<DocumentChasingOccurrence>(documentChasingOccurrenceKey(TENANT, SUBJECT, ASSIGNMENT, DOCREQ, SCHEDULED_AT, OCC_ID));
    expect(occurrenceRow?.status).toBe("TRIGGERED"); // never reverted just because the email failed
    const intent = await store.get<DocumentChasingIntent>({ PK: `TENANT#${TENANT}#SUBJECT#${SUBJECT}`, SK: `REQASSIGN#${ASSIGNMENT}#DOCREQ#${DOCREQ}#CHASINGINTENT#intent-1` });
    expect(intent?.status).toBe("FAILED");
    expect(intent?.failureReason).toContain("simulated SES failure");
  });

  it("EXPIRED with no resolvable internal user email marks the intent FAILED without crashing", async () => {
    await seedRequest();
    await seedAssignment();
    await seedOccurrence("EXPIRED");
    deps.resolveInternalUserEmail = async () => undefined;

    const outcome = await dispatchChasingOccurrence(deps, command("EXPIRED"));

    expect(outcome.kind).toBe("SEND_FAILED");
    expect(emailProvider.sent).toHaveLength(0);
    const intent = await store.get<DocumentChasingIntent>({ PK: `TENANT#${TENANT}#SUBJECT#${SUBJECT}`, SK: `REQASSIGN#${ASSIGNMENT}#DOCREQ#${DOCREQ}#CHASINGINTENT#intent-1` });
    expect(intent?.failureReason).toBe("INTERNAL_USER_EMAIL_NOT_FOUND");
  });
});
