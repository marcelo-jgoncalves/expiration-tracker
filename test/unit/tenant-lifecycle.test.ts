import { describe, expect, it } from "vitest";
import {
  canTransition,
  assertValidTransition,
  InvalidTenantLifecycleTransitionError,
  tenantLifecycleKey,
  type TenantLifecycleStatus,
} from "../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { executeTenantBusinessMutation } from "../../src/shared/tenant-lifecycle/tenant-business-mutation.js";
import { buildVersionedCreate, type TransactWriteEntry } from "../../src/shared/dynamodb/occ.js";
import { TenantNotActiveError } from "../../src/shared/errors/app-error.js";
import { InMemoryIdentityStore } from "./identity/in-memory-store.js";

const ALL_STATUSES: TenantLifecycleStatus[] = ["ACTIVE", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"];

describe("TenantLifecycleRecord state machine", () => {
  it("allows every forward transition on the approved happy path", () => {
    expect(canTransition("ACTIVE", "DELETING")).toBe(true);
    expect(canTransition("DELETING", "QUIESCING")).toBe(true);
    expect(canTransition("QUIESCING", "PURGING")).toBe(true);
    expect(canTransition("PURGING", "VERIFIED")).toBe(true);
    expect(canTransition("VERIFIED", "DELETED")).toBe(true);
  });

  it("never allows reverting to ACTIVE from any state", () => {
    for (const from of ALL_STATUSES) {
      expect(canTransition(from, "ACTIVE"), `${from} -> ACTIVE must be false`).toBe(false);
    }
  });

  it("never allows leaving DELETED (true terminal state)", () => {
    for (const to of ALL_STATUSES) {
      if (to === "DELETED") continue;
      expect(canTransition("DELETED", to), `DELETED -> ${to} must be false`).toBe(false);
    }
  });

  it("rejects skipping stages (e.g. DELETING straight to VERIFIED, ACTIVE straight to PURGING)", () => {
    expect(canTransition("DELETING", "VERIFIED")).toBe(false);
    expect(canTransition("ACTIVE", "PURGING")).toBe(false);
    expect(canTransition("ACTIVE", "QUIESCING")).toBe(false);
  });

  it("allows entering BLOCKED/HELD from any of the mid-cascade states", () => {
    for (const from of ["DELETING", "QUIESCING", "PURGING", "VERIFIED"] as const) {
      expect(canTransition(from, "BLOCKED")).toBe(true);
      expect(canTransition(from, "HELD")).toBe(true);
    }
  });

  it("does not allow ACTIVE to enter BLOCKED/HELD directly (only mid-cascade states can get stuck)", () => {
    expect(canTransition("ACTIVE", "BLOCKED")).toBe(false);
    expect(canTransition("ACTIVE", "HELD")).toBe(false);
  });

  it("allows resuming from BLOCKED/HELD back to exactly the state it was blocked from, never elsewhere", () => {
    expect(canTransition("BLOCKED", "QUIESCING", "QUIESCING")).toBe(true);
    expect(canTransition("BLOCKED", "PURGING", "QUIESCING")).toBe(false);
    expect(canTransition("HELD", "PURGING", "PURGING")).toBe(true);
    expect(canTransition("HELD", "DELETED", "PURGING")).toBe(false);
  });

  it("assertValidTransition throws InvalidTenantLifecycleTransitionError for an illegal move, and is silent for a legal one", () => {
    expect(() => assertValidTransition("DELETING", "ACTIVE")).toThrow(InvalidTenantLifecycleTransitionError);
    expect(() => assertValidTransition("ACTIVE", "DELETING")).not.toThrow();
  });

  it("tenantLifecycleKey is deterministic and tenant-scoped", () => {
    expect(tenantLifecycleKey("tenant-1")).toEqual({ PK: "TENANT#tenant-1#LIFECYCLE", SK: "LIFECYCLE" });
    expect(tenantLifecycleKey("tenant-2").PK).not.toBe(tenantLifecycleKey("tenant-1").PK);
  });
});

describe("executeTenantBusinessMutation (TenantBusinessMutation lane)", () => {
  const TABLE = "MainTable";

  function seedLifecycle(store: InMemoryIdentityStore, tenantId: string, status: TenantLifecycleStatus) {
    return store.putIfAbsent({
      ...tenantLifecycleKey(tenantId),
      entityType: "TenantLifecycleRecord",
      tenantId,
      status,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
      version: 1,
    });
  }

  it("commits the caller's entries when the tenant lifecycle is ACTIVE", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-1", "ACTIVE");

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(TABLE, { PK: "TENANT#tenant-1#ITEM#item-1", SK: "META", version: 1 }) },
    ];
    await executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-1", entries });

    const written = await store.get({ PK: "TENANT#tenant-1#ITEM#item-1", SK: "META" });
    expect(written).toBeDefined();
  });

  it("adversarial: rejects the mutation (fails the whole transaction) when the tenant lifecycle is DELETING - the core concurrency invariant", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-1", "DELETING");

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(TABLE, { PK: "TENANT#tenant-1#ITEM#item-1", SK: "META", version: 1 }) },
    ];

    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-1", entries })).rejects.toBeInstanceOf(
      TenantNotActiveError,
    );

    // Atomicity: the caller's own entry must NOT have been applied either.
    const written = await store.get({ PK: "TENANT#tenant-1#ITEM#item-1", SK: "META" });
    expect(written).toBeUndefined();
  });

  it("rejects the mutation when no TenantLifecycleRecord exists at all for the tenant", async () => {
    const store = new InMemoryIdentityStore();
    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(TABLE, { PK: "TENANT#tenant-1#ITEM#item-1", SK: "META", version: 1 }) },
    ];

    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-1", entries })).rejects.toBeInstanceOf(
      TenantNotActiveError,
    );
  });

  it("rejects a zero-entry call outright (nothing to fence, would silently be a no-op)", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-1", "ACTIVE");

    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-1", entries: [] })).rejects.toBeInstanceOf(
      TenantNotActiveError,
    );
  });

  it("one tenant's DELETING lifecycle never blocks a different tenant's mutation (no cross-tenant leakage in the fence)", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-1", "DELETING");
    await seedLifecycle(store, "tenant-2", "ACTIVE");

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(TABLE, { PK: "TENANT#tenant-2#ITEM#item-1", SK: "META", version: 1 }) },
    ];
    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-2", entries })).resolves.toBeUndefined();
  });
});
