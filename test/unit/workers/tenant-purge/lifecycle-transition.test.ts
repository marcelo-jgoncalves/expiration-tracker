import { describe, expect, it } from "vitest";
import { advanceTenantLifecycle, UnexpectedTenantLifecycleStateError, type TenantLifecycleReader } from "../../../../src/workers/tenant-purge/lifecycle-transition.js";
import { tenantLifecycleKey, type TenantLifecycleRecord, type TenantLifecycleStatus } from "../../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { transitionTenantLifecycle, type SystemMutationStore } from "../../../../src/shared/tenant-lifecycle/system-mutation.js";
import { InMemoryIdentityStore } from "../../identity/in-memory-store.js";

const TABLE = "MainTable";

async function seed(store: InMemoryIdentityStore, tenantId: string, status: TenantLifecycleStatus, version = 1): Promise<void> {
  await store.putIfAbsent({
    ...tenantLifecycleKey(tenantId),
    entityType: "TenantLifecycleRecord",
    tenantId,
    status,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    version,
  });
}

/** Reads through the same in-memory store the mutation lane writes to, so an idempotent re-read
 * observes the real committed state rather than a hand-stubbed one. */
function readerFor(store: InMemoryIdentityStore): TenantLifecycleReader {
  return { read: async (tenantId) => store.get<TenantLifecycleRecord>(tenantLifecycleKey(tenantId)) };
}

