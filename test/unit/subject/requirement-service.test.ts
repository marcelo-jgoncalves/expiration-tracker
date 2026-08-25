import { describe, expect, it, beforeEach } from "vitest";
import { InMemorySubjectStore, makeSubjectIdGenerator, makeItemLookup } from "./in-memory-store.js";
import { SubjectService } from "../../../src/modules/subject/application/subject-service.js";
import { RequirementService } from "../../../src/modules/subject/application/requirement-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { TrackedSubject } from "../../../src/modules/subject/domain/tracked-subject.js";
import { documentSubmissionKey, type DocumentSubmission } from "../../../src/modules/subject/domain/document-submission.js";

function makeSubmission(overrides: Partial<DocumentSubmission> & { subjectId: string; assignmentId: string; submissionId: string }): DocumentSubmission {
  return {
    ...documentSubmissionKey("tenant-1", overrides.subjectId, overrides.assignmentId, overrides.submissionId),
    entityType: "DocumentSubmission",
    tenantId: "tenant-1",
    documentRequestId: "request-1",
    fileName: "a.pdf",
    mediaType: "application/pdf",
    contentLength: 100,
    checksumSha256: "a".repeat(64),
    status: "PENDING_UPLOAD",
    quarantineObject: { bucket: "b", key: "k", versionId: "" },
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

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

describe("RequirementService", () => {
  let store: InMemorySubjectStore;
  let subjects: SubjectService;
  let requirements: RequirementService;
  let subject: TrackedSubject;

  beforeEach(async () => {
    store = new InMemorySubjectStore();
    subjects = new SubjectService({ store, tableName: "MainTable", ids: makeSubjectIdGenerator(), now: () => "2026-08-23T12:00:00.000Z" });
    requirements = new RequirementService({
      store,
      tableName: "MainTable",
      ids: makeSubjectIdGenerator(),
      itemLookup: makeItemLookup(new Set(["item-1"])),
      now: () => "2026-08-23T12:00:00.000Z",
    });
    subject = await subjects.createSubject(ctx(), { type: "VENDOR", displayName: "ACME" });
  });

  it("assignRequirement creates a MISSING assignment under the subject's partition (no new GSI)", async () => {
    const assignment = await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "Seguro RC" });

    expect(assignment.status).toBe("MISSING");
    expect(assignment.PK).toBe(`TENANT#tenant-1#SUBJECT#${subject.subjectId}`);
    expect(assignment.SK).toBe(`REQASSIGN#${assignment.assignmentId}`);
  });

  it("assignRequirement 404s against a deleted subject", async () => {
    await subjects.deleteSubject(ctx(), subject.subjectId, subject.version);
    await expect(requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("assignRequirement denies a VIEWER role", async () => {
    await expect(
      requirements.assignRequirement(ctx({ tenant: { tenantId: "tenant-1", roles: ["VIEWER"] } }), subject.subjectId, { requirementName: "x" }),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("linkExpirationItem transitions MISSING -> SATISFIED only after confirming the item exists via ExpirationItemLookup, never trusting the itemId blindly", async () => {
    const assignment = await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "Seguro RC" });

    await expect(requirements.linkExpirationItem(ctx(), subject.subjectId, assignment.assignmentId, "does-not-exist", assignment.version)).rejects.toBeInstanceOf(
      ValidationError,
    );

    const linked = await requirements.linkExpirationItem(ctx(), subject.subjectId, assignment.assignmentId, "item-1", assignment.version);
    expect(linked.status).toBe("SATISFIED");
    expect(linked.linkedItemId).toBe("item-1");
  });

  it("unlinkExpirationItem reverts SATISFIED back to MISSING and clears linkedItemId/satisfiedAt", async () => {
    const assignment = await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "Seguro RC" });
    const linked = await requirements.linkExpirationItem(ctx(), subject.subjectId, assignment.assignmentId, "item-1", assignment.version);

    const unlinked = await requirements.unlinkExpirationItem(ctx(), subject.subjectId, assignment.assignmentId, linked.version);
    expect(unlinked.status).toBe("MISSING");
    expect(unlinked.linkedItemId).toBeUndefined();

    const persisted = await store.get<{ PK: string; SK: string; linkedItemId?: string }>({
      PK: `TENANT#tenant-1#SUBJECT#${subject.subjectId}`,
      SK: `REQASSIGN#${assignment.assignmentId}`,
    });
    expect(persisted?.linkedItemId).toBeUndefined();
  });

  it("updateRequirementAssignment enforces OCC", async () => {
    const assignment = await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "a" });
    await expect(requirements.updateRequirementAssignment(ctx(), subject.subjectId, assignment.assignmentId, { requirementName: "b" }, 999)).rejects.toBeInstanceOf(
      ConflictError,
    );
    const updated = await requirements.updateRequirementAssignment(ctx(), subject.subjectId, assignment.assignmentId, { requirementName: "b" }, assignment.version);
    expect(updated.requirementName).toBe("b");
  });

  it("listRequirementAssignments lists every assignment under the subject's partition and excludes soft-deleted ones", async () => {
    const a = await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "a" });
    await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "b" });
    await requirements.deleteRequirementAssignment(ctx(), subject.subjectId, a.assignmentId, a.version);

    const listed = await requirements.listRequirementAssignments(ctx(), subject.subjectId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.requirementName).toBe("b");
  });

  describe("getDocumentSubmission/listDocumentSubmissions (BLOCKER-A, segunda metade)", () => {
    it("listDocumentSubmissions lists every submission under the assignment's SK range, excludes another assignment's submissions", async () => {
      const a = await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "a" });
      const other = await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "other" });
      await store.putIfAbsent(makeSubmission({ subjectId: subject.subjectId, assignmentId: a.assignmentId, submissionId: "sub-1" }));
      await store.putIfAbsent(makeSubmission({ subjectId: subject.subjectId, assignmentId: a.assignmentId, submissionId: "sub-2" }));
      await store.putIfAbsent(makeSubmission({ subjectId: subject.subjectId, assignmentId: other.assignmentId, submissionId: "sub-3" }));

      const listed = await requirements.listDocumentSubmissions(ctx(), subject.subjectId, a.assignmentId);
      expect(listed.map((s) => s.submissionId).sort()).toEqual(["sub-1", "sub-2"]);
    });

    it("listDocumentSubmissions excludes soft-deleted submissions", async () => {
      const a = await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "a" });
      await store.putIfAbsent(makeSubmission({ subjectId: subject.subjectId, assignmentId: a.assignmentId, submissionId: "sub-1" }));
      await store.putIfAbsent(makeSubmission({ subjectId: subject.subjectId, assignmentId: a.assignmentId, submissionId: "sub-2", deletedAt: "2026-08-24T00:00:00.000Z" }));

      const listed = await requirements.listDocumentSubmissions(ctx(), subject.subjectId, a.assignmentId);
      expect(listed.map((s) => s.submissionId)).toEqual(["sub-1"]);
    });

    it("getDocumentSubmission returns a real submission by id", async () => {
      const a = await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "a" });
      await store.putIfAbsent(makeSubmission({ subjectId: subject.subjectId, assignmentId: a.assignmentId, submissionId: "sub-1" }));

      const submission = await requirements.getDocumentSubmission(ctx(), subject.subjectId, a.assignmentId, "sub-1");
      expect(submission.submissionId).toBe("sub-1");
    });

    it("getDocumentSubmission throws NotFoundError for a submission that never existed", async () => {
      const a = await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "a" });
      await expect(requirements.getDocumentSubmission(ctx(), subject.subjectId, a.assignmentId, "no-such")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("getDocumentSubmission denies a VIEWER-less/no-membership role the same way other reads do", async () => {
      const a = await requirements.assignRequirement(ctx(), subject.subjectId, { requirementName: "a" });
      await store.putIfAbsent(makeSubmission({ subjectId: subject.subjectId, assignmentId: a.assignmentId, submissionId: "sub-1" }));
      await expect(
        requirements.getDocumentSubmission(ctx({ tenant: { tenantId: "tenant-1", roles: [] } }), subject.subjectId, a.assignmentId, "sub-1"),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    });
  });
});
