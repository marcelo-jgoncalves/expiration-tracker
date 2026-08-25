/**
 * dispatchOccurrence unit tests - the freshness fence (BLOCKER-B, Codex Round B/D) had no
 * dedicated coverage: the integration test (test/integration/reminder-engine.test.ts) only
 * exercises the happy path where item/policy never change between dispatch's read and its
 * commit. These tests deliberately mutate the underlying store BETWEEN dispatchOccurrence's
 * internal `get()` reads and its `transactWrite()` commit (via a store wrapper that races
 * the mutation in from inside `get()`, since the function itself has no seam to inject a
 * pause) - genuinely exercising the TOCTOU window the fence closes, not just asserting the
 * happy path still works.
 */
import { describe, expect, it } from "vitest";
import { InMemoryReminderStore, makeReminderIdGenerator } from "./in-memory-store.js";
import { ReminderPolicyService } from "../../../src/modules/reminder/application/reminder-policy-service.js";
import { ReminderMaterializer } from "../../../src/modules/reminder/application/reminder-materializer.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import { dispatchOccurrence, type DispatchDeps } from "../../../src/workers/reminder-dispatch/dispatch.js";
import type { DispatchCommand } from "../../../src/workers/reminder-producer/producer.js";
import { itemKey } from "../../../src/modules/expiration/domain/expiration-item.js";
import { policyKey } from "../../../src/modules/reminder/domain/reminder-policy.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { buildVersionedUpdate, type EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TENANT = "t1";
const ITEM_ID = "item1";
const TABLE = "MainTable";
const NOW = "2026-08-01T00:00:00.000Z";

function contextFor(tenantId: string): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-user-1", sessionId: "session-1" },
    tenant: { tenantId, roles: ["OWNER"] },
    auth: { issuedAt: NOW, expiresAt: NOW, tokenId: "jti-1" },
  };
}

/** Wraps a real InMemoryReminderStore so a caller-supplied mutation runs right after
 * dispatchOccurrence's SECOND `get()` call resolves - dispatch's own sequence is exactly
 * `get(item)` then `get(policy)` before it ever calls `transactWrite` (findOccurrence uses
 * `queryByItem`, not `get`, so it doesn't count here) - simulating a concurrent writer
 * landing in the real window between dispatch's reads and its commit, not before the reads
 * (which would just make dispatch's own `stale` pre-check take the early-exit branch
 * instead of ever reaching the fence this test targets). */
class RacingStore extends InMemoryReminderStore {
  private getCalls = 0;
  constructor(private readonly raceIn: () => Promise<void>) {
    super();
  }
  override async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    const result = await super.get<T>(key);
    this.getCalls += 1;
    if (this.getCalls === 2) {
      await this.raceIn();
    }
    return result;
  }
}

