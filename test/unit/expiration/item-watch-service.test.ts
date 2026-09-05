import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryExpirationStore, makeExpirationIdGenerator, allowAllMemberEligibilityChecker, fakeMemberEligibilityChecker } from "./in-memory-store.js";
import { ExpirationService } from "../../../src/modules/expiration/application/expiration-service.js";
import { ItemWatchService } from "../../../src/modules/expiration/application/item-watch-service.js";
import { IneligibleAssigneeError, NotFoundError, TenantNotActiveError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { tenantLifecycleKey, type TenantLifecycleRecord, type TenantLifecycleStatus } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

/** W3-07 (D-067): removeWatcher() is fenced by TenantBusinessMutation, which requires a
 * TenantLifecycleRecord to exist and be ACTIVE - seed one directly (bypassing the identity
 * module's bootstrap, which this test suite doesn't otherwise exercise). */
async function seedLifecycle(store: InMemoryExpirationStore, tenantId: string, status: TenantLifecycleStatus = "ACTIVE"): Promise<void> {
  const record: TenantLifecycleRecord = {
    ...tenantLifecycleKey(tenantId),
    SK: "LIFECYCLE",
    entityType: "TenantLifecycleRecord",
    tenantId,
    status,
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    version: 1,
  };
  await store.putIfAbsent(record);
}

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

describe("ItemWatchService", () => {
  let store: InMemoryExpirationStore;
  let expiration: ExpirationService;
  let watches: ItemWatchService;

  beforeEach(async () => {
    store = new InMemoryExpirationStore();
    expiration = new ExpirationService({ store, tableName: "MainTable", ids: makeExpirationIdGenerator(), members: allowAllMemberEligibilityChecker(), now: () => "2026-08-23T12:00:00.000Z" });
    watches = new ItemWatchService({ store, tableName: "MainTable", members: allowAllMemberEligibilityChecker(), now: () => "2026-08-23T12:00:00.000Z" });
    await seedLifecycle(store, "tenant-1");
  });

  it("addWatcher creates an ItemWatch under the same partition as ExpirationItem, without changing the item's own version", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });

    const watch = await watches.addWatcher(ctx(), item.itemId, "watcher-user");

    expect(watch.PK).toBe(`TENANT#tenant-1#ITEM#${item.itemId}`);
    expect(watch.SK).toBe("WATCH#USER#watcher-user");
    expect(watch.status).toBe("ACTIVE");

    const itemAfter = await store.get<{ PK: string; SK: string; version: number }>({ PK: `TENANT#tenant-1#ITEM#${item.itemId}`, SK: "META" });
    expect(itemAfter?.version).toBe(1); // watcher add never mutates the item's own OCC version
  });

  it("addWatcher 404s against a non-existent item", async () => {
    await expect(watches.addWatcher(ctx(), "no-such-item", "watcher-user")).rejects.toBeInstanceOf(NotFoundError);
  });

  // Wave B2B-11: mutação: remover a checagem `members.isEligibleMember` (ou trocar por
  // `allowAllMemberEligibilityChecker()`) faria este teste falhar - antes desta wave, qualquer
  // string era aceita como watcher sem validação nenhuma.
  it("addWatcher rejects a userId that is not an eligible member of the Organization", async () => {
    const ineligibleWatches = new ItemWatchService({ store, tableName: "MainTable", members: fakeMemberEligibilityChecker(["member-user"]), now: () => "2026-08-23T12:00:00.000Z" });
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });

    await expect(ineligibleWatches.addWatcher(ctx(), item.itemId, "not-a-member")).rejects.toBeInstanceOf(IneligibleAssigneeError);
    const list = await watches.listWatchers(ctx(), item.itemId);
    expect(list).toHaveLength(0);
  });

  it("addWatcher accepts a userId that IS an eligible member of the Organization", async () => {
    const eligibleWatches = new ItemWatchService({ store, tableName: "MainTable", members: fakeMemberEligibilityChecker(["member-user"]), now: () => "2026-08-23T12:00:00.000Z" });
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });

    const watch = await eligibleWatches.addWatcher(ctx(), item.itemId, "member-user");
    expect(watch.status).toBe("ACTIVE");
  });

  it("addWatcher denies a VIEWER role", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await expect(watches.addWatcher(ctx({ tenant: { tenantId: "tenant-1", roles: ["VIEWER"] } }), item.itemId, "watcher-user")).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
  });

  it("addWatcher is idempotent: calling it twice for the same user does not create a second record or fail", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await watches.addWatcher(ctx(), item.itemId, "watcher-user");
    await watches.addWatcher(ctx(), item.itemId, "watcher-user");

    const list = await watches.listWatchers(ctx(), item.itemId);
    expect(list).toHaveLength(1);
  });

  it("removeWatcher soft-removes (status REMOVED) and listWatchers excludes it; re-adding reactivates the same record", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await watches.addWatcher(ctx(), item.itemId, "watcher-user");

    await watches.removeWatcher(ctx(), item.itemId, "watcher-user");
    expect(await watches.listWatchers(ctx(), item.itemId)).toHaveLength(0);

    const reactivated = await watches.addWatcher(ctx(), item.itemId, "watcher-user");
    expect(reactivated.status).toBe("ACTIVE");
    expect(await watches.listWatchers(ctx(), item.itemId)).toHaveLength(1);
  });

  it("removeWatcher on a never-watched user is a no-op, not an error", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await expect(watches.removeWatcher(ctx(), item.itemId, "never-watched")).resolves.toBeUndefined();
  });

  it("W3-07 fence: removeWatcher is rejected once the tenant's TenantLifecycleRecord moves to DELETING, even for an otherwise-valid watch", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await watches.addWatcher(ctx(), item.itemId, "watcher-user");

    // Flip the tenant to DELETING directly on the store (no lifecycle-transition worker
    // exists yet - out of scope for this chunk, see NEXT_SESSION_PROMPT.md) and confirm the
    // ConditionCheck in the SAME TransactWriteItems as the mutation rejects it.
    const record = await store.get<TenantLifecycleRecord>(tenantLifecycleKey("tenant-1"));
    await store.update({ ...record!, status: "DELETING" });

    await expect(watches.removeWatcher(ctx(), item.itemId, "watcher-user")).rejects.toBeInstanceOf(TenantNotActiveError);

    // And the watch itself was never mutated - the transaction rejected atomically, no
    // partial application.
    const list = await watches.listWatchers(ctx(), item.itemId);
    expect(list).toHaveLength(1);
  });

  it("W3-07 fence: removeWatcher succeeds normally while the tenant lifecycle is ACTIVE (control case for the adversarial test above)", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await watches.addWatcher(ctx(), item.itemId, "watcher-user");

    await expect(watches.removeWatcher(ctx(), item.itemId, "watcher-user")).resolves.toBeUndefined();
    expect(await watches.listWatchers(ctx(), item.itemId)).toHaveLength(0);
  });

  it("listWatchers returns multiple watchers for the same item", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await watches.addWatcher(ctx(), item.itemId, "watcher-a");
    await watches.addWatcher(ctx(), item.itemId, "watcher-b");

    const list = await watches.listWatchers(ctx(), item.itemId);
    expect(list.map((w) => w.userId).sort()).toEqual(["watcher-a", "watcher-b"]);
  });

  // D-200 (watcher notification fan-out): teto justificado pelo limite de 100 ações de
  // TransactWriteItems em dispatchOccurrence() - ver MAX_ITEM_WATCHERS.
  it("addWatcher rejects the 21st distinct ACTIVE watcher (MAX_ITEM_WATCHERS = 20)", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    for (let i = 0; i < 20; i++) await watches.addWatcher(ctx(), item.itemId, `watcher-${i}`);

    await expect(watches.addWatcher(ctx(), item.itemId, "watcher-21")).rejects.toThrow();
    expect(await watches.listWatchers(ctx(), item.itemId)).toHaveLength(20);
  });

  it("addWatcher cap does not block an idempotent re-add of an already-ACTIVE watcher", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    for (let i = 0; i < 20; i++) await watches.addWatcher(ctx(), item.itemId, `watcher-${i}`);

    await expect(watches.addWatcher(ctx(), item.itemId, "watcher-0")).resolves.toBeDefined();
  });

  it("addWatcher cap counts a REMOVED->ACTIVE reactivation, not just brand-new rows", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    for (let i = 0; i < 20; i++) await watches.addWatcher(ctx(), item.itemId, `watcher-${i}`);
    await watches.removeWatcher(ctx(), item.itemId, "watcher-0");

    // 19 ACTIVE now - reactivating watcher-0 brings it back to 20, still allowed.
    await expect(watches.addWatcher(ctx(), item.itemId, "watcher-0")).resolves.toBeDefined();
    // But a genuinely NEW 21st watcher is rejected again once back at 20 ACTIVE.
    await expect(watches.addWatcher(ctx(), item.itemId, "watcher-21")).rejects.toThrow();
  });
});
