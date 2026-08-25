import { describe, expect, it, beforeEach, vi } from "vitest";
import { InMemoryExpirationStore, makeExpirationIdGenerator } from "./in-memory-store.js";
import { ExpirationService } from "../../../src/modules/expiration/application/expiration-service.js";
import { ConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";
import { ConcurrentOperationError } from "../../../src/shared/idempotency/idempotency.js";
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

describe("ExpirationService", () => {
  let store: InMemoryExpirationStore;
  let service: ExpirationService;

  beforeEach(() => {
    store = new InMemoryExpirationStore();
    service = new ExpirationService({ store, tableName: "MainTable", ids: makeExpirationIdGenerator(), now: () => "2026-08-19T12:00:00.000Z" });
  });

  it("createItem writes the item (version 1, ACTIVE, GSI1 keyed by status+dueDate) and an audit record atomically", async () => {
    const item = await service.createItem(ctx(), { name: "Alvará", category: "Licenças", dueDate: "2026-09-10T00:00:00.000Z" });

    expect(item.version).toBe(1);
    expect(item.status).toBe("ACTIVE");
    expect(item.categoryNormalized).toBe("licencas");
    expect(item.GSI1PK).toBe("TENANT#tenant-1#ITEMSTATUS#ACTIVE");
    expect(item.GSI1SK).toBe("DUE#2026-09-10T00:00:00.000Z#ITEM#item-1");

    const audits = store.allItems().filter((i) => i["entityType"] === "AuditEvent");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.["action"]).toBe("CREATE");
  });

  it("createItem is idempotent (CREATE-IDEMPOTENCY-01): a retry with the same key and payload returns the same item instead of creating a second one", async () => {
    const input = { name: "Alvará", category: "Licenças", dueDate: "2026-09-10T00:00:00.000Z" };
    const first = await service.createItem(ctx(), input, "fixed-create-key");
    const second = await service.createItem(ctx(), input, "fixed-create-key");

    expect(second.itemId).toBe(first.itemId);
    expect(store.allItems().filter((i) => i["entityType"] === "ExpirationItem")).toHaveLength(1);
  });

  it("createItem without an idempotency key never dedupes (unprotected, backward-compatible default) - two calls with identical payload create two distinct items", async () => {
    const input = { name: "Alvará", category: "Licenças", dueDate: "2026-09-10T00:00:00.000Z" };
    const first = await service.createItem(ctx(), input);
    const second = await service.createItem(ctx(), input);

    expect(second.itemId).not.toBe(first.itemId);
    expect(store.allItems().filter((i) => i["entityType"] === "ExpirationItem")).toHaveLength(2);
  });

  it("createItem: a different idempotency key creates a distinct item even with the same payload", async () => {
    const input = { name: "Alvará", category: "Licenças", dueDate: "2026-09-10T00:00:00.000Z" };
    const first = await service.createItem(ctx(), input, "key-a");
    const second = await service.createItem(ctx(), input, "key-b");

    expect(second.itemId).not.toBe(first.itemId);
  });

  it("createItem: reusing the same idempotency key with a different payload is rejected (ConcurrentOperationError), not silently accepted", async () => {
    await service.createItem(ctx(), { name: "Alvará", category: "Licenças", dueDate: "2026-09-10T00:00:00.000Z" }, "reused-key");

    await expect(
      service.createItem(ctx(), { name: "Contrato diferente", category: "Contrato", dueDate: "2026-10-01T00:00:00.000Z" }, "reused-key"),
    ).rejects.toBeInstanceOf(ConcurrentOperationError);
  });

  it("createItem: requestHash does not collide across field boundaries - a delimiter character inside free-text fields must not make two different payloads look like the same request", async () => {
    // Before the canonical-JSON fix, joining fields as `${name}|${category}|${dueDate}|...`
    // meant these two payloads produced the byte-identical string
    // "Foo|Bar|Baz|2026-09-10T00:00:00.000Z|||||||" - a "|" inside `name` shifted every field
    // after it, so the second call would have been misclassified as COMPLETED_SAME_REQUEST
    // (silently returning the first item) instead of correctly detecting a genuine conflict.
    await service.createItem(ctx(), { name: "Foo|Bar", category: "Baz", dueDate: "2026-09-10T00:00:00.000Z" }, "collision-key");

    await expect(
      service.createItem(ctx(), { name: "Foo", category: "Bar|Baz", dueDate: "2026-09-10T00:00:00.000Z" }, "collision-key"),
    ).rejects.toBeInstanceOf(ConcurrentOperationError);
  });

  it("createItem: the same idempotency key is isolated per tenant - two tenants using the same key each get their own item", async () => {
    const input = { name: "Alvará", category: "Licenças", dueDate: "2026-09-10T00:00:00.000Z" };
    const tenantA = await service.createItem(ctx({ tenant: { tenantId: "tenant-1", roles: ["OWNER"] } }), input, "shared-key");
    const tenantB = await service.createItem(ctx({ tenant: { tenantId: "tenant-2", roles: ["OWNER"] } }), input, "shared-key");

    expect(tenantB.itemId).not.toBe(tenantA.itemId);
    expect(tenantB.tenantId).toBe("tenant-2");
  });

  it("createItem: KNOWN LIMITATION shared with renewItem (pre-existing, not introduced by this change) - if the process dies between commit() and idempotency.complete(), the record is stuck IN_PROGRESS forever and a legitimate retry gets ConcurrentOperationError instead of the reconciled item. Documented here so the behavior is explicit, not a silent duplicate: the item is still created exactly once, never twice.", async () => {
    const input = { name: "Alvará", category: "Licenças", dueDate: "2026-09-10T00:00:00.000Z" };
    vi.spyOn(store, "update").mockRejectedValueOnce(new Error("simulated crash before idempotency.complete()"));

    await expect(service.createItem(ctx(), input, "crash-key")).rejects.toThrow("simulated crash");
    expect(store.allItems().filter((i) => i["entityType"] === "ExpirationItem")).toHaveLength(1); // the item WAS created - commit() already succeeded before the simulated crash

    await expect(service.createItem(ctx(), input, "crash-key")).rejects.toBeInstanceOf(ConcurrentOperationError); // retry fails safe (no duplicate), it does not silently succeed nor duplicate
    expect(store.allItems().filter((i) => i["entityType"] === "ExpirationItem")).toHaveLength(1); // still exactly one item - the original defect (duplicate creation) does not resurface
  });

  it("createItem denies a VIEWER role", async () => {
    await expect(
      service.createItem(ctx({ tenant: { tenantId: "tenant-1", roles: ["VIEWER"] } }), {
        name: "x",
        category: "y",
        dueDate: "2026-09-10T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("getItem 404s on a soft-deleted item", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await service.deleteItem(ctx(), item.itemId, item.version);
    await expect(service.getItem(ctx(), item.itemId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateItem enforces OCC: a stale expectedVersion is rejected with ConflictError, a fresh one succeeds", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });

    await expect(service.updateItem(ctx(), item.itemId, { name: "b" }, 999)).rejects.toBeInstanceOf(ConflictError);

    const updated = await service.updateItem(ctx(), item.itemId, { name: "b" }, item.version);
    expect(updated.version).toBe(2);
    expect(updated.name).toBe("b");
  });

  it("changing dueDate via updateItem emits ItemDueDateChanged through the outbox in the same transaction as the item write", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await service.updateItem(ctx(), item.itemId, { dueDate: "2026-10-01T00:00:00.000Z" }, item.version);

    // BLOCKER-B: createItem itself now also emits expiration.item-due-date-changed.v1
    // (previousDueDate: null) - filter to the UPDATE's own event specifically.
    const outboxRecords = store.allItems().filter((i) => i["entityType"] === "OutboxEvent" && i["eventType"] === "expiration.item-due-date-changed.v1");
    expect(outboxRecords).toHaveLength(2);
    const updateEvent = outboxRecords.find((r) => (r["payload"] as Record<string, unknown>)["previousDueDate"] !== null)!;
    const payload = updateEvent["payload"] as Record<string, unknown>;
    expect(payload["previousDueDate"]).toBe("2026-09-10T00:00:00.000Z");
    expect(payload["newDueDate"]).toBe("2026-10-01T00:00:00.000Z");
    expect(payload["itemVersion"]).toBe(2);
  });

  it("createItem emits ItemDueDateChanged (BLOCKER-B: a new item's due date is 'the due date changing' from nonexistent, so a policy attached at creation time can materialize immediately)", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });

    const outboxRecords = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
    expect(outboxRecords).toHaveLength(1);
    expect(outboxRecords[0]?.["eventType"]).toBe("expiration.item-due-date-changed.v1");
    const payload = outboxRecords[0]?.["payload"] as Record<string, unknown>;
    expect(payload["previousDueDate"]).toBeNull();
    expect(payload["newDueDate"]).toBe("2026-09-10T00:00:00.000Z");
    expect(payload["itemVersion"]).toBe(1);
    expect(outboxRecords[0]?.["aggregateId"]).toBe(item.itemId);
  });

  it("updateItem without a dueDate change writes no ADDITIONAL outbox record beyond createItem's own", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await service.updateItem(ctx(), item.itemId, { name: "renamed" }, item.version);

    const outboxRecords = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
    expect(outboxRecords).toHaveLength(1); // only createItem's - updateItem itself added none
  });

  it("archiveItem emits expiration.item-deactivated.v1", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await service.archiveItem(ctx(), item.itemId, item.version);

    const deactivated = store.allItems().filter((i) => i["entityType"] === "OutboxEvent" && i["eventType"] === "expiration.item-deactivated.v1");
    expect(deactivated).toHaveLength(1);
    expect((deactivated[0]?.["payload"] as Record<string, unknown>)["itemId"]).toBe(item.itemId);
  });

  it("deleteItem emits expiration.item-deactivated.v1", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await service.deleteItem(ctx(), item.itemId, item.version);

    const deactivated = store.allItems().filter((i) => i["entityType"] === "OutboxEvent" && i["eventType"] === "expiration.item-deactivated.v1");
    expect(deactivated).toHaveLength(1);
  });

  it("renewItem emits expiration.item-deactivated.v1 for the OLD item alongside item-due-date-changed.v1 for the NEW item", async () => {
    const source = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    const renewed = await service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version);

    const deactivated = store.allItems().filter((i) => i["entityType"] === "OutboxEvent" && i["eventType"] === "expiration.item-deactivated.v1");
    expect(deactivated).toHaveLength(1);
    expect((deactivated[0]?.["payload"] as Record<string, unknown>)["itemId"]).toBe(source.itemId);

    const dueDateChanged = store.allItems().filter((i) => i["entityType"] === "OutboxEvent" && i["eventType"] === "expiration.item-due-date-changed.v1");
    // source's own createItem event + the renewed item's own creation event
    expect(dueDateChanged).toHaveLength(2);
    expect(dueDateChanged.some((r) => r["aggregateId"] === renewed.itemId)).toBe(true);
  });

  it("every mutation appends exactly one append-only AuditEvent - no update/delete API is exposed for it", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await service.updateItem(ctx(), item.itemId, { name: "b" }, item.version);
    await service.archiveItem(ctx(), item.itemId, item.version + 1);

    const audits = store.allItems().filter((i) => i["entityType"] === "AuditEvent");
    expect(audits.map((a) => a["action"])).toEqual(["CREATE", "UPDATE", "ARCHIVE"]);
    for (const audit of audits) {
      expect(audit["PK"]).toMatch(/^TENANT#tenant-1#AUDIT#\d{6}$/);
    }
  });

  it("renewItem creates a new ACTIVE item (lineage successor), marks the source RENEWED, and never mutates the source dueDate in place", async () => {
    const source = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    const renewed = await service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version);

    expect(renewed.itemId).not.toBe(source.itemId);
    expect(renewed.status).toBe("ACTIVE");
    expect(renewed.renewedFromId).toBe(source.itemId);
    expect(renewed.dueDate).toBe("2027-09-10T00:00:00.000Z");

    const sourceAfter = await store.get<{ PK: string; SK: string; status: string; dueDate: string }>({
      PK: `TENANT#tenant-1#ITEM#${source.itemId}`,
      SK: "META",
    });
    expect(sourceAfter?.status).toBe("RENEWED");
    expect(sourceAfter?.dueDate).toBe("2026-09-10T00:00:00.000Z"); // unchanged - renewal never mutates the source's dueDate
  });

  it("renewItem is idempotent: retrying with the same key returns the same new item instead of creating a second one", async () => {
    const source = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    const first = await service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version, "fixed-key");
    const second = await service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version, "fixed-key");

    expect(second.itemId).toBe(first.itemId);
    const allItems = store.allItems().filter((i) => i["entityType"] === "ExpirationItem");
    expect(allItems).toHaveLength(2); // source + one renewed successor, not two
  });

  it("renewItem: an OCC conflict (stale expectedVersion) releases the idempotency key, so a retry with a freshly-fetched version succeeds - it does not permanently fail with ConcurrentOperationError", async () => {
    // Regression for a real bug found implementing the Renew vertical slice's OCC-recovery
    // flow (docs/frontend/core-expiration-vertical-slice.md §16): begin() acquired the lock
    // (status IN_PROGRESS) BEFORE the OCC-guarded write ran; the write then failed its
    // condition and threw ConflictError, but nothing released the lock - idempotency.complete()
    // was never reached. A retry under the SAME client-generated idempotency key (which the
    // frontend correctly reuses per mission §29 - a retry of the same logical submission
    // reuses its key) computed a DIFFERENT requestHash (the caller re-fetched the item and
    // supplied the new expectedVersion), so begin() saw a hash mismatch against the still-
    // IN_PROGRESS record and threw ConcurrentOperationError forever, even though the renewal
    // never actually happened. ExpirationService.renewItem's catch block must call
    // idempotency.abort() before rethrowing so this retry can acquire fresh.
    const source = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });

    // Simulate the "someone else changed it concurrently" version conflict - expectedVersion
    // is stale (source.version + 1 instead of source.version).
    await expect(
      service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version + 1, "same-client-key"),
    ).rejects.toBeInstanceOf(ConflictError);

    // The failed attempt must not have created a successor or transitioned the source.
    expect(store.allItems().filter((i) => i["entityType"] === "ExpirationItem")).toHaveLength(1);

    // Retry: the caller re-fetched the item (same version as before, nothing actually changed
    // in this test - a real concurrent writer isn't needed to prove the key is unblocked) and
    // resubmits with the SAME idempotency key, per mission §29.
    const renewed = await service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version, "same-client-key");

    expect(renewed.renewedFromId).toBe(source.itemId);
    expect(store.allItems().filter((i) => i["entityType"] === "ExpirationItem")).toHaveLength(2);
  });

  it("renewItem: retrying under the same key after a wrong-status conflict (already renewed) also releases the lock rather than blocking forever", async () => {
    const source = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await service.renewItem(ctx(), source.itemId, { newDueDate: "2027-01-01T00:00:00.000Z" }, source.version); // no key - unrelated attempt, transitions source to RENEWED

    await expect(
      service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version, "another-client-key"),
    ).rejects.toBeInstanceOf(ConflictError); // source is RENEWED now, not ACTIVE

    // A subsequent, genuinely different renewal attempt (real product flow: the user reloads
    // the now-RENEWED item and gives up, or the item continues to be RENEWED and this key is
    // simply never retried) must not leave "another-client-key" poisoned for unrelated future
    // use under a different itemId - abort() must have released it.
    const other = await service.createItem(ctx(), { name: "c", category: "d", dueDate: "2026-09-10T00:00:00.000Z" });
    const renewedOther = await service.renewItem(ctx(), other.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, other.version, "another-client-key");
    expect(renewedOther.renewedFromId).toBe(other.itemId);
  });

  it("renewItem: requestHash distinguishes two requests that share itemId/expectedVersion/cycle but differ in newDueDate (Codex Round B finding, fixed)", async () => {
    // Before the fix, requestHash was `${itemId}|${expectedVersion}|${cycle}` - when a caller
    // supplies `cycle` explicitly (independent of newDueDate per renew-item-request.v1.json),
    // two requests with the same cycle but different newDueDate hashed identically and the
    // second would have been wrongly treated as a replay of the first.
    const source = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });

    const first = await service.renewItem(ctx(), source.itemId, { newDueDate: "2027-01-01T00:00:00.000Z", cycle: "same-cycle-label" }, source.version, "same-key");
    expect(first.dueDate).toBe("2027-01-01T00:00:00.000Z");

    // Same key, same cycle label, but a genuinely different newDueDate - must be rejected as a
    // real conflict (key reuse across different logical requests), never silently treated as
    // "the same request, return the cached result".
    await expect(
      service.renewItem(ctx(), source.itemId, { newDueDate: "2027-06-01T00:00:00.000Z", cycle: "same-cycle-label" }, source.version, "same-key"),
    ).rejects.toBeInstanceOf(ConcurrentOperationError);
  });

  it("renewItem: if idempotency.complete() fails after a successful commit, the lock is left IN_PROGRESS (never wrongly reset to ABORTED) and a same-key retry can never create a duplicate successor (Codex Round B finding, fixed)", async () => {
    const source = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });

    const updateSpy = vi.spyOn(store, "update").mockRejectedValueOnce(new Error("simulated complete() failure"));
    await expect(
      service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version, "same-key"),
    ).rejects.toThrow("simulated complete() failure");
    updateSpy.mockRestore();

    // The transactional write itself DID succeed (source RENEWED, one successor created) -
    // only idempotency bookkeeping failed afterward, and must not have been silently discarded
    // by an incorrect abort().
    expect(store.allItems().filter((i) => i["entityType"] === "ExpirationItem")).toHaveLength(2);

    // A retry under the same key - even with the now-stale original expectedVersion - must
    // never create a second successor. The record is left IN_PROGRESS (the pre-existing,
    // documented residual: mission §32/docs/frontend/core-expiration-vertical-slice.md §16),
    // so this surfaces as ConcurrentOperationError, not data loss or duplication.
    await expect(
      service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version, "same-key"),
    ).rejects.toBeInstanceOf(ConcurrentOperationError);
    expect(store.allItems().filter((i) => i["entityType"] === "ExpirationItem")).toHaveLength(2); // still exactly 2, never 3
  });

  it("listDashboard queries GSI1 by tenant+status and returns items ordered by dueDate", async () => {
    await service.createItem(ctx(), { name: "later", category: "b", dueDate: "2026-12-01T00:00:00.000Z" });
    await service.createItem(ctx(), { name: "sooner", category: "b", dueDate: "2026-09-01T00:00:00.000Z" });

    const items = await service.listDashboard(ctx(), { status: "ACTIVE" });
    expect(items.map((i) => i.name)).toEqual(["sooner", "later"]);
  });

  it("listDashboard for one tenant never returns another tenant's items", async () => {
    await service.createItem(ctx({ tenant: { tenantId: "tenant-1", roles: ["OWNER"] } }), {
      name: "tenant-1-item",
      category: "b",
      dueDate: "2026-09-01T00:00:00.000Z",
    });
    await service.createItem(ctx({ tenant: { tenantId: "tenant-2", roles: ["OWNER"] } }), {
      name: "tenant-2-item",
      category: "b",
      dueDate: "2026-09-01T00:00:00.000Z",
    });

    const items = await service.listDashboard(ctx({ tenant: { tenantId: "tenant-1", roles: ["OWNER"] } }), { status: "ACTIVE" });
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe("tenant-1-item");
  });
});
