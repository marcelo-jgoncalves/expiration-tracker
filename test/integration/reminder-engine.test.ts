/**
 * M3 exit criterion (implementation-blueprint.md §19): "NotificationIntent criado
 * deterministicamente, sem delivery externo" - a policy + item produces a materialized
 * occurrence, the producer picks it up at the right minute (fake clock, no real waiting),
 * claims it, dispatch triggers it and creates exactly one idempotent NotificationIntent.
 * Mirrors test/integration/expiration-lifecycle.test.ts's convention (real module code,
 * not units in isolation) and test/unit/expiration's fake-store pattern.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryReminderStore, makeReminderIdGenerator } from "../unit/reminder/in-memory-store.js";
import { ReminderPolicyService } from "../../src/modules/reminder/application/reminder-policy-service.js";
import { ReminderMaterializer } from "../../src/modules/reminder/application/reminder-materializer.js";
import { defaultShardConfig } from "../../src/modules/reminder/domain/shard-config.js";
import { runProducerTick } from "../../src/workers/reminder-producer/producer.js";
import { dispatchOccurrence } from "../../src/workers/reminder-dispatch/dispatch.js";
import { reconcileExpiredClaims } from "../../src/workers/reminder-reconciliation/reconciliation.js";
import type { ReminderOccurrence } from "../../src/modules/reminder/domain/reminder-occurrence.js";
import type { NotificationIntent } from "../../src/modules/reminder/domain/notification-intent.js";
import { itemKey } from "../../src/modules/expiration/domain/expiration-item.js";
import type { RequestContext } from "../../src/modules/identity/domain/request-context.js";

/** Manually-built RequestContext (same shape RequestContextResolver produces) - M1/M2 already
 * prove the resolver pipeline end-to-end; M3's HTTP handlers reuse that exact pipeline
 * (policy-handlers.ts mirrors item-handlers.ts byte-for-byte in structure), so this test
 * exercises ReminderPolicyService/materializer/producer/dispatch/reconciliation directly
 * against a fixed, known tenantId instead of re-deriving one through the resolver. */
function contextFor(tenantId: string, userId: string): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId, cognitoSubject: `sub-${userId}`, sessionId: "session-1" },
    tenant: { tenantId, roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
  };
}

