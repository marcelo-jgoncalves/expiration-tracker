/**
 * D-300 end-to-end integration test (`reminder-producer-implementation-plan-scoping/
 * DECISION.md` §6): the actual PERF-12 proof - a burst of occurrences concentrated in ONE
 * (shard, minute), driven through the REAL chain (enumerate-and-lease.ts -> scan-page.ts,
 * multiple pages, real chunking -> claimReminderOccurrence) against an in-memory store, asserting
 * ZERO occurrences are lost (every SCHEDULED occurrence ends up CLAIMED with a dispatch command),
 * closing the loop this whole plan exists to close. Uses InMemoryReminderStore/a fake claim
 * queue rather than DynamoDB Local/real SQS (Docker unavailable in this environment - this test
 * proves the ALGORITHM is loss-free; the two AWS load-test branches
 * (perf/load-testing-multi-tenant-v1, perf/load-testing-10k-v1) are the separate, live-AWS proof
 * this DECISION also requires before considering D-300 fully closed).
 */
import { describe, expect, it } from "vitest";
import { InMemoryReminderStore } from "../unit/reminder/in-memory-store.js";
import { runEnumerationTick } from "../../src/workers/reminder-scan/enumerate-and-lease.js";
import { runScanPage, type ClaimQueuePort, type ClaimCandidateCommand } from "../../src/workers/reminder-scan/scan-page.js";
import { claimReminderOccurrence } from "../../src/modules/reminder/application/reminder-claim.js";
import { leaseKey, type ReminderScanLease } from "../../src/workers/reminder-scan/lease.js";
import { defaultShardConfig } from "../../src/modules/reminder/domain/shard-config.js";
import { gsi3PartitionForShard } from "../../src/modules/reminder/domain/reminder-occurrence.js";

const TABLE = "MainTable";
const TICK_MINUTE = new Date("2026-09-14T12:00:00.000Z");
const REF = { shardFnVersion: 1, shardId: 0, minuteISO: TICK_MINUTE.toISOString() };

/** Routes candidates straight into an in-process queue (no real SQS) - the test drains it by
 * calling claimReminderOccurrence directly, mirroring what reminder-claim-consumer-handler.ts
 * does per message. */
class InMemoryClaimQueue implements ClaimQueuePort {
  readonly delivered: ClaimCandidateCommand[] = [];
  async sendMessageBatch(entries: ClaimCandidateCommand[]) {
    this.delivered.push(...entries);
    return { failedEntryIds: [] };
  }
}

function makeDeps(store: InMemoryReminderStore, claimQueue: InMemoryClaimQueue, nowIso: string) {
  let counter = 0;
  const now = () => nowIso;
  const newEventId = () => `evt-${++counter}`;
  const correlationId = () => "corr-e2e";
  const rolloutEpoch = 1;
  const leaseDurationMs = 200_000;
  return {
    enumeration: { store, shardConfig: defaultShardConfig(), tableName: TABLE, now, newEventId, correlationId, rolloutEpoch, leaseDurationMs, newOwnerToken: () => `owner-${counter}` },
    scanPage: { store, claimQueue, tableName: TABLE, now, newEventId, correlationId, rolloutEpoch, pageSize: 25, leaseDurationMs, sleep: async () => {} },
    claim: { store, tableName: TABLE, now, claimTtlMs: 120_000, newEventId, correlationId },
  };
}

async function seedBurst(store: InMemoryReminderStore, count: number): Promise<string[]> {
  const gsi3pk = gsi3PartitionForShard(TICK_MINUTE, REF.shardId);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const occurrenceId = `occ_${String(i).padStart(4, "0")}`;
    const tenantId = `t_${i % 7}`; // spread across a few tenants, same (shard, minute)
    ids.push(occurrenceId);
    await store.update({
      PK: `TENANT#${tenantId}#ITEM#item_${i}`,
      SK: `OCC#${occurrenceId}`,
      entityType: "ReminderOccurrence",
      occurrenceId,
      tenantId,
      itemId: `item_${i}`,
      itemVersion: 1,
      policyVersion: 1,
      status: "SCHEDULED",
      scheduledAt: TICK_MINUTE.toISOString(),
      version: 1,
      GSI3PK: gsi3pk,
      GSI3SK: `TENANT#${tenantId}#OCCURRENCE#${occurrenceId}`,
    });
  }
  return ids;
}

