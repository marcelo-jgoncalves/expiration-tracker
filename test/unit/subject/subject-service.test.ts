import { describe, expect, it, beforeEach } from "vitest";
import { InMemorySubjectStore, makeSubjectIdGenerator } from "./in-memory-store.js";
import { SubjectService } from "../../../src/modules/subject/application/subject-service.js";
import { ConflictError, NotFoundError, QuotaExceededError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { DEFAULT_ACTIVE_TRACKED_SUBJECTS_LIMIT, entitlementKey } from "../../../src/modules/subject/domain/entitlement.js";

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

describe("SubjectService", () => {
  let store: InMemorySubjectStore;
  let service: SubjectService;

  beforeEach(() => {
    store = new InMemorySubjectStore();
    service = new SubjectService({ store, tableName: "MainTable", ids: makeSubjectIdGenerator(), now: () => "2026-08-23T12:00:00.000Z" });
  });

  it("createSubject provisions the default entitlement on first use and increments its counter atomically with the subject write", async () => {
    const subject = await service.createSubject(ctx(), { type: "VENDOR", displayName: "ACME Seguros" });

    expect(subject.version).toBe(1);
    expect(subject.status).toBe("ACTIVE");
    expect(subject.displayNameNormalized).toBe("acme seguros");
    expect(subject.GSI7PK).toBe("TENANT#tenant-1#SUBJECTSTATUS#ACTIVE");

    const entitlement = await store.get<{ PK: string; SK: string; activeTrackedSubjectsCount: number; activeTrackedSubjectsLimit: number }>(
      entitlementKey("tenant-1"),
    );
    expect(entitlement?.activeTrackedSubjectsCount).toBe(1);
    expect(entitlement?.activeTrackedSubjectsLimit).toBe(DEFAULT_ACTIVE_TRACKED_SUBJECTS_LIMIT);

    const audits = store.allItems().filter((i) => i["entityType"] === "SubjectAuditEvent");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.["action"]).toBe("CREATE");
  });

  it("createSubject denies a VIEWER role", async () => {
    await expect(service.createSubject(ctx({ tenant: { tenantId: "tenant-1", roles: ["VIEWER"] } }), { type: "VENDOR", displayName: "x" })).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
  });

  it("createSubject rejects with QuotaExceededError once the plan's active-subject limit is reached, and never creates a partial subject", async () => {
    for (let i = 0; i < DEFAULT_ACTIVE_TRACKED_SUBJECTS_LIMIT; i++) {
      await service.createSubject(ctx(), { type: "VENDOR", displayName: `Subject ${i}` });
    }
    await expect(service.createSubject(ctx(), { type: "VENDOR", displayName: "one too many" })).rejects.toBeInstanceOf(QuotaExceededError);

    const subjects = store.allItems().filter((i) => i["entityType"] === "TrackedSubject");
    expect(subjects).toHaveLength(DEFAULT_ACTIVE_TRACKED_SUBJECTS_LIMIT);
  });

  it("getSubject 404s on a soft-deleted subject", async () => {
    const subject = await service.createSubject(ctx(), { type: "VENDOR", displayName: "a" });
    await service.deleteSubject(ctx(), subject.subjectId, subject.version);
    await expect(service.getSubject(ctx(), subject.subjectId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateSubject enforces OCC: a stale expectedVersion is rejected with ConflictError, a fresh one succeeds", async () => {
    const subject = await service.createSubject(ctx(), { type: "VENDOR", displayName: "a" });
    await expect(service.updateSubject(ctx(), subject.subjectId, { displayName: "b" }, 999)).rejects.toBeInstanceOf(ConflictError);

    const updated = await service.updateSubject(ctx(), subject.subjectId, { displayName: "b" }, subject.version);
    expect(updated.version).toBe(2);
    expect(updated.displayName).toBe("b");
  });

  it("archiveSubject releases 1 entitlement slot in the same transaction as the status change", async () => {
    const subject = await service.createSubject(ctx(), { type: "VENDOR", displayName: "a" });
    let entitlement = await store.get<{ PK: string; SK: string; activeTrackedSubjectsCount: number }>(entitlementKey("tenant-1"));
    expect(entitlement?.activeTrackedSubjectsCount).toBe(1);

    await service.archiveSubject(ctx(), subject.subjectId, subject.version);

    entitlement = await store.get<{ PK: string; SK: string; activeTrackedSubjectsCount: number }>(entitlementKey("tenant-1"));
    expect(entitlement?.activeTrackedSubjectsCount).toBe(0);

    const archived = await store.get<{ PK: string; SK: string; status: string }>({ PK: `TENANT#tenant-1#SUBJECT#${subject.subjectId}`, SK: "META" });
    expect(archived?.status).toBe("ARCHIVED");
  });

  it("archiving a subject frees a slot that a new subject can then use", async () => {
    for (let i = 0; i < DEFAULT_ACTIVE_TRACKED_SUBJECTS_LIMIT; i++) {
      await service.createSubject(ctx(), { type: "VENDOR", displayName: `Subject ${i}` });
    }
    const all = store.allItems().filter((i) => i["entityType"] === "TrackedSubject");
    const first = all[0] as unknown as { subjectId: string; version: number };
    await service.archiveSubject(ctx(), first.subjectId, first.version);

    await expect(service.createSubject(ctx(), { type: "VENDOR", displayName: "fits now" })).resolves.toBeDefined();
  });

  it("listSubjects returns only subjects matching the requested status via GSI7", async () => {
    const a = await service.createSubject(ctx(), { type: "VENDOR", displayName: "a" });
    await service.createSubject(ctx(), { type: "VENDOR", displayName: "b" });
    await service.archiveSubject(ctx(), a.subjectId, a.version);

    const active = await service.listSubjects(ctx(), { status: "ACTIVE" });
    const archived = await service.listSubjects(ctx(), { status: "ARCHIVED" });
    expect(active).toHaveLength(1);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.subjectId).toBe(a.subjectId);
  });
});