describe("Reminder Engine end-to-end (M3 exit criterion)", () => {
  const TENANT = "t1";
  const ITEM_ID = "item1";
  const TABLE = "MainTable";
  let store: InMemoryReminderStore;
  let clock: { current: string };
  let policies: ReminderPolicyService;
  let ctx: RequestContext;

  function now(): string {
    return clock.current;
  }

  beforeEach(async () => {
    store = new InMemoryReminderStore();
    clock = { current: "2026-08-01T00:00:00.000Z" };
    ctx = contextFor(TENANT, "user-1");
    policies = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now });

    // Seed the ExpirationItem directly (M2 already proves the item lifecycle end-to-end;
    // M3's scope is the Reminder Engine reacting to an ACTIVE item + policy).
    await store.putIfAbsent({
      ...itemKey(TENANT, ITEM_ID),
      entityType: "ExpirationItem",
      itemId: ITEM_ID,
      tenantId: TENANT,
      status: "ACTIVE",
      dueDate: "2026-09-10T00:00:00.000Z",
      version: 1,
    });
  });

  it("materializes -> producer claims at the right minute (fake clock) -> dispatch triggers -> exactly one NotificationIntent, idempotent under duplicate delivery", async () => {
    const policy = await policies.createPolicy(ctx, {
        scope: "ITEM",
        itemId: ITEM_ID,
        rule: {
          name: "7 days before, 09:00 America/Sao_Paulo",
          triggers: [{ triggerId: "trig1", offsetIso: "-P7D", localTime: "09:00" }],
          timeZone: "America/Sao_Paulo",
          channels: ["EMAIL"],
        },
    });

    const materializer = new ReminderMaterializer(store, TABLE, now);
    const materialized = await materializer.materialize({
      tenantId: TENANT,
      itemId: ITEM_ID,
      itemVersion: 1,
      itemDueDate: "2026-09-10T00:00:00.000Z",
      policy,
      shardConfig: defaultShardConfig(),
    });
    expect(materialized.created).toHaveLength(1);
    const occurrence = materialized.created[0]!;
    expect(occurrence.scheduledAt).toBe("2026-09-03T12:00:00.000Z");

    // A producer tick BEFORE the scheduled minute claims nothing.
    const earlyTick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now },
      new Date("2026-09-03T11:59:00.000Z"),
    );
    expect(earlyTick.claimed).toHaveLength(0);

    // Fake clock advances to the exact scheduled minute - no real wall-clock waiting.
    clock.current = "2026-09-03T12:00:30.000Z";
    const tick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now },
      new Date("2026-09-03T12:00:00.000Z"),
    );
    expect(tick.claimed).toHaveLength(1);
    expect(tick.failed).toHaveLength(0);
    const command = tick.claimed[0]!;
    expect(command.tenantId).toBe(TENANT);
    expect(command.data.occurrenceId).toBe(occurrence.occurrenceId);

    const claimedRow = await store.get<ReminderOccurrence>({ PK: occurrence.PK, SK: occurrence.SK });
    expect(claimedRow?.status).toBe("CLAIMED");

    // A duplicate producer tick for the SAME minute must NOT claim it a second time (it's
    // no longer SCHEDULED).
    const duplicateTick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now },
      new Date("2026-09-03T12:00:00.000Z"),
    );
    expect(duplicateTick.claimed).toHaveLength(0);

    let eventIdCounter = 0;
    const dispatchDeps = {
      store,
      tableName: TABLE,
      now,
      newIntentId: () => "intent-1",
      newEventId: () => `evt-${++eventIdCounter}`,
      correlationId: () => "corr-dispatch",
    };

    const outcome = await dispatchOccurrence(dispatchDeps, command);
    expect(outcome.kind).toBe("TRIGGERED");
    const intent = (outcome as { kind: "TRIGGERED"; intent: NotificationIntent }).intent;
    expect(intent.occurrenceId).toBe(occurrence.occurrenceId);
    expect(intent.requestedChannels).toEqual(["EMAIL"]);

    const triggeredRow = await store.get<ReminderOccurrence>({ PK: occurrence.PK, SK: occurrence.SK });
    expect(triggeredRow?.status).toBe("TRIGGERED");

    // Duplicate dispatch delivery (SQS at-least-once redelivery of the exact same command)
    // must not create a second intent.
    const duplicateOutcome = await dispatchOccurrence(dispatchDeps, command);
    expect(duplicateOutcome.kind).toBe("ALREADY_TRIGGERED");

    const allIntents = store.allItems().filter((i) => i["entityType"] === "NotificationIntent");
    expect(allIntents).toHaveLength(1);

    // Outbox: exactly one notification.intent-created.v1 event.
    const outboxEvents = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]?.["eventType"]).toBe("notification.intent-created.v1");
  });

  it("lookback window: a producer tick that missed minute M still claims it a few minutes later", async () => {
    const policy = await policies.createPolicy(ctx, {
        scope: "ITEM",
        itemId: ITEM_ID,
        rule: {
          name: "1 day before",
          triggers: [{ triggerId: "trig1", offsetIso: "-P1D", localTime: "08:00" }],
          timeZone: "UTC",
          channels: ["EMAIL"],
        },
    });

    const materializer = new ReminderMaterializer(store, TABLE, now);
    const materialized = await materializer.materialize({
      tenantId: TENANT,
      itemId: ITEM_ID,
      itemVersion: 1,
      itemDueDate: "2026-09-10T00:00:00.000Z",
      policy,
      shardConfig: defaultShardConfig(),
    });
    const occurrence = materialized.created[0]!;
    expect(occurrence.scheduledAt).toBe("2026-09-09T08:00:00.000Z");

    // Simulate the producer NOT running at the scheduled minute (outage) - first tick after
    // recovery happens 3 minutes later, well inside the default 5-minute lookback.
    clock.current = "2026-09-09T08:03:30.000Z";
    const recoveryTick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now },
      new Date("2026-09-09T08:03:00.000Z"),
    );
    expect(recoveryTick.claimed).toHaveLength(1);
    expect(recoveryTick.minutesScanned).toContain("2026-09-09T08:00:00.000Z");
  });

  it("claim-expiry reconciliation reverts an unconfirmed claim to SCHEDULED so the next producer tick can re-claim it", async () => {
    const policy = await policies.createPolicy(ctx, {
        scope: "ITEM",
        itemId: ITEM_ID,
        rule: {
          name: "same day",
          triggers: [{ triggerId: "trig1", offsetIso: "P0D", localTime: "08:00" }],
          timeZone: "UTC",
          channels: ["EMAIL"],
        },
    });

    const materializer = new ReminderMaterializer(store, TABLE, now);
    const materialized = await materializer.materialize({
      tenantId: TENANT,
      itemId: ITEM_ID,
      itemVersion: 1,
      itemDueDate: "2026-09-10T00:00:00.000Z",
      policy,
      shardConfig: defaultShardConfig(),
    });
    const occurrence = materialized.created[0]!;

    clock.current = "2026-09-10T08:00:30.000Z";
    const tick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now, claimTtlMs: 60_000 },
      new Date("2026-09-10T08:00:00.000Z"),
    );
    expect(tick.claimed).toHaveLength(1);

    // Dispatch never runs (simulated worker crash). Time passes well beyond the claim TTL.
    clock.current = "2026-09-10T08:03:00.000Z";
    const claimedRow = (await store.get<ReminderOccurrence>({ PK: occurrence.PK, SK: occurrence.SK }))!;
    expect(claimedRow.status).toBe("CLAIMED");

    const reverted = await reconcileExpiredClaims({ store, tableName: TABLE, now, shardConfig: defaultShardConfig() }, [claimedRow]);
    expect(reverted).toBe(1);

    const revertedRow = await store.get<ReminderOccurrence>({ PK: occurrence.PK, SK: occurrence.SK });
    expect(revertedRow?.status).toBe("SCHEDULED");

    // The next producer tick (still within lookback of the original scheduled minute) re-claims it.
    const secondTick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now },
      new Date("2026-09-10T08:03:00.000Z"),
    );
    expect(secondTick.claimed).toHaveLength(1);
    expect(secondTick.claimed[0]?.data.occurrenceId).toBe(occurrence.occurrenceId);
  });

  it("a stale/duplicate command (item's version has since moved on) is cancelled by dispatch, not silently dropped nor turned into a false NotificationIntent", async () => {
    const policy = await policies.createPolicy(ctx, {
        scope: "ITEM",
        itemId: ITEM_ID,
        rule: {
          name: "same day",
          triggers: [{ triggerId: "trig1", offsetIso: "P0D", localTime: "08:00" }],
          timeZone: "UTC",
          channels: ["EMAIL"],
        },
    });

    const materializer = new ReminderMaterializer(store, TABLE, now);
    const materialized = await materializer.materialize({
      tenantId: TENANT,
      itemId: ITEM_ID,
      itemVersion: 1,
      itemDueDate: "2026-09-10T00:00:00.000Z",
      policy,
      shardConfig: defaultShardConfig(),
    });
    const occurrence = materialized.created[0]!;

    clock.current = "2026-09-10T08:00:30.000Z";
    const tick = await runProducerTick({ store, shardConfig: defaultShardConfig(), tableName: TABLE, now }, new Date("2026-09-10T08:00:00.000Z"));
    const command = tick.claimed[0]!;

    // Item's dueDate changed (version bumped) after the occurrence was already claimed.
    const item = (await store.get<{ PK: string; SK: string; status: string; version: number }>(itemKey(TENANT, ITEM_ID)))!;
    await store.update<{ PK: string; SK: string; status: string; version: number }>({ ...item, version: 2 });

    let eventIdCounter = 0;
    const outcome = await dispatchOccurrence(
      { store, tableName: TABLE, now, newIntentId: () => "intent-x", newEventId: () => `evt-${++eventIdCounter}`, correlationId: () => "c" },
      command,
    );
    expect(outcome.kind).toBe("CANCELLED_STALE");

    const row = await store.get<ReminderOccurrence>({ PK: occurrence.PK, SK: occurrence.SK });
    expect(row?.status).toBe("CANCELLED");
    const intents = store.allItems().filter((i) => i["entityType"] === "NotificationIntent");
    expect(intents).toHaveLength(0);
  });
});
