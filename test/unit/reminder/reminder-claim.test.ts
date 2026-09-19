import { describe, expect, it } from "vitest";
import { InMemoryReminderStore } from "./in-memory-store.js";
import { claimReminderOccurrence } from "../../../src/modules/reminder/application/reminder-claim.js";

const TABLE = "MainTable";
const TENANT = "t_01";

function deps(store: InMemoryReminderStore, nowIso: string) {
  let counter = 0;
  return {
    store,
    tableName: TABLE,
    dispatchOutboxTableName: TABLE,
    now: () => nowIso,
    claimTtlMs: 120_000,
    newEventId: () => `evt-${++counter}`,
    correlationId: () => "corr-1",
  };
}

async function seedOccurrence(store: InMemoryReminderStore, overrides: Partial<Record<string, unknown>> = {}) {
  const item = {
    PK: `TENANT#${TENANT}#ITEM#item-1`,
    SK: `OCC#occ-1`,
    entityType: "ReminderOccurrence",
    occurrenceId: "occ-1",
    tenantId: TENANT,
    itemId: "item-1",
    itemVersion: 1,
    policyVersion: 1,
    status: "SCHEDULED",
    scheduledAt: "2026-09-14T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
  await store.update(item);
  return item;
}

describe("claimReminderOccurrence (extracted from producer.ts, D-300 §1)", () => {
  it("claims a SCHEDULED occurrence: conditional SCHEDULED->CLAIMED plus an outbox dispatch entry in the SAME transaction", async () => {
    const store = new InMemoryReminderStore();
    const occ = await seedOccurrence(store);

    const outcome = await claimReminderOccurrence(deps(store, "2026-09-14T12:00:05.000Z"), { PK: occ.PK, SK: occ.SK }, TENANT);

    expect(outcome.kind).toBe("CLAIMED");
    if (outcome.kind !== "CLAIMED") throw new Error("unreachable");
    expect(outcome.command.commandType).toBe("reminder.dispatch.v1");
    expect(outcome.command.data.occurrenceVersion).toBe(2);

    const updated = await store.get<{ PK: string; SK: string; status: string; version: number }>({ PK: occ.PK, SK: occ.SK });
    expect(updated?.status).toBe("CLAIMED");
    expect(updated?.version).toBe(2);

    const outboxRows = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.["destination"]).toBe("SQS_REMINDER_DISPATCH_V1");
  });

  it("SKIPPED_NOT_SCHEDULED: already claimed/cancelled/triggered by a prior tick or race - not a failure", async () => {
    const store = new InMemoryReminderStore();
    const occ = await seedOccurrence(store, { status: "CLAIMED" });

    const outcome = await claimReminderOccurrence(deps(store, "2026-09-14T12:00:05.000Z"), { PK: occ.PK, SK: occ.SK }, TENANT);
    expect(outcome.kind).toBe("SKIPPED_NOT_SCHEDULED");
  });

  it("SKIPPED_NOT_DUE: never claims an occurrence before scheduledAt", async () => {
    const store = new InMemoryReminderStore();
    const occ = await seedOccurrence(store);
    const outcome = await claimReminderOccurrence(deps(store, "2026-09-14T11:59:59.999Z"), { PK: occ.PK, SK: occ.SK }, TENANT);
    expect(outcome.kind).toBe("SKIPPED_NOT_DUE");
    expect((await store.get<{ PK: string; SK: string; status: string }>({ PK: occ.PK, SK: occ.SK }))?.status).toBe("SCHEDULED");
  });

  // G-V3: treating even the occurrence's sole conditional failure as retry breaks this benign-race contract.
  it("LOST_CLAIM_RACE: only the occurrence condition failed, so concurrent claim is a no-op", async () => {
    const store = new InMemoryReminderStore();
    const occ = await seedOccurrence(store);

    // Real reproduction of the race: the occurrence's version is bumped past what this call will
    // read AFTER the read but modeled here by simulating the store itself rejecting the
    // transaction, exactly as real DynamoDB would when the conditional Update's #version =
    // :expectedVersion fails - the concrete mechanism producer.ts's own PoisonOnceStore
    // (test/unit/reminder/producer.test.ts) exercises for the identical shape.
    const racingStore = {
      get: store.get.bind(store),
      transactWrite: async () => {
        throw { name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }] };
      },
    };

    const outcome = await claimReminderOccurrence(
      { store: racingStore, tableName: TABLE, dispatchOutboxTableName: TABLE, now: () => "2026-09-14T12:00:05.000Z", claimTtlMs: 120_000, newEventId: () => "evt-1", correlationId: () => "corr-1" },
      { PK: occ.PK, SK: occ.SK },
      TENANT,
    );

    expect(outcome.kind).toBe("LOST_CLAIM_RACE");
  });

  it("a non-condition transient store error is NOT swallowed - it propagates so the caller can route it to its own failure/retry path", async () => {
    const store = new InMemoryReminderStore();
    const occ = await seedOccurrence(store);
    const flakyStore = {
      get: store.get.bind(store),
      transactWrite: async () => {
        throw new Error("simulated transient network fault");
      },
    };

    await expect(
      claimReminderOccurrence(
        { store: flakyStore, tableName: TABLE, dispatchOutboxTableName: TABLE, now: () => "2026-09-14T12:00:05.000Z", claimTtlMs: 120_000, newEventId: () => "evt-1", correlationId: () => "corr-1" },
        { PK: occ.PK, SK: occ.SK },
        TENANT,
      ),
    ).rejects.toThrow(/transient network fault/);
  });
});