describe("advanceTenantLifecycle (D-121 Rodada 2 Fix 3 - the one transition handler)", () => {
  it("advances QUIESCING -> PURGING through the OCC-fenced SystemMutation lane", async () => {
    const store = new InMemoryIdentityStore();
    await seed(store, "tenant-1", "QUIESCING");

    const out = await advanceTenantLifecycle({ store, reader: readerFor(store), tableName: TABLE }, { tenantId: "tenant-1", from: "QUIESCING", to: "PURGING" });

    expect(out).toEqual({ tenantId: "tenant-1", status: "PURGING", alreadyAdvanced: false });
    const record = await store.get<TenantLifecycleRecord>(tenantLifecycleKey("tenant-1"));
    expect(record?.status).toBe("PURGING");
    expect(record?.version).toBe(2);
  });

  // G-V3 target: the idempotent no-op branch. A Step Functions Task retried after a Lambda
  // timeout whose TransactWriteItems ACTUALLY committed re-invokes this handler with the same
  // {from, to} - the record is already at `to`. Mutation that must fail: deleting the
  // `record.status === input.to` early return makes this throw
  // UnexpectedTenantLifecycleStateError, turning a successful transition into a permanently
  // failing state machine execution.
  it("treats a record already at `to` as an idempotent no-op instead of throwing on its own success", async () => {
    const store = new InMemoryIdentityStore();
    await seed(store, "tenant-1", "PURGING", 7);

    const out = await advanceTenantLifecycle({ store, reader: readerFor(store), tableName: TABLE }, { tenantId: "tenant-1", from: "QUIESCING", to: "PURGING" });

    expect(out).toEqual({ tenantId: "tenant-1", status: "PURGING", alreadyAdvanced: true });
    // Nothing was committed - the version is untouched, proving this returned before the lane ran.
    const record = await store.get<TenantLifecycleRecord>(tenantLifecycleKey("tenant-1"));
    expect(record?.version).toBe(7);
  });

  it("throws (so ASL's native Catch applies) when the record is at neither `from` nor `to`", async () => {
    const store = new InMemoryIdentityStore();
    await seed(store, "tenant-1", "ACTIVE");

    await expect(advanceTenantLifecycle({ store, reader: readerFor(store), tableName: TABLE }, { tenantId: "tenant-1", from: "QUIESCING", to: "PURGING" })).rejects.toBeInstanceOf(
      UnexpectedTenantLifecycleStateError,
    );
  });

  it("throws when the lifecycle record does not exist at all", async () => {
    const store = new InMemoryIdentityStore();

    await expect(advanceTenantLifecycle({ store, reader: readerFor(store), tableName: TABLE }, { tenantId: "ghost", from: "QUIESCING", to: "PURGING" })).rejects.toBeInstanceOf(
      UnexpectedTenantLifecycleStateError,
    );
  });

  // The conflict path: a concurrent duplicate Task invocation commits the SAME move between our
  // read and our write. Re-reading once and finding the record at `to` is the only benign
  // explanation and is accepted as the idempotent no-op.
  it("accepts a SystemMutationConflictError as idempotent when a re-read shows the record landed on `to`", async () => {
    const store = new InMemoryIdentityStore();
    await seed(store, "tenant-1", "QUIESCING");
    const reader = readerFor(store);

    // Racing store: the transactWrite is rejected as a conflict, but the record is concurrently
    // moved to PURGING by the "other" invocation - exactly the real interleaving.
    const racingStore: SystemMutationStore = {
      transactWrite: async () => {
        // Commit the SAME move through the real primitive (so the fake sees occ.ts's real
        // builder output), then fail our own write exactly as DynamoDB would have.
        await transitionTenantLifecycle({ store, tableName: TABLE, tenantId: "tenant-1", from: "QUIESCING", to: "PURGING", expectedVersion: 1 });
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] };
      },
    };

    const out = await advanceTenantLifecycle({ store: racingStore, reader, tableName: TABLE }, { tenantId: "tenant-1", from: "QUIESCING", to: "PURGING" });

    expect(out.alreadyAdvanced).toBe(true);
    expect(out.status).toBe("PURGING");
  });

  it("rethrows a conflict when the re-read does NOT show the record at `to` (genuine contention, never a silent success)", async () => {
    const store = new InMemoryIdentityStore();
    await seed(store, "tenant-1", "QUIESCING");
    const conflictingStore: SystemMutationStore = {
      transactWrite: async () => {
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] };
      },
    };

    await expect(advanceTenantLifecycle({ store: conflictingStore, reader: readerFor(store), tableName: TABLE }, { tenantId: "tenant-1", from: "QUIESCING", to: "PURGING" })).rejects.toThrow();
  });

  it("records blockedReason when moving a stuck purge to BLOCKED", async () => {
    const store = new InMemoryIdentityStore();
    await seed(store, "tenant-1", "PURGING");

    await advanceTenantLifecycle({ store, reader: readerFor(store), tableName: TABLE }, { tenantId: "tenant-1", from: "PURGING", to: "BLOCKED", blockedReason: "PURGE_NOT_CONVERGING" });

    const record = await store.get<TenantLifecycleRecord>(tenantLifecycleKey("tenant-1"));
    expect(record?.status).toBe("BLOCKED");
    expect(record?.blockedReason).toBe("PURGE_NOT_CONVERGING");
    expect(record?.blockedFrom).toBe("PURGING");
  });

  // D-127: the one designed exception to "neither from nor to throws" - the ASL's
  // CheckCancelled Choice depends on this returning a clean {cancelled: true} result instead of
  // throwing, so cancellation ends the execution in a Succeed state, never MarkBlocked.
  describe("D-127: HELD_FOR_RECOVERY -> DELETING finding the record already back at ACTIVE (cancelled)", () => {
    it("returns {cancelled: true} instead of throwing, and commits NOTHING", async () => {
      const store = new InMemoryIdentityStore();
      await seed(store, "tenant-1", "ACTIVE", 9); // CancelOrganizationClosureService already restored it

      const out = await advanceTenantLifecycle(
        { store, reader: readerFor(store), tableName: TABLE },
        { tenantId: "tenant-1", from: "HELD_FOR_RECOVERY", to: "DELETING" },
      );

      expect(out).toEqual({ tenantId: "tenant-1", status: "ACTIVE", alreadyAdvanced: false, cancelled: true });
      const record = await store.get<TenantLifecycleRecord>(tenantLifecycleKey("tenant-1"));
      expect(record?.version).toBe(9); // untouched - no write happened
      expect(record?.status).toBe("ACTIVE");
    });

    // G-V3 target: the narrow scoping of the cancellation exception. Mutation that must fail:
    // widening the `record.status === "ACTIVE"` check (or dropping the `from`/`to` match) to
    // apply more broadly would let a GENUINELY unexpected state (e.g. a bug that left the record
    // BLOCKED) silently report {cancelled: true} instead of throwing - exactly the "never open a
    // new hole while adding a state" risk this task was warned about.
    it("still throws UnexpectedTenantLifecycleStateError for every OTHER unexpected status at this same from/to pair", async () => {
      const store = new InMemoryIdentityStore();
      await seed(store, "tenant-1", "BLOCKED");

      await expect(
        advanceTenantLifecycle({ store, reader: readerFor(store), tableName: TABLE }, { tenantId: "tenant-1", from: "HELD_FOR_RECOVERY", to: "DELETING" }),
      ).rejects.toBeInstanceOf(UnexpectedTenantLifecycleStateError);
    });

    // G-V3 target: the cancellation exception must be scoped to exactly this from/to pair, never
    // leak into other transitions that happen to find ACTIVE unexpectedly (which would always be
    // a genuine bug elsewhere, never a designed outcome).
    it("does NOT apply the cancellation exception to any other from/to pair finding ACTIVE unexpectedly", async () => {
      const store = new InMemoryIdentityStore();
      await seed(store, "tenant-1", "ACTIVE");

      await expect(
        advanceTenantLifecycle({ store, reader: readerFor(store), tableName: TABLE }, { tenantId: "tenant-1", from: "QUIESCING", to: "PURGING" }),
      ).rejects.toBeInstanceOf(UnexpectedTenantLifecycleStateError);
    });
  });
});
