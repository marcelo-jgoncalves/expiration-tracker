import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryReminderStore } from "./in-memory-store.js";
import { ReminderMaterializer } from "../../../src/modules/reminder/application/reminder-materializer.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import { policyKey, type ReminderPolicy } from "../../../src/modules/reminder/domain/reminder-policy.js";
import type { ReminderOccurrence } from "../../../src/modules/reminder/domain/reminder-occurrence.js";

function policy(overrides: Partial<ReminderPolicy> = {}): ReminderPolicy {
  const tenantId = overrides.tenantId ?? "t1";
  const policyId = overrides.policyId ?? "p1";
  return {
    ...policyKey(tenantId, policyId), // derives PK from the final tenantId/policyId, not hardcoded -
    // a fixed PK here would make two policy() calls with different policyId overrides
    // silently collide on the same store row (real bug this test file hit once).
    entityType: "ReminderPolicy",
    policyId,
    tenantId,
    scope: "ITEM",
    itemId: "item1",
    name: "7 days before",
    triggers: [{ triggerId: "trig1", offsetIso: "-P7D", localTime: "09:00" }],
    timeZone: "America/Sao_Paulo",
    channels: ["EMAIL"],
    enabled: true,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ReminderMaterializer (implementation-blueprint.md §9.2)", () => {
  let store: InMemoryReminderStore;
  let materializer: ReminderMaterializer;

  beforeEach(() => {
    store = new InMemoryReminderStore();
    materializer = new ReminderMaterializer(store, "MainTable", () => "2026-08-01T00:00:00.000Z");
  });

  it("materializes one occurrence per trigger with correct GSI3 keys", async () => {
    const result = await materializer.materialize({
      tenantId: "t1",
      itemId: "item1",
      itemVersion: 1,
      itemDueDate: "2026-09-10",
      policy: policy(),
      shardConfig: defaultShardConfig(),
    });

    expect(result.created).toHaveLength(1);
    const occ = result.created[0]!;
    expect(occ.status).toBe("SCHEDULED");
    expect(occ.scheduledAt).toBe("2026-09-03T12:00:00.000Z"); // 7 days before 09-10, 09:00 -03:00
    expect(occ.GSI3PK).toBe("DUE#202609031200#" + occ.shard);
    expect(occ.GSI3SK).toBe("TENANT#t1#OCCURRENCE#" + occ.occurrenceId);
  });

  it("is idempotent: calling materialize twice for the same (itemVersion, policyVersion) creates nothing new", async () => {
    const input = {
      tenantId: "t1",
      itemId: "item1",
      itemVersion: 1,
      itemDueDate: "2026-09-10",
      policy: policy(),
      shardConfig: defaultShardConfig(),
    };
    const first = await materializer.materialize(input);
    const second = await materializer.materialize(input);
    expect(first.created).toHaveLength(1);
    expect(second.created).toHaveLength(0);
    expect(second.skippedExisting).toBe(1);
  });

  it("does not materialize anything for a disabled policy", async () => {
    const result = await materializer.materialize({
      tenantId: "t1",
      itemId: "item1",
      itemVersion: 1,
      itemDueDate: "2026-09-10",
      policy: policy({ enabled: false }),
      shardConfig: defaultShardConfig(),
    });
    expect(result.created).toHaveLength(0);
  });

  it("cancelStaleOccurrences cancels only SCHEDULED/CLAIMED occurrences from an older itemVersion, leaving current-version ones untouched", async () => {
    await materializer.materialize({
      tenantId: "t1",
      itemId: "item1",
      itemVersion: 1,
      itemDueDate: "2026-09-10",
      policy: policy(),
      shardConfig: defaultShardConfig(),
    });
    await materializer.materialize({
      tenantId: "t1",
      itemId: "item1",
      itemVersion: 2,
      itemDueDate: "2026-10-01",
      policy: policy(),
      shardConfig: defaultShardConfig(),
    });

    const cancelled = await materializer.cancelStaleOccurrences({ tenantId: "t1", itemId: "item1", currentItemVersion: 2 });
    expect(cancelled).toBe(1);

    const all = (await store.queryByItem<ReminderOccurrence>("t1", "item1")) as ReminderOccurrence[];
    const v1 = all.find((o) => o.itemVersion === 1)!;
    const v2 = all.find((o) => o.itemVersion === 2)!;
    expect(v1.status).toBe("CANCELLED");
    expect(v2.status).toBe("SCHEDULED");
  });

  describe("BLOCKER-B: reconcilePolicyOccurrences (current-target reconcile, policy-version fenced)", () => {
    it("cancels occurrences from a stale policy version, leaving current-version ones untouched", async () => {
      const v1 = policy({ version: 1 });
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: v1, shardConfig: defaultShardConfig() });

      const v2 = policy({ version: 2 });
      await store.putIfAbsent(v2); // policy row must exist for the ConditionCheck fence
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: v2, shardConfig: defaultShardConfig() });

      const cancelled = await materializer.reconcilePolicyOccurrences({ tenantId: "t1", itemId: "item1", policy: v2 });
      expect(cancelled).toBe(1);

      const all = (await store.queryByItem<ReminderOccurrence>("t1", "item1")) as ReminderOccurrence[];
      const stale = all.find((o) => o.policyVersion === 1)!;
      const current = all.find((o) => o.policyVersion === 2)!;
      expect(stale.status).toBe("CANCELLED");
      expect(current.status).toBe("SCHEDULED");
    });

    it("cancels occurrences when the policy is disabled, even at the same version", async () => {
      const enabledPolicy = policy({ version: 1, enabled: true });
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: enabledPolicy, shardConfig: defaultShardConfig() });

      const disabledPolicy = policy({ version: 1, enabled: false });
      await store.putIfAbsent(disabledPolicy);

      const cancelled = await materializer.reconcilePolicyOccurrences({ tenantId: "t1", itemId: "item1", policy: disabledPolicy });
      expect(cancelled).toBe(1);
    });

    it("does not cancel anything when the persisted policy version no longer matches what the caller read (fence rejects the stale cancel)", async () => {
      const v1 = policy({ version: 1 });
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: v1, shardConfig: defaultShardConfig() });

      const v2 = policy({ version: 2 });
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: v2, shardConfig: defaultShardConfig() });

      // Caller believes the policy is still at v2 (its own in-memory snapshot from a read
      // moments ago), but the store now holds v3 - simulating a policy update that
      // committed in the real gap between the caller's read and this call.
      const v3 = policy({ version: 3 });
      await store.update(v3);

      const cancelled = await materializer.reconcilePolicyOccurrences({ tenantId: "t1", itemId: "item1", policy: v2 });
      expect(cancelled).toBe(0); // fence rejected every attempt - store still at v3, not v2

      const all = (await store.queryByItem<ReminderOccurrence>("t1", "item1")) as ReminderOccurrence[];
      expect(all.every((o) => o.status === "SCHEDULED")).toBe(true); // nothing was wrongly cancelled
    });

    it("rethrows (does not silently swallow) a transaction cancellation unrelated to the occurrence/policy-fence conditions - e.g. throttling", async () => {
      const v1 = policy({ version: 1 });
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: v1, shardConfig: defaultShardConfig() });

      // Wraps the real store so the cancellation reasons show something OTHER than the
      // occurrence's own condition (index 0) or the policy fence (index 1) failing -
      // simulating a genuine unrelated cancellation (throttling, an unclassified reason)
      // that must be retried by the caller, never mistaken for one of the two expected
      // safe races (Codex implementation-review finding: this exact class of bug was
      // already fixed twice in dispatch.ts before being found here too).
      const throttlingStore: typeof store = Object.assign(Object.create(Object.getPrototypeOf(store)), store, {
        transactWrite: async () => {
          throw { name: "TransactionCanceledException", message: "Throttled", CancellationReasons: [{ Code: "None" }, { Code: "ThrottlingException" }] };
        },
      });
      const throttledMaterializer = new ReminderMaterializer(throttlingStore, "MainTable", () => "2026-08-01T00:00:00.000Z");

      // reconcilePolicyOccurrencesUnconditionally's shouldCancel is always true, so it's
      // guaranteed to attempt (and thus hit the stubbed throw on) the freshly-materialized
      // occurrence, unlike reconcilePolicyOccurrences which would correctly skip it (same
      // version, still enabled - nothing stale to cancel).
      await expect(throttledMaterializer.reconcilePolicyOccurrencesUnconditionally({ tenantId: "t1", itemId: "item1", policy: v1 })).rejects.toMatchObject({ message: "Throttled" });
    });
  });

  describe("BLOCKER-B: reconcilePolicyOccurrencesUnconditionally (non-current-target partition, policy-version fenced)", () => {
    it("cancels every live occurrence for the policy under the item, regardless of version", async () => {
      const v1 = policy({ version: 1 });
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: v1, shardConfig: defaultShardConfig() });
      const v2 = policy({ version: 2 });
      await store.putIfAbsent(v2);
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: v2, shardConfig: defaultShardConfig() });

      const cancelled = await materializer.reconcilePolicyOccurrencesUnconditionally({ tenantId: "t1", itemId: "item1", policy: v2 });
      expect(cancelled).toBe(2); // both versions cancelled - this item is no longer this policy's target at all

      const all = (await store.queryByItem<ReminderOccurrence>("t1", "item1")) as ReminderOccurrence[];
      expect(all.every((o) => o.status === "CANCELLED")).toBe(true);
    });

    it("is fenced: a concurrently-moved policy (version mismatch) aborts every cancellation attempt", async () => {
      const v1 = policy({ version: 1 });
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: v1, shardConfig: defaultShardConfig() });
      const v2 = policy({ version: 2 });
      await store.update(v2); // store now at v2, but caller's snapshot below is still v1

      const cancelled = await materializer.reconcilePolicyOccurrencesUnconditionally({ tenantId: "t1", itemId: "item1", policy: v1 });
      expect(cancelled).toBe(0);

      const all = (await store.queryByItem<ReminderOccurrence>("t1", "item1")) as ReminderOccurrence[];
      expect(all.every((o) => o.status === "SCHEDULED")).toBe(true);
    });

    it("only touches occurrences for the given policyId, leaving other policies' occurrences on the same item alone", async () => {
      const policyA = policy({ policyId: "pA", version: 1 });
      const policyB = policy({ policyId: "pB", version: 1, triggers: [{ triggerId: "trigB", offsetIso: "-P3D", localTime: "10:00" }] });
      await store.putIfAbsent(policyA);
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: policyA, shardConfig: defaultShardConfig() });
      await store.putIfAbsent(policyB);
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: policyB, shardConfig: defaultShardConfig() });

      const cancelled = await materializer.reconcilePolicyOccurrencesUnconditionally({ tenantId: "t1", itemId: "item1", policy: policyA });
      expect(cancelled).toBe(1);

      const all = (await store.queryByItem<ReminderOccurrence>("t1", "item1")) as ReminderOccurrence[];
      expect(all.find((o) => o.policyId === "pA")!.status).toBe("CANCELLED");
      expect(all.find((o) => o.policyId === "pB")!.status).toBe("SCHEDULED");
    });
  });

  describe("BLOCKER-B: cancelAllOccurrences (item-deactivated - archive/delete/renewal-old-side)", () => {
    it("cancels every live occurrence for the item, across all policies, unconditionally", async () => {
      const policyA = policy({ policyId: "pA" });
      const policyB = policy({ policyId: "pB", triggers: [{ triggerId: "trigB", offsetIso: "-P3D", localTime: "10:00" }] });
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: policyA, shardConfig: defaultShardConfig() });
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: policyB, shardConfig: defaultShardConfig() });

      const cancelled = await materializer.cancelAllOccurrences({ tenantId: "t1", itemId: "item1" });
      expect(cancelled).toBe(2);

      const all = (await store.queryByItem<ReminderOccurrence>("t1", "item1")) as ReminderOccurrence[];
      expect(all.every((o) => o.status === "CANCELLED")).toBe(true);
    });

    it("rethrows a transaction cancellation unrelated to the occurrence's own condition, rather than silently swallowing it", async () => {
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: policy(), shardConfig: defaultShardConfig() });

      const throttlingStore: typeof store = Object.assign(Object.create(Object.getPrototypeOf(store)), store, {
        transactWrite: async () => {
          throw { name: "TransactionCanceledException", message: "Throttled", CancellationReasons: [{ Code: "ThrottlingException" }] };
        },
      });
      const throttledMaterializer = new ReminderMaterializer(throttlingStore, "MainTable", () => "2026-08-01T00:00:00.000Z");

      await expect(throttledMaterializer.cancelAllOccurrences({ tenantId: "t1", itemId: "item1" })).rejects.toMatchObject({ message: "Throttled" });
    });

    it("does not touch occurrences already DELIVERED/TRIGGERED/CANCELLED", async () => {
      const result = await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: policy(), shardConfig: defaultShardConfig() });
      const occ = result.created[0]!;
      await store.update({ ...occ, status: "TRIGGERED" });

      const cancelled = await materializer.cancelAllOccurrences({ tenantId: "t1", itemId: "item1" });
      expect(cancelled).toBe(0);

      const all = (await store.queryByItem<ReminderOccurrence>("t1", "item1")) as ReminderOccurrence[];
      expect(all[0]!.status).toBe("TRIGGERED"); // untouched
    });

    it("does not cross tenants - cancelling item1 in t1 never touches item1 in t2", async () => {
      await materializer.materialize({ tenantId: "t1", itemId: "item1", itemVersion: 1, itemDueDate: "2026-09-10", policy: policy(), shardConfig: defaultShardConfig() });
      await materializer.materialize({
        tenantId: "t2",
        itemId: "item1",
        itemVersion: 1,
        itemDueDate: "2026-09-10",
        policy: policy({ tenantId: "t2", PK: "TENANT#t2#POLICY#p1" }),
        shardConfig: defaultShardConfig(),
      });

      await materializer.cancelAllOccurrences({ tenantId: "t1", itemId: "item1" });

      const t1Occ = (await store.queryByItem<ReminderOccurrence>("t1", "item1")) as ReminderOccurrence[];
      const t2Occ = (await store.queryByItem<ReminderOccurrence>("t2", "item1")) as ReminderOccurrence[];
      expect(t1Occ[0]!.status).toBe("CANCELLED");
      expect(t2Occ[0]!.status).toBe("SCHEDULED");
    });
  });

  describe("M3.5: GSI6 WORKSTATE#DST_PENDING pointer lifecycle", () => {
    it("sets a GSI6 pointer only for a trigger whose schedule lands on a DST-ambiguous/nonexistent local time", async () => {
      // America/New_York 2026-03-08 02:30 is the US spring-forward gap (NONEXISTENT).
      const dstPolicy = policy({
        timeZone: "America/New_York",
        triggers: [{ triggerId: "trig1", offsetIso: "P0D", localTime: "02:30" }],
      });
      const result = await materializer.materialize({
        tenantId: "t1",
        itemId: "item1",
        itemVersion: 1,
        itemDueDate: "2026-03-08",
        policy: dstPolicy,
        shardConfig: defaultShardConfig(),
      });
      const occ = result.created[0]!;
      expect(occ.GSI6PK).toBe("WORKSTATE#DST_PENDING");
      expect(occ.GSI6SK).toBe(`${occ.scheduledAt}#TENANT#t1#OCCURRENCE#${occ.occurrenceId}`);
    });

    it("does NOT set a GSI6 pointer for a normal (non-DST-boundary) schedule", async () => {
      const result = await materializer.materialize({
        tenantId: "t1",
        itemId: "item1",
        itemVersion: 1,
        itemDueDate: "2026-09-10",
        policy: policy(), // America/Sao_Paulo, fixed offset, always NORMAL
        shardConfig: defaultShardConfig(),
      });
      const occ = result.created[0]!;
      expect(occ.GSI6PK).toBeUndefined();
      expect(occ.GSI6SK).toBeUndefined();
    });

    it("removes the GSI6 pointer when cancelStaleOccurrences cancels the occurrence", async () => {
      const dstPolicy = policy({
        timeZone: "America/New_York",
        triggers: [{ triggerId: "trig1", offsetIso: "P0D", localTime: "02:30" }],
      });
      await materializer.materialize({
        tenantId: "t1",
        itemId: "item1",
        itemVersion: 1,
        itemDueDate: "2026-03-08",
        policy: dstPolicy,
        shardConfig: defaultShardConfig(),
      });
      await materializer.materialize({
        tenantId: "t1",
        itemId: "item1",
        itemVersion: 2,
        itemDueDate: "2026-04-01",
        policy: dstPolicy,
        shardConfig: defaultShardConfig(),
      });

      await materializer.cancelStaleOccurrences({ tenantId: "t1", itemId: "item1", currentItemVersion: 2 });

      const all = (await store.queryByItem<ReminderOccurrence>("t1", "item1")) as ReminderOccurrence[];
      const cancelled = all.find((o) => o.itemVersion === 1)!;
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.GSI6PK).toBeUndefined();
      expect(cancelled.GSI6SK).toBeUndefined();
      // Full-audit round1 (Arquitetura, Data Model & Consistency) fix: GSI3 pointer must
      // also be removed on cancellation, not just GSI6 - see reminder-materializer.ts.
      expect(cancelled.GSI3PK).toBeUndefined();
      expect(cancelled.GSI3SK).toBeUndefined();
    });
  });
});
