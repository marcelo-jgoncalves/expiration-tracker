import { describe, expect, it } from "vitest";
import { InMemoryReminderStore } from "../reminder/in-memory-store.js";
import { runEnumerationTick, type EnumerationDeps } from "../../../src/workers/reminder-scan/enumerate-and-lease.js";
import { leaseKey, type ReminderScanLease } from "../../../src/workers/reminder-scan/lease.js";
import { defaultShardConfig, DEFAULT_SHARD_COUNT } from "../../../src/modules/reminder/domain/shard-config.js";

const TABLE = "MainTable";
const LEASE_DURATION_MS = 200_000;

function makeDeps(store: InMemoryReminderStore, nowIso: string, overrides: Partial<EnumerationDeps> = {}): EnumerationDeps {
  let eventCounter = 0;
  let ownerCounter = 0;
  return {
    store,
    shardConfig: defaultShardConfig(),
    tableName: TABLE,
    now: () => nowIso,
    newEventId: () => `evt-${++eventCounter}`,
    correlationId: () => "corr-1",
    rolloutEpoch: 1,
    lookbackMinutes: 0, // single-minute enumeration for a small, deterministic test surface
    leaseDurationMs: LEASE_DURATION_MS,
    newOwnerToken: () => `owner-${++ownerCounter}`,
    ...overrides,
  };
}

const TICK_MINUTE = new Date("2026-09-14T12:00:00.000Z");

describe("runEnumerationTick (D-300 §1: EventBridge enumeração + acquire/reclaim)", () => {
  it("acquires a fresh lease for every (shard, minute) combination that has none yet", async () => {
    const store = new InMemoryReminderStore();
    const result = await runEnumerationTick(makeDeps(store, "2026-09-14T12:00:05.000Z"), TICK_MINUTE);

    expect(result.acquired).toHaveLength(DEFAULT_SHARD_COUNT);
    expect(result.reclaimed).toHaveLength(0);
    expect(result.contended).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.lostRace).toBe(0);
    expect(result.shardPartitionsScanned).toBe(DEFAULT_SHARD_COUNT);

    for (const ref of result.acquired) {
      const lease = await store.get<ReminderScanLease>(leaseKey(ref));
      expect(lease?.status).toBe("IN_PROGRESS");
      expect(lease?.version).toBe(1);
    }
  });

  it("leaves an active (leaseUntil in the future) IN_PROGRESS lease alone - reports it as contended, never reclaims a live lease", async () => {
    const store = new InMemoryReminderStore();
    // First tick acquires all shards.
    await runEnumerationTick(makeDeps(store, "2026-09-14T12:00:05.000Z"), TICK_MINUTE);

    // Second tick, still well within the lease duration - must NOT reclaim.
    const second = await runEnumerationTick(makeDeps(store, "2026-09-14T12:00:10.000Z"), TICK_MINUTE);
    expect(second.acquired).toHaveLength(0);
    expect(second.reclaimed).toHaveLength(0);
    expect(second.contended).toBe(DEFAULT_SHARD_COUNT);
  });

  it("reclaims a lease once leaseUntil has passed (previous owner died mid-chain without completing)", async () => {
    const store = new InMemoryReminderStore();
    await runEnumerationTick(makeDeps(store, "2026-09-14T12:00:05.000Z"), TICK_MINUTE);

    // leaseUntil = 12:00:05 + 200s = 12:03:25 - a tick well after that must reclaim.
    const later = await runEnumerationTick(makeDeps(store, "2026-09-14T12:05:00.000Z"), TICK_MINUTE);
    expect(later.reclaimed).toHaveLength(DEFAULT_SHARD_COUNT);
    expect(later.acquired).toHaveLength(0);
    expect(later.contended).toBe(0);

    const anyRef = later.reclaimed[0]!;
    const lease = await store.get<ReminderScanLease>(leaseKey(anyRef));
    expect(lease?.version).toBe(1); // reclaim resets version/counters
    expect(lease?.pagesProcessed).toBe(0);
  });

  it("skips a COMPLETED lease entirely - neither acquires nor reclaims, no write at all", async () => {
    const store = new InMemoryReminderStore();
    const first = await runEnumerationTick(makeDeps(store, "2026-09-14T12:00:05.000Z"), TICK_MINUTE);
    const ref = first.acquired[0]!;
    // Manually complete this one lease (as scan-page.ts would via its checkpoint transition).
    const lease = await store.get<ReminderScanLease>(leaseKey(ref));
    await store.update({ ...lease!, status: "COMPLETED", GSI6PK: undefined, GSI6SK: undefined });

    const second = await runEnumerationTick(makeDeps(store, "2026-09-14T12:00:10.000Z"), TICK_MINUTE);
    expect(second.completed).toBe(1);
    // The other 3 shards' leases are still fresh (leaseUntil far in the future) - contended,
    // never re-acquired.
    expect(second.contended).toBe(DEFAULT_SHARD_COUNT - 1);
    expect(second.acquired).toHaveLength(0);
    expect(second.reclaimed).toHaveLength(0);

    const stillCompleted = await store.get<ReminderScanLease>(leaseKey(ref));
    expect(stillCompleted?.status).toBe("COMPLETED"); // untouched
  });

  it("THE RACE this design must tolerate: a concurrent acquire/reclaim for the SAME (shard, minute) is reported as lostRace, never thrown", async () => {
    const store = new InMemoryReminderStore();
    const racingStore = {
      get: store.get.bind(store),
      transactWrite: async () => {
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed" };
      },
    };
    const result = await runEnumerationTick(makeDeps(racingStore as never, "2026-09-14T12:00:05.000Z"), TICK_MINUTE);
    expect(result.lostRace).toBe(DEFAULT_SHARD_COUNT);
    expect(result.acquired).toHaveLength(0);
  });

  it("propagates a genuine (non-condition) store error rather than swallowing it as a race", async () => {
    const store = new InMemoryReminderStore();
    const flakyStore = {
      get: store.get.bind(store),
      transactWrite: async () => {
        throw new Error("simulated transient store fault");
      },
    };
    await expect(runEnumerationTick(makeDeps(flakyStore as never, "2026-09-14T12:00:05.000Z"), TICK_MINUTE)).rejects.toThrow(/transient store fault/);
  });

  it("enumerates across the full lookback window, not just the tick minute", async () => {
    const store = new InMemoryReminderStore();
    const result = await runEnumerationTick(makeDeps(store, "2026-09-14T12:15:05.000Z", { lookbackMinutes: 15 }), new Date("2026-09-14T12:15:00.000Z"));
    expect(result.minutesScanned).toHaveLength(16); // inclusive of both ends
    expect(result.shardPartitionsScanned).toBe(16 * DEFAULT_SHARD_COUNT);
    expect(result.acquired).toHaveLength(16 * DEFAULT_SHARD_COUNT);
  });
});
