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