async function setupScheduled(
  store: InMemoryReminderStore,
): Promise<{ command: DispatchCommand; dispatchDeps: DispatchDeps; policyPk: string }> {
  await store.putIfAbsent({
    ...itemKey(TENANT, ITEM_ID),
    entityType: "ExpirationItem",
    itemId: ITEM_ID,
    tenantId: TENANT,
    status: "ACTIVE",
    dueDate: "2026-09-10T00:00:00.000Z",
    version: 1,
  });

  const policies = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now: () => NOW });
  const policy = await policies.createPolicy(contextFor(TENANT), {
    scope: "ITEM",
    itemId: ITEM_ID,
    rule: {
      name: "7 days before",
      triggers: [{ triggerId: "trig1", offsetIso: "-P7D", localTime: "09:00" }],
      timeZone: "America/Sao_Paulo",
      channels: ["EMAIL"],
    },
  });

  const materializer = new ReminderMaterializer(store, TABLE, () => NOW);
  const materialized = await materializer.materialize({
    tenantId: TENANT,
    itemId: ITEM_ID,
    itemVersion: 1,
    itemDueDate: "2026-09-10T00:00:00.000Z",
    policy,
    shardConfig: defaultShardConfig(),
  });
  const occurrence = materialized.created[0]!;

  // Claim it directly (bypassing the producer - not what's under test here).
  await store.transactWrite([
    {
      Update: buildVersionedUpdate({
        tableName: TABLE,
        key: { PK: occurrence.PK, SK: occurrence.SK },
        tenantId: TENANT,
        expectedVersion: occurrence.version,
        set: { status: "CLAIMED" },
      }),
    },
  ]);

  const command: DispatchCommand = {
    messageVersion: 1,
    messageId: "msg-1",
    createdAt: NOW,
    correlationId: "corr-1",
    commandType: "reminder.dispatch.v1",
    tenantId: TENANT,
    deduplicationKey: occurrence.occurrenceId,
    data: {
      itemId: ITEM_ID,
      occurrenceId: occurrence.occurrenceId,
      occurrenceVersion: occurrence.version + 1,
      scheduledAt: occurrence.scheduledAt,
      itemVersion: 1,
      policyVersion: policy.version,
    },
  };

  const dispatchDeps: DispatchDeps = {
    store,
    tableName: TABLE,
    // Dispatch checks `scheduledAt` against `now()` within a tolerance window - the "now"
    // relevant to this test is dispatch TIME (the occurrence's own scheduled minute), not
    // the fixed materialization-time clock used to seed the fixtures above.
    now: () => occurrence.scheduledAt,
    newIntentId: () => "intent-1",
    newEventId: () => "evt-1",
    correlationId: () => "corr-dispatch",
  };

  return { command, dispatchDeps, policyPk: policyKey(TENANT, policy.policyId).PK };
}

describe("dispatchOccurrence — freshness fence under a genuine read/commit race", () => {
  it("aborts (ABORTED_FRESHNESS_RACE) and creates no NotificationIntent when the policy is disabled in the window between dispatch's read and its commit", async () => {
    let policyPk = "";
    const store: InMemoryReminderStore = new RacingStore(async () => {
      // Disable the policy directly in the backing store, simulating a concurrent
      // ReminderPolicyService.disablePolicy() call landing after dispatch already read it.
      const row = await store.get<{ PK: string; SK: string; version: number }>({ PK: policyPk, SK: "META" });
      if (row) await store.update({ ...row, enabled: false });
    });

    const setup = await setupScheduled(store);
    policyPk = setup.policyPk;

    const outcome = await dispatchOccurrence(setup.dispatchDeps, setup.command);

    expect(outcome.kind).toBe("ABORTED_FRESHNESS_RACE");
    const allRows = store.allItems();
    expect(allRows.some((r) => r["entityType"] === "NotificationIntent")).toBe(false);
    const occurrenceRow = allRows.find((r) => r["entityType"] === "ReminderOccurrence");
    expect(occurrenceRow?.["status"]).toBe("CLAIMED"); // untouched - transaction rolled back
  });

  it("aborts (ABORTED_FRESHNESS_RACE) and creates no NotificationIntent when the item is archived in the window between dispatch's read and its commit", async () => {
    const store: InMemoryReminderStore = new RacingStore(async () => {
      const row = await store.get<{ PK: string; SK: string; version: number }>(itemKey(TENANT, ITEM_ID));
      if (row) await store.update({ ...row, status: "ARCHIVED" });
    });

    const { command, dispatchDeps } = await setupScheduled(store);

    const outcome = await dispatchOccurrence(dispatchDeps, command);

    expect(outcome.kind).toBe("ABORTED_FRESHNESS_RACE");
    const allRows = store.allItems();
    expect(allRows.some((r) => r["entityType"] === "NotificationIntent")).toBe(false);
  });

  it("still succeeds (TRIGGERED) when nothing races - the fence never fires a false positive on the happy path", async () => {
    const store = new InMemoryReminderStore();
    const { command, dispatchDeps } = await setupScheduled(store);

    const outcome = await dispatchOccurrence(dispatchDeps, command);

    expect(outcome.kind).toBe("TRIGGERED");
    const allRows = store.allItems();
    expect(allRows.some((r) => r["entityType"] === "NotificationIntent")).toBe(true);
  });
});
