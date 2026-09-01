import { describe, expect, it } from "vitest";
import { runTenantPurgeSweep, type TenantLifecycleScanSource, type TenantPurgeSweepDeps } from "../../../../src/workers/tenant-purge/tenant-purge-sweep.js";
import { tenantLifecycleKey, type TenantLifecycleRecord, type TenantLifecycleStatus } from "../../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { transitionTenantLifecycle } from "../../../../src/shared/tenant-lifecycle/system-mutation.js";
import type { TenantPurgeExecutionStarter } from "../../../../src/shared/tenant-lifecycle/tenant-purge-execution-starter.js";
import type { TenantPurgeExecutionDescriber, TenantPurgeExecutionDescription } from "../../../../src/shared/tenant-lifecycle/tenant-purge-execution-describer.js";
import { InMemoryIdentityStore } from "../../identity/in-memory-store.js";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const TABLE = "MainTable";

function record(tenantId: string, status: TenantLifecycleStatus, updatedAt: string, extra: Partial<TenantLifecycleRecord> = {}): TenantLifecycleRecord {
  return { ...tenantLifecycleKey(tenantId), SK: "LIFECYCLE", entityType: "TenantLifecycleRecord", tenantId, status, createdAt: "2026-01-01T00:00:00.000Z", updatedAt, version: 1, ...extra };
}

function scanOf(...items: TenantLifecycleRecord[]): TenantLifecycleScanSource {
  return { scanLifecycleRecords: async () => ({ items }) };
}

function recordingStarter(): TenantPurgeExecutionStarter & { started: string[] } {
  const started: string[] = [];
  return { started, startExecution: async (input) => { started.push(input.name); return { executionArn: `arn:aws:states:us-east-1:1:execution:x:${input.name}` }; } };
}

function describerReturning(description: TenantPurgeExecutionDescription): TenantPurgeExecutionDescriber {
  return { describeExecution: async () => description };
}

/** Empty stores: every verification pass reports a fully converged tenant unless a test overrides
 * one of them. */
function baseDeps(lifecycle: TenantLifecycleScanSource, executions: TenantPurgeExecutionStarter, store?: InMemoryIdentityStore): TenantPurgeSweepDeps {
  return {
    lifecycle,
    executions,
    executionDescriber: describerReturning({ status: "RUNNING", name: "unused" }),
    store: store ?? new InMemoryIdentityStore(),
    tableName: TABLE,
    dynamo: { store: { transactWrite: async () => {} }, candidates: { scanTenantItems: async () => ({ items: [] }) }, tableName: "MainTable" },
    sessionTable: { source: { scanTenantSessions: async () => ({ items: [] }), deleteSession: async () => ({ deleted: true }) } },
    s3Source: {
      listObjectVersions: async () => ({ versions: [], deleteMarkers: [], isTruncated: false }),
      deleteObjects: async () => ({ deletedCount: 0, errors: [] }),
      listMultipartUploads: async () => ({ uploads: [], isTruncated: false }),
      abortMultipartUpload: async () => {},
    },
    s3TargetsFor: (tenantId) => [{ bucket: "clean-bucket", prefix: `clean/${tenantId}/`, tenantId }],
    now: () => NOW,
  };
}

describe("runTenantPurgeSweep - repair half (D-121 Rodada 2 Fix 1's durable repair)", () => {
  // G-V3 target: the 1-hour staleness filter. Mutation that must fail: dropping the
  // `ageMs > ORPHAN_REPAIR_THRESHOLD_MS` guard makes the sweeper re-launch an execution for the
  // healthy 10-minute-old tenant too, fighting a live execution on every scheduled run.
  it("repairs only lifecycle records stale for more than an hour, never healthy in-flight ones", async () => {
    const starter = recordingStarter();
    const lifecycle = scanOf(
      record("fresh-tenant", "DELETING", "2026-08-31T11:50:00.000Z"), // 10 minutes - healthy, inside the 1800s quiescence bound
      record("stale-tenant", "PURGING", "2026-08-31T08:00:00.000Z"), // 4 hours - genuinely orphaned
    );

    const result = await runTenantPurgeSweep(baseDeps(lifecycle, starter));

    expect(starter.started).toEqual(["stale-tenant"]);
    expect(result.executionsRepaired).toBe(1);
    expect(result.lifecycleRecordsScanned).toBe(2);
  });

  it("repairs every in-flight status (DELETING/QUIESCING/PURGING/VERIFIED) once stale", async () => {
    const starter = recordingStarter();
    const stale = "2026-08-30T00:00:00.000Z";
    const lifecycle = scanOf(record("t-del", "DELETING", stale), record("t-qui", "QUIESCING", stale), record("t-pur", "PURGING", stale), record("t-ver", "VERIFIED", stale));

    await runTenantPurgeSweep(baseDeps(lifecycle, starter));

    expect(starter.started.sort()).toEqual(["t-del", "t-pur", "t-qui", "t-ver"]);
  });

  // BLOCKED/HELD are parked awaiting a human operator - re-launching would fight the remediation.
  it("never repairs BLOCKED or HELD tenants, however stale", async () => {
    const starter = recordingStarter();
    const lifecycle = scanOf(record("t-blocked", "BLOCKED", "2026-01-01T00:00:00.000Z"), record("t-held", "HELD", "2026-01-01T00:00:00.000Z"));

    await runTenantPurgeSweep(baseDeps(lifecycle, starter));

    expect(starter.started).toEqual([]);
  });

  it("never starts an execution for an ACTIVE tenant (a live customer, not a closure)", async () => {
    const starter = recordingStarter();

    await runTenantPurgeSweep(baseDeps(scanOf(record("t-active", "ACTIVE", "2026-01-01T00:00:00.000Z")), starter));

    expect(starter.started).toEqual([]);
  });

  it("paginates the lifecycle scan to completion rather than stopping at the first page", async () => {
    const starter = recordingStarter();
    let call = 0;
    const lifecycle: TenantLifecycleScanSource = {
      scanLifecycleRecords: async () => {
        call += 1;
        if (call === 1) return { items: [record("t-page1", "PURGING", "2026-01-01T00:00:00.000Z")], lastEvaluatedKey: { PK: "x" } };
        return { items: [record("t-page2", "PURGING", "2026-01-01T00:00:00.000Z")] };
      },
    };

    const result = await runTenantPurgeSweep(baseDeps(lifecycle, starter));

    expect(starter.started).toEqual(["t-page1", "t-page2"]);
    expect(result.lifecycleRecordsScanned).toBe(2);
  });
});

