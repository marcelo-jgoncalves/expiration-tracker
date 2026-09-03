import { describe, expect, it } from "vitest";
import { InMemoryExpirationStore, activeLifecycleRecord, makeExpirationIdGenerator, allowAllMemberEligibilityChecker } from "./in-memory-store.js";
import { ExpirationService } from "../../../src/modules/expiration/application/expiration-service.js";
import { ValidationError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { itemKey, gsi1Keys, type ExpirationItem } from "../../../src/modules/expiration/domain/expiration-item.js";
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

const TENANT = "tenant-1";
const NOW = "2026-09-03T00:00:00.000Z";

function makeItem(itemId: string, name: string, opts: { status?: ExpirationItem["status"]; tags?: string[]; assigneeUserId?: string; dueDate?: string } = {}): Record<string, unknown> & EntityKey {
  const status = opts.status ?? "ACTIVE";
  const dueDate = opts.dueDate ?? "2027-01-01T00:00:00.000Z";
  return {
    ...itemKey(TENANT, itemId),
    entityType: "ExpirationItem",
    itemId,
    tenantId: TENANT,
    name,
    category: "geral",
    categoryNormalized: "geral",
    dueDate,
    tags: opts.tags ?? [],
    ...(opts.assigneeUserId !== undefined ? { assigneeUserId: opts.assigneeUserId } : {}),
    status,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...gsi1Keys(TENANT, status, dueDate, itemId),
  } as unknown as Record<string, unknown> & EntityKey;
}

function makeService(store: InMemoryExpirationStore) {
  return new ExpirationService({ store, tableName: "MainTable", ids: makeExpirationIdGenerator(), members: allowAllMemberEligibilityChecker(), now: () => NOW });
}

describe("ExpirationService.searchExpirationItems (D-194 Fatia 3)", () => {
  it("rejects a call with no status (status is required and singular)", async () => {
    const store = new InMemoryExpirationStore([activeLifecycleRecord(TENANT)]);
    const service = makeService(store);
    await expect(service.searchExpirationItems(ctx(), { status: undefined as unknown as "ACTIVE" })).rejects.toThrow(ValidationError);
  });

  it("filters by name (substring), tag (exact membership) and assigneeUserId (exact match) - all real native ExpirationItem fields", async () => {
    const store = new InMemoryExpirationStore([
      activeLifecycleRecord(TENANT),
      makeItem("i1", "Alvará Sanitário", { tags: ["urgent"], assigneeUserId: "user-9" }),
      makeItem("i2", "Alvará Ambiental", { tags: ["food"], assigneeUserId: "user-8" }),
      makeItem("i3", "Certidão Negativa", { tags: ["urgent"], assigneeUserId: "user-9" }),
    ]);
    const service = makeService(store);

    const byName = await service.searchExpirationItems(ctx(), { status: "ACTIVE", namePrefix: "alvará" });
    expect(byName.items.map((h) => h.item.itemId).sort()).toEqual(["i1", "i2"]);

    const byTag = await service.searchExpirationItems(ctx(), { status: "ACTIVE", tag: "urgent" });
    expect(byTag.items.map((h) => h.item.itemId).sort()).toEqual(["i1", "i3"]);

    const byAssignee = await service.searchExpirationItems(ctx(), { status: "ACTIVE", assigneeUserId: "user-8" });
    expect(byAssignee.items.map((h) => h.item.itemId)).toEqual(["i2"]);
  });

  it("filters by UnifiedValidityState via the Fatia 1 adapter (dueDate-driven, never PERMANENTE for ExpirationItem)", async () => {
    const store = new InMemoryExpirationStore([
      activeLifecycleRecord(TENANT),
      makeItem("i1", "Vence logo", { dueDate: "2026-09-05T00:00:00.000Z" }), // within 7 days of NOW -> VENCENDO
      makeItem("i2", "Vence longe", { dueDate: "2027-06-01T00:00:00.000Z" }), // -> VALIDO
      makeItem("i3", "Já venceu", { dueDate: "2026-01-01T00:00:00.000Z" }), // -> VENCIDO
    ]);
    const service = makeService(store);
    const page = await service.searchExpirationItems(ctx(), { status: "ACTIVE", validityState: "VENCENDO" });
    expect(page.items.map((h) => h.item.itemId)).toEqual(["i1"]);
  });

  it("never enriches with subjectDisplayName - ExpirationItem has no subjectId, out of scope per the design", async () => {
    const store = new InMemoryExpirationStore([activeLifecycleRecord(TENANT), makeItem("i1", "Item A")]);
    const service = makeService(store);
    const page = await service.searchExpirationItems(ctx(), { status: "ACTIVE" });
    expect(page.items[0]).not.toHaveProperty("subjectDisplayName");
  });

  it("caps at 5 native pages of 25 (125 evaluated) and signals scanLimitReached with a resumable cursor when more exist", async () => {
    const seed = [activeLifecycleRecord(TENANT)];
    for (let i = 0; i < 200; i++) seed.push(makeItem(`i${i}`, `Item ${i}`) as unknown as ReturnType<typeof activeLifecycleRecord>);
    const store = new InMemoryExpirationStore(seed);
    const service = makeService(store);
    const page = await service.searchExpirationItems(ctx(), { status: "ACTIVE" });
    expect(page.items).toHaveLength(125);
    expect(page.scanLimitReached).toBe(true);
    expect(page.lastEvaluatedKey).toBeDefined();

    const nextPage = await service.searchExpirationItems(ctx(), { status: "ACTIVE", exclusiveStartKey: page.lastEvaluatedKey });
    expect(nextPage.items).toHaveLength(75);
    expect(nextPage.scanLimitReached).toBe(false);
    const allIds = [...page.items, ...nextPage.items].map((h) => h.item.itemId);
    expect(new Set(allIds).size).toBe(200);
  });
});
