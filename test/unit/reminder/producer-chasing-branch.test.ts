/**
 * M10 cluster 4 (D-039/D-046/D-048): dedicated coverage for producer.ts's new entityType
 * discriminator branch - the highest-risk touch of this session, since GSI3 is now a SHARED
 * index. Proves: (1) a DocumentChasingOccurrence claims correctly through the exact same
 * scan/claim/outbox mechanics as reminders; (2) a MIXED tick (one reminder + one chasing
 * occurrence in the SAME GSI3 partition/minute, exactly what a real shared-index scan returns)
 * claims both independently without either interfering with the other; (3) an unrecognized
 * GSI3SK shape is fail-closed (counted, never processed, never crashes the tick or silently
 * drops the rest of the batch); (4) the existing reminder-only tests (producer.test.ts) still
 * pass completely unchanged, proving the reminder branch is byte-behavior-identical.
 */
import { describe, expect, it } from "vitest";
import { InMemoryReminderStore, makeReminderIdGenerator } from "./in-memory-store.js";
import { runProducerTick, shouldAlarm, type ProducerTickResult } from "../../../src/workers/reminder-producer/producer.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import { itemKey } from "../../../src/modules/expiration/domain/expiration-item.js";
import { ReminderPolicyService } from "../../../src/modules/reminder/application/reminder-policy-service.js";
import { ReminderMaterializer } from "../../../src/modules/reminder/application/reminder-materializer.js";
import { DocumentChasingMaterializer } from "../../../src/modules/subject/application/document-chasing-materializer.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { DocumentChasingOccurrence } from "../../../src/modules/subject/domain/document-chasing.js";

const TENANT = "t1";
const TABLE = "MainTable";

function ctx(): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "u1", cognitoSubject: "sub-u1", sessionId: "s1" },
    tenant: { tenantId: TENANT, roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
  };
}

async function materializeOneChasingOccurrence(store: InMemoryReminderStore, now: () => string, tokenExpiresAt: string): Promise<DocumentChasingOccurrence> {
  const materializer = new DocumentChasingMaterializer(store, now);
  const result = await materializer.materialize({
    tenantId: TENANT,
    subjectId: "subject-1",
    assignmentId: "assignment-1",
    documentRequestId: "docreq-1",
    documentRequestVersion: 1,
    tokenExpiresAt,
    shardConfig: defaultShardConfig(),
  });
  // EXPIRED tier is always materialized regardless of how close tokenExpiresAt is - pick it,
  // its scheduledAt equals tokenExpiresAt exactly, easiest to target with a tick.
  return result.created.find((o) => o.tier === "EXPIRED")!;
}

