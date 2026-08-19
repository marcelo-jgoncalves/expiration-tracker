/**
 * Camada 2 (docs/architecture/m3.5-runtime-design.md): the M3 exit criterion end-to-end
 * flow (materialize -> producer claim -> outbox -> relay -> dispatch -> reconciliation),
 * replayed against REAL DynamoDB (DynamoDB Local via Testcontainers) through the real
 * adapters - not the in-memory fakes, not mocks. Proves ConditionExpression/
 * TransactWriteItems/Query semantics that the fakes only approximate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDynamoDbLocal, TABLE_NAME } from "./setup.js";
import { DynamoDbReminderStore } from "../../src/modules/reminder/persistence/dynamodb-reminder-store.js";
import { DynamoDbReminderProducerStore } from "../../src/modules/reminder/persistence/dynamodb-reminder-producer-store.js";
import { DynamoDbReminderReconciliationCandidateSource } from "../../src/modules/reminder/persistence/dynamodb-reconciliation-candidate-source.js";
import { DynamoDbOutboxRelayStore } from "../../src/shared/outbox/persistence/dynamodb-outbox-relay-store.js";
import { ReminderMaterializer } from "../../src/modules/reminder/application/reminder-materializer.js";
import { defaultShardConfig } from "../../src/modules/reminder/domain/shard-config.js";
import { runProducerTick } from "../../src/workers/reminder-producer/producer.js";
import { dispatchOccurrence } from "../../src/workers/reminder-dispatch/dispatch.js";
import { reconcileExpiredClaims } from "../../src/workers/reminder-reconciliation/reconciliation.js";
import { publishOne } from "../../src/workers/dispatch-outbox-relay/relay.js";
import type { ReminderPolicy } from "../../src/modules/reminder/domain/reminder-policy.js";
import type { ReminderOccurrence } from "../../src/modules/reminder/domain/reminder-occurrence.js";

describe("Reminder Engine end-to-end against REAL DynamoDB (Camada 2)", () => {
  let ctx: Awaited<ReturnType<typeof startDynamoDbLocal>>;
  let store: DynamoDbReminderStore;
  let producerStore: DynamoDbReminderProducerStore;
  let candidateSource: DynamoDbReminderReconciliationCandidateSource;
  let relayStore: DynamoDbOutboxRelayStore;

  beforeAll(async () => {
    ctx = await startDynamoDbLocal();
    store = new DynamoDbReminderStore(ctx.client, TABLE_NAME);
    producerStore = new DynamoDbReminderProducerStore(ctx.client, TABLE_NAME);
    candidateSource = new DynamoDbReminderReconciliationCandidateSource(ctx.client, TABLE_NAME);
    relayStore = new DynamoDbOutboxRelayStore(ctx.client, TABLE_NAME);
  }, 60_000);

  afterAll(async () => {
    await ctx.stop();
  });

  const TENANT = "t1";
  const ITEM_ID = "item1";

  function policy(): ReminderPolicy {
    return {
      PK: `TENANT#${TENANT}#POLICY#p1`,
      SK: "META",
      entityType: "ReminderPolicy",
      policyId: "p1",
      tenantId: TENANT,
      scope: "ITEM",
      itemId: ITEM_ID,
      name: "same day 09:00",
      triggers: [{ triggerId: "trig1", offsetIso: "P0D", localTime: "09:00" }],
      timeZone: "America/Sao_Paulo",
      channels: ["EMAIL"],
      enabled: true,
      version: 1,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
  }

  it("materialize -> producer claim (real GSI3 query + real TransactWriteItems) -> durable outbox -> relay -> dispatch -> exactly one NotificationIntent", async () => {
    const now = () => "2026-09-10T12:00:00.000Z";

    await store.putIfAbsent({
      PK: `TENANT#${TENANT}#ITEM#${ITEM_ID}`,
      SK: "META",
      entityType: "ExpirationItem",
      itemId: ITEM_ID,
      tenantId: TENANT,
      status: "ACTIVE",
      dueDate: "2026-09-10T00:00:00.000Z",
      version: 1,
    });
    const pol = policy();
    await store.putIfAbsent(pol);

    const materializer = new ReminderMaterializer(store, TABLE_NAME, now);
    const materialized = await materializer.materialize({
      tenantId: TENANT,
      itemId: ITEM_ID,
      itemVersion: 1,
      itemDueDate: "2026-09-10",
      policy: pol,
      shardConfig: defaultShardConfig(),
    });
    expect(materialized.created).toHaveLength(1);

    // Real GSI3 Query against DynamoDB Local, real conditional TransactWriteItems claim,
    // real durable-outbox write (destination=SQS_REMINDER_DISPATCH_V1) in the SAME
    // transaction, real GSI6 WORKSTATE#CLAIMED pointer.
    let eventIdCounter = 0;
    const tick = await runProducerTick(
      {
        store: producerStore,
        shardConfig: defaultShardConfig(),
        tableName: TABLE_NAME,
        now,
        newEventId: () => `evt-${++eventIdCounter}`,
        correlationId: () => "corr-1",
      },
      new Date("2026-09-10T12:00:00.000Z"), // policy trigger is P0D (same day as dueDate) 09:00 America/Sao_Paulo = 12:00 UTC on 09-10
    );
    expect(tick.claimed).toHaveLength(1);
    expect(tick.failed).toHaveLength(0);

    const claimedOccurrence = await store.get<ReminderOccurrence>({
      PK: `TENANT#${TENANT}#ITEM#${ITEM_ID}`,
      SK: materialized.created[0]!.SK,
    });
    expect(claimedOccurrence?.status).toBe("CLAIMED");
    expect(claimedOccurrence?.GSI6PK).toBe("WORKSTATE#CLAIMED");

    // Real outbox relay: reads the durable record (via a GSI6 candidate-shaped shape here,
    // constructed directly for the relay - the Streams wiring itself is CDK/AWS-only and out
    // of DynamoDB Local's scope; this proves the relay's DynamoDB read/write side for real).
    const outboxItems = await ctx.raw
      .send(
        new (await import("@aws-sdk/lib-dynamodb")).QueryCommand({
          TableName: TABLE_NAME,
          IndexName: "GSI6",
          KeyConditionExpression: "GSI6PK = :pk",
          ExpressionAttributeValues: { ":pk": "RECON#OUTBOX#PENDING" },
        }),
      )
      .then((r) => r.Items ?? []);
    expect(outboxItems).toHaveLength(1);
    expect(outboxItems[0]?.["destination"]).toBe("SQS_REMINDER_DISPATCH_V1");

    const sentToQueue: unknown[] = [];
    const publishOutcome = await publishOne(
      { store: relayStore, sendToDispatchQueue: async (p) => void sentToQueue.push(p), now, leaseOwner: "relay-1" },
      outboxItems[0] as never,
    );
    expect(publishOutcome.kind).toBe("PUBLISHED");
    expect(sentToQueue).toHaveLength(1);

    // markPublished must have removed the GSI6 pointer for real (Codex-found bug, fixed).
    const afterPublish = await ctx.raw.send(
      new (await import("@aws-sdk/lib-dynamodb")).QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI6",
        KeyConditionExpression: "GSI6PK = :pk",
        ExpressionAttributeValues: { ":pk": "RECON#OUTBOX#PENDING" },
      }),
    );
    expect(afterPublish.Items ?? []).toHaveLength(0);

    // Real dispatch: CLAIMED -> TRIGGERED + NotificationIntent, real TransactWriteItems.
    const command = sentToQueue[0] as Parameters<typeof dispatchOccurrence>[1];
    const outcome = await dispatchOccurrence(
      { store, tableName: TABLE_NAME, now, newIntentId: () => "intent-1", newEventId: () => `evt-${++eventIdCounter}`, correlationId: () => "corr-2" },
      command,
    );
    expect(outcome.kind).toBe("TRIGGERED");

    const triggeredOccurrence = await store.get<ReminderOccurrence>({
      PK: `TENANT#${TENANT}#ITEM#${ITEM_ID}`,
      SK: materialized.created[0]!.SK,
    });
    expect(triggeredOccurrence?.status).toBe("TRIGGERED");
    expect(triggeredOccurrence?.GSI6PK).toBeUndefined(); // pointer removed on TRIGGERED, proven against real DynamoDB

    // Duplicate delivery (SQS at-least-once) must not create a second NotificationIntent.
    const duplicateOutcome = await dispatchOccurrence(
      { store, tableName: TABLE_NAME, now, newIntentId: () => "intent-2", newEventId: () => `evt-${++eventIdCounter}`, correlationId: () => "corr-3" },
      command,
    );
    expect(duplicateOutcome.kind).toBe("ALREADY_TRIGGERED");
  }, 30_000);

  it("real conditional Query on GSI6 finds an expired claim and reconciliation reverts it via real TransactWriteItems", async () => {
    const now = () => "2026-09-10T12:05:00.000Z";
    const itemId = "item2";

    await store.putIfAbsent({
      PK: `TENANT#${TENANT}#ITEM#${itemId}`,
      SK: "META",
      entityType: "ExpirationItem",
      itemId,
      tenantId: TENANT,
      status: "ACTIVE",
      dueDate: "2026-09-10T00:00:00.000Z",
      version: 1,
    });

    const occurrenceId = "occ_expired";
    await store.putIfAbsent({
      PK: `TENANT#${TENANT}#ITEM#${itemId}`,
      SK: `OCC#2026-09-10T12:00:00.000Z#${occurrenceId}`,
      entityType: "ReminderOccurrence",
      occurrenceId,
      tenantId: TENANT,
      itemId,
      policyId: "p1",
      triggerId: "trig1",
      scheduledAt: "2026-09-10T12:00:00.000Z",
      localScheduledAt: "2026-09-10T09:00:00",
      timeZone: "America/Sao_Paulo",
      originalRule: { offset: "P0D", localTime: "09:00" },
      itemVersion: 1,
      policyVersion: 1,
      shard: "00",
      shardFnVersion: 1,
      status: "CLAIMED",
      claimedAt: "2026-09-10T12:00:00.000Z",
      claimExpiresAt: "2026-09-10T12:02:00.000Z", // expired relative to `now`
      version: 1,
      createdAt: "2026-09-10T12:00:00.000Z",
      updatedAt: "2026-09-10T12:00:00.000Z",
      GSI6PK: "WORKSTATE#CLAIMED",
      GSI6SK: "2026-09-10T12:02:00.000Z#TENANT#t1#OCCURRENCE#occ_expired",
    });

    const page = await candidateSource.listExpiredClaims({ before: now() });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.occurrenceId).toBe(occurrenceId);

    const reverted = await reconcileExpiredClaims({ store, tableName: TABLE_NAME, now, shardConfig: defaultShardConfig() }, page.items as unknown as ReminderOccurrence[]);
    expect(reverted).toBe(1);

    const afterRevert = await store.get<ReminderOccurrence>({ PK: `TENANT#${TENANT}#ITEM#${itemId}`, SK: `OCC#2026-09-10T12:00:00.000Z#${occurrenceId}` });
    expect(afterRevert?.status).toBe("SCHEDULED");
    expect(afterRevert?.GSI6PK).toBeUndefined();
  }, 30_000);
});