describe("runTenantPurgeSweep - residual verification half (D-066 Rodada H, 90-day window)", () => {
  it("verifies DELETED tenants inside the 90-day window and reports a fully converged one as clean", async () => {
    const starter = recordingStarter();
    const lifecycle = scanOf(record("t-deleted", "DELETED", "2026-08-01T00:00:00.000Z")); // 30 days ago

    const result = await runTenantPurgeSweep(baseDeps(lifecycle, starter));

    expect(result.tenantsVerified).toBe(1);
    expect(result.tenantsWithResidue).toEqual([]);
    // A DELETED tenant is never re-launched - DELETED is terminal.
    expect(starter.started).toEqual([]);
  });

  it("skips DELETED tenants past the 90-day window", async () => {
    const starter = recordingStarter();
    const lifecycle = scanOf(record("t-old", "DELETED", "2026-01-01T00:00:00.000Z")); // ~8 months ago

    const result = await runTenantPurgeSweep(baseDeps(lifecycle, starter));

    expect(result.tenantsVerified).toBe(0);
  });

  it("reports residue found by the already-existing verifyTenant*Empty passes, without deleting anything", async () => {
    const starter = recordingStarter();
    const deps = baseDeps(scanOf(record("t-residue", "DELETED", "2026-08-30T00:00:00.000Z")), starter);
    deps.dynamo = { ...deps.dynamo, candidates: { scanTenantItems: async () => ({ items: [{ PK: "TENANT#t-residue#ITEM#1", SK: "ITEM", tenantId: "t-residue" }] }) } };

    const result = await runTenantPurgeSweep(deps);

    expect(result.tenantsWithResidue).toEqual([{ tenantId: "t-residue", remainingDynamoItems: 1, remainingSessions: 0, remainingS3Objects: 0 }]);
  });
});