describe("producer.ts - M10 cluster 4 entityType discriminator branch", () => {
  it("claims a DocumentChasingOccurrence through the same GSI3 scan mechanics as reminders", async () => {
    const store = new InMemoryReminderStore();
    const clock = { current: "2026-08-20T00:00:00.000Z" };
    const now = () => clock.current;

    const occurrence = await materializeOneChasingOccurrence(store, now, "2026-08-23T12:00:00.000Z");
    clock.current = "2026-08-23T12:00:30.000Z";

    const tick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now, newEventId: () => `evt-${Math.random()}`, correlationId: () => "cor-1" },
      new Date("2026-08-23T12:00:00.000Z"),
    );

    expect(tick.claimed).toHaveLength(0);
    expect(tick.failed).toHaveLength(0);
    expect(tick.unknownEntityType).toBe(0);
    expect(tick.chasingClaimed).toHaveLength(1);
    expect(tick.chasingClaimed[0]?.commandType).toBe("document-chasing.dispatch.v1");
    expect(tick.chasingClaimed[0]?.data.occurrenceId).toBe(occurrence.occurrenceId);
    expect(tick.chasingClaimed[0]?.data.tier).toBe("EXPIRED");
    expect(tick.chasingClaimed[0]?.correlationId).toBe("cor-1");

    const row = await store.get<DocumentChasingOccurrence>({ PK: occurrence.PK, SK: occurrence.SK });
    expect(row?.status).toBe("CLAIMED");
    expect(row?.version).toBe(2);
    expect(row?.GSI6PK).toBe("WORKSTATE#CLAIMED");

    // The outbox event was written with the chasing-specific destination, in the SAME
    // transaction as the claim - never a separate, non-atomic write.
    const outboxRecords = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
    expect(outboxRecords).toHaveLength(1);
    expect(outboxRecords[0]?.["destination"]).toBe("SQS_DOCUMENT_CHASING_DISPATCH_V1");
  });

  it("a mixed tick (one reminder + one chasing occurrence in the SAME GSI3 partition/minute) claims both independently", async () => {
    const store = new InMemoryReminderStore();
    const clock = { current: "2026-08-01T00:00:00.000Z" };
    const now = () => clock.current;

    await store.putIfAbsent({
      ...itemKey(TENANT, "item1"),
      entityType: "ExpirationItem",
      itemId: "item1",
      tenantId: TENANT,
      status: "ACTIVE",
      dueDate: "2026-08-23T12:00:00.000Z",
      version: 1,
    });
    const policies = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now });
    const policy = await policies.createPolicy(ctx(), {
      scope: "ITEM",
      itemId: "item1",
      rule: { name: "same day noon", triggers: [{ triggerId: "trig1", offsetIso: "P0D", localTime: "12:00" }], timeZone: "UTC", channels: ["EMAIL"] },
    });
    const reminderMaterializer = new ReminderMaterializer(store, TABLE, now);
    const reminderResult = await reminderMaterializer.materialize({
      tenantId: TENANT,
      itemId: "item1",
      itemVersion: 1,
      itemDueDate: "2026-08-23T12:00:00.000Z",
      policy,
      shardConfig: defaultShardConfig(),
    });
    const reminderOccurrence = reminderResult.created[0]!;
    expect(reminderOccurrence.scheduledAt).toBe("2026-08-23T12:00:00.000Z");

    // Same exact minute as the reminder above - proves a single GSI3 partition scan really can
    // return both entity types mixed together (the scenario the whole discriminator exists for).
    const chasingOccurrence = await materializeOneChasingOccurrence(store, now, "2026-08-23T12:00:00.000Z");

    clock.current = "2026-08-23T12:00:30.000Z";
    const tick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now, newEventId: () => `evt-${Math.random()}`, correlationId: () => "cor-mixed" },
      new Date("2026-08-23T12:00:00.000Z"),
    );

    expect(tick.failed).toHaveLength(0);
    expect(tick.unknownEntityType).toBe(0);
    expect(tick.claimed).toHaveLength(1);
    expect(tick.claimed[0]?.data.occurrenceId).toBe(reminderOccurrence.occurrenceId);
    expect(tick.chasingClaimed).toHaveLength(1);
    expect(tick.chasingClaimed[0]?.data.occurrenceId).toBe(chasingOccurrence.occurrenceId);
  });

  it("fails closed on an unrecognized GSI3SK shape - never processed, never crashes the tick, counted for alarming", async () => {
    const store = new InMemoryReminderStore();
    const now = () => "2026-08-23T12:00:30.000Z";

    // Simulates a future/foreign entityType writing to the shared GSI3 with neither the
    // reminder nor the chasing SK shape - a real bug (or a third entity type added later
    // without updating the discriminator) must never be silently processed or dropped.
    await store.putIfAbsent({
      PK: "TENANT#t1#SOMETHING#weird",
      SK: "META",
      entityType: "SomeFutureThing",
      GSI3PK: "DUE#202608231200#00",
      GSI3SK: "TENANT#t1#UNKNOWNTYPE#foo",
    });

    const tick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now, newEventId: () => `evt-${Math.random()}`, correlationId: () => "cor-unknown" },
      new Date("2026-08-23T12:00:00.000Z"),
    );

    expect(tick.claimed).toHaveLength(0);
    expect(tick.chasingClaimed).toHaveLength(0);
    expect(tick.failed).toHaveLength(0);
    expect(tick.unknownEntityType).toBe(1);
  });

  it("a chasing occurrence already claimed by a prior tick is skipped, not treated as a failure (lost race, not an error)", async () => {
    const store = new InMemoryReminderStore();
    const clock = { current: "2026-08-01T00:00:00.000Z" };
    const now = () => clock.current;

    const occurrence = await materializeOneChasingOccurrence(store, now, "2026-08-23T12:00:00.000Z");
    clock.current = "2026-08-23T12:00:30.000Z";

    // First tick claims it.
    const first = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now, newEventId: () => `evt-${Math.random()}`, correlationId: () => "cor-a" },
      new Date("2026-08-23T12:00:00.000Z"),
    );
    expect(first.chasingClaimed).toHaveLength(1);

    // A second, concurrent-ish tick (still within lookback) finds it already CLAIMED.
    const second = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now, newEventId: () => `evt-${Math.random()}`, correlationId: () => "cor-b" },
      new Date("2026-08-23T12:00:00.000Z"),
    );
    expect(second.chasingClaimed).toHaveLength(0);
    expect(second.failed).toHaveLength(0);

    const row = await store.get<DocumentChasingOccurrence>({ PK: occurrence.PK, SK: occurrence.SK });
    expect(row?.version).toBe(2); // only the first tick's claim actually mutated it
  });
});

describe("shouldAlarm - the exact regression a Codex adversarial review found (D-039/D-046/D-048)", () => {
  function baseResult(overrides: Partial<ProducerTickResult> = {}): ProducerTickResult {
    return {
      claimed: [],
      chasingClaimed: [],
      failed: [],
      unknownEntityType: 0,
      scanned: 0,
      minutesScanned: [],
      shardPartitionsScanned: 0,
      ...overrides,
    };
  }

  it("does not alarm on a clean tick", () => {
    expect(shouldAlarm(baseResult())).toEqual({ alarm: false });
  });

  it("alarms when unknownEntityType is nonzero - this is the exact bug the review found: the handler used to only check `failed`, silently absorbing this counter", () => {
    const result = shouldAlarm(baseResult({ unknownEntityType: 2 }));
    expect(result.alarm).toBe(true);
    expect(result.reason).toMatch(/2 GSI3 row\(s\)/);
  });

  it("alarms when failed is nonzero, with a distinct message from unknownEntityType", () => {
    const result = shouldAlarm(baseResult({ failed: [{ occurrenceId: "o1", tenantId: "t1", error: new Error("boom") }] }));
    expect(result.alarm).toBe(true);
    expect(result.reason).toMatch(/1 occurrence\(s\) failed to claim/);
  });

  it("prefers the unknownEntityType reason when both conditions are true (deterministic message, fail-closed is the more actionable signal)", () => {
    const result = shouldAlarm(baseResult({ unknownEntityType: 1, failed: [{ occurrenceId: "o1", tenantId: "t1", error: new Error("boom") }] }));
    expect(result.reason).toMatch(/GSI3 row\(s\)/);
  });
});
