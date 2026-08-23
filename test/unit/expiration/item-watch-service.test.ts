import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryExpirationStore, makeExpirationIdGenerator } from "./in-memory-store.js";
import { ExpirationService } from "../../../src/modules/expiration/application/expiration-service.js";
import { ItemWatchService } from "../../../src/modules/expiration/application/item-watch-service.js";
import { NotFoundError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

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

  beforeEach(() => {
    store = new InMemoryExpirationStore();
    expiration = new ExpirationService({ store, tableName: "MainTable", ids: makeExpirationIdGenerator(), now: () => "2026-08-23T12:00:00.000Z" });
    watches = new ItemWatchService({ store, tableName: "MainTable", now: () => "2026-08-23T12:00:00.000Z" });
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

  it("listWatchers returns multiple watchers for the same item", async () => {
    const item = await expiration.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await watches.addWatcher(ctx(), item.itemId, "watcher-a");
    await watches.addWatcher(ctx(), item.itemId, "watcher-b");

    const list = await watches.listWatchers(ctx(), item.itemId);
    expect(list.map((w) => w.userId).sort()).toEqual(["watcher-a", "watcher-b"]);
  });
});