describe("D-300 end-to-end: burst in one (shard, minute) - zero occurrences lost across the full scan/claim chain", () => {
  it("drains a 500-occurrence single-shard burst across multiple pages with zero loss (the PERF-12 proof, algorithm-level)", async () => {
    const BURST_SIZE = 500;
    const store = new InMemoryReminderStore();
    const claimQueue = new InMemoryClaimQueue();
    const deps = makeDeps(store, claimQueue, "2026-09-14T12:00:05.000Z");

    await seedBurst(store, BURST_SIZE);

    // 1) Enumeration acquires the lease for this (shard, minute) - lookback 0 keeps this test's
    // surface to exactly the one (shard, minute) under test.
    const enumResult = await runEnumerationTick({ ...deps.enumeration, lookbackMinutes: 0, shardConfig: { current: { shardFnVersion: 1, shardCount: 1 }, legacy: [] } }, TICK_MINUTE);
    expect(enumResult.acquired.length).toBeGreaterThan(0);

    // 2) Drain every page scan-page.ts produces, following the checkpoint's own
    // lastEvaluatedKey chain - exactly what the SQS scan-continuation queue would deliver, one
    // message at a time, in this test driven synchronously in a loop.
    let startedFrom: string | undefined;
    let completed = false;
    let pages = 0;
    const MAX_PAGES = 50; // safety bound - BURST_SIZE/pageSize(25) = 20 pages expected
    while (!completed) {
      pages += 1;
      expect(pages).toBeLessThanOrEqual(MAX_PAGES);
      const lease = await store.get<ReminderScanLease>(leaseKey(REF));
      const outcome = await runScanPage(deps.scanPage, { ref: REF, ownerToken: lease!.ownerToken, startedFromLastEvaluatedKey: startedFrom, messageRolloutEpoch: 1 });
      expect(outcome.kind).toBe("PROCESSED");
      if (outcome.kind !== "PROCESSED") throw new Error("unreachable");
      completed = outcome.completed;
      const updatedLease = await store.get<ReminderScanLease>(leaseKey(REF));
      startedFrom = updatedLease?.lastEvaluatedKey;
    }

    // Every candidate reached the claim queue - none dropped between scan and publish.
    expect(claimQueue.delivered).toHaveLength(BURST_SIZE);
    expect(new Set(claimQueue.delivered.map((c) => c.data.PK)).size).toBe(BURST_SIZE); // no duplicates

    // 3) Drain the claim queue exactly as reminder-claim-consumer-handler.ts would - one
    // claimReminderOccurrence call per candidate.
    const claimed: string[] = [];
    for (const candidate of claimQueue.delivered) {
      const outcome = await claimReminderOccurrence(deps.claim, { PK: candidate.data.PK, SK: candidate.data.SK }, candidate.tenantId);
      if (outcome.kind === "CLAIMED") claimed.push(candidate.data.PK);
    }

    // THE ACTUAL PERF-12 PROOF: every single occurrence in the burst ends up CLAIMED (with a
    // real dispatch command) - zero lost, unlike the old bug (44-47% loss under this exact
    // shape of burst).
    expect(claimed).toHaveLength(BURST_SIZE);
    const allItems = store.allItems();
    const stillScheduled = allItems.filter((i) => i["entityType"] === "ReminderOccurrence" && i["status"] === "SCHEDULED");
    expect(stillScheduled).toHaveLength(0);
    const claimedItems = allItems.filter((i) => i["entityType"] === "ReminderOccurrence" && i["status"] === "CLAIMED");
    expect(claimedItems).toHaveLength(BURST_SIZE);

    // Lease reached COMPLETED, GSI6 pointer cleaned up.
    const finalLease = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(finalLease?.status).toBe("COMPLETED");
    expect(finalLease?.GSI6PK).toBeUndefined();
    expect(finalLease?.candidatesPublished).toBe(BURST_SIZE);
  });

  // G-V3: removing the pre-send cursor fence duplicates the 25 delivered candidates.
  it("a replayed predecessor cannot publish candidates or advance the chain after its checkpoint", async () => {
    const store = new InMemoryReminderStore();
    const claimQueue = new InMemoryClaimQueue();
    const deps = makeDeps(store, claimQueue, "2026-09-14T12:00:05.000Z");
    await seedBurst(store, 60);

    await runEnumerationTick({ ...deps.enumeration, lookbackMinutes: 0, shardConfig: { current: { shardFnVersion: 1, shardCount: 1 }, legacy: [] } }, TICK_MINUTE);
    const lease = await store.get<ReminderScanLease>(leaseKey(REF));

    // Page 1 (real): processes correctly, advances the lease.
    const page1 = await runScanPage(deps.scanPage, { ref: REF, ownerToken: lease!.ownerToken, startedFromLastEvaluatedKey: undefined, messageRolloutEpoch: 1 });
    expect(page1.kind).toBe("PROCESSED");

    // A duplicate/redelivered copy of the SAME page-1 message arrives again (SQS at-least-once
    // delivery) - must be rejected before query/send, never double-processed.
    const duplicatePage1 = await runScanPage(deps.scanPage, { ref: REF, ownerToken: lease!.ownerToken, startedFromLastEvaluatedKey: undefined, messageRolloutEpoch: 1 });
    expect(duplicatePage1.kind).toBe("STALE_NO_OP");
    expect(claimQueue.delivered).toHaveLength(25);
    expect((await store.get<ReminderScanLease>(leaseKey(REF)))?.pagesProcessed).toBe(1);
  });
});
