import { describe, expect, it } from "vitest";
import {
  ConcurrentOperationError,
  IdempotencyStore,
  type DynamoLike,
} from "../../src/shared/idempotency/idempotency.js";

function fakeClient(): DynamoLike & { store: Map<string, any> } {
  const store = new Map<string, any>();
  return {
    store,
    async putIfAbsent(item) {
      const k = `${item.PK}#${item.SK}`;
      if (store.has(k)) return "ALREADY_EXISTS";
      store.set(k, item);
      return "PUT";
    },
    async get(key) {
      return store.get(`${key.PK}#${key.SK}`);
    },
    async update(item) {
      store.set(`${item.PK}#${item.SK}`, item);
    },
    async transitionIfStatus(item, expectedStatus) {
      const k = `${item.PK}#${item.SK}`;
      const current = store.get(k);
      if (!current || current.status !== expectedStatus) return false;
      store.set(k, item);
      return true;
    },
  };
}

describe("IdempotencyStore", () => {
  it("returns ACQUIRED on first begin() for a key", async () => {
    const client = fakeClient();
    const store = new IdempotencyStore(client, "IdempotencyTable");
    const result = await store.begin({
      tenantId: "t_01",
      operation: "reminder.materialize",
      key: "occ_01",
      requestHash: "hash_a",
      expiresAt: "2026-08-20T00:00:00.000Z",
    });
    expect(result).toBe("ACQUIRED");
  });

  it("returns COMPLETED_SAME_REQUEST for a retried identical request after completion", async () => {
    const client = fakeClient();
    const store = new IdempotencyStore(client, "IdempotencyTable");
    const input = {
      tenantId: "t_01",
      operation: "reminder.materialize",
      key: "occ_01",
      requestHash: "hash_a",
      expiresAt: "2026-08-20T00:00:00.000Z",
    };
    await store.begin(input);
    await store.complete({ tenantId: "t_01", operation: "reminder.materialize", key: "occ_01" });

    const result = await store.begin(input);
    expect(result).toBe("COMPLETED_SAME_REQUEST");
  });

  it("throws ConcurrentOperationError when the same key is reused with a different requestHash", async () => {
    const client = fakeClient();
    const store = new IdempotencyStore(client, "IdempotencyTable");
    await store.begin({
      tenantId: "t_01",
      operation: "reminder.materialize",
      key: "occ_01",
      requestHash: "hash_a",
      expiresAt: "2026-08-20T00:00:00.000Z",
    });

    await expect(
      store.begin({
        tenantId: "t_01",
        operation: "reminder.materialize",
        key: "occ_01",
        requestHash: "hash_b",
        expiresAt: "2026-08-20T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ConcurrentOperationError);
  });

  it("throws ConcurrentOperationError for a concurrent duplicate still IN_PROGRESS", async () => {
    const client = fakeClient();
    const store = new IdempotencyStore(client, "IdempotencyTable");
    const input = {
      tenantId: "t_01",
      operation: "reminder.materialize",
      key: "occ_01",
      requestHash: "hash_a",
      expiresAt: "2026-08-20T00:00:00.000Z",
    };
    await store.begin(input);
    await expect(store.begin(input)).rejects.toBeInstanceOf(ConcurrentOperationError);
  });

  it("abort() releases an IN_PROGRESS record so a retry with a different requestHash can acquire fresh, instead of ConcurrentOperationError forever", async () => {
    const client = fakeClient();
    const store = new IdempotencyStore(client, "IdempotencyTable");
    const input = { tenantId: "t_01", operation: "expiration.renewItem", key: "k1", requestHash: "hash_v2", expiresAt: "2026-08-20T00:00:00.000Z" };
    await store.begin(input);

    await store.abort({ tenantId: "t_01", operation: "expiration.renewItem", key: "k1" });

    const retry = await store.begin({ ...input, requestHash: "hash_v3" });
    expect(retry).toBe("ACQUIRED");
  });

  it("abort() is a no-op on an already-COMPLETED record - never discards a real cached success", async () => {
    const client = fakeClient();
    const store = new IdempotencyStore(client, "IdempotencyTable");
    const input = { tenantId: "t_01", operation: "expiration.renewItem", key: "k1", requestHash: "hash_a", expiresAt: "2026-08-20T00:00:00.000Z" };
    await store.begin(input);
    await store.complete({ tenantId: "t_01", operation: "expiration.renewItem", key: "k1", responseRef: "item-1" });

    await store.abort({ tenantId: "t_01", operation: "expiration.renewItem", key: "k1" });

    const result = await store.begin(input);
    expect(result).toBe("COMPLETED_SAME_REQUEST");
  });

  it("abort() is a no-op on a key that was never begun", async () => {
    const client = fakeClient();
    const store = new IdempotencyStore(client, "IdempotencyTable");
    await expect(store.abort({ tenantId: "t_01", operation: "expiration.renewItem", key: "never-begun" })).resolves.toBeUndefined();
  });

  it("transitionIfStatus lets exactly one of two concurrent ABORTED-reacquisition attempts win (Codex Round B TOCTOU finding, closed)", async () => {
    const client = fakeClient();
    const store = new IdempotencyStore(client, "IdempotencyTable");
    const input = { tenantId: "t_01", operation: "expiration.renewItem", key: "k1", requestHash: "hash_a", expiresAt: "2026-08-20T00:00:00.000Z" };
    await store.begin(input);
    await store.abort({ tenantId: "t_01", operation: "expiration.renewItem", key: "k1" });

    const existing = await client.get({ PK: "TENANT#t_01#IDEMPOTENCY#expiration.renewItem", SK: "KEY#k1" });
    expect(existing).toBeDefined();

    // Two concurrent callers both observed the same ABORTED record (as begin() itself would
    // via get()) and race to reacquire it - the OLD get()-then-update() implementation let
    // both "win"; the conditional transitionIfStatus() must let exactly one.
    const [resultA, resultB] = await Promise.all([
      client.transitionIfStatus({ ...existing!, status: "IN_PROGRESS", requestHash: "hash_b" }, "ABORTED"),
      client.transitionIfStatus({ ...existing!, status: "IN_PROGRESS", requestHash: "hash_c" }, "ABORTED"),
    ]);

    expect([resultA, resultB].filter(Boolean)).toHaveLength(1);
  });

  it("abort() cannot clobber a concurrently-completed record back to ABORTED", async () => {
    const client = fakeClient();
    const store = new IdempotencyStore(client, "IdempotencyTable");
    const input = { tenantId: "t_01", operation: "expiration.renewItem", key: "k1", requestHash: "hash_a", expiresAt: "2026-08-20T00:00:00.000Z" };
    await store.begin(input);
    // Simulates a legitimate complete() landing before abort()'s own conditional write applies.
    await store.complete({ tenantId: "t_01", operation: "expiration.renewItem", key: "k1", responseRef: "item-1" });

    await store.abort({ tenantId: "t_01", operation: "expiration.renewItem", key: "k1" });

    const result = await store.begin(input);
    expect(result).toBe("COMPLETED_SAME_REQUEST"); // the real success is still there, never discarded
  });

  it("scopes idempotency keys per tenant and operation", async () => {
    const client = fakeClient();
    const store = new IdempotencyStore(client, "IdempotencyTable");
    const r1 = await store.begin({
      tenantId: "t_01",
      operation: "reminder.materialize",
      key: "occ_01",
      requestHash: "hash_a",
      expiresAt: "2026-08-20T00:00:00.000Z",
    });
    const r2 = await store.begin({
      tenantId: "t_02",
      operation: "reminder.materialize",
      key: "occ_01",
      requestHash: "hash_a",
      expiresAt: "2026-08-20T00:00:00.000Z",
    });
    expect(r1).toBe("ACQUIRED");
    expect(r2).toBe("ACQUIRED");
  });
});
