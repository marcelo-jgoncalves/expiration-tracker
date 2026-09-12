/**
 * ReminderPolicyService - BLOCKER-B coverage (reminder-delivery-pipeline.md §5, Codex
 * Round H APPROVED 9.2/10): ITEM-policy integrity (a policy can never reference a
 * nonexistent/foreign/inactive item), POLICYREF pointer lifecycle (create/move/remove),
 * and reminder.policy-changed.v1 emission (itemId/previousItemId shape per operation).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryReminderStore, makeReminderIdGenerator } from "./in-memory-store.js";
import { ReminderPolicyService } from "../../../src/modules/reminder/application/reminder-policy-service.js";
import { policyKey, activePolicyPointerKey, validatePolicyScope } from "../../../src/modules/reminder/domain/reminder-policy.js";
import { itemKey } from "../../../src/modules/expiration/domain/expiration-item.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";

const TENANT = "t1";
const TABLE = "MainTable";
const NOW = "2026-08-01T00:00:00.000Z";

function contextFor(tenantId: string): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-user-1", sessionId: "session-1" },
    tenant: { tenantId, roles: ["OWNER"] },
    auth: { issuedAt: NOW, expiresAt: NOW, tokenId: "jti-1" },
  };
}

async function seedActiveItem(store: InMemoryReminderStore, itemId: string, tenantId = TENANT): Promise<void> {
  await store.putIfAbsent({
    ...itemKey(authorizedTenantIdFromPersistedEntity({ tenantId }), itemId),
    entityType: "ExpirationItem",
    itemId,
    tenantId,
    status: "ACTIVE",
    dueDate: "2026-09-10T00:00:00.000Z",
    version: 1,
  });
}

function outboxEvents(store: InMemoryReminderStore) {
  return store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
}

describe("ReminderPolicyService - domain validation", () => {
  it("throws when scope ITEM is missing itemId", () => {
    expect(() => validatePolicyScope({ scope: "ITEM" })).toThrow(ValidationError);
  });
  it("throws when scope TEMPLATE carries itemId", () => {
    expect(() => validatePolicyScope({ scope: "TEMPLATE", itemId: "item1" })).toThrow(ValidationError);
  });
  it("accepts scope ITEM with itemId, and TEMPLATE without", () => {
    expect(() => validatePolicyScope({ scope: "ITEM", itemId: "item1" })).not.toThrow();
    expect(() => validatePolicyScope({ scope: "TEMPLATE" })).not.toThrow();
  });
});

describe("ReminderPolicyService - createPolicy", () => {
  let store: InMemoryReminderStore;
  let service: ReminderPolicyService;
  let ctx: RequestContext;

  beforeEach(() => {
    store = new InMemoryReminderStore();
    service = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now: () => NOW });
    ctx = contextFor(TENANT);
  });

  it("rejects an ITEM-scoped policy whose item does not exist", async () => {
    await expect(
      service.createPolicy(ctx, {
        scope: "ITEM",
        itemId: "ghost-item",
        rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects an ITEM-scoped policy whose item is not ACTIVE", async () => {
    await store.putIfAbsent({ ...itemKey(authorizedTenantIdFromPersistedEntity({ tenantId: TENANT }), "item1"), entityType: "ExpirationItem", itemId: "item1", tenantId: TENANT, status: "ARCHIVED", dueDate: NOW, version: 1 });
    await expect(
      service.createPolicy(ctx, {
        scope: "ITEM",
        itemId: "item1",
        rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects an ITEM-scoped policy whose item belongs to a different tenant", async () => {
    await seedActiveItem(store, "item1", "other-tenant");
    await expect(
      service.createPolicy(ctx, {
        scope: "ITEM",
        itemId: "item1",
        rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("writes the POLICYREF pointer and emits reminder.policy-changed.v1 with itemId, for a valid ITEM-scoped policy", async () => {
    await seedActiveItem(store, "item1");
    const policy = await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });

    const pointer = await store.get(activePolicyPointerKey(TENANT, "item1"));
    expect(pointer).toBeDefined();
    expect((pointer as unknown as { policyId: string }).policyId).toBe(policy.policyId);
    expect((pointer as unknown as { tenantId: string }).tenantId).toBe(TENANT);

    const events = outboxEvents(store);
    expect(events).toHaveLength(1);
    expect(events[0]?.["eventType"]).toBe("reminder.policy-changed.v1");
    expect((events[0]?.["payload"] as { itemId?: string }).itemId).toBe("item1");
    expect((events[0]?.["payload"] as { previousItemId?: string }).previousItemId).toBeNull();
  });

  it("creates a TEMPLATE-scoped policy with no pointer, no item check, and no itemId in the event", async () => {
    const policy = await service.createPolicy(ctx, {
      scope: "TEMPLATE",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });
    expect(policy.scope).toBe("TEMPLATE");

    const events = outboxEvents(store);
    expect((events[0]?.["payload"] as { itemId?: string }).itemId).toBeNull();
  });
});

describe("ReminderPolicyService - getPolicyForItem (D-258 discovery)", () => {
  let store: InMemoryReminderStore;
  let service: ReminderPolicyService;
  let ctx: RequestContext;

  beforeEach(async () => {
    store = new InMemoryReminderStore();
    service = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now: () => NOW });
    ctx = contextFor(TENANT);
    await seedActiveItem(store, "item1");
  });

  it("returns null (not an error) when the item has no policy yet", async () => {
    expect(await service.getPolicyForItem(ctx, "item1")).toBeNull();
  });

  it("resolves the policy via the POLICYREF pointer for an item that has one", async () => {
    const policy = await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });

    const found = await service.getPolicyForItem(ctx, "item1");
    expect(found?.policyId).toBe(policy.policyId);
    expect(found?.name).toBe("r");
  });

  it("follows a moved pointer after updatePolicy re-targets the policy to a different item", async () => {
    const policy = await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });
    await seedActiveItem(store, "item2");
    await service.updatePolicy(ctx, policy.policyId, { scope: "ITEM", itemId: "item2", rule: { name: "r", triggers: policy.triggers, timeZone: policy.timeZone, channels: policy.channels } }, 1);

    expect(await service.getPolicyForItem(ctx, "item1")).toBeNull();
    expect((await service.getPolicyForItem(ctx, "item2"))?.policyId).toBe(policy.policyId);
  });

  it("still resolves a disabled policy (disable never removes the pointer, per §5)", async () => {
    const policy = await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });
    await service.disablePolicy(ctx, policy.policyId, 1);

    const found = await service.getPolicyForItem(ctx, "item1");
    expect(found?.enabled).toBe(false);
  });

  it("denies cross-tenant access to the same itemId (a different tenant's item1)", async () => {
    await seedActiveItem(store, "item1", "other-tenant");
    await service.createPolicy(contextFor("other-tenant"), {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });

    expect(await service.getPolicyForItem(ctx, "item1")).toBeNull();
  });

  it("Codex review finding (D-258 round 1): VIEWER can read via reminder:read (READ_ONLY_ROLES), never blocked like a WRITE_ROLES action would", async () => {
    await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });
    const viewerCtx: RequestContext = { ...ctx, tenant: { ...ctx.tenant, roles: ["VIEWER"] } };

    const found = await service.getPolicyForItem(viewerCtx, "item1");
    expect(found?.name).toBe("r");
  });

  it("Codex review finding (D-258 round 1): a stale pointer whose target policy no longer targets this item (orphaned) is skipped, never returned", async () => {
    const policy = await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });
    // Simulate a corrupted/leftover pointer: the policy itself moved to TEMPLATE scope via a
    // path that (hypothetically) left the OLD item1 pointer behind without the normal
    // updatePolicy cleanup - directly write a stale pointer row rather than relying on any
    // production code path to produce one (that path is exactly what §5 says must never be
    // trusted blindly).
    await store.update({ ...(await store.get(policyKey(TENANT, policy.policyId)))!, scope: "TEMPLATE", itemId: undefined });

    expect(await service.getPolicyForItem(ctx, "item1")).toBeNull();
  });

  it("P0.4 uniqueness fix (Claude<->Codex protocol, decisions-log.md D-XXX): rejects creating a second ITEM-scoped policy for an item that already has one live", async () => {
    await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "older", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });

    await expect(
      service.createPolicy(ctx, {
        scope: "ITEM",
        itemId: "item1",
        rule: { name: "newer", triggers: [{ triggerId: "t2", offsetIso: "-P3D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("legacy-pointer fallback (pre-P0.4-migration window): when 2+ legacy POLICYREF# pointers exist for an item (never producible by current code, only by historical/pre-migration data), the most recently updated candidate is returned deterministically, never an unvalidated refs[0]", async () => {
    // Simulates data from before the P0.4 uniqueness fix: 2 legacy per-policy pointers for
    // the same item, no fixed pointer yet - the exact shape getPolicyForItem's fallback
    // path exists to tolerate until the migration script (or a self-healing edit) runs.
    const older: import("../../../src/modules/reminder/domain/reminder-policy.js").ReminderPolicy = {
      PK: "TENANT#t1#POLICY#older", SK: "META", entityType: "ReminderPolicy", policyId: "older", tenantId: TENANT, scope: "ITEM", itemId: "item1",
      name: "older", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"],
      enabled: true, version: 1, createdAt: NOW, updatedAt: NOW,
    };
    const newer: import("../../../src/modules/reminder/domain/reminder-policy.js").ReminderPolicy = {
      ...older, PK: "TENANT#t1#POLICY#newer", policyId: "newer", name: "newer", updatedAt: "2026-08-02T00:00:00.000Z",
    };
    await store.putIfAbsent(older);
    await store.putIfAbsent(newer);
    await store.putIfAbsent({ PK: "TENANT#t1#ITEM#item1", SK: "POLICYREF#older", entityType: "ReminderPolicyRef", policyId: "older", tenantId: TENANT });
    await store.putIfAbsent({ PK: "TENANT#t1#ITEM#item1", SK: "POLICYREF#newer", entityType: "ReminderPolicyRef", policyId: "newer", tenantId: TENANT });

    const found = await service.getPolicyForItem(ctx, "item1");
    expect(found?.policyId).toBe("newer");
    expect(found?.name).toBe("newer");
  });
});

describe("ReminderPolicyService - updatePolicy pointer lifecycle", () => {
  let store: InMemoryReminderStore;
  let service: ReminderPolicyService;
  let ctx: RequestContext;

  beforeEach(async () => {
    store = new InMemoryReminderStore();
    service = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now: () => NOW });
    ctx = contextFor(TENANT);
    await seedActiveItem(store, "item1");
  });

  it("moves the pointer atomically when itemId changes, and the event carries both itemId and previousItemId", async () => {
    const policy = await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });
    await seedActiveItem(store, "item2");

    const updated = await service.updatePolicy(
      ctx,
      policy.policyId,
      { scope: "ITEM", itemId: "item2", rule: { name: "r", triggers: policy.triggers, timeZone: policy.timeZone, channels: policy.channels } },
      1,
    );
    expect(updated.itemId).toBe("item2");

    expect(await store.get(activePolicyPointerKey(TENANT, "item1"))).toBeUndefined();
    const newPointer = await store.get(activePolicyPointerKey(TENANT, "item2"));
    expect(newPointer).toBeDefined();

    const events = outboxEvents(store).filter((e) => e["eventType"] === "reminder.policy-changed.v1");
    expect(events).toHaveLength(2); // create + update
    const updateEvent = events[1]!;
    expect((updateEvent["payload"] as { itemId?: string }).itemId).toBe("item2");
    expect((updateEvent["payload"] as { previousItemId?: string }).previousItemId).toBe("item1");
  });

  it("removes the pointer and carries previousItemId when scope changes ITEM -> TEMPLATE", async () => {
    const policy = await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });

    await service.updatePolicy(ctx, policy.policyId, { scope: "TEMPLATE", rule: { name: "r", triggers: policy.triggers, timeZone: policy.timeZone, channels: policy.channels } }, 1);

    expect(await store.get(activePolicyPointerKey(TENANT, "item1"))).toBeUndefined();
    const events = outboxEvents(store).filter((e) => e["eventType"] === "reminder.policy-changed.v1");
    const updateEvent = events[1]!;
    expect((updateEvent["payload"] as { itemId?: string }).itemId).toBeNull();
    expect((updateEvent["payload"] as { previousItemId?: string }).previousItemId).toBe("item1");
  });

  it("does not touch the pointer or fail when itemId is unchanged (unrelated field edit)", async () => {
    const policy = await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });

    const updated = await service.updatePolicy(
      ctx,
      policy.policyId,
      { scope: "ITEM", itemId: "item1", rule: { name: "renamed", triggers: policy.triggers, timeZone: policy.timeZone, channels: policy.channels } },
      1,
    );
    expect(updated.name).toBe("renamed");
    expect(await store.get(activePolicyPointerKey(TENANT, "item1"))).toBeDefined();
  });

  it("rejects a same-item update (unrelated field edit) when the target item is no longer ACTIVE (Codex implementation-review finding: this integrity check must not be skipped just because the pointer write is)", async () => {
    const policy = await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });

    const item = await store.get<{ PK: string; SK: string; status: string; version: number }>({ PK: "TENANT#t1#ITEM#item1", SK: "META" });
    await store.update({ ...item!, status: "ARCHIVED" });

    await expect(
      service.updatePolicy(
        ctx,
        policy.policyId,
        { scope: "ITEM", itemId: "item1", rule: { name: "renamed", triggers: policy.triggers, timeZone: policy.timeZone, channels: policy.channels } },
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects moving a policy to an item that does not exist", async () => {
    const policy = await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });

    await expect(
      service.updatePolicy(ctx, policy.policyId, { scope: "ITEM", itemId: "ghost-item", rule: { name: "r", triggers: policy.triggers, timeZone: policy.timeZone, channels: policy.channels } }, 1),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("ReminderPolicyService - disablePolicy", () => {
  it("leaves the pointer in place (still discoverable for cancellation) and emits itemId with no previousItemId", async () => {
    const store = new InMemoryReminderStore();
    const service = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now: () => NOW });
    const ctx = contextFor(TENANT);
    await seedActiveItem(store, "item1");

    const policy = await service.createPolicy(ctx, {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });

    await service.disablePolicy(ctx, policy.policyId, 1);

    expect(await store.get(activePolicyPointerKey(TENANT, "item1"))).toBeDefined();
    const events = outboxEvents(store).filter((e) => e["eventType"] === "reminder.policy-changed.v1");
    const disableEvent = events[1]!;
    expect((disableEvent["payload"] as { itemId?: string }).itemId).toBe("item1");
    expect((disableEvent["payload"] as { previousItemId?: string }).previousItemId).toBeNull();
  });
});

describe("ReminderPolicyService - cross-tenant isolation", () => {
  it("tenant B cannot read, update or disable tenant A's real policy, even knowing its policyId", async () => {
    const store = new InMemoryReminderStore();
    const service = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now: () => NOW });
    const tenantA = contextFor(TENANT);
    const tenantB = contextFor("t2");

    const policy = await service.createPolicy(tenantA, {
      scope: "TEMPLATE",
      rule: { name: "r", triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL"] },
    });

    await expect(service.getPolicy(tenantB, policy.policyId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.updatePolicy(
        tenantB,
        policy.policyId,
        { scope: "TEMPLATE", rule: { name: "hijacked", triggers: policy.triggers, timeZone: policy.timeZone, channels: policy.channels } },
        policy.version,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.disablePolicy(tenantB, policy.policyId, policy.version)).rejects.toBeInstanceOf(NotFoundError);

    const stillThere = await service.getPolicy(tenantA, policy.policyId);
    expect(stillThere.name).not.toBe("hijacked");
    expect(stillThere.enabled).toBe(true);
  });
});
