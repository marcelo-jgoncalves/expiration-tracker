import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDynamoDbLocal, TABLE_NAME } from "./setup.js";
import { DynamoDbOutboxRelayStore } from "../../src/shared/outbox/persistence/dynamodb-outbox-relay-store.js";
import { DynamoDbReminderStore } from "../../src/modules/reminder/persistence/dynamodb-reminder-store.js";
import { publishOne } from "../../src/workers/dispatch-outbox-relay/relay.js";
import { recoverExpiredClaims } from "../../src/workers/reminder-reconciliation/recover-expired-claims.js";
import { outboxShard, type OutboxRecord } from "../../src/shared/outbox/outbox.js";

describe("PERF-12 persisted outbox fences and atomic recovery", () => {
  let ctx: Awaited<ReturnType<typeof startDynamoDbLocal>>;
  let store: DynamoDbReminderStore;
  let relay: DynamoDbOutboxRelayStore;
  beforeAll(async () => {
    ctx = await startDynamoDbLocal();
    store = new DynamoDbReminderStore(ctx.client, TABLE_NAME);
    relay = new DynamoDbOutboxRelayStore(ctx.client, TABLE_NAME);
  });
  afterAll(async () => { if (ctx) await ctx.stop(); });
  const now = () => "2026-09-16T22:00:00.000Z";
  const keyOf = ({ PK, SK }: { PK: string; SK: string }) => ({ PK, SK });
  // Sub-sharded by eventId since D-304 (real hot-partition fix) - built via the real
  // outboxShard() rather than a hardcoded literal, so this fixture can never silently drift
  // out of sync with the shard the production code actually computes (exactly what broke this
  // suite's collision test the first time: a hardcoded PK stopped colliding with the one
  // recoverExpiredClaims computes internally, so the transaction it expects to fail atomically
  // just... didn't).
  function event(id: string): OutboxRecord {
    return { PK: `TENANT#t1#OUTBOX#${outboxShard(now(), id)}`, SK: `EVENT#${now()}#${id}`, eventId: id,
      entityType: "OutboxEvent", tenantId: "t1", eventType: "ReminderDispatchRequested",
      aggregateType: "ReminderOccurrence", aggregateId: "o1", aggregateVersion: 2,
      destination: "SQS_REMINDER_DISPATCH_V1", status: "PENDING", payload: {},
      occurredAt: now(), createdAt: now(), publishAttempts: 0, nextAttemptAt: now(),
      GSI6PK: "RECON#OUTBOX#PENDING", GSI6SK: now() };
  }

  // G-V3: removing persisted PENDING from acquisition republishes this historical image.
  it("a stale PENDING stream image cannot republish an already published record", async () => {
    const record = event("stale");
    await store.putIfAbsent(record);
    let sends = 0;
    const deps = { store: relay, now, leaseOwner: "first", senders: {
      SQS_REMINDER_DISPATCH_V1: async () => { sends++; },
    } };
    expect((await publishOne(deps, record)).kind).toBe("PUBLISHED");
    const historical = { ...record, leaseOwner: "first", leaseExpiresAt: "2026-09-16T22:00:30.000Z" };
    expect((await publishOne({ ...deps, leaseOwner: "replay" }, historical)).kind).toBe("SKIPPED_LEASE_HELD");
    expect(sends).toBe(1);
    expect(await store.get(keyOf(record))).toMatchObject({ status: "PUBLISHED" });
  });

  // G-V3: attribute_not_exists(leaseOwner) without status allows UpdateItem to create a ghost item.
  it("an absent outbox cannot acquire a lease or be recreated", async () => {
    const key = keyOf(event("absent"));
    expect(await relay.tryAcquireLease(key, "owner", "2026-09-16T22:00:30.000Z", now())).toBe(false);
    expect(await store.get(key)).toBeUndefined();
  });

  // G-V3: rejecting every existing lease prevents recovery after send failure/owner death.
  it("only one owner acquires a pending record and an expired lease can be recovered", async () => {
    const record = event("expired");
    await store.putIfAbsent(record);
    const acquired = await Promise.all(["a", "b"].map(owner => relay.tryAcquireLease(keyOf(record), owner, "2026-09-16T22:00:30.000Z", now())));
    expect(acquired.filter(Boolean)).toHaveLength(1);
    expect(await relay.tryAcquireLease(keyOf(record), "c", "2026-09-16T22:01:30.000Z", "2026-09-16T22:01:00.000Z")).toBe(true);
  });

  // G-V3: swallowing the outbox's condition failure or splitting renewal/outbox commits advances the claim without durable work.
  it("outbox collision rolls back claim renewal; a later retry atomically renews and publishes", async () => {
    const candidate = { PK: "TENANT#t1#ITEM#recovery", SK: "OCC#o1", tenantId: "t1",
      entityType: "ReminderOccurrence", occurrenceId: "o1", itemId: "recovery", itemVersion: 1,
      policyVersion: 1, status: "CLAIMED", version: 2, scheduledAt: "2026-09-16T20:00:00.000Z",
      claimExpiresAt: "2026-09-16T21:59:00.000Z", GSI6PK: "WORKSTATE#CLAIMED", GSI6SK: "expired" };
    await store.putIfAbsent(candidate);
    await store.putIfAbsent(event("collision"));
    const deps = { store, tableName: TABLE_NAME, dispatchOutboxTableName: TABLE_NAME, now, claimTtlMs: 120000, newEventId: () => "collision", correlationId: () => "recovery" };
    await expect(recoverExpiredClaims(deps, [candidate])).rejects.toMatchObject({ name: "TransactionCanceledException" });
    expect(await store.get(keyOf(candidate))).toEqual(candidate);
    expect(await recoverExpiredClaims({ ...deps, newEventId: () => "recovered" }, [candidate])).toBe(1);
    expect(await store.get(keyOf(candidate))).toMatchObject({ status: "CLAIMED", version: 3, claimExpiresAt: "2026-09-16T22:02:00.000Z" });
    expect(await store.get(keyOf(event("recovered")))).toMatchObject({ status: "PENDING", aggregateVersion: 3, destination: "SQS_REMINDER_DISPATCH_V1" });
  });
});
