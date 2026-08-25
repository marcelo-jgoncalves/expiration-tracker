/**
 * reminder-materialization-trigger — BLOCKER-B end-to-end trigger coverage
 * (reminder-delivery-pipeline.md, Codex Round H APPROVED 9.2/10). Covers every scenario
 * the review rounds (B through H) demanded: materialization, duplicate-materialization
 * idempotency, disabled policy, archived item, renewal cycle semantics, policy-version/
 * disable staleness, tenant isolation, orphaned pointers, and the A->B->A out-of-order +
 * true-concurrency policy-move races that took three rounds (E/F/G) to close in the design.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryReminderStore, makeReminderIdGenerator } from "./in-memory-store.js";
import { ReminderPolicyService } from "../../../src/modules/reminder/application/reminder-policy-service.js";
import { ExpirationService } from "../../../src/modules/expiration/application/expiration-service.js";
import { InMemoryExpirationStore, makeExpirationIdGenerator } from "../expiration/in-memory-store.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import { handleTriggerEvent, type TriggerDeps } from "../../../src/workers/reminder-materialization-trigger/trigger.js";
import type { ReminderOccurrence } from "../../../src/modules/reminder/domain/reminder-occurrence.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { itemKey } from "../../../src/modules/expiration/domain/expiration-item.js";
import { policyKey } from "../../../src/modules/reminder/domain/reminder-policy.js";

const TENANT = "t1";
const TABLE = "MainTable";
const NOW = "2026-08-01T00:00:00.000Z";
const RULE = { name: "7 days before", triggers: [{ triggerId: "trig1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo", channels: ["EMAIL" as const] };

function contextFor(tenantId: string): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-user-1", sessionId: "session-1" },
    tenant: { tenantId, roles: ["OWNER"] },
    auth: { issuedAt: NOW, expiresAt: NOW, tokenId: "jti-1" },
  };
}

/**
 * Because ExpirationService and ReminderPolicyService/materializer each have their OWN
 * store port (they're different modules, deliberately not sharing a data-access
 * abstraction), but this worker (like dispatch.ts and reconciliation.ts) reads
 * ExpirationItem rows through the ReminderStore's generic get() - this fixture keeps ONE
 * InMemoryReminderStore as the source of truth and mirrors every ExpirationService write
 * into it too, so the trigger worker (which only ever sees the ReminderStore) observes
 * exactly what a real single DynamoDB table would show it.
 */
class MirroredExpirationStore extends InMemoryExpirationStore {
  constructor(private readonly mirror: InMemoryReminderStore) {
    super();
  }
  override async putIfAbsent<T extends { PK: string; SK: string }>(item: T): Promise<boolean> {
    await this.mirror.putIfAbsent(item);
    return super.putIfAbsent(item);
  }
  override async update<T extends { PK: string; SK: string }>(item: T): Promise<void> {
    await this.mirror.update(item);
    return super.update(item);
  }
  override async transactWrite(entries: Parameters<InMemoryExpirationStore["transactWrite"]>[0]): Promise<void> {
    await this.mirror.transactWrite(entries as unknown as Parameters<InMemoryReminderStore["transactWrite"]>[0]);
    return super.transactWrite(entries);
  }
}

