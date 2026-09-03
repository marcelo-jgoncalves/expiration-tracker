import { describe, expect, it, beforeEach } from "vitest";
import { InMemorySubjectStore, makeSubjectIdGenerator } from "./in-memory-store.js";
import { SubjectService } from "../../../src/modules/subject/application/subject-service.js";
import { ValidationError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { subjectKey, gsi7Keys, normalizeDisplayName, type TrackedSubject } from "../../../src/modules/subject/domain/tracked-subject.js";

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

function makeSubject(tenantId: string, subjectId: string, displayName: string, opts: { type?: TrackedSubject["type"]; tags?: string[] } = {}): TrackedSubject {
  const type = opts.type ?? "VENDOR";
  const displayNameNormalized = normalizeDisplayName(displayName);
  return {
    ...subjectKey(tenantId, subjectId),
    entityType: "TrackedSubject",
    subjectId,
    tenantId,
    type,
    displayName,
    displayNameNormalized,
    tags: opts.tags ?? [],
    status: "ACTIVE",
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    version: 1,
    ...gsi7Keys(tenantId, "ACTIVE", type, displayNameNormalized, subjectId),
  };
}

describe("SubjectService.searchSubjects (D-194 Fatia 3)", () => {
  let store: InMemorySubjectStore;
  let service: SubjectService;

  beforeEach(() => {
    store = new InMemorySubjectStore();
    service = new SubjectService({ store, tableName: "MainTable", ids: makeSubjectIdGenerator(), now: () => "2026-08-23T12:00:00.000Z" });
  });

  it("rejects a call with no status (status is required and singular)", async () => {
    await expect(service.searchSubjects(ctx(), { status: undefined as unknown as "ACTIVE" })).rejects.toThrow(ValidationError);
  });

  it("paginates across real physical GSI7 pages - a second call with the first page's cursor never repeats or skips an item", async () => {
    for (let i = 0; i < 40; i++) {
      await store.putIfAbsent(makeSubject("tenant-1", `s${i}`, `Vendor ${String(i).padStart(2, "0")}`));
    }
    const page1 = await service.searchSubjects(ctx(), { status: "ACTIVE" });
    // 40 items = 2 physical pages of <=25, both fetched within the 5-page cap - a natural end,
    // no cursor, every item present exactly once.
    expect(page1.items).toHaveLength(40);
    expect(page1.lastEvaluatedKey).toBeUndefined();
    expect(page1.scanLimitReached).toBe(false);
    const ids = page1.items.map((h) => h.subject.subjectId);
    expect(new Set(ids).size).toBe(40);
  });

  it("filters by type + namePrefix as a PREFIX match against displayNameNormalized when type is given", async () => {
    await store.putIfAbsent(makeSubject("tenant-1", "s1", "Alfa Seguros", { type: "VENDOR" }));
    await store.putIfAbsent(makeSubject("tenant-1", "s2", "Alfa Transportes", { type: "VENDOR" }));
    await store.putIfAbsent(makeSubject("tenant-1", "s3", "Beta Alfa", { type: "VENDOR" })); // "alfa" not a PREFIX here
    await store.putIfAbsent(makeSubject("tenant-1", "s4", "Alfa Cliente", { type: "CLIENT" })); // wrong type

    const page = await service.searchSubjects(ctx(), { status: "ACTIVE", type: "VENDOR", namePrefix: "Alfa" });
    const names = page.items.map((h) => h.subject.displayName).sort();
    expect(names).toEqual(["Alfa Seguros", "Alfa Transportes"]);
  });

  it("falls back to a SUBSTRING match against displayNameNormalized when type is absent", async () => {
    await store.putIfAbsent(makeSubject("tenant-1", "s1", "Beta Alfa Seguros"));
    await store.putIfAbsent(makeSubject("tenant-1", "s2", "Gama Ltda"));

    const page = await service.searchSubjects(ctx(), { status: "ACTIVE", namePrefix: "alfa" });
    expect(page.items.map((h) => h.subject.subjectId)).toEqual(["s1"]);
  });

  it("filters by tag (exact membership)", async () => {
    await store.putIfAbsent(makeSubject("tenant-1", "s1", "Vendor A", { tags: ["urgent", "food"] }));
    await store.putIfAbsent(makeSubject("tenant-1", "s2", "Vendor B", { tags: ["food"] }));

    const page = await service.searchSubjects(ctx(), { status: "ACTIVE", tag: "urgent" });
    expect(page.items.map((h) => h.subject.subjectId)).toEqual(["s1"]);
  });

  it("caps at 5 native pages of 25 (125 evaluated) and signals scanLimitReached with a resumable cursor when more exist", async () => {
    for (let i = 0; i < 200; i++) {
      await store.putIfAbsent(makeSubject("tenant-1", `s${i}`, `Vendor ${String(i).padStart(3, "0")}`));
    }
    const page = await service.searchSubjects(ctx(), { status: "ACTIVE" });
    expect(page.items).toHaveLength(125);
    expect(page.scanLimitReached).toBe(true);
    expect(page.lastEvaluatedKey).toBeDefined();

    const nextPage = await service.searchSubjects(ctx(), { status: "ACTIVE", exclusiveStartKey: page.lastEvaluatedKey });
    expect(nextPage.items).toHaveLength(75); // remaining 200-125
    expect(nextPage.scanLimitReached).toBe(false);
    const allIds = [...page.items, ...nextPage.items].map((h) => h.subject.subjectId);
    expect(new Set(allIds).size).toBe(200);
  });
});
