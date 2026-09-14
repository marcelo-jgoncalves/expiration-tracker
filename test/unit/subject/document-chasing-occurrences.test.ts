/**
 * D-288: (1) real bug fix — `DocumentRequestService.listDocumentRequests()` used a SK prefix
 * (`REQASSIGN#<assignmentId>#DOCREQ#`) that also matched `DocumentChasingOccurrence`/
 * `DocumentChasingIntent` rows sharing the same assignment/documentRequestId, so those rows used
 * to leak into the response mistyped as `DocumentRequest`; (2) new
 * `listDocumentChasingOccurrences()` closing the A10 timeline gap (no route existed to read
 * these rows at all).
 *
 * `createDocumentRequest()` already materializes the 3 real `DocumentChasingOccurrence` tiers
 * (T7/T3/EXPIRED, `document-chasing-materializer.ts`) as a side effect of creation — these tests
 * use that REAL materialized data rather than hand-seeding a synthetic fixture, proving the fix
 * against the exact rows production actually writes.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemorySubjectStore, makeSubjectIdGenerator } from "./in-memory-store.js";
import { SubjectService } from "../../../src/modules/subject/application/subject-service.js";
import { RequirementService } from "../../../src/modules/subject/application/requirement-service.js";
import { DocumentRequestService } from "../../../src/modules/subject/application/document-request-service.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

const TENANT = "tenant-1";
const NOW = "2026-09-14T12:00:00.000Z";

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

describe("DocumentRequestService - chasing occurrences (D-288)", () => {
  let store: InMemorySubjectStore;
  let requests: DocumentRequestService;
  let subjectId: string;
  let assignmentId: string;
  let documentRequestId: string;

  beforeEach(async () => {
    store = new InMemorySubjectStore();
    const ids = makeSubjectIdGenerator();
    const subjects = new SubjectService({ store, tableName: "MainTable", ids, now: () => NOW });
    const requirements = new RequirementService({ store, tableName: "MainTable", ids, itemLookup: { itemExists: async () => true }, now: () => NOW });
    requests = new DocumentRequestService({
      store,
      tableName: "MainTable",
      ids,
      guestTokenPepper: "test-pepper",
      shardConfig: defaultShardConfig(),
      initialInviteEmailEnabled: false,
      now: () => NOW,
    });

    const subject = await subjects.createSubject(ctx(), { type: "VENDOR", displayName: "ACME" });
    subjectId = subject.subjectId;
    const assignment = await requirements.assignRequirement(ctx(), subjectId, { requirementName: "Certidão negativa" });
    assignmentId = assignment.assignmentId;
    // Materializes the 3 real DocumentChasingOccurrence tiers (T7/T3/EXPIRED) as a side effect -
    // exactly the rows these tests exercise, never a hand-built fixture.
    const created = await requests.createDocumentRequest(ctx(), subjectId, assignmentId, { recipientEmail: "vendor@example.com" });
    documentRequestId = created.request.documentRequestId;
  });

  it("BUG FIX: listDocumentRequests never returns a DocumentChasingOccurrence row sharing the same SK prefix, even though the store has 3 real ones for this exact assignment", async () => {
    const result = await requests.listDocumentRequests(ctx(), subjectId, assignmentId);
    expect(result).toHaveLength(1);
    expect(result[0]?.entityType).toBe("DocumentRequest");
    expect(result[0]?.documentRequestId).toBe(documentRequestId);
  });

  it("listDocumentChasingOccurrences: returns exactly the 3 real materialized tiers (T7/T3/EXPIRED) for this documentRequestId", async () => {
    const result = await requests.listDocumentChasingOccurrences(ctx(), subjectId, documentRequestId);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.entityType === "DocumentChasingOccurrence")).toBe(true);
    expect(result.every((r) => r.documentRequestId === documentRequestId)).toBe(true);
    expect(new Set(result.map((r) => r.tier))).toEqual(new Set(["T7", "T3", "EXPIRED"]));
  });

  it("listDocumentChasingOccurrences: never returns a DocumentChasingIntent row (adjacent SK namespace, CHASINGINTENT# vs CHASING#)", async () => {
    const tenantId = authorizedTenantIdFromPersistedEntity({ tenantId: TENANT });
    await store.putIfAbsent({
      PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`,
      SK: `REQASSIGN#${assignmentId}#DOCREQ#${documentRequestId}#CHASINGINTENT#intent-1`,
      entityType: "DocumentChasingIntent",
      intentId: "intent-1",
      tenantId: TENANT,
      subjectId,
      assignmentId,
      documentRequestId,
      occurrenceId: "occ-1",
      tier: "T7",
      recipient: { kind: "EXTERNAL_EMAIL_SNAPSHOT", email: "vendor@example.com" },
      templateId: "document-chasing-t7",
      templateVersion: 1,
      status: "PENDING",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const result = await requests.listDocumentChasingOccurrences(ctx(), subjectId, documentRequestId);
    expect(result).toHaveLength(3); // still only the 3 real occurrences, never the intent row.
    expect(result.every((r) => r.entityType === "DocumentChasingOccurrence")).toBe(true);
  });

  it("listDocumentChasingOccurrences: a documentRequestId that doesn't exist rejects with NotFoundError, never an empty list (same discipline as getDocumentRequest)", async () => {
    await expect(requests.listDocumentChasingOccurrences(ctx(), subjectId, "docreq-does-not-exist")).rejects.toThrow();
  });
});
