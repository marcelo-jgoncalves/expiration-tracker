import { describe, expect, it } from "vitest";
import { InMemoryReminderStore } from "../reminder/in-memory-store.js";
import { runScanPage, type ClaimQueuePort, type ScanPageDeps, type ClaimCandidateCommand } from "../../../src/workers/reminder-scan/scan-page.js";
import { buildAcquireLeaseTransaction, leaseKey, type ReminderScanLease } from "../../../src/workers/reminder-scan/lease.js";
import { gsi3PartitionForShard } from "../../../src/modules/reminder/domain/reminder-occurrence.js";

const REF = { shardFnVersion: 1, shardId: 3, minuteISO: "2026-09-14T12:00:00.000Z" };
const GSI3PK = gsi3PartitionForShard(new Date(REF.minuteISO), REF.shardId);
const TABLE = "MainTable";
const LEASE_DURATION_MS = 200_000;

class FakeClaimQueue implements ClaimQueuePort {
  sent: ClaimCandidateCommand[][] = [];
  /** Per-call scripted outcomes - shift()'d off on each sendMessageBatch call; last one repeats. */
  scripted: { failedEntryIds: { id: string; senderFault: boolean }[] }[] = [];

  async sendMessageBatch(entries: ClaimCandidateCommand[]) {
    this.sent.push(entries);
    return this.scripted.length > 0 ? (this.scripted.shift() as never) : { failedEntryIds: [] };
  }
}

function makeDeps(store: InMemoryReminderStore, claimQueue: ClaimQueuePort, nowIso: string, overrides: Partial<ScanPageDeps> = {}): ScanPageDeps {
  let counter = 0;
  return {
    store,
    claimQueue,
    tableName: TABLE,
    now: () => nowIso,
    newEventId: () => `evt-${++counter}`,
    correlationId: () => "corr-1",
    rolloutEpoch: 1,
    pageSize: 200,
    leaseDurationMs: LEASE_DURATION_MS,
    sleep: async () => {},
    ...overrides,
  };
}

async function seedReminderRow(store: InMemoryReminderStore, tenantId: string, occurrenceId: string): Promise<void> {
  await store.update({
    PK: `TENANT#${tenantId}#ITEM#item-1`,
    SK: `OCC#${occurrenceId}`,
    GSI3PK,
    GSI3SK: `TENANT#${tenantId}#OCCURRENCE#${occurrenceId}`,
  });
}

async function seedChasingRow(store: InMemoryReminderStore, tenantId: string, occurrenceId: string): Promise<void> {
  await store.update({
    PK: `TENANT#${tenantId}#CHASING#${occurrenceId}`,
    SK: `META`,
    GSI3PK,
    GSI3SK: `TENANT#${tenantId}#CHASING#${occurrenceId}`,
  });
}

async function acquireLease(store: InMemoryReminderStore, ownerToken: string, nowIso: string): Promise<void> {
  const { tx } = buildAcquireLeaseTransaction(makeDeps(store, new FakeClaimQueue(), nowIso), REF, ownerToken, LEASE_DURATION_MS);
  await store.transactWrite(tx);
}

