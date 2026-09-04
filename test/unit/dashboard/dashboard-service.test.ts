import { describe, expect, it } from "vitest";
import { DashboardService } from "../../../src/modules/dashboard/application/dashboard-service.js";
import { InMemoryDocumentArchiveStore } from "../document-archive/in-memory-store.js";
import { InMemoryExpirationStore } from "../expiration/in-memory-store.js";
import { requirementKey, requirementGsi1Keys, type Requirement } from "../../../src/modules/document-archive/domain/requirement.js";
import { itemKey, gsi1Keys } from "../../../src/modules/expiration/domain/expiration-item.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TENANT = "tenant-1";
const NOW = "2026-09-03T00:00:00.000Z";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: TENANT, roles: ["MEMBER"] },
    auth: { issuedAt: NOW, expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

function makeRequirement(
  requirementId: string,
  status: Requirement["status"],
  opts: { evidenceState?: Requirement["evidenceState"]; evidenceValidUntil?: string } = {},
): Record<string, unknown> & EntityKey {
  return {
    ...requirementKey(TENANT, "subject-1", requirementId),
    entityType: "Requirement",
    requirementId,
    tenantId: TENANT,
    subjectId: "subject-1",
    name: `req-${requirementId}`,
    applicability: "APPLICABLE",
    status,
    ...(opts.evidenceState !== undefined ? { evidenceState: opts.evidenceState } : {}),
    ...(opts.evidenceValidUntil !== undefined ? { evidenceValidUntil: opts.evidenceValidUntil } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...requirementGsi1Keys(TENANT, status, NOW, requirementId),
  } as unknown as Record<string, unknown> & EntityKey;
}

function makeItem(itemId: string, dueDate: string): Record<string, unknown> & EntityKey {
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
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...gsi1Keys(TENANT, "ACTIVE", dueDate, itemId),
  } as unknown as Record<string, unknown> & EntityKey;
}

function makeService(documentStore: InMemoryDocumentArchiveStore, itemStore: InMemoryExpirationStore) {
  return new DashboardService({ documentStore, itemStore, now: () => new Date(NOW) });
}

describe("DashboardService.getSummary (Roadmap P0.6, fatia 1)", () => {
  it("counts overdue = Requirement.NOT_SATISFIED + ExpirationItem.ACTIVE past dueDate", async () => {
    const documentStore = new InMemoryDocumentArchiveStore([
      makeRequirement("req-1", "NOT_SATISFIED"),
      makeRequirement("req-2", "NOT_SATISFIED"),
    ]);
    const itemStore = new InMemoryExpirationStore([
      makeItem("item-1", "2026-08-01T00:00:00.000Z"), // past -> overdue
      makeItem("item-2", "2026-12-01T00:00:00.000Z"), // far future -> not overdue
    ]);
    const summary = await makeService(documentStore, itemStore).getSummary(ctx());
    expect(summary.overdueCount).toBe(3); // 2 requirements + 1 item
    expect(summary.approximate).toBe(false);
  });

  it("counts expiringSoon = Requirement.SATISFIED nearing evidenceValidUntil + ExpirationItem.ACTIVE nearing dueDate (7-day window)", async () => {
    const documentStore = new InMemoryDocumentArchiveStore([
      makeRequirement("req-1", "SATISFIED", { evidenceState: "ACCEPTED", evidenceValidUntil: "2026-09-05T00:00:00.000Z" }), // 2 days out -> VENCENDO
      makeRequirement("req-2", "SATISFIED", { evidenceState: "ACCEPTED", evidenceValidUntil: "2027-01-01T00:00:00.000Z" }), // far -> VALIDO, not counted
    ]);
    const itemStore = new InMemoryExpirationStore([
      makeItem("item-1", "2026-09-04T00:00:00.000Z"), // 1 day out -> VENCENDO
    ]);
    const summary = await makeService(documentStore, itemStore).getSummary(ctx());
    expect(summary.expiringSoonCount).toBe(2); // 1 requirement + 1 item
  });

  it("counts awaitingReview = Requirement.PENDING with evidence still mid-flow only (excludes terminal-but-not-accepted evidence)", async () => {
    const documentStore = new InMemoryDocumentArchiveStore([
      makeRequirement("req-1", "PENDING", { evidenceState: "UNDER_REVIEW" }), // mid-flow -> counted
      makeRequirement("req-2", "PENDING", { evidenceState: "REJECTED" }), // terminal, not accepted -> NOT counted
    ]);
    const itemStore = new InMemoryExpirationStore([]);
    const summary = await makeService(documentStore, itemStore).getSummary(ctx());
    expect(summary.awaitingReviewCount).toBe(1);
  });

  it("counts missingRequirements = Requirement.MISSING, unfiltered", async () => {
    const documentStore = new InMemoryDocumentArchiveStore([makeRequirement("req-1", "MISSING"), makeRequirement("req-2", "MISSING")]);
    const itemStore = new InMemoryExpirationStore([]);
    const summary = await makeService(documentStore, itemStore).getSummary(ctx());
    expect(summary.missingRequirementsCount).toBe(2);
  });

  it("returns all-zero counts with approximate:false for an empty tenant", async () => {
    const summary = await makeService(new InMemoryDocumentArchiveStore([]), new InMemoryExpirationStore([])).getSummary(ctx());
    expect(summary).toEqual({ overdueCount: 0, expiringSoonCount: 0, awaitingReviewCount: 0, missingRequirementsCount: 0, approximate: false });
  });

  it("denies a role without read access (RBAC negative case)", async () => {
    const documentStore = new InMemoryDocumentArchiveStore([]);
    const itemStore = new InMemoryExpirationStore([]);
    await expect(
      makeService(documentStore, itemStore).getSummary(ctx({ tenant: { tenantId: TENANT, roles: [] } })),
    ).rejects.toThrow();
  });
});
