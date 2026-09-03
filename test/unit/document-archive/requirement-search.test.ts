import { describe, expect, it } from "vitest";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle } from "./in-memory-store.js";
import { ValidationError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { requirementKey, requirementGsi1Keys, type Requirement } from "../../../src/modules/document-archive/domain/requirement.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

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
  };
}

const TENANT = "tenant-1";
const NOW = "2026-09-03T00:00:00.000Z";

function makeRequirement(
  subjectId: string,
  requirementId: string,
  name: string,
  opts: { status?: Requirement["status"]; assigneeUserId?: string; evidenceValidUntil?: string } = {},
): Record<string, unknown> & EntityKey {
  const status = opts.status ?? "MISSING";
  return {
    ...requirementKey(TENANT, subjectId, requirementId),
    entityType: "Requirement",
    requirementId,
    tenantId: TENANT,
    subjectId,
    name,
    applicability: "APPLICABLE",
    status,
    ...(opts.assigneeUserId !== undefined ? { assigneeUserId: opts.assigneeUserId } : {}),
    ...(status === "SATISFIED" ? { evidenceState: "ACCEPTED" as const, evidenceValidUntil: opts.evidenceValidUntil } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...requirementGsi1Keys(TENANT, status, NOW, requirementId),
  } as unknown as Record<string, unknown> & EntityKey;
}

function makeService(store: InMemoryDocumentArchiveStore) {
  const signer = { presignUpload: async () => ({ uploadUrl: "https://s3.example/fake?sig=fake", requiredHeaders: {} }) };
  const members = { isEligibleMember: async () => true };
  return new DocumentArchiveService({ store, tableName: "test-table", ids: makeIds(), quarantineBucket: "test-quarantine-bucket", signer, members, now: () => NOW });
}

describe("DocumentArchiveService.searchRequirements (D-194 Fatia 3)", () => {
  it("rejects a call with no status (status is required and singular)", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT)]);
    const service = makeService(store);
    await expect(service.searchRequirements(ctx(), { status: undefined as unknown as "MISSING" })).rejects.toThrow(ValidationError);
  });

  it("filters by name (substring, never prefix - Requirement has no type-scoped ordering)", async () => {
    const store = new InMemoryDocumentArchiveStore([
      seedActiveTenantLifecycle(TENANT),
      makeRequirement("subj-1", "req-1", "Certidão Negativa Federal"),
      makeRequirement("subj-1", "req-2", "Alvará Negativo"),
      makeRequirement("subj-1", "req-3", "Licença Ambiental"),
    ]);
    const service = makeService(store);
    const page = await service.searchRequirements(ctx(), { status: "MISSING", namePrefix: "negativ" });
    expect(page.items.map((h) => h.requirement.requirementId).sort()).toEqual(["req-1", "req-2"]);
  });

  it("filters by assigneeUserId (exact match)", async () => {
    const store = new InMemoryDocumentArchiveStore([
      seedActiveTenantLifecycle(TENANT),
      makeRequirement("subj-1", "req-1", "A", { assigneeUserId: "user-9" }),
      makeRequirement("subj-1", "req-2", "B", { assigneeUserId: "user-8" }),
    ]);
    const service = makeService(store);
    const page = await service.searchRequirements(ctx(), { status: "MISSING", assigneeUserId: "user-9" });
    expect(page.items.map((h) => h.requirement.requirementId)).toEqual(["req-1"]);
  });

  it("filters by UnifiedValidityState via the Fatia 1 adapter, never reimplementing the derivation", async () => {
    const store = new InMemoryDocumentArchiveStore([
      seedActiveTenantLifecycle(TENANT),
      makeRequirement("subj-1", "req-1", "Vence logo", { status: "SATISFIED", evidenceValidUntil: "2026-09-05T00:00:00.000Z" }), // within 7 days of NOW -> VENCENDO
      makeRequirement("subj-1", "req-2", "Vence longe", { status: "SATISFIED", evidenceValidUntil: "2027-01-01T00:00:00.000Z" }), // -> VALIDO
    ]);
    const service = makeService(store);
    const page = await service.searchRequirements(ctx(), { status: "SATISFIED", validityState: "VENCENDO" });
    expect(page.items.map((h) => h.requirement.requirementId)).toEqual(["req-1"]);
  });

  it("enriches REQUIREMENT hits with subjectDisplayName via a single chunked BatchGetItem over distinct subjectIds", async () => {
    const store = new InMemoryDocumentArchiveStore([
      seedActiveTenantLifecycle(TENANT),
      { PK: `TENANT#${TENANT}#SUBJECT#subj-1`, SK: "META", entityType: "TrackedSubject", tenantId: TENANT, subjectId: "subj-1", displayName: "ACME Ltda", status: "ACTIVE", createdAt: NOW, updatedAt: NOW, version: 1 },
      { PK: `TENANT#${TENANT}#SUBJECT#subj-2`, SK: "META", entityType: "TrackedSubject", tenantId: TENANT, subjectId: "subj-2", displayName: "Beta SA", status: "ACTIVE", createdAt: NOW, updatedAt: NOW, version: 1 },
      makeRequirement("subj-1", "req-1", "A"),
      makeRequirement("subj-1", "req-2", "B"), // same subject as req-1 - distinct subjectIds still dedupe to 1 batchGet key for subj-1
      makeRequirement("subj-2", "req-3", "C"),
    ]);
    const service = makeService(store);
    const page = await service.searchRequirements(ctx(), { status: "MISSING" });
    expect(page.items).toHaveLength(3);
    expect(store.batchGetCallCount).toBe(1); // never a second read per item
    const bySubject = new Map(page.items.map((h) => [h.requirement.requirementId, h.subjectDisplayName]));
    expect(bySubject.get("req-1")).toBe("ACME Ltda");
    expect(bySubject.get("req-2")).toBe("ACME Ltda");
    expect(bySubject.get("req-3")).toBe("Beta SA");
  });

  it("caps at 5 native pages of 25 (125 evaluated) and signals scanLimitReached with a resumable cursor when more exist, chunking BatchGetItem in one call for >100 distinct subjectIds", async () => {
    const seed: (Record<string, unknown> & { PK: string; SK: string })[] = [seedActiveTenantLifecycle(TENANT)];
    // 200 requirements, each under its OWN subject (so distinct subjectIds among the 125
    // evaluated hits comfortably exceed 100, exercising the store's internal 100-key chunking
    // from a single service-level batchGet call).
    for (let i = 0; i < 200; i++) {
      const subjectId = `subj-${i}`;
      seed.push({ PK: `TENANT#${TENANT}#SUBJECT#${subjectId}`, SK: "META", entityType: "TrackedSubject", tenantId: TENANT, subjectId, displayName: `Subject ${i}`, status: "ACTIVE", createdAt: NOW, updatedAt: NOW, version: 1 });
      seed.push(makeRequirement(subjectId, `req-${i}`, `Requirement ${i}`) as unknown as Record<string, unknown> & { PK: string; SK: string });
    }
    const store = new InMemoryDocumentArchiveStore(seed);
    const service = makeService(store);
    const page = await service.searchRequirements(ctx(), { status: "MISSING" });
    expect(page.items).toHaveLength(125);
    expect(page.scanLimitReached).toBe(true);
    expect(page.lastEvaluatedKey).toBeDefined();
    expect(store.batchGetCallCount).toBe(1);
    expect(store.batchGetKeyCount).toBe(125); // one distinct subjectId per requirement here

    const nextPage = await service.searchRequirements(ctx(), { status: "MISSING", exclusiveStartKey: page.lastEvaluatedKey });
    expect(nextPage.items).toHaveLength(75);
    expect(nextPage.scanLimitReached).toBe(false);
  });
});