describe("runScanPage (D-300 §1/§2/§5)", () => {
  it("STALE_NO_OP: no lease exists at all - never writes, never sends", async () => {
    const store = new InMemoryReminderStore();
    const claimQueue = new FakeClaimQueue();
    const outcome = await runScanPage(makeDeps(store, claimQueue, "2026-09-14T12:00:10.000Z"), {
      ref: REF,
      ownerToken: "owner-A",
      startedFromLastEvaluatedKey: undefined,
      messageRolloutEpoch: 1,
    });
    expect(outcome).toEqual({ kind: "STALE_NO_OP" });
    expect(claimQueue.sent).toHaveLength(0);
  });

  it("STALE_NO_OP: lease exists but owned by a different token (reclaimed under someone else)", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-A", "2026-09-14T12:00:05.000Z");
    const claimQueue = new FakeClaimQueue();
    const outcome = await runScanPage(makeDeps(store, claimQueue, "2026-09-14T12:00:10.000Z"), {
      ref: REF,
      ownerToken: "owner-STALE",
      startedFromLastEvaluatedKey: undefined,
      messageRolloutEpoch: 1,
    });
    expect(outcome).toEqual({ kind: "STALE_NO_OP" });
  });

  it("STALE_EPOCH_DROPPED: a residual message from before a rollback carries an older epoch than current", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-A", "2026-09-14T12:00:05.000Z");
    const claimQueue = new FakeClaimQueue();
    const outcome = await runScanPage(makeDeps(store, claimQueue, "2026-09-14T12:00:10.000Z", { rolloutEpoch: 2 }), {
      ref: REF,
      ownerToken: "owner-A",
      startedFromLastEvaluatedKey: undefined,
      messageRolloutEpoch: 1,
    });
    expect(outcome).toEqual({ kind: "STALE_EPOCH_DROPPED" });
    // Lease untouched - not even read/checked past the epoch gate.
    const lease = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(lease?.version).toBe(1);
  });

  it("PROCESSED: publishes one candidate per GSI3 row (reminder + chasing, mixed), completes the lease when no more pages remain", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-A", "2026-09-14T12:00:05.000Z");
    await seedReminderRow(store, "t_01", "occ_01");
    await seedReminderRow(store, "t_01", "occ_02");
    await seedChasingRow(store, "t_01", "occ_03");

    const claimQueue = new FakeClaimQueue();
    const outcome = await runScanPage(makeDeps(store, claimQueue, "2026-09-14T12:00:10.000Z"), {
      ref: REF,
      ownerToken: "owner-A",
      startedFromLastEvaluatedKey: undefined,
      messageRolloutEpoch: 1,
    });

    expect(outcome).toEqual({ kind: "PROCESSED", pagesProcessed: 1, candidatesPublished: 3, completed: true });
    expect(claimQueue.sent).toHaveLength(1); // one chunk, 3 <= 10
    expect(claimQueue.sent[0]).toHaveLength(3);
    const kinds = claimQueue.sent[0]!.map((c) => c.data.entityKind).sort();
    expect(kinds).toEqual(["CHASING", "REMINDER", "REMINDER"]);

    const lease = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(lease?.status).toBe("COMPLETED");
    expect(lease?.candidatesPublished).toBe(3);
    expect(lease?.pagesProcessed).toBe(1);
    expect(lease?.GSI6PK).toBeUndefined();
  });

  it("chunks candidates into groups of <=10 SendMessageBatch entries each", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-A", "2026-09-14T12:00:05.000Z");
    for (let i = 0; i < 23; i++) await seedReminderRow(store, "t_01", `occ_${i}`);

    const claimQueue = new FakeClaimQueue();
    const outcome = await runScanPage(makeDeps(store, claimQueue, "2026-09-14T12:00:10.000Z"), {
      ref: REF,
      ownerToken: "owner-A",
      startedFromLastEvaluatedKey: undefined,
      messageRolloutEpoch: 1,
    });

    expect(outcome.kind).toBe("PROCESSED");
    expect(claimQueue.sent.map((c) => c.length)).toEqual([10, 10, 3]);
  });

  it("THE OLD BUG this design fixes (PERF-12): a SendMessageBatch sender-fault throws WITHOUT checkpointing - the page is never silently dropped, it stays reprocessable on reclaim", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-A", "2026-09-14T12:00:05.000Z");
    await seedReminderRow(store, "t_01", "occ_01");

    const claimQueue = new FakeClaimQueue();
    claimQueue.scripted = [{ failedEntryIds: [{ id: "x", senderFault: true }] }];

    await expect(
      runScanPage(makeDeps(store, claimQueue, "2026-09-14T12:00:10.000Z"), {
        ref: REF,
        ownerToken: "owner-A",
        startedFromLastEvaluatedKey: undefined,
        messageRolloutEpoch: 1,
      }),
    ).rejects.toThrow(/sender fault/);

    // Old bug this proves fixed: the checkpoint (and thus pagesProcessed/candidatesPublished/
    // lastEvaluatedKey advancement) never happened - the lease is exactly as it was before this
    // failed attempt, so a subsequent reclaim will reprocess this SAME page from scratch, never
    // silently skipping the occurrences that failed to publish.
    const lease = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(lease?.status).toBe("IN_PROGRESS");
    expect(lease?.pagesProcessed).toBe(0);
    expect(lease?.candidatesPublished).toBe(0);
    expect(lease?.version).toBe(1);
  });

  it("retries a transient (non-sender-fault) SendMessageBatch failure, resending the WHOLE chunk, and succeeds within budget", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-A", "2026-09-14T12:00:05.000Z");
    await seedReminderRow(store, "t_01", "occ_01");

    const claimQueue = new FakeClaimQueue();
    claimQueue.scripted = [{ failedEntryIds: [{ id: "x", senderFault: false }] }, { failedEntryIds: [] }];
    const sleeps: number[] = [];

    const outcome = await runScanPage(makeDeps(store, claimQueue, "2026-09-14T12:00:10.000Z", { sleep: async (ms) => void sleeps.push(ms) }), {
      ref: REF,
      ownerToken: "owner-A",
      startedFromLastEvaluatedKey: undefined,
      messageRolloutEpoch: 1,
    });

    expect(outcome.kind).toBe("PROCESSED");
    expect(claimQueue.sent).toHaveLength(2); // resent the whole chunk, not a partial retry
    expect(sleeps).toHaveLength(1);
  });

  it("throws (DependencyUnavailableError) after exhausting retry attempts on a persistently transient failure - never checkpoints", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-A", "2026-09-14T12:00:05.000Z");
    await seedReminderRow(store, "t_01", "occ_01");

    const claimQueue = new FakeClaimQueue();
    claimQueue.scripted = [
      { failedEntryIds: [{ id: "x", senderFault: false }] },
      { failedEntryIds: [{ id: "x", senderFault: false }] },
      { failedEntryIds: [{ id: "x", senderFault: false }] },
    ];

    await expect(
      runScanPage(makeDeps(store, claimQueue, "2026-09-14T12:00:10.000Z", { sleep: async () => {} }), {
        ref: REF,
        ownerToken: "owner-A",
        startedFromLastEvaluatedKey: undefined,
        messageRolloutEpoch: 1,
      }),
    ).rejects.toThrow(/transient/);

    const lease = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(lease?.status).toBe("IN_PROGRESS");
    expect(lease?.pagesProcessed).toBe(0);
  });

  // G-V3: removing the pre-send cursor check republishes the first page and fails the sent-count assertion.
  it("rejects an obsolete continuation before republishing candidates while the lease is still IN_PROGRESS", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-A", "2026-09-14T12:00:05.000Z");
    await seedReminderRow(store, "t_01", "occ_01");
    await seedReminderRow(store, "t_01", "occ_02");

    const claimQueue = new FakeClaimQueue();
    // pageSize:1 with 2 rows seeded - page 1 returns exactly 1 item plus a lastEvaluatedKey, so
    // the lease stays IN_PROGRESS (more pages remain) rather than completing outright.
    const deps = makeDeps(store, claimQueue, "2026-09-14T12:00:10.000Z", { pageSize: 1 });
    const first = await runScanPage(deps, { ref: REF, ownerToken: "owner-A", startedFromLastEvaluatedKey: undefined, messageRolloutEpoch: 1 });
    expect(first).toMatchObject({ kind: "PROCESSED", completed: false });

    const leaseAfterFirst = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(leaseAfterFirst?.status).toBe("IN_PROGRESS");

    // A duplicate/redelivered SQS message for the SAME original (page-1) continuation arrives
    // after the lease already advanced past it - startedFromLastEvaluatedKey still undefined,
    // but the lease's real lastEvaluatedKey is no longer absent, so the position clause fails.
    const duplicate = await runScanPage(deps, { ref: REF, ownerToken: "owner-A", startedFromLastEvaluatedKey: undefined, messageRolloutEpoch: 1 });
    expect(duplicate.kind).toBe("STALE_NO_OP");
    expect(claimQueue.sent).toHaveLength(1);
  });

  // G-V3: removing the pre-send expiry check publishes candidates under an expired owner.
  it("does not publish candidates when the scan lease has expired", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-A", "2026-09-14T12:00:05.000Z");
    await seedReminderRow(store, "t_01", "occ_01");
    const queue = new FakeClaimQueue();
    const result = await runScanPage(makeDeps(store, queue, "2026-09-14T12:05:00.000Z"), {
      ref: REF, ownerToken: "owner-A", startedFromLastEvaluatedKey: undefined, messageRolloutEpoch: 1,
    });
    expect(result.kind).toBe("STALE_NO_OP");
    expect(queue.sent).toHaveLength(0);
  });

  // G-V3: swallowing every TransactionCanceledException acknowledges a transient checkpoint failure.
  it("propagates a transaction conflict after candidate publication so SQS retries the page", async () => {
    const store = new InMemoryReminderStore();
    await acquireLease(store, "owner-A", "2026-09-14T12:00:05.000Z");
    await seedReminderRow(store, "t_01", "occ_01");
    const failure = { name: "TransactionCanceledException", CancellationReasons: [{ Code: "TransactionConflict" }] };
    const queue = new FakeClaimQueue();
    const deps = makeDeps(store, queue, "2026-09-14T12:00:10.000Z", { store: {
      get: store.get.bind(store), queryGsi3Page: store.queryGsi3Page.bind(store),
      transactWrite: async () => { throw failure; },
    } });
    await expect(runScanPage(deps, { ref: REF, ownerToken: "owner-A", startedFromLastEvaluatedKey: undefined, messageRolloutEpoch: 1 })).rejects.toBe(failure);
    expect(queue.sent).toHaveLength(1);
    expect((await store.get<ReminderScanLease>(leaseKey(REF)))?.pagesProcessed).toBe(0);
  });
});