describe("reminder-materialization-trigger", () => {
  let store: InMemoryReminderStore;
  let expirationStore: MirroredExpirationStore;
  let expirationService: ExpirationService;
  let policyService: ReminderPolicyService;
  let deps: TriggerDeps;
  let ctx: RequestContext;

  beforeEach(() => {
    store = new InMemoryReminderStore();
    expirationStore = new MirroredExpirationStore(store);
    // A monotonically-advancing clock (not a fixed NOW) shared by both services: with a
    // fixed clock, ExpirationService's and ReminderPolicyService's independent id-generator
    // counters (test/unit/expiration/in-memory-store.ts and ./in-memory-store.ts each keep
    // their OWN module-level counter) can coincidentally produce the identical eventId
    // string (e.g. both generators' 2nd draw is "evt-2") - with occurredAt also identical,
    // their outbox records collide on the exact same PK/SK in this shared mirrored store.
    // Real production event ids are collision-resistant (not small sequential counters
    // shared naively across independently-imported modules), so this is a test-fixture
    // concern only, not a product bug - a real, always-advancing clock sidesteps it the
    // same way it would in production.
    let clock = Date.parse(NOW);
    const advancingNow = () => new Date((clock += 1)).toISOString();
    expirationService = new ExpirationService({ store: expirationStore, tableName: TABLE, ids: makeExpirationIdGenerator(), now: advancingNow });
    policyService = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now: advancingNow });
    deps = { store, tableName: TABLE, now: () => NOW, shardConfig: defaultShardConfig() };
    ctx = contextFor(TENANT);
  });

  async function liveOccurrences(itemId: string): Promise<ReminderOccurrence[]> {
    return (await store.queryByItem<ReminderOccurrence>(TENANT, itemId)) as ReminderOccurrence[];
  }

  describe("ITEM_DUE_DATE_CHANGED", () => {
    it("materializes a real occurrence for a policy attached to a brand-new item", async () => {
      const item = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      await policyService.createPolicy(ctx, { scope: "ITEM", itemId: item.itemId, rule: RULE });

      const result = await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: item.itemId });

      expect(result.materialized).toBe(1);
      const occs = await liveOccurrences(item.itemId);
      expect(occs).toHaveLength(1);
      expect(occs[0]?.status).toBe("SCHEDULED");
    });

    it("is idempotent: processing the same event twice does not duplicate the occurrence", async () => {
      const item = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      await policyService.createPolicy(ctx, { scope: "ITEM", itemId: item.itemId, rule: RULE });

      await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: item.itemId });
      await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: item.itemId });

      expect(await liveOccurrences(item.itemId)).toHaveLength(1);
    });

    it("does not materialize anything for a disabled policy", async () => {
      const item = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      await policyService.createPolicy(ctx, { scope: "ITEM", itemId: item.itemId, rule: RULE, enabled: false });

      const result = await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: item.itemId });

      expect(result.materialized).toBe(0);
      expect(await liveOccurrences(item.itemId)).toHaveLength(0);
    });

    it("does not materialize for an archived item (defensive - treats it as item-deactivated)", async () => {
      const item = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      await policyService.createPolicy(ctx, { scope: "ITEM", itemId: item.itemId, rule: RULE });
      await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: item.itemId });
      await expirationService.archiveItem(ctx, item.itemId, item.version);

      const result = await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: item.itemId });

      expect(result.materialized).toBe(0);
      const occs = await liveOccurrences(item.itemId);
      expect(occs.every((o) => o.status === "CANCELLED")).toBe(true);
    });

    it("skips (does not crash on) an orphaned pointer whose policy no longer exists/matches", async () => {
      const item = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      // Write an orphaned pointer directly - no real policy behind it.
      await store.putIfAbsent({ PK: itemKey(TENANT, item.itemId).PK, SK: "POLICYREF#ghost-policy", entityType: "ReminderPolicyRef", policyId: "ghost-policy" });

      const result = await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: item.itemId });

      expect(result.skippedOrphanedPointers).toBe(1);
      expect(result.materialized).toBe(0);
    });

    it("does not cross tenants - an item-due-date-changed event for t1 never touches t2's occurrences", async () => {
      const ctx2 = contextFor("t2");
      const item1 = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      await policyService.createPolicy(ctx, { scope: "ITEM", itemId: item1.itemId, rule: RULE });

      const expirationService2 = new ExpirationService({ store: expirationStore, tableName: TABLE, ids: makeExpirationIdGenerator(), now: () => NOW });
      const policyService2 = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now: () => NOW });
      const item2 = await expirationService2.createItem(ctx2, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      await policyService2.createPolicy(ctx2, { scope: "ITEM", itemId: item2.itemId, rule: RULE });

      await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: item1.itemId });

      expect(await liveOccurrences(item1.itemId)).toHaveLength(1);
      const t2Occs = (await store.queryByItem<ReminderOccurrence>("t2", item2.itemId)) as ReminderOccurrence[];
      expect(t2Occs).toHaveLength(0); // never touched by the t1 event
    });
  });

  describe("ITEM_DEACTIVATED", () => {
    it("cancels every live occurrence for the item, across all policies", async () => {
      const item = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      await policyService.createPolicy(ctx, { scope: "ITEM", itemId: item.itemId, rule: RULE });
      await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: item.itemId });

      const result = await handleTriggerEvent(deps, { kind: "ITEM_DEACTIVATED", tenantId: TENANT, itemId: item.itemId });

      expect(result.cancelledUnconditionally).toBe(1);
      expect((await liveOccurrences(item.itemId))[0]?.status).toBe("CANCELLED");
    });
  });

  describe("renewal cycle semantics", () => {
    it("archiving the old item's occurrences via item-deactivated, then the new item gets its OWN fresh occurrence once its own policy is attached", async () => {
      const source = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      await policyService.createPolicy(ctx, { scope: "ITEM", itemId: source.itemId, rule: RULE });
      await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: source.itemId });
      expect(await liveOccurrences(source.itemId)).toHaveLength(1);

      const renewed = await expirationService.renewItem(ctx, source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version);

      // Old item side: item-deactivated cancels its live occurrence (real deploy would fire
      // this from the outbox event completeRenewal already emits).
      await handleTriggerEvent(deps, { kind: "ITEM_DEACTIVATED", tenantId: TENANT, itemId: source.itemId });
      const oldOccs = await liveOccurrences(source.itemId);
      expect(oldOccs.every((o) => o.status === "CANCELLED")).toBe(true);

      // New item: per the approved design (§8), policies are NOT auto-copied on renewal -
      // the new item has zero policies until one is explicitly attached, so its own
      // due-date-changed event materializes nothing yet.
      const noPolicyResult = await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: renewed.itemId });
      expect(noPolicyResult.materialized).toBe(0);

      // Once a policy IS attached to the renewed item, it materializes independently of
      // the old (cancelled) cycle.
      await policyService.createPolicy(ctx, { scope: "ITEM", itemId: renewed.itemId, rule: RULE });
      const result = await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: renewed.itemId });
      expect(result.materialized).toBe(1);
      expect((await liveOccurrences(renewed.itemId))[0]?.status).toBe("SCHEDULED");
    });
  });

  describe("policy update semantics (staleness/disable)", () => {
    it("a policy-changed event after a policy edit cancels the old-version occurrence and materializes the new one", async () => {
      const item = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      const policy = await policyService.createPolicy(ctx, { scope: "ITEM", itemId: item.itemId, rule: RULE });
      await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: item.itemId });
      expect(await liveOccurrences(item.itemId)).toHaveLength(1);

      const newRule = { ...RULE, triggers: [{ triggerId: "trig2", offsetIso: "-P3D", localTime: "09:00" }] };
      await policyService.updatePolicy(ctx, policy.policyId, { scope: "ITEM", itemId: item.itemId, rule: newRule }, 1);

      const result = await handleTriggerEvent(deps, { kind: "POLICY_CHANGED", tenantId: TENANT, policyId: policy.policyId, itemId: item.itemId, previousItemId: null });

      expect(result.reconciled).toBe(1); // old-version occurrence cancelled
      expect(result.materialized).toBe(1); // new-version occurrence created
      const occs = await liveOccurrences(item.itemId);
      expect(occs.filter((o) => o.status === "SCHEDULED")).toHaveLength(1);
      expect(occs.filter((o) => o.status === "CANCELLED")).toHaveLength(1);
    });

    it("disabling a policy cancels its already-materialized occurrence", async () => {
      const item = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      const policy = await policyService.createPolicy(ctx, { scope: "ITEM", itemId: item.itemId, rule: RULE });
      await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: item.itemId });

      await policyService.disablePolicy(ctx, policy.policyId, 1);
      const result = await handleTriggerEvent(deps, { kind: "POLICY_CHANGED", tenantId: TENANT, policyId: policy.policyId, itemId: item.itemId, previousItemId: null });

      expect(result.reconciled).toBe(1);
      expect(result.materialized).toBe(0);
      expect((await liveOccurrences(item.itemId))[0]?.status).toBe("CANCELLED");
    });
  });

  describe("policy move — out-of-order and true concurrency (Codex Round E/F/G)", () => {
    it("A->B->A processed out of order: the delayed A->B event never cancels the currently-valid A occurrence", async () => {
      const itemA = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      const itemB = await expirationService.createItem(ctx, { name: "b", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      const policy = await policyService.createPolicy(ctx, { scope: "ITEM", itemId: itemA.itemId, rule: RULE });
      await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: itemA.itemId });
      expect(await liveOccurrences(itemA.itemId)).toHaveLength(1);

      // Move A -> B (produces the "delayed" event, processed LAST below).
      await policyService.updatePolicy(ctx, policy.policyId, { scope: "ITEM", itemId: itemB.itemId, rule: RULE }, 1);
      const aToBEvent = { kind: "POLICY_CHANGED" as const, tenantId: TENANT, policyId: policy.policyId, itemId: itemB.itemId, previousItemId: itemA.itemId };

      // Move B -> A (processed FIRST - simulates B->A's event arriving/being processed
      // before the delayed A->B event above, even though A->B was produced first).
      await policyService.updatePolicy(ctx, policy.policyId, { scope: "ITEM", itemId: itemA.itemId, rule: RULE }, 2);
      const bToAEvent = { kind: "POLICY_CHANGED" as const, tenantId: TENANT, policyId: policy.policyId, itemId: itemA.itemId, previousItemId: itemB.itemId };

      await handleTriggerEvent(deps, bToAEvent); // processed first: restores A as current, materializes there
      const afterBToA = await liveOccurrences(itemA.itemId);
      expect(afterBToA.some((o) => o.status === "SCHEDULED")).toBe(true);

      await handleTriggerEvent(deps, aToBEvent); // the delayed A->B event, processed last

      // The currently-valid A occurrence must NOT have been cancelled by the delayed event.
      const afterDelayed = await liveOccurrences(itemA.itemId);
      expect(afterDelayed.some((o) => o.status === "SCHEDULED")).toBe(true);
    });

    it("true concurrency: reconcilePolicyOccurrencesUnconditionally is fenced, so a policy move landing mid-reconcile does not cancel a currently-valid occurrence", async () => {
      const itemA = await expirationService.createItem(ctx, { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      const itemB = await expirationService.createItem(ctx, { name: "b", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
      const policy = await policyService.createPolicy(ctx, { scope: "ITEM", itemId: itemA.itemId, rule: RULE });
      await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: itemA.itemId });

      // Move A -> B, producing a stale worker's own read of the policy (still targeting B).
      await policyService.updatePolicy(ctx, policy.policyId, { scope: "ITEM", itemId: itemB.itemId, rule: RULE }, 1);
      const staleReadOfPolicy = await store.get<import("../../../src/modules/reminder/domain/reminder-policy.js").ReminderPolicy>(policyKey(TENANT, policy.policyId));

      // Simulate the policy moving AGAIN (B -> A) after the stale worker's read but before
      // its fenced cancellation would commit - directly exercising the materializer's own
      // fence (reminder-materializer.test.ts covers this at the unit level; this proves the
      // trigger worker's onPolicyChanged wiring doesn't bypass it).
      await policyService.updatePolicy(ctx, policy.policyId, { scope: "ITEM", itemId: itemA.itemId, rule: RULE }, 2);
      await handleTriggerEvent(deps, { kind: "ITEM_DUE_DATE_CHANGED", tenantId: TENANT, itemId: itemA.itemId }); // re-materializes on A with the now-current policy

      const { ReminderMaterializer } = await import("../../../src/modules/reminder/application/reminder-materializer.js");
      const materializer = new ReminderMaterializer(store, TABLE, () => NOW);
      const cancelled = await materializer.reconcilePolicyOccurrencesUnconditionally({ tenantId: TENANT, itemId: itemA.itemId, policy: staleReadOfPolicy! });

      expect(cancelled).toBe(0); // fence rejected it - store is already past staleReadOfPolicy's version
      expect((await liveOccurrences(itemA.itemId)).some((o) => o.status === "SCHEDULED")).toBe(true);
    });
  });
});
