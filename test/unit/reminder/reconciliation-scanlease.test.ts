import { describe, expect, it } from "vitest";
import { InMemoryReminderStore } from "./in-memory-store.js";
import { reconcileScanLeases, type ScanLeaseReconciliationDeps } from "../../../src/workers/reminder-reconciliation/reconciliation.js";
import { buildAcquireLeaseTransaction, leaseKey, type ReminderScanLease } from "../../../src/workers/reminder-scan/lease.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import type { StuckScanLeaseCandidate } from "../../../src/modules/reminder/ports/reconciliation-candidate-source.js";

const TABLE = "MainTable";
const REF = { shardFnVersion: 1, shardId: 3, minuteISO: "2026-09-14T12:00:00.000Z" };
const LEASE_DURATION_MS = 200_000;

function deps(store: InMemoryReminderStore, nowIso: string): ScanLeaseReconciliationDeps {
  let counter = 0;
  return {
    store,
    tableName: TABLE,
    now: () => nowIso,
    shardConfig: defaultShardConfig(),
    newEventId: () => `evt-${++counter}`,
    correlationId: () => "corr-1",
    rolloutEpoch: 1,
    leaseDurationMs: LEASE_DURATION_MS,
  };
}

async function acquireLease(store: InMemoryReminderStore, ownerToken: string, nowIso: string): Promise<void> {
  let counter = 0;
  const { tx } = buildAcquireLeaseTransaction(
    { tableName: TABLE, now: () => nowIso, newEventId: () => `acq-${++counter}`, correlationId: () => "corr-acquire", rolloutEpoch: 1 },
    REF,
    ownerToken,
    LEASE_DURATION_MS,
  );
  await store.transactWrite(tx);
}

describe("reconcileScanLeases (D-300 §7) - independent stuck-lease detection outside enumerate-and-lease.ts's own lookback window", () => {
  it("reclaims a lease still IN_PROGRESS past its own leaseUntil - the exact stuck-chain case this pass exists for", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-dead", "2026-09-14T12:00:05.000Z"); // leaseUntil = 12:03:25

    const stuckLease = await store.get<ReminderScanLease>(leaseKey(REF));
    const candidate: StuckScanLeaseCandidate = {
      PK: stuckLease!.PK,
      SK: stuckLease!.SK,
      ownerToken: stuckLease!.ownerToken,
      leaseUntil: stuckLease!.leaseUntil,
      version: stuckLease!.version,
      status: stuckLease!.status,
    };

    // Well after leaseUntil - the producer's own enumeration tick would have moved its
    // lookback window past this (shard, minute) by now in a realistic deployment.
    const reclaimed = await reconcileScanLeases(deps(store, "2026-09-14T12:30:00.000Z"), [candidate]);

    expect(reclaimed).toBe(1);
    const after = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(after?.ownerToken).not.toBe("owner-dead");
    expect(after?.version).toBe(1); // reclaim resets version/counters
    expect(after?.status).toBe("IN_PROGRESS");
  });

  it("does NOT reclaim a candidate whose leaseUntil has NOT actually passed by the time this pass runs - the server-side condition (not this pass's own judgment) is what protects a live lease", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-alive", "2026-09-14T12:00:05.000Z"); // leaseUntil = 12:03:25
    const lease = await store.get<ReminderScanLease>(leaseKey(REF));
    const staleCandidateSnapshot: StuckScanLeaseCandidate = {
      PK: lease!.PK,
      SK: lease!.SK,
      ownerToken: lease!.ownerToken,
      leaseUntil: lease!.leaseUntil,
      version: lease!.version,
      status: lease!.status,
    };

    // The candidate was read at some point, but "now" for the actual reclaim attempt is still
    // BEFORE leaseUntil - buildReclaimLeaseTransaction's own condition (leaseUntil < :leaseNow)
    // rejects it, proving the safety net is server-side, not a client-side timestamp check this
    // pass could get wrong.
    const reclaimed = await reconcileScanLeases(deps(store, "2026-09-14T12:01:00.000Z"), [staleCandidateSnapshot]);

    expect(reclaimed).toBe(0);
    const unchanged = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(unchanged?.ownerToken).toBe("owner-alive");
  });

  it("skips a COMPLETED candidate entirely - never attempts a reclaim transaction for it", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-a", "2026-09-14T12:00:05.000Z");
    const lease = await store.get<ReminderScanLease>(leaseKey(REF));
    const completedCandidate: StuckScanLeaseCandidate = {
      PK: lease!.PK,
      SK: lease!.SK,
      ownerToken: lease!.ownerToken,
      leaseUntil: lease!.leaseUntil,
      version: lease!.version,
      status: "COMPLETED", // simulates a candidate snapshot taken just before completion landed
    };

    const reclaimed = await reconcileScanLeases(deps(store, "2026-09-14T12:30:00.000Z"), [completedCandidate]);
    expect(reclaimed).toBe(0);
  });

  it("a lost race (another invocation reclaimed it first) is a benign no-op, never a throw", async () => {
    const store = new InMemoryReminderStore();
    const racingStore = {
      get: store.get.bind(store),
      transactWrite: async () => {
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed" };
      },
    };
    const candidate: StuckScanLeaseCandidate = {
      PK: leaseKey(REF).PK,
      SK: "LEASE",
      ownerToken: "owner-dead",
      leaseUntil: "2026-09-14T12:03:25.000Z",
      version: 1,
      status: "IN_PROGRESS",
    };

    const reclaimed = await reconcileScanLeases(deps(racingStore as never, "2026-09-14T12:30:00.000Z"), [candidate]);
    expect(reclaimed).toBe(0);
  });

  it("propagates a genuine (non-condition) store error rather than swallowing it", async () => {
    const flakyStore = {
      get: async () => undefined,
      transactWrite: async () => {
        throw new Error("simulated transient store fault");
      },
    };
    const candidate: StuckScanLeaseCandidate = {
      PK: leaseKey(REF).PK,
      SK: "LEASE",
      ownerToken: "owner-dead",
      leaseUntil: "2026-09-14T12:03:25.000Z",
      version: 1,
      status: "IN_PROGRESS",
    };

    await expect(reconcileScanLeases(deps(flakyStore as never, "2026-09-14T12:30:00.000Z"), [candidate])).rejects.toThrow(/transient store fault/);
  });
});
