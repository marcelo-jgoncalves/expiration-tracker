import { describe, expect, it } from "vitest";
import {
  canTransition,
  assertValidTransition,
  InvalidTenantLifecycleTransitionError,
  tenantLifecycleKey,
  type TenantLifecycleStatus,
} from "../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { executeTenantBusinessMutation } from "../../src/shared/tenant-lifecycle/tenant-business-mutation.js";
import { buildVersionedCreate, buildVersionedUpdate, buildVersionedDelete, type TransactWriteEntry } from "../../src/shared/dynamodb/occ.js";
import { InternalError, TenantNotActiveError } from "../../src/shared/errors/app-error.js";
import { InMemoryIdentityStore } from "./identity/in-memory-store.js";

const ALL_STATUSES: TenantLifecycleStatus[] = ["ACTIVE", "HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"];

describe("TenantLifecycleRecord state machine", () => {
  it("allows every forward transition on the approved happy path (D-127: ACTIVE now goes through HELD_FOR_RECOVERY first)", () => {
    expect(canTransition("ACTIVE", "HELD_FOR_RECOVERY")).toBe(true);
    expect(canTransition("HELD_FOR_RECOVERY", "DELETING")).toBe(true);
    expect(canTransition("DELETING", "QUIESCING")).toBe(true);
    expect(canTransition("QUIESCING", "PURGING")).toBe(true);
    expect(canTransition("PURGING", "VERIFIED")).toBe(true);
    expect(canTransition("VERIFIED", "DELETED")).toBe(true);
  });

  it("D-127: never allows reverting to ACTIVE from any state EXCEPT the one named exception, HELD_FOR_RECOVERY", () => {
    for (const from of ALL_STATUSES) {
      if (from === "HELD_FOR_RECOVERY") continue;
      expect(canTransition(from, "ACTIVE"), `${from} -> ACTIVE must be false`).toBe(false);
    }
    expect(canTransition("HELD_FOR_RECOVERY", "ACTIVE")).toBe(true);
  });

  it("never allows leaving DELETED (true terminal state)", () => {
    for (const to of ALL_STATUSES) {
      if (to === "DELETED") continue;
      expect(canTransition("DELETED", to), `DELETED -> ${to} must be false`).toBe(false);
    }
  });

  it("rejects skipping stages (e.g. DELETING straight to VERIFIED, ACTIVE straight to PURGING/DELETING, HELD_FOR_RECOVERY straight to QUIESCING)", () => {
    expect(canTransition("DELETING", "VERIFIED")).toBe(false);
    expect(canTransition("ACTIVE", "PURGING")).toBe(false);
    expect(canTransition("ACTIVE", "QUIESCING")).toBe(false);
    expect(canTransition("ACTIVE", "DELETING")).toBe(false); // D-127: no longer a direct edge
    expect(canTransition("HELD_FOR_RECOVERY", "QUIESCING")).toBe(false);
    expect(canTransition("HELD_FOR_RECOVERY", "PURGING")).toBe(false);
  });

  it("allows entering BLOCKED/HELD from any of the mid-cascade states, including HELD_FOR_RECOVERY (D-127)", () => {
    for (const from of ["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED"] as const) {
      expect(canTransition(from, "BLOCKED")).toBe(true);
      expect(canTransition(from, "HELD")).toBe(true);
    }
  });

  it("does not allow ACTIVE to enter BLOCKED/HELD directly (only mid-cascade states can get stuck)", () => {
    expect(canTransition("ACTIVE", "BLOCKED")).toBe(false);
    expect(canTransition("ACTIVE", "HELD")).toBe(false);
  });

  it("allows resuming from BLOCKED/HELD back to exactly the state it was blocked from, never elsewhere, including the new HELD_FOR_RECOVERY case (D-127)", () => {
    expect(canTransition("BLOCKED", "QUIESCING", "QUIESCING")).toBe(true);
    expect(canTransition("BLOCKED", "PURGING", "QUIESCING")).toBe(false);
    expect(canTransition("HELD", "PURGING", "PURGING")).toBe(true);
    expect(canTransition("HELD", "DELETED", "PURGING")).toBe(false);
    expect(canTransition("HELD", "HELD_FOR_RECOVERY", "HELD_FOR_RECOVERY")).toBe(true);
    // Resuming from a HELD_FOR_RECOVERY-originated hold must land on HELD_FOR_RECOVERY, never
    // skip straight to ACTIVE (that would bypass CancelOrganizationClosureService's own checks -
    // StopExecution, OCC re-verification - entirely) or to any further-along state.
    expect(canTransition("HELD", "ACTIVE", "HELD_FOR_RECOVERY")).toBe(false);
    expect(canTransition("HELD", "DELETING", "HELD_FOR_RECOVERY")).toBe(false);
  });

  it("assertValidTransition throws InvalidTenantLifecycleTransitionError for an illegal move, and is silent for a legal one", () => {
    expect(() => assertValidTransition("DELETING", "ACTIVE")).toThrow(InvalidTenantLifecycleTransitionError);
    expect(() => assertValidTransition("ACTIVE", "HELD_FOR_RECOVERY")).not.toThrow();
    expect(() => assertValidTransition("HELD_FOR_RECOVERY", "ACTIVE")).not.toThrow();
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

  it("adversarial (D-072 tenant/entries cross-validation): rejects a Put entry whose Item.tenantId does not match the fenced tenantId, before any write is attempted", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-A", "ACTIVE");
    await seedLifecycle(store, "tenant-B", "ACTIVE");

    // Caller fences on tenant-A but the entry it built is actually scoped to tenant-B.
    const entries: TransactWriteEntry[] = [
      {
        Put: buildVersionedCreate(TABLE, {
          PK: "TENANT#tenant-B#ITEM#item-1",
          SK: "META",
          tenantId: "tenant-B",
          version: 1,
        }),
      },
    ];

    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-A", entries })).rejects.toBeInstanceOf(
      InternalError,
    );

    // Neither tenant's row was written - rejected before the transaction was even attempted.
    expect(await store.get({ PK: "TENANT#tenant-B#ITEM#item-1", SK: "META" })).toBeUndefined();
  });

  it("adversarial (D-072): rejects an Update entry whose declared tenantId does not match the fenced tenantId", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-A", "ACTIVE");
    await seedLifecycle(store, "tenant-B", "ACTIVE");
    await store.putIfAbsent({ PK: "TENANT#tenant-B#ITEM#item-1", SK: "META", tenantId: "tenant-B", version: 1, count: 0 });

    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: TABLE,
          key: { PK: "TENANT#tenant-B#ITEM#item-1", SK: "META" },
          tenantId: "tenant-B",
          expectedVersion: 1,
          set: { count: 1 },
        }),
      },
    ];

    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-A", entries })).rejects.toBeInstanceOf(
      InternalError,
    );

    const untouched = await store.get<{ PK: string; SK: string; count: number; version: number }>({
      PK: "TENANT#tenant-B#ITEM#item-1",
      SK: "META",
    });
    expect(untouched?.count).toBe(0);
    expect(untouched?.version).toBe(1);
  });

  it("KNOWN GAP, not a hardening target this session (D-072/D-079/D-080 follow-up review, Codex-confirmed): an entry with a non-TENANT#-prefixed PK AND no declared tenantId field at all passes through unchecked - closing this fully needs mandatory tenant metadata enforced by the builders themselves or a branded entry type, see decisions-log.md. This is a genuinely hypothetical shape today: 4 of 6 REAL non-TENANT#-prefixed entities in this codebase (GuestTokenPointer, Session, TextractJob, IdentityMapping) DO declare a tenantId field and so ARE already caught by check 1 below if forged - see the next test. The 2 real entities with neither signal (LoginAttempt, pre-authentication by design; GuestRateLimitRecord, src/modules/subject/application/guest-rate-limiter.ts, tenantless rate-limiting before the guest token resolves a tenant) are never routed through this lane (Codex round 4, D-080, independently re-confirmed by grep). This is NOT the same as the D-075 PK-encoding gap above, which IS now closed", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-1", "ACTIVE");

    // A hypothetical entity shaped like LOGINATTEMPT# (no TENANT# prefix, no tenantId field at
    // all, by design - minted before authentication) - neither check can catch a mismatch on a
    // shape like this. Documented residual gap, not exercised by any real call site today
    // (verified by grep of every executeTenantBusinessMutation/tryTenantBusinessMutation call site).
    const entries: TransactWriteEntry[] = [{ Put: buildVersionedCreate(TABLE, { PK: "LOGINATTEMPT#abc123", SK: "POINTER", version: 1 }) }];
    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-1", entries })).resolves.toBeUndefined();
  });

  it("adversarial (this session): a forged tenantId field alongside a real non-TENANT#-prefixed PK convention (GUESTTOKEN#, matching GuestTokenPointer's actual key shape from src/modules/subject/domain/guest-token.ts) encoding a different tenant is rejected before any write - proves check 1 (declared tenantId) already covers every REAL non-TENANT#-prefixed entity in this codebase, since all of them declare tenantId, even though check 2 (PK-prefix) intentionally skips this PK shape", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-A", "ACTIVE");
    await seedLifecycle(store, "tenant-B", "ACTIVE");

    // GuestTokenPointer.tenantId is forged to match the fence, but the pointer genuinely belongs
    // to tenant-B (selectorHash is a lookup key, not a tenant-encoding one - the PK itself never
    // encodes a tenant, by design, since guest-token lookup happens before tenantId is known).
    const entries: TransactWriteEntry[] = [
      {
        Put: buildVersionedCreate(TABLE, {
          PK: "GUESTTOKEN#selector-hash-xyz",
          SK: "POINTER",
          tenantId: "tenant-A",
          subjectId: "subject-1",
          version: 1,
        }),
      },
    ];

    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-B", entries })).rejects.toBeInstanceOf(
      InternalError,
    );
    expect(await store.get({ PK: "GUESTTOKEN#selector-hash-xyz", SK: "POINTER" })).toBeUndefined();
  });

  it("D-075 CLOSED: rejects a Put entry whose declared Item.tenantId matches the fenced tenantId but whose physical PK actually encodes a different tenant - the residual bypass Codex's round-2 review flagged as the most serious remaining gap", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-A", "ACTIVE");
    await seedLifecycle(store, "tenant-B", "ACTIVE");

    // Item.tenantId is forged to match the fence, but PK genuinely targets tenant-B's key space.
    const entries: TransactWriteEntry[] = [
      {
        Put: buildVersionedCreate(TABLE, {
          PK: "TENANT#tenant-B#ITEM#item-9",
          SK: "META",
          tenantId: "tenant-A",
          version: 1,
        }),
      },
    ];

    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-A", entries })).rejects.toBeInstanceOf(
      InternalError,
    );
    expect(await store.get({ PK: "TENANT#tenant-B#ITEM#item-9", SK: "META" })).toBeUndefined();
  });

  it("D-075 CLOSED: rejects an Update entry whose Key.PK encodes a different tenant than the fence, even with no declared :tenantId mismatch caught first", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-A", "ACTIVE");
    await seedLifecycle(store, "tenant-B", "ACTIVE");
    await store.putIfAbsent({ PK: "TENANT#tenant-B#ITEM#item-10", SK: "META", tenantId: "tenant-B", version: 1, count: 0 });

    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: TABLE,
          key: { PK: "TENANT#tenant-B#ITEM#item-10", SK: "META" },
          tenantId: "tenant-B",
          expectedVersion: 1,
          set: { count: 1 },
        }),
      },
    ];

    // Declared :tenantId already mismatches here too (tenant-B vs fenced tenant-A) - proves the
    // PK check is redundant-but-consistent with the declared check on this path; the dedicated
    // Put test above is the one proving the PK check catches what the declared check CANNOT.
    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-A", entries })).rejects.toBeInstanceOf(
      InternalError,
    );
    const untouched = await store.get<{ PK: string; SK: string; count: number; version: number }>({
      PK: "TENANT#tenant-B#ITEM#item-10",
      SK: "META",
    });
    expect(untouched?.count).toBe(0);
  });

  it("D-075 CLOSED: rejects any entry whose TableName does not match the fenced tableName", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-1", "ACTIVE");

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate("SomeOtherTable", { PK: "TENANT#tenant-1#ITEM#item-11", SK: "META", version: 1 }) },
    ];

    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-1", entries })).rejects.toBeInstanceOf(
      InternalError,
    );
  });

  it("adversarial (D-072 follow-up review): rejects a Delete entry whose declared tenantId does not match the fenced tenantId", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-A", "ACTIVE");
    await seedLifecycle(store, "tenant-B", "ACTIVE");
    await store.putIfAbsent({ PK: "TENANT#tenant-B#ITEM#item-4", SK: "META", tenantId: "tenant-B", version: 1 });

    const entries: TransactWriteEntry[] = [
      {
        Delete: buildVersionedDelete({
          tableName: TABLE,
          key: { PK: "TENANT#tenant-B#ITEM#item-4", SK: "META" },
          tenantId: "tenant-B",
          expectedVersion: 1,
        }),
      },
    ];

    await expect(executeTenantBusinessMutation({ store, tableName: TABLE, tenantId: "tenant-A", entries })).rejects.toBeInstanceOf(
      InternalError,
    );

    // Not deleted - rejected before the transaction was even attempted.
    expect(await store.get({ PK: "TENANT#tenant-B#ITEM#item-4", SK: "META" })).toBeDefined();
  });

  it("adversarial (D-072 item 4 hardening): a broken adapter that populates CancellationReasons with a non-array shape does not crash - falls back to TenantNotActiveError, the same safe-by-default outcome as CancellationReasons being absent entirely", async () => {
    // Real AWS DynamoDB always sends CancellationReasons as an array; this simulates a
    // hypothetical broken/stripped adapter to prove the lane degrades safely instead of
    // throwing a TypeError from `reasons[fenceIndex]?.Code` on a non-array value.
    const brokenStore = {
      transactWrite: async (): Promise<void> => {
        const err = new Error("TransactionCanceledException");
        err.name = "TransactionCanceledException";
        (err as unknown as { CancellationReasons: unknown }).CancellationReasons = "not-an-array";
        throw err;
      },
    };

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(TABLE, { PK: "TENANT#tenant-1#ITEM#item-3", SK: "META", version: 1 }) },
    ];

    await expect(
      executeTenantBusinessMutation({ store: brokenStore, tableName: TABLE, tenantId: "tenant-1", entries }),
    ).rejects.toBeInstanceOf(TenantNotActiveError);
  });

  it("adversarial (D-072 item 4 hardening, extended after follow-up review): a CancellationReasons array present but with a malformed element at the fence's own index (missing/non-string Code) also falls back to TenantNotActiveError, not a silent pass-through of the caller's own conflict", async () => {
    // Distinguishes the array-present-but-element-malformed case from the array-absent case
    // this file's other broken-adapter test already covers - closes the specific gap a
    // follow-up Codex review found: Array.isArray() alone does not validate the SHAPE of the
    // element at the fence's own index.
    const brokenStore = {
      transactWrite: async (): Promise<void> => {
        const err = new Error("TransactionCanceledException");
        err.name = "TransactionCanceledException";
        // One entry (the caller's Put) plus the fence - fence index is 1, but the array only
        // has 1 element, so reasons[1] is undefined (a malformed/too-short array).
        (err as unknown as { CancellationReasons: unknown }).CancellationReasons = [{ Code: "None" }];
        throw err;
      },
    };

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(TABLE, { PK: "TENANT#tenant-1#ITEM#item-5", SK: "META", version: 1 }) },
    ];

    await expect(
      executeTenantBusinessMutation({ store: brokenStore, tableName: TABLE, tenantId: "tenant-1", entries }),
    ).rejects.toBeInstanceOf(TenantNotActiveError);
  });

  it("control (D-072 item 4): a well-formed CancellationReasons array where the fence's own index is Code 'None' still surfaces the caller's own conflict, not misclassified as TenantNotActiveError - proves the hardening did not regress the original CancellationReasons-aware distinction", async () => {
    const brokenStore = {
      transactWrite: async (): Promise<void> => {
        const err = new Error("TransactionCanceledException");
        err.name = "TransactionCanceledException";
        // 1 caller entry (index 0, the actual cause) + the fence (index 1, "None" - fence did
        // NOT fail).
        (err as unknown as { CancellationReasons: unknown }).CancellationReasons = [
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
        ];
        throw err;
      },
    };

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(TABLE, { PK: "TENANT#tenant-1#ITEM#item-6", SK: "META", version: 1 }) },
    ];

    await expect(
      executeTenantBusinessMutation({ store: brokenStore, tableName: TABLE, tenantId: "tenant-1", entries }),
    ).rejects.not.toBeInstanceOf(TenantNotActiveError);
  });
});