describe("runTenantPurgeSweep - HELD_FOR_RECOVERY reconciliation (D-127 round-7 strict conjunction)", () => {
  const EXECUTION_ARN = "arn:aws:states:us-east-1:1:execution:x-tenant-purge:t-held-attempt-1";

  it("never blindly re-launches a HELD_FOR_RECOVERY tenant via the generic orphan-repair path, however stale", async () => {
    const starter = recordingStarter();
    const lifecycle = scanOf(record("t-held", "HELD_FOR_RECOVERY", "2026-01-01T00:00:00.000Z", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN }));
    const deps = baseDeps(lifecycle, starter);
    deps.executionDescriber = describerReturning({ status: "RUNNING", name: "t-held-attempt-1" });

    await runTenantPurgeSweep(deps);

    // RUNNING is the healthy steady state - never re-started (that would race a possible
    // in-flight cancellation, see reconcileHeldForRecovery's file header), never alarmed either.
    expect(starter.started).toEqual([]);
  });

  it("completes a stalled cancellation: ABORTED + matching closureAttemptId + still HELD_FOR_RECOVERY -> restores ACTIVE", async () => {
    const store = new InMemoryIdentityStore();
    const rec = record("t-held", "HELD_FOR_RECOVERY", "2026-01-01T00:00:00.000Z", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN, version: 3 });
    await store.putIfAbsent(rec);
    const starter = recordingStarter();
    const deps = baseDeps(scanOf(rec), starter, store);
    deps.executionDescriber = describerReturning({ status: "ABORTED", name: "t-held-attempt-1" });

    const result = await runTenantPurgeSweep(deps);

    expect(result.cancellationsRepaired).toEqual(["t-held"]);
    expect(result.tenantsAmbiguous).toEqual([]);
    const after = await store.get<TenantLifecycleRecord>(tenantLifecycleKey("t-held"));
    expect(after?.status).toBe("ACTIVE");
  });

  // G-V3 target: the strict conjunction. Mutation that must fail: treating FAILED/TIMED_OUT/
  // SUCCEEDED as safe-to-restore (an earlier design round's rejected claim) would make this
  // assertion fail by restoring ACTIVE instead of alarming.
  it.each(["FAILED", "TIMED_OUT", "SUCCEEDED", "NOT_FOUND"] as const)("alarms (never restores) when the execution is %s, even with a matching closureAttemptId", async (status) => {
    const store = new InMemoryIdentityStore();
    const rec = record("t-held", "HELD_FOR_RECOVERY", "2026-01-01T00:00:00.000Z", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN });
    await store.putIfAbsent(rec);
    const starter = recordingStarter();
    const deps = baseDeps(scanOf(rec), starter, store);
    deps.executionDescriber = describerReturning({ status, name: "t-held-attempt-1" });

    const result = await runTenantPurgeSweep(deps);

    expect(result.cancellationsRepaired).toEqual([]);
    expect(result.tenantsAmbiguous).toEqual([{ tenantId: "t-held", reason: expect.stringContaining(status) }]);
    const after = await store.get<TenantLifecycleRecord>(tenantLifecycleKey("t-held"));
    expect(after?.status).toBe("HELD_FOR_RECOVERY"); // untouched
  });

  it("alarms when ABORTED but the execution name belongs to a stale/superseded closureAttemptId", async () => {
    const store = new InMemoryIdentityStore();
    const rec = record("t-held", "HELD_FOR_RECOVERY", "2026-01-01T00:00:00.000Z", { closureAttemptId: "attempt-2", executionArn: EXECUTION_ARN });
    await store.putIfAbsent(rec);
    const starter = recordingStarter();
    const deps = baseDeps(scanOf(rec), starter, store);
    // executionArn on the record still points at attempt-1's execution (a stale/never-updated
    // reference) - the name embeds attempt-1, but the record has moved on to attempt-2.
    deps.executionDescriber = describerReturning({ status: "ABORTED", name: "t-held-attempt-1" });

    const result = await runTenantPurgeSweep(deps);

    expect(result.cancellationsRepaired).toEqual([]);
    expect(result.tenantsAmbiguous).toEqual([{ tenantId: "t-held", reason: expect.stringContaining("name mismatch") }]);
    const after = await store.get<TenantLifecycleRecord>(tenantLifecycleKey("t-held"));
    expect(after?.status).toBe("HELD_FOR_RECOVERY");
  });

  it("repairs (re-StartExecution) a HELD_FOR_RECOVERY record that never got an executionArn attached, without describing/alarming", async () => {
    const starter = recordingStarter();
    const lifecycle = scanOf(record("t-held", "HELD_FOR_RECOVERY", "2026-01-01T00:00:00.000Z", { closureAttemptId: "attempt-1" }));
    const deps = baseDeps(lifecycle, starter);
    let described = false;
    deps.executionDescriber = { describeExecution: async () => { described = true; return { status: "RUNNING", name: "x" }; } };

    const result = await runTenantPurgeSweep(deps);

    expect(starter.started).toEqual(["t-held-attempt-1"]);
    expect(result.executionsRepaired).toBe(1);
    expect(described).toBe(false);
  });

  it("a benign race (something else already resolved the record, e.g. the deadline fired first) is not treated as ambiguous", async () => {
    const store = new InMemoryIdentityStore();
    const rec = record("t-held", "HELD_FOR_RECOVERY", "2026-01-01T00:00:00.000Z", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN, version: 1 });
    await store.putIfAbsent(rec);
    // Something else (e.g. the ASL's own deadline transition) already moved the record past
    // HELD_FOR_RECOVERY before this sweep pass's write lands.
    await transitionTenantLifecycle({ store, tableName: TABLE, tenantId: "t-held", from: "HELD_FOR_RECOVERY", to: "DELETING", expectedVersion: 1 });
    const starter = recordingStarter();
    const deps = baseDeps(scanOf(rec), starter, store); // scan still returns the STALE page read
    deps.executionDescriber = describerReturning({ status: "ABORTED", name: "t-held-attempt-1" });

    const result = await runTenantPurgeSweep(deps);

    expect(result.cancellationsRepaired).toEqual([]);
    expect(result.tenantsAmbiguous).toEqual([]); // lost race, not ambiguous
    const after = await store.get<TenantLifecycleRecord>(tenantLifecycleKey("t-held"));
    expect(after?.status).toBe("DELETING"); // untouched by the losing sweep pass
  });
});
