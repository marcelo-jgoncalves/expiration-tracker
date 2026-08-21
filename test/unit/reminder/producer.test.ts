/**
 * Dedicated unit coverage for producer.ts's partial-batch-failure path, closing a real gap
 * found in the Engineering Maturity Review (2026-08-19, Checkpoint 2-9): `runProducerTick`'s
 * `failed` array (implementation-blueprint.md §9.3 point 4 - "só as entradas com falha são
 * surfaced, o chamador reprocessa só elas, nunca o batch inteiro") had zero test coverage;
 * every existing test only asserted `failed` was empty on the happy path, never exercised a
 * genuine per-occurrence failure (e.g. a transient store error unrelated to a lost claim
 * race) actually landing in `failed` instead of crashing the whole tick or being dropped.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryReminderStore, makeReminderIdGenerator } from "./in-memory-store.js";
import { ReminderPolicyService } from "../../../src/modules/reminder/application/reminder-policy-service.js";
import { ReminderMaterializer } from "../../../src/modules/reminder/application/reminder-materializer.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import { runProducerTick } from "../../../src/workers/reminder-producer/producer.js";
import type { ReminderProducerStore, TransactWriteEntry, EntityKey } from "../../../src/modules/reminder/ports/reminder-store.js";
import { itemKey } from "../../../src/modules/expiration/domain/expiration-item.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { defaultSchemaRegistry } from "../../../src/shared/contracts/schema-validator.js";

/** Wraps a real InMemoryReminderStore but injects one poison failure: the first
 * transactWrite whose Update targets `poisonSk` throws a plain Error (not a
 * TransactionCanceledException) - models a transient store/network fault distinct from a
 * lost optimistic-concurrency race, which the producer must route to `failed`, not swallow
 * or crash on. */
class PoisonOnceStore implements ReminderProducerStore {
  private thrown = false;
  constructor(
    private readonly inner: InMemoryReminderStore,
    private readonly poisonSk: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    return this.inner.get<T>(key);
  }

  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    if (!this.thrown) {
      const hitsPoisonKey = entries.some((e) => "Update" in e && e.Update.Key.SK === this.poisonSk);
      if (hitsPoisonKey) {
        this.thrown = true;
        throw new Error("simulated transient store fault (not a condition failure)");
      }
    }
    return this.inner.transactWrite(entries);
  }

  async queryGsi3<T extends EntityKey = Record<string, unknown> & EntityKey>(input: { gsi3pk: string }) {
    return this.inner.queryGsi3<T>(input);
  }
}

describe("producer.ts - partial batch failure", () => {
  const TENANT = "t1";
  const ITEM_ID = "item1";
  const TABLE = "MainTable";
  let store: InMemoryReminderStore;
  let clock: { current: string };

  function now(): string {
    return clock.current;
  }

  beforeEach(async () => {
    store = new InMemoryReminderStore();
    clock = { current: "2026-08-01T00:00:00.000Z" };

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

  it("a genuine store error on one occurrence's claim lands in `failed`, without aborting the rest of the tick", async () => {
    const ctx: RequestContext = {
      requestId: "r1",
      correlationId: "c1",
      principal: { userId: "u1", cognitoSubject: "sub-u1", sessionId: "s1" },
      tenant: { tenantId: TENANT, roles: ["OWNER"] },
      auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    };
    const policies = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now });
    const policy = await policies.createPolicy(ctx, {
      scope: "ITEM",
      itemId: ITEM_ID,
      rule: {
        name: "same day 08:00",
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
    const poisonStore = new PoisonOnceStore(store, occurrence.SK);

    const tick = await runProducerTick(
      { store: poisonStore, shardConfig: defaultShardConfig(), tableName: TABLE, now, newEventId: () => `evt-${Math.random()}`, correlationId: () => "c" },
      new Date("2026-09-10T08:00:00.000Z"),
    );

    expect(tick.claimed).toHaveLength(0);
    expect(tick.failed).toHaveLength(1);
    expect(tick.failed[0]?.occurrenceId).toBe(occurrence.occurrenceId);
    expect(tick.failed[0]?.tenantId).toBe(TENANT);
    expect(tick.failed[0]?.error).toBeInstanceOf(Error);

    // The occurrence itself was never mutated - still SCHEDULED, ready to be retried by
    // the caller (per §9.3 point 4: only the failed entries are retried, not the batch).
    const row = await store.get<{ PK: string; SK: string; status: string }>({ PK: occurrence.PK, SK: occurrence.SK });
    expect(row?.status).toBe("SCHEDULED");
  });

  it("the real claimed DispatchCommand satisfies its own JSON schema (reminder-dispatch.v1.json) - closes a real pre-existing gap where the schema was never validated against a producer-constructed command, only against a hand-written example (found during M5's observability review)", async () => {
    const ctx: RequestContext = {
      requestId: "r1",
      correlationId: "c1",
      principal: { userId: "u1", cognitoSubject: "sub-u1", sessionId: "s1" },
      tenant: { tenantId: TENANT, roles: ["OWNER"] },
      auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    };
    const policies = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now });
    const policy = await policies.createPolicy(ctx, {
      scope: "ITEM",
      itemId: ITEM_ID,
      rule: {
        name: "same day 08:00",
        triggers: [{ triggerId: "trig1", offsetIso: "P0D", localTime: "08:00" }],
        timeZone: "UTC",
        channels: ["EMAIL"],
      },
    });

    const materializer = new ReminderMaterializer(store, TABLE, now);
    await materializer.materialize({
      tenantId: TENANT,
      itemId: ITEM_ID,
      itemVersion: 1,
      itemDueDate: "2026-09-10T00:00:00.000Z",
      policy,
      shardConfig: defaultShardConfig(),
    });

    clock.current = "2026-09-10T08:00:30.000Z";

    const tick = await runProducerTick(
      { store, shardConfig: defaultShardConfig(), tableName: TABLE, now, newEventId: () => `evt-${Math.random()}`, correlationId: () => "cor-real" },
      new Date("2026-09-10T08:00:00.000Z"),
    );

    expect(tick.claimed).toHaveLength(1);
    const command = tick.claimed[0];
    const { valid, errors } = defaultSchemaRegistry.validate(
      "https://expiration-tracker/schemas/queues/reminder-dispatch.v1.json",
      command,
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
    expect(command?.correlationId).toBe("cor-real");
  });
});
