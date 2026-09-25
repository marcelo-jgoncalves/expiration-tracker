import { describe, expect, it } from "vitest";
import { InMemoryReminderStore } from "./in-memory-store.js";
import { recoverExpiredClaims } from "../../../src/workers/reminder-reconciliation/recover-expired-claims.js";
import { claimReminderOccurrence } from "../../../src/modules/reminder/application/reminder-claim.js";

// ADR-0016 Decision A (2026-09-25) retired the DocumentChasingOccurrence entityType this suite
// used to also exercise (document-chasing feature, fully removed) - ReminderOccurrence is the
// only entityType left.
function setup(entityType = "ReminderOccurrence") {
  const store = new InMemoryReminderStore();
  let counter = 0;
  const deps = { store, tableName: "table", dispatchOutboxTableName: "table", now: () => "2026-09-16T22:00:00.000Z", claimTtlMs: 120000,
    newEventId: () => `evt-${++counter}`, correlationId: () => "recovery" };
  const candidate = { PK: "TENANT#t1#ITEM#item1",
    SK: "OCC#o1", tenantId: "t1", entityType,
    occurrenceId: "o1", itemId: "item1", itemVersion: 1, policyVersion: 1,
    subjectId: "s1", assignmentId: "a1", documentRequestId: "r1", tier: "T7", documentRequestVersion: 1,
    status: "CLAIMED", version: 2, scheduledAt: "2026-09-16T20:00:00.000Z",
    claimExpiresAt: "2026-09-16T21:59:00.000Z", GSI6PK: "WORKSTATE#CLAIMED", GSI6SK: "expired" };
  return { store, deps, candidate };
}

describe("PAGED expired claim recovery", () => {
  // G-V3: resetting to SCHEDULED or omitting the outbox strands work behind the completed scan.
  it.each([
    ["ReminderOccurrence", "SQS_REMINDER_DISPATCH_V1"],
  ])("recovers %s outside lookback with a completed scan and durable %s dispatch", async (entity, destination) => {
    const { store, deps, candidate } = setup(entity);
    await store.update(candidate);
    const lease = { PK: "SCAN#1#0#2026-09-16T20:00:00.000Z", SK: "LEASE", status: "COMPLETED", version: 14 };
    await store.update(lease);
    expect(await recoverExpiredClaims(deps, [candidate])).toBe(1);
    expect(await store.get(candidate)).toMatchObject({ status: "CLAIMED", version: 3, claimExpiresAt: "2026-09-16T22:02:00.000Z", GSI6PK: "WORKSTATE#CLAIMED" });
    const outbox = store.allItems().filter(x => x["entityType"] === "OutboxEvent");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ destination, status: "PENDING", aggregateVersion: 3, payload: { data: { occurrenceVersion: 3 } } });
    expect(await store.get(lease)).toEqual(lease);
    // Replaying the old GSI6 candidate rereads the renewed claim and cannot publish again.
    expect(await recoverExpiredClaims(deps, [candidate])).toBe(0);
  });

  // G-V3: dropping the version fence permits two recovery outboxes for concurrent renewals.
  it("concurrent recovery creates one outbox and one version transition", async () => {
    const { store, deps, candidate } = setup();
    await store.update(candidate);
    const results = await Promise.all([recoverExpiredClaims(deps, [candidate]), recoverExpiredClaims(deps, [candidate])]);
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(store.allItems().filter(x => x["entityType"] === "OutboxEvent")).toHaveLength(1);
    expect((await store.get(candidate))?.["version"]).toBe(3);
  });

  // G-V3: trusting the candidate image revives a claim that dispatch already completed.
  it("does not recover a stale candidate whose current occurrence is TRIGGERED", async () => {
    const { store, deps, candidate } = setup();
    await store.update({ ...candidate, status: "TRIGGERED", version: 3 });
    expect(await recoverExpiredClaims(deps, [candidate])).toBe(0);
    expect(store.allItems().filter(x => x["entityType"] === "OutboxEvent")).toHaveLength(0);
  });

  // G-V3: classifying any transaction cancellation as a successful race loses transient/permanent failures.
  it.each([undefined, ["TransactionConflict", "None"], ["ProvisionedThroughputExceeded", "None"],
    ["ValidationError", "None"], ["ConditionalCheckFailed", "TransactionConflict"], ["None", "ConditionalCheckFailed"]])(
    "preserves cancellation reasons %j for caller retry in both claim helpers", async (codes) => {
      const { store, deps, candidate } = setup();
      await store.update({ ...candidate, status: "SCHEDULED" });
      const failure = { name: "TransactionCanceledException", CancellationReasons: codes?.map(Code => ({ Code })) };
      const failedDeps = { ...deps, store: { get: store.get.bind(store), transactWrite: async () => { throw failure; } } };
      await expect(claimReminderOccurrence(failedDeps, candidate, candidate.tenantId)).rejects.toBe(failure);
      expect((await store.get(candidate))?.["status"]).toBe("SCHEDULED");
    },
  );

  // G-V3: writing claim renewal separately from the outbox makes the retry unable to rediscover expired work.
  it("a failed recovery transaction leaves the expired claim discoverable and a later retry succeeds", async () => {
    const { store, deps, candidate } = setup();
    await store.update(candidate);
    const failure = new Error("network unavailable");
    await expect(recoverExpiredClaims({ ...deps, store: { get: store.get.bind(store), transactWrite: async () => { throw failure; } } }, [candidate])).rejects.toBe(failure);
    expect(await store.get(candidate)).toEqual(candidate);
    expect(await recoverExpiredClaims(deps, [candidate])).toBe(1);
  });
});
