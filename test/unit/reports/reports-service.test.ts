import { describe, expect, it } from "vitest";
import { ReportsService } from "../../../src/modules/reports/application/reports-service.js";
import { InMemoryDocumentArchiveStore } from "../document-archive/in-memory-store.js";
import { InMemoryExpirationStore } from "../expiration/in-memory-store.js";
import { requirementKey, requirementGsi1Keys, type RequirementStatus } from "../../../src/modules/document-archive/domain/requirement.js";
import { itemKey, gsi1Keys, type ExpirationItemStatus } from "../../../src/modules/expiration/domain/expiration-item.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TENANT = "tenant-1";
const NOW = "2026-09-04T00:00:00.000Z";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: TENANT, roles: ["ADMIN"] },
    auth: { issuedAt: NOW, expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

function makeRequirement(
  subjectId: string,
  requirementId: string,
  status: RequirementStatus,
  opts: { assigneeUserId?: string; evidenceValidUntil?: string } = {},
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
    ...(opts.assigneeUserId !== undefined ? { assigneeUserId: opts.assigneeUserId } : {}),
    ...(status === "SATISFIED" ? { evidenceState: "ACCEPTED" as const, evidenceValidUntil: opts.evidenceValidUntil } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...requirementGsi1Keys(TENANT, status, NOW, requirementId),
  } as unknown as Record<string, unknown> & EntityKey;
}

function makeSubjectRow(subjectId: string, displayName: string): Record<string, unknown> & EntityKey {
  return { PK: `TENANT#${TENANT}#SUBJECT#${subjectId}`, SK: "META", entityType: "TrackedSubject", tenantId: TENANT, subjectId, displayName, status: "ACTIVE", createdAt: NOW, updatedAt: NOW, version: 1 } as unknown as Record<string, unknown> & EntityKey;
}

function makeItem(itemId: string, status: ExpirationItemStatus, dueDate: string, opts: { assigneeUserId?: string; renewedFromId?: string } = {}): Record<string, unknown> & EntityKey {
  return {
    ...itemKey(TENANT, itemId),
    entityType: "ExpirationItem",
    itemId,
    tenantId: TENANT,
    name: `item-${itemId}`,
    category: "cat",
    categoryNormalized: "cat",
    dueDate,
    tags: [],
    status,
    ...(opts.assigneeUserId !== undefined ? { assigneeUserId: opts.assigneeUserId } : {}),
    ...(opts.renewedFromId !== undefined ? { renewedFromId: opts.renewedFromId } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...gsi1Keys(TENANT, status, dueDate, itemId),
  } as unknown as Record<string, unknown> & EntityKey;
}

function makeService(documentStore: InMemoryDocumentArchiveStore, itemStore: InMemoryExpirationStore) {
  return new ReportsService({ documentStore, itemStore, now: () => new Date(NOW) });
}

describe("ReportsService (Roadmap P0.7, fatias 1-2)", () => {
  it("getExpiredItems returns only ACTIVE items whose dueDate is already past (VENCIDO)", async () => {
    const itemStore = new InMemoryExpirationStore([
      makeItem("i1", "ACTIVE", "2026-08-01T00:00:00.000Z"), // past -> VENCIDO
      makeItem("i2", "ACTIVE", "2026-12-01T00:00:00.000Z"), // future -> not included
      makeItem("i3", "ARCHIVED", "2026-01-01T00:00:00.000Z"), // not ACTIVE -> never evaluated
    ]);
    const page = await makeService(new InMemoryDocumentArchiveStore([]), itemStore).getExpiredItems(ctx());
    expect(page.rows.map((r) => r.itemId)).toEqual(["i1"]);
    expect(page.truncated).toBe(false);
  });

  it("getExpiringSoonItems returns only ACTIVE items inside the 7-day VENCENDO window", async () => {
    const itemStore = new InMemoryExpirationStore([
      makeItem("i1", "ACTIVE", "2026-09-05T00:00:00.000Z"), // 1 day out -> VENCENDO
      makeItem("i2", "ACTIVE", "2026-12-01T00:00:00.000Z"), // far -> not included
    ]);
    const page = await makeService(new InMemoryDocumentArchiveStore([]), itemStore).getExpiringSoonItems(ctx());
    expect(page.rows.map((r) => r.itemId)).toEqual(["i1"]);
  });

  it("getRenewedItems returns ExpirationItem.status===RENEWED rows, carrying renewedFromId", async () => {
    const itemStore = new InMemoryExpirationStore([makeItem("i1", "RENEWED", "2026-01-01T00:00:00.000Z", { renewedFromId: "i0" }), makeItem("i2", "ACTIVE", "2026-01-01T00:00:00.000Z")]);
    const page = await makeService(new InMemoryDocumentArchiveStore([]), itemStore).getRenewedItems(ctx());
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]!.renewedFromId).toBe("i0");
  });

  it("getMissingRequirements returns Requirement.status===MISSING rows enriched with subjectDisplayName", async () => {
    const documentStore = new InMemoryDocumentArchiveStore([makeSubjectRow("s1", "ACME Ltda"), makeRequirement("s1", "r1", "MISSING"), makeRequirement("s1", "r2", "SATISFIED")]);
    const page = await makeService(documentStore, new InMemoryExpirationStore([])).getMissingRequirements(ctx());
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]!.requirement.requirementId).toBe("r1");
    expect(page.rows[0]!.subjectDisplayName).toBe("ACME Ltda");
  });

  it("getRequirementsBySubject returns every status, sorted by subjectId", async () => {
    const documentStore = new InMemoryDocumentArchiveStore([
      makeSubjectRow("s2", "Beta"),
      makeSubjectRow("s1", "Alpha"),
      makeRequirement("s2", "r2", "MISSING"),
      makeRequirement("s1", "r1", "SATISFIED", { evidenceValidUntil: "2027-01-01T00:00:00.000Z" }),
    ]);
    const page = await makeService(documentStore, new InMemoryExpirationStore([])).getRequirementsBySubject(ctx());
    expect(page.rows.map((r) => r.requirement.subjectId)).toEqual(["s1", "s2"]);
  });

  it("getRequirementsByAssignee excludes every Requirement without assigneeUserId set, across all statuses", async () => {
    const documentStore = new InMemoryDocumentArchiveStore([
      makeSubjectRow("s1", "ACME"),
      makeRequirement("s1", "r1", "MISSING", { assigneeUserId: "user-9" }),
      makeRequirement("s1", "r2", "MISSING"),
      makeRequirement("s1", "r3", "SATISFIED", { assigneeUserId: "user-9", evidenceValidUntil: "2027-01-01T00:00:00.000Z" }),
    ]);
    const page = await makeService(documentStore, new InMemoryExpirationStore([])).getRequirementsByAssignee(ctx());
    expect(page.rows.map((r) => r.requirement.requirementId).sort()).toEqual(["r1", "r3"]);
  });

  it("getExpirationItemsByAssignee only evaluates the actively-tracked statuses (ACTIVE/ARCHIVED/RENEWED), never DELETED", async () => {
    const itemStore = new InMemoryExpirationStore([
      makeItem("i1", "ACTIVE", "2026-01-01T00:00:00.000Z", { assigneeUserId: "user-9" }),
      makeItem("i2", "ARCHIVED", "2026-01-01T00:00:00.000Z", { assigneeUserId: "user-9" }),
      makeItem("i3", "DELETED", "2026-01-01T00:00:00.000Z", { assigneeUserId: "user-9" }),
      makeItem("i4", "ACTIVE", "2026-01-01T00:00:00.000Z"),
    ]);
    const page = await makeService(new InMemoryDocumentArchiveStore([]), itemStore).getExpirationItemsByAssignee(ctx());
    expect(page.rows.map((r) => r.itemId).sort()).toEqual(["i1", "i2"]);
  });

  it("surfaces truncated:true (lower bound, never an overstatement) once a status query hits the 5-page/125-item cap", async () => {
    const seed: (Record<string, unknown> & EntityKey)[] = [];
    for (let i = 0; i < 200; i++) {
      const subjectId = `subj-${i}`;
      seed.push(makeSubjectRow(subjectId, `Subject ${i}`));
      seed.push(makeRequirement(subjectId, `req-${i}`, "MISSING"));
    }
    const documentStore = new InMemoryDocumentArchiveStore(seed);
    const page = await makeService(documentStore, new InMemoryExpirationStore([])).getMissingRequirements(ctx());
    expect(page.rows).toHaveLength(125);
    expect(page.truncated).toBe(true);
  });

  it("denies a role without ADMIN_ROLES access to item:export (RBAC negative case)", async () => {
    const itemStore = new InMemoryExpirationStore([]);
    await expect(makeService(new InMemoryDocumentArchiveStore([]), itemStore).getExpiredItems(ctx({ tenant: { tenantId: TENANT, roles: ["MEMBER"] } }))).rejects.toThrow();
  });

  it("denies a role without ADMIN_ROLES access to docarchive:requirement-export (RBAC negative case)", async () => {
    const documentStore = new InMemoryDocumentArchiveStore([]);
    await expect(makeService(documentStore, new InMemoryExpirationStore([])).getMissingRequirements(ctx({ tenant: { tenantId: TENANT, roles: ["MEMBER"] } }))).rejects.toThrow();
  });
});
