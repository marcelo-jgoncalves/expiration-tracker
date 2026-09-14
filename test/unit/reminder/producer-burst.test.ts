/**
 * Regression coverage for PERF-12 1k load test's real finding
 * (docs/engineering/performance/results/PERF-12-async-pipeline-1k.md): a burst of occurrences
 * due the same minute used to be processed strictly sequentially by `runProducerTick`, and
 * once a burst minute aged out of the (then 5-minute) lookback window, any occurrence still
 * SCHEDULED was permanently stuck - neither reconciliation pass covers "SCHEDULED, past
 * lookback, never claimed" (see reconciliation.ts's own file header).
 *
 * These tests do not reproduce a real 10s Lambda timeout (not meaningfully testable without a
 * real wall-clock wait per the task's own guidance) - instead they assert the two structural
 * properties whose absence caused the real bug:
 *  1. A burst of many occurrences due the same minute, spread across multiple GSI3 shard
 *     partitions, all claim correctly under the new bounded-concurrency processing - no
 *     occurrence is double-claimed, dropped, or corrupted by running concurrently instead of
 *     sequentially (this is what PRODUCER_CLAIM_CONCURRENCY changed).
 *  2. The widened default lookback (5 -> 15 minutes) actually extends how late a still-
 *     SCHEDULED occurrence can be picked up by a normal tick - directly exercising the
 *     mechanism that would have saved PERF-12's ~440 stuck occurrences, and pinning the new
 *     default so a future accidental revert back to 5 is caught here, not in production.
 */
import { describe, expect, it } from "vitest";
import { InMemoryReminderStore, makeReminderIdGenerator } from "./in-memory-store.js";
import { ReminderPolicyService } from "../../../src/modules/reminder/application/reminder-policy-service.js";
import { ReminderMaterializer } from "../../../src/modules/reminder/application/reminder-materializer.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import { runProducerTick } from "../../../src/workers/reminder-producer/producer.js";
import { itemKey } from "../../../src/modules/expiration/domain/expiration-item.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";

const TENANT = "t1";
const TABLE = "MainTable";
const BURST_SIZE = 40; // enough to spread across every shard (DEFAULT_SHARD_COUNT) and exercise PRODUCER_CLAIM_CONCURRENCY (8) more than once.

function ctx(userId: string): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId, cognitoSubject: `sub-${userId}`, sessionId: "s1" },
    tenant: { tenantId: TENANT, roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
  };
}

async function seedBurst(store: InMemoryReminderStore, now: () => string, count: number): Promise<string[]> {
  const policies = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now });
  const materializer = new ReminderMaterializer(store, TABLE, now);
  const occurrenceIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const itemId = `item-${i}`;
    await store.putIfAbsent({
      ...itemKey(authorizedTenantIdFromPersistedEntity({ tenantId: TENANT }), itemId),
      entityType: "ExpirationItem",
      itemId,
      tenantId: TENANT,
      status: "ACTIVE",
      dueDate: "2026-09-10T00:00:00.000Z",
      version: 1,
    });

    const policy = await policies.createPolicy(ctx(`u-${i}`), {
      scope: "ITEM",
      itemId,
      rule: {
        name: "burst same-minute trigger",
        triggers: [{ triggerId: "trig1", offsetIso: "P0D", localTime: "08:00" }],
        timeZone: "UTC",
        channels: ["EMAIL"],
      },
    });

    const materialized = await materializer.materialize({
      tenantId: TENANT,
      itemId,
      itemVersion: 1,
      itemDueDate: "2026-09-10T00:00:00.000Z",
      policy,
      shardConfig: defaultShardConfig(),
    });
    occurrenceIds.push(materialized.created[0]!.occurrenceId);
  }

  return occurrenceIds;
}

describe("producer.ts - burst load (PERF-12 regression)", () => {
  it(`claims all ${BURST_SIZE} occurrences due the same minute exactly once each under bounded-concurrency processing - no double-claim, no drop, no failure`, async () => {
    const store = new InMemoryReminderStore();
    const clock = { current: "2026-08-01T00:00:00.000Z" };
    const now = () => clock.current;

    const occurrenceIds = await seedBurst(store, now, BURST_SIZE);

    clock.current = "2026-09-10T08:00:05.000Z"; // just after the shared trigger minute
    const tick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now, newEventId: () => `evt-${Math.random()}`, correlationId: () => `cor-${Math.random()}` },
      new Date("2026-09-10T08:00:00.000Z"),
    );

    expect(tick.failed).toEqual([]);
    expect(tick.unknownEntityType).toBe(0);
    expect(tick.claimed).toHaveLength(BURST_SIZE);

    // Every occurrence claimed exactly once (no duplicate claims from concurrent workers
    // racing the `seen` dedup guard or the DynamoDB conditional claim itself).
    const claimedOccurrenceIds = tick.claimed.map((c) => c.data.occurrenceId);
    expect(new Set(claimedOccurrenceIds).size).toBe(BURST_SIZE);
    expect(new Set(claimedOccurrenceIds)).toEqual(new Set(occurrenceIds));

    // Every seeded occurrence actually transitioned to CLAIMED in the store - none silently
    // skipped by a concurrent worker.
    for (const item of store.allItems()) {
      if (String(item["entityType"]) === "ReminderOccurrence") {
        expect(item["status"]).toBe("CLAIMED");
      }
    }
  });

  it("default lookback (15 min) still claims an occurrence whose minute is 12 minutes old - the exact PERF-12 scenario (occurrences that outlive the OLD 5-minute lookback while the producer recovers from a timeout-driven burst)", async () => {
    const store = new InMemoryReminderStore();
    const clock = { current: "2026-08-01T00:00:00.000Z" };
    const now = () => clock.current;

    await seedBurst(store, now, 1);

    // The scheduled minute is 2026-09-10T08:00, the tick runs 12 minutes later - past the OLD
    // 5-minute default, comfortably inside the NEW 15-minute default.
    clock.current = "2026-09-10T08:12:30.000Z";
    const tick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now, newEventId: () => `evt-${Math.random()}`, correlationId: () => "cor" },
      new Date("2026-09-10T08:12:00.000Z"),
      // no explicit lookbackMinutes - pins the actual production default.
    );

    expect(tick.claimed).toHaveLength(1);
  });

  it("an occurrence past the 15-minute default lookback is NOT claimed by a normal tick - documents the residual gap the timeout raise + parallelism fix are meant to prevent from ever being hit in practice", async () => {
    const store = new InMemoryReminderStore();
    const clock = { current: "2026-08-01T00:00:00.000Z" };
    const now = () => clock.current;

    await seedBurst(store, now, 1);

    clock.current = "2026-09-10T08:20:00.000Z"; // 20 minutes past the scheduled minute
    const tick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now, newEventId: () => `evt-${Math.random()}`, correlationId: () => "cor" },
      new Date("2026-09-10T08:20:00.000Z"),
    );

    expect(tick.claimed).toHaveLength(0);
    expect(tick.scanned).toBe(0); // outside every scanned partition/minute entirely
  });
});
