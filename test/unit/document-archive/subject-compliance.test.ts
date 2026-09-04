import { describe, expect, it } from "vitest";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle } from "./in-memory-store.js";
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
  status: Requirement["status"],
  opts: { evidenceValidUntil?: string } = {},
): Record<string, unknown> & EntityKey {
  return {
    ...requirementKey(TENANT, subjectId, requirementId),
    entityType: "Requirement",
    requirementId,
    tenantId: TENANT,
    subjectId,
    name: `req-${requirementId}`,
    applicability: "APPLICABLE",
    status,
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

describe("DocumentArchiveService.getSubjectCompliance (Roadmap P0.6, fatia 2)", () => {
  it("computes compliancePercent = round(100 * satisfiedCount / totalCount), excluding NOT_APPLICABLE", async () => {
    const store = new InMemoryDocumentArchiveStore([
      seedActiveTenantLifecycle(TENANT),
      makeRequirement("subj-1", "req-1", "SATISFIED", { evidenceValidUntil: "2027-01-01T00:00:00.000Z" }),
      makeRequirement("subj-1", "req-2", "SATISFIED", { evidenceValidUntil: "2027-01-01T00:00:00.000Z" }),
      makeRequirement("subj-1", "req-3", "MISSING"),
      makeRequirement("subj-1", "req-4", "NOT_APPLICABLE"), // excluded from both numerator and denominator
    ]);
    const compliance = await makeService(store).getSubjectCompliance(ctx(), "subj-1");
    expect(compliance).toEqual({ totalRequirements: 3, satisfiedCount: 2, expiringSoonCount: 0, missingCount: 1, compliancePercent: 67 });
  });

  it("returns compliancePercent: null (never 0 or 100) when there is no applicable requirement", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), makeRequirement("subj-1", "req-1", "NOT_APPLICABLE")]);
    const compliance = await makeService(store).getSubjectCompliance(ctx(), "subj-1");
    expect(compliance).toEqual({ totalRequirements: 0, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 0, compliancePercent: null });
  });

  it("returns compliancePercent: null for a Subject with no Requirements at all", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT)]);
    const compliance = await makeService(store).getSubjectCompliance(ctx(), "subj-nonexistent");
    expect(compliance.compliancePercent).toBeNull();
  });

  it("counts expiringSoonCount via the shared UnifiedValidityState adapter (VENCENDO, 7-day window), never reimplementing the threshold", async () => {
    const store = new InMemoryDocumentArchiveStore([
      seedActiveTenantLifecycle(TENANT),
      makeRequirement("subj-1", "req-1", "SATISFIED", { evidenceValidUntil: "2026-09-05T00:00:00.000Z" }), // 2 days out -> VENCENDO
      makeRequirement("subj-1", "req-2", "SATISFIED", { evidenceValidUntil: "2027-01-01T00:00:00.000Z" }), // far -> VALIDO
    ]);
    const compliance = await makeService(store).getSubjectCompliance(ctx(), "subj-1");
    expect(compliance.expiringSoonCount).toBe(1);
    expect(compliance.satisfiedCount).toBe(2);
  });

  it("denies a role without docarchive:requirement-read (RBAC negative case)", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT)]);
    await expect(makeService(store).getSubjectCompliance(ctx({ tenant: { tenantId: TENANT, roles: [] } }), "subj-1")).rejects.toThrow();
  });
});
