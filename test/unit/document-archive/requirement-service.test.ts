import { describe, expect, it } from "vitest";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { ConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "tenant-1", roles: ["MEMBER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

function ctxAs(userId: string, roles: string[] = ["MEMBER"]): RequestContext {
  return ctx({ principal: { userId, cognitoSubject: `sub-${userId}`, sessionId: `session-${userId}` }, tenant: { tenantId: "tenant-1", roles } });
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
  };
}

const NOW = "2026-09-01T00:00:00.000Z";

function makeService(store = new InMemoryDocumentArchiveStore()) {
  const service = new DocumentArchiveService({ store, tableName: "test-table", ids: makeIds(), now: () => NOW });
  return { service, store };
}

const TENANT = "tenant-1";
const SUBJECT = "subject-1";

/** Drives a Document/DocumentVersion all the way to ACCEPTED, so tests can link real evidence
 * without duplicating the full lifecycle inline every time. */
async function acceptedVersion(service: DocumentArchiveService, validUntil?: string) {
  const doc = await service.createDocument(ctx(), { subjectId: SUBJECT, documentType: "ALVARA", hasValidity: !!validUntil });
  const draft = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
  const received = await service.commitUpload(ctx(), doc.documentId, draft.seq, draft.version);
  const underReview = await service.claimReview(ctx(), doc.documentId, draft.seq, received.version);
  await service.acceptVersion(ctx(), doc.documentId, draft.seq, underReview.version, `tok-${draft.versionId}`);
  const versions = await service.listVersions(ctx(), doc.documentId);
  let accepted = versions.find((v) => v.versionId === draft.versionId)!;
  if (validUntil) {
    // Simulate a real DocumentVersion carrying validity (Nucleus 1's acceptVersion doesn't set
    // validUntil itself - that's populated at upload time in the full design). Written directly
    // against the fake store, same technique document-archive-service.test.ts already uses to
    // simulate a pending file scan.
    const { buildVersionedUpdate } = await import("../../../src/shared/dynamodb/occ.js");
    const store = (service as any).store;
    await store.transactWrite([
      { Update: buildVersionedUpdate({ tableName: "test-table", key: { PK: accepted.PK, SK: accepted.SK }, tenantId: TENANT, expectedVersion: accepted.version, set: { validUntil } }) },
    ]);
    accepted = await store.get({ PK: accepted.PK, SK: accepted.SK });
  }
  return { doc, accepted };
}

describe("RequirementService (D-143 Nucleus 2, Decision 5/D9)", () => {
  it("creates a Requirement APPLICABLE with no evidence -> MISSING", async () => {
    const { service } = makeService();
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND Federal", applicability: "APPLICABLE" });
    expect(req.status).toBe("MISSING");
    expect(req.GSI1PK).toBe(`TENANT#${TENANT}#REQSTATUS#MISSING`);
    expect(req.version).toBe(1);
  });

  it("creates a Requirement NOT_APPLICABLE -> NOT_APPLICABLE regardless of evidence", async () => {
    const { service } = makeService();
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND Federal", applicability: "NOT_APPLICABLE" });
    expect(req.status).toBe("NOT_APPLICABLE");
  });

  it("VIEWER cannot create/update/delete a Requirement (RBAC), but can read one", async () => {
    const { service } = makeService();
    const viewer = ctxAs("viewer-1", ["VIEWER"]);
    await expect(service.createRequirement(viewer, { subjectId: SUBJECT, name: "x", applicability: "APPLICABLE" })).rejects.toThrow(AuthorizationDeniedError);
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "x", applicability: "APPLICABLE" });
    const read = await service.getRequirement(viewer, SUBJECT, req.requirementId);
    expect(read.requirementId).toBe(req.requirementId);
  });

  it("getRequirement 404s for an unknown id", async () => {
    const { service } = makeService();
    await expect(service.getRequirement(ctx(), SUBJECT, "missing")).rejects.toThrow(NotFoundError);
  });

  it("listRequirements returns every Requirement under a Subject", async () => {
    const { service } = makeService();
    await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "A", applicability: "APPLICABLE" });
    await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "B", applicability: "APPLICABLE" });
    await service.createRequirement(ctx(), { subjectId: "other-subject", name: "C", applicability: "APPLICABLE" });
    const list = await service.listRequirements(ctx(), SUBJECT);
    expect(list.map((r) => r.name).sort()).toEqual(["A", "B"]);
  });

  it("linkEvidence to an ACCEPTED version with no validUntil -> SATISFIED, denormalizing evidence fields", async () => {
    const { service } = makeService();
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND", applicability: "APPLICABLE" });
    const { doc, accepted } = await acceptedVersion(service);

    const linked = await service.linkEvidence(ctx(), SUBJECT, req.requirementId, req.version, doc.documentId, accepted.versionId);
    expect(linked.status).toBe("SATISFIED");
    expect(linked.evidenceVersionId).toBe(accepted.versionId);
    expect(linked.evidenceDocumentId).toBe(doc.documentId);
    expect(linked.evidenceSeq).toBe(accepted.seq);
    expect(linked.evidenceState).toBe("ACCEPTED");
    expect(linked.GSI1PK).toBe(`TENANT#${TENANT}#REQSTATUS#SATISFIED`);
  });

  it("linkEvidence to a RECEIVED (not yet ACCEPTED) version -> PENDING", async () => {
    const { service } = makeService();
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND", applicability: "APPLICABLE" });
    const doc = await service.createDocument(ctx(), { subjectId: SUBJECT, documentType: "ALVARA", hasValidity: false });
    const draft = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
    const received = await service.commitUpload(ctx(), doc.documentId, draft.seq, draft.version);

    const linked = await service.linkEvidence(ctx(), SUBJECT, req.requirementId, req.version, doc.documentId, received.versionId);
    expect(linked.status).toBe("PENDING");
  });

  it("linkEvidence to an ACCEPTED version already past validUntil -> NOT_SATISFIED", async () => {
    const { service } = makeService();
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND", applicability: "APPLICABLE" });
    const { doc, accepted } = await acceptedVersion(service, "2020-01-01T00:00:00.000Z");

    const linked = await service.linkEvidence(ctx(), SUBJECT, req.requirementId, req.version, doc.documentId, accepted.versionId);
    expect(linked.status).toBe("NOT_SATISFIED");
  });

  it("linkEvidence 404s when the DocumentVersion doesn't exist", async () => {
    const { service } = makeService();
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND", applicability: "APPLICABLE" });
    const doc = await service.createDocument(ctx(), { subjectId: SUBJECT, documentType: "ALVARA", hasValidity: false });
    await expect(service.linkEvidence(ctx(), SUBJECT, req.requirementId, req.version, doc.documentId, "ghost-version")).rejects.toThrow(NotFoundError);
  });

  it("unlinkEvidence clears evidence fields and returns to MISSING", async () => {
    const { service } = makeService();
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND", applicability: "APPLICABLE" });
    const { doc, accepted } = await acceptedVersion(service);
    const linked = await service.linkEvidence(ctx(), SUBJECT, req.requirementId, req.version, doc.documentId, accepted.versionId);
    expect(linked.status).toBe("SATISFIED");

    const unlinked = await service.unlinkEvidence(ctx(), SUBJECT, req.requirementId, linked.version);
    expect(unlinked.status).toBe("MISSING");
    expect(unlinked.evidenceVersionId).toBeUndefined();
    expect(unlinked.evidenceState).toBeUndefined();
    expect(unlinked.evidenceValidUntil).toBeUndefined();
  });

  it("updateRequirement flips applicability to NOT_APPLICABLE immediately, without waiting for the reindex worker", async () => {
    const { service } = makeService();
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND", applicability: "APPLICABLE" });
    const { doc, accepted } = await acceptedVersion(service);
    const linked = await service.linkEvidence(ctx(), SUBJECT, req.requirementId, req.version, doc.documentId, accepted.versionId);
    expect(linked.status).toBe("SATISFIED");

    const updated = await service.updateRequirement(ctx(), SUBJECT, req.requirementId, linked.version, { applicability: "NOT_APPLICABLE" });
    expect(updated.status).toBe("NOT_APPLICABLE");
  });

  it("updateRequirement flips applicability back to APPLICABLE and re-derives SATISFIED from cached evidence (no live re-read of DocumentVersion)", async () => {
    const { service } = makeService();
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND", applicability: "APPLICABLE" });
    const { doc, accepted } = await acceptedVersion(service);
    const linked = await service.linkEvidence(ctx(), SUBJECT, req.requirementId, req.version, doc.documentId, accepted.versionId);
    const toggledOff = await service.updateRequirement(ctx(), SUBJECT, req.requirementId, linked.version, { applicability: "NOT_APPLICABLE" });
    const toggledOn = await service.updateRequirement(ctx(), SUBJECT, req.requirementId, toggledOff.version, { applicability: "APPLICABLE" });
    expect(toggledOn.status).toBe("SATISFIED");
    // Evidence pointer itself was never touched by either applicability flip.
    expect(toggledOn.evidenceVersionId).toBe(accepted.versionId);
  });

  it("updateRequirement rejects a stale expectedVersion as a conflict", async () => {
    const { service } = makeService();
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND", applicability: "APPLICABLE" });
    await expect(service.updateRequirement(ctx(), SUBJECT, req.requirementId, req.version + 1, { name: "renamed" })).rejects.toThrow(ConflictError);
  });

  it("deleteRequirement removes the item; a second delete 404s", async () => {
    const { service } = makeService();
    const req = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND", applicability: "APPLICABLE" });
    await service.deleteRequirement(ctx(), SUBJECT, req.requirementId, req.version);
    await expect(service.getRequirement(ctx(), SUBJECT, req.requirementId)).rejects.toThrow(NotFoundError);
    await expect(service.deleteRequirement(ctx(), SUBJECT, req.requirementId, req.version)).rejects.toThrow(NotFoundError);
  });
});
