/**
 * ReminderPolicyService - BLOCKER-B coverage (reminder-delivery-pipeline.md §5, Codex
 * Round H APPROVED 9.2/10): ITEM-policy integrity (a policy can never reference a
 * nonexistent/foreign/inactive item), POLICYREF pointer lifecycle (create/move/remove),
 * and reminder.policy-changed.v1 emission (itemId/previousItemId shape per operation).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryReminderStore, makeReminderIdGenerator } from "./in-memory-store.js";
import { ReminderPolicyService } from "../../../src/modules/reminder/application/reminder-policy-service.js";
import { policyRefKey, validatePolicyScope } from "../../../src/modules/reminder/domain/reminder-policy.js";
import { itemKey } from "../../../src/modules/expiration/domain/expiration-item.js";
import { ConflictError, ValidationError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

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
    ...itemKey(tenantId, itemId),
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
    await store.putIfAbsent({ ...itemKey(TENANT, "item1"), entityType: "ExpirationItem", itemId: "item1", tenantId: TENANT, status: "ARCHIVED", dueDate: NOW, version: 1 });
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

    const pointer = await store.get(policyRefKey(TENANT, "item1", policy.policyId));
    expect(pointer).toBeDefined();
    expect((pointer as unknown as { policyId: string }).policyId).toBe(policy.policyId);

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

    expect(await store.get(policyRefKey(TENANT, "item1", policy.policyId))).toBeUndefined();
    const newPointer = await store.get(policyRefKey(TENANT, "item2", policy.policyId));
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

    expect(await store.get(policyRefKey(TENANT, "item1", policy.policyId))).toBeUndefined();
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
    expect(await store.get(policyRefKey(TENANT, "item1", policy.policyId))).toBeDefined();
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

    expect(await store.get(policyRefKey(TENANT, "item1", policy.policyId))).toBeDefined();
    const events = outboxEvents(store).filter((e) => e["eventType"] === "reminder.policy-changed.v1");
    const disableEvent = events[1]!;
    expect((disableEvent["payload"] as { itemId?: string }).itemId).toBe("item1");
    expect((disableEvent["payload"] as { previousItemId?: string }).previousItemId).toBeNull();
  });
});
