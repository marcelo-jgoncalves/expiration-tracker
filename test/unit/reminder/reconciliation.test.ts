/**
 * Dedicated unit coverage for reconciliation.ts (implementation-blueprint.md §9.5), closing
 * a real gap found in the Engineering Maturity Review (2026-08-19, Checkpoint 2-9): claim-
 * expiry reconciliation had scenario coverage only inside the M3 integration test, and
 * `reconcileDst` (the DST-affected re-evaluation pass) had ZERO coverage anywhere, direct or
 * indirect - not even imported outside reconciliation.ts itself. This is the "replay/
 * reconciliation são testados" evidence gate G8 depends on.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryReminderStore, makeReminderIdGenerator } from "./in-memory-store.js";
import { ReminderPolicyService } from "../../../src/modules/reminder/application/reminder-policy-service.js";
import { ReminderMaterializer } from "../../../src/modules/reminder/application/reminder-materializer.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import { reconcileExpiredClaims, reconcileDst } from "../../../src/workers/reminder-reconciliation/reconciliation.js";
import { occurrenceKey, gsi3Keys, type ReminderOccurrence } from "../../../src/modules/reminder/domain/reminder-occurrence.js";
import { itemKey } from "../../../src/modules/expiration/domain/expiration-item.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

function contextFor(tenantId: string, userId: string): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId, cognitoSubject: `sub-${userId}`, sessionId: "session-1" },
    tenant: { tenantId, roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
  };
}

describe("reconciliation.ts", () => {
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

  describe("reconcileExpiredClaims", () => {
    it("does not touch a CLAIMED occurrence whose claimExpiresAt has not passed yet", async () => {
      const occurrence: ReminderOccurrence = {
        PK: `TENANT#${TENANT}#ITEM#${ITEM_ID}`,
        SK: "OCC#2026-09-10T08:00:00.000Z#occ1",
        entityType: "ReminderOccurrence",
        occurrenceId: "occ1",
        tenantId: TENANT,
        itemId: ITEM_ID,
        policyId: "policy1",
        triggerId: "trig1",
        scheduledAt: "2026-09-10T08:00:00.000Z",
        localScheduledAt: "2026-09-10T08:00:00",
        timeZone: "UTC",
        originalRule: { offset: "P0D", localTime: "08:00" },
        itemVersion: 1,
        policyVersion: 1,
        shard: "00",
        shardFnVersion: 1,
        status: "CLAIMED",
        claimedAt: "2026-09-10T08:00:00.000Z",
        claimExpiresAt: "2026-09-10T08:05:00.000Z", // still in the future relative to `now` below
        version: 1,
        createdAt: "2026-09-10T08:00:00.000Z",
        updatedAt: "2026-09-10T08:00:00.000Z",
      };
      await store.putIfAbsent(occurrence);
      clock.current = "2026-09-10T08:02:00.000Z"; // before claimExpiresAt

      const reverted = await reconcileExpiredClaims({ store, tableName: TABLE, now, shardConfig: defaultShardConfig() }, [occurrence]);

      expect(reverted).toBe(0);
      const row = await store.get<ReminderOccurrence>({ PK: occurrence.PK, SK: occurrence.SK });
      expect(row?.status).toBe("CLAIMED");
    });

    it("ignores an occurrence that is not CLAIMED (e.g. already TRIGGERED)", async () => {
      const occurrence: ReminderOccurrence = {
        PK: `TENANT#${TENANT}#ITEM#${ITEM_ID}`,
        SK: "OCC#2026-09-10T08:00:00.000Z#occ2",
        entityType: "ReminderOccurrence",
        occurrenceId: "occ2",
        tenantId: TENANT,
        itemId: ITEM_ID,
        policyId: "policy1",
        triggerId: "trig1",
        scheduledAt: "2026-09-10T08:00:00.000Z",
        localScheduledAt: "2026-09-10T08:00:00",
        timeZone: "UTC",
        originalRule: { offset: "P0D", localTime: "08:00" },
        itemVersion: 1,
        policyVersion: 1,
        shard: "00",
        shardFnVersion: 1,
        status: "TRIGGERED",
        version: 1,
        createdAt: "2026-09-10T08:00:00.000Z",
        updatedAt: "2026-09-10T08:00:00.000Z",
      };
      await store.putIfAbsent(occurrence);
      clock.current = "2026-09-10T09:00:00.000Z";

      const reverted = await reconcileExpiredClaims({ store, tableName: TABLE, now, shardConfig: defaultShardConfig() }, [occurrence]);

      expect(reverted).toBe(0);
      const row = await store.get<ReminderOccurrence>({ PK: occurrence.PK, SK: occurrence.SK });
      expect(row?.status).toBe("TRIGGERED");
    });
  });

  describe("reconcileDst", () => {
    it("cancels a divergent SCHEDULED occurrence and materializes the DST-corrected replacement, leaving TRIGGERED history untouched", async () => {
      // Current policy: 09:00 America/Sao_Paulo.
      const policy = await policies.createPolicy(ctx, {
        scope: "ITEM",
        itemId: ITEM_ID,
        rule: {
          name: "same day 09:00",
          triggers: [{ triggerId: "trig1", offsetIso: "P0D", localTime: "09:00" }],
          timeZone: "America/Sao_Paulo",
          channels: ["EMAIL"],
        },
      });

      // Simulate a legacy occurrence materialized under a rule that has since changed (e.g.
      // an offset/timeZone rule edit, or a DST transition table update) - self-consistent
      // (its SK/occurrenceId match ITS OWN scheduledAt, exactly as the real materializer
      // would have produced at write-time), but at a different instant than what a FRESH
      // recomputation of the CURRENT policy produces. This is the actual shape "drift"
      // takes in production: not a corrupted field, but a stale write under an old rule.
      const staleScheduledAt = "2026-09-10T11:00:00.000Z"; // what the old rule used to compute
      const staleOccurrenceId = "occ_stale_legacy";
      const gsi3 = gsi3Keys({ tenantId: TENANT, occurrenceId: staleOccurrenceId, scheduledAt: staleScheduledAt, shardCount: defaultShardConfig().current.shardCount });
      const stale: ReminderOccurrence = {
        ...occurrenceKey(TENANT, ITEM_ID, staleScheduledAt, staleOccurrenceId),
        entityType: "ReminderOccurrence",
        occurrenceId: staleOccurrenceId,
        tenantId: TENANT,
        itemId: ITEM_ID,
        policyId: policy.policyId,
        triggerId: "trig1",
        scheduledAt: staleScheduledAt,
        localScheduledAt: "2026-09-10T08:00:00",
        timeZone: "America/Sao_Paulo",
        originalRule: { offset: "P0D", localTime: "08:00" },
        itemVersion: 1,
        policyVersion: policy.version,
        shard: gsi3.shard,
        shardFnVersion: 1,
        status: "SCHEDULED",
        version: 1,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        GSI3PK: gsi3.GSI3PK,
        GSI3SK: gsi3.GSI3SK,
      };
      await store.putIfAbsent(stale);

      // reconcileDst's window is [now, now+7d] - advance the clock to within 7 days of the
      // scheduled occurrence (Sep 10), otherwise the trigger falls outside the window and
      // is treated as "not expected" for the wrong reason (masking the real divergence check).
      clock.current = "2026-09-05T00:00:00.000Z";

      const result = await reconcileDst(
        { store, tableName: TABLE, now, shardConfig: defaultShardConfig() },
        [{ tenantId: TENANT, itemId: ITEM_ID, itemVersion: 1, itemDueDate: "2026-09-10T00:00:00.000Z", policy }],
      );

      expect(result.divergences).toBe(1);
      expect(result.cancelled).toBe(1);
      expect(result.created).toBe(1);

      const cancelledRow = await store.get<ReminderOccurrence>({ PK: stale.PK, SK: stale.SK });
      expect(cancelledRow?.status).toBe("CANCELLED");

      const live = (await store.queryByItem<ReminderOccurrence>(TENANT, ITEM_ID)).filter((o) => o.status === "SCHEDULED");
      expect(live).toHaveLength(1);
      expect(live[0]?.scheduledAt).toBe("2026-09-10T12:00:00.000Z"); // freshly recomputed under the CURRENT 09:00 America/Sao_Paulo rule
      expect(live[0]?.occurrenceId).not.toBe(stale.occurrenceId); // a new occurrence, not a mutation of the stale one
    });

    it("is a no-op (idempotent) when the live occurrence already matches the freshly recomputed schedule", async () => {
      const policy = await policies.createPolicy(ctx, {
        scope: "ITEM",
        itemId: ITEM_ID,
        rule: {
          name: "same day 09:00",
          triggers: [{ triggerId: "trig1", offsetIso: "P0D", localTime: "09:00" }],
          timeZone: "America/Sao_Paulo",
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

      clock.current = "2026-09-05T00:00:00.000Z"; // within the 7-day reconciliation window of Sep 10

      const result = await reconcileDst(
        { store, tableName: TABLE, now, shardConfig: defaultShardConfig() },
        [{ tenantId: TENANT, itemId: ITEM_ID, itemVersion: 1, itemDueDate: "2026-09-10T00:00:00.000Z", policy }],
      );

      expect(result.divergences).toBe(0);
      expect(result.cancelled).toBe(0);
      expect(result.created).toBe(0);
    });

    it("skips a disabled policy entirely (no cancellation, no materialization)", async () => {
      const enabled = await policies.createPolicy(ctx, {
        scope: "ITEM",
        itemId: ITEM_ID,
        rule: {
          name: "same day 09:00",
          triggers: [{ triggerId: "trig1", offsetIso: "P0D", localTime: "09:00" }],
          timeZone: "America/Sao_Paulo",
          channels: ["EMAIL"],
        },
      });
      const materializer = new ReminderMaterializer(store, TABLE, now);
      await materializer.materialize({
        tenantId: TENANT,
        itemId: ITEM_ID,
        itemVersion: 1,
        itemDueDate: "2026-09-10T00:00:00.000Z",
        policy: enabled,
        shardConfig: defaultShardConfig(),
      });
      const disabled = { ...enabled, enabled: false };

      const result = await reconcileDst(
        { store, tableName: TABLE, now, shardConfig: defaultShardConfig() },
        [{ tenantId: TENANT, itemId: ITEM_ID, itemVersion: 1, itemDueDate: "2026-09-10T00:00:00.000Z", policy: disabled }],
      );

      expect(result).toEqual({ cancelled: 0, created: 0, divergences: 0 });
    });
  });

  describe("runReconciliation", () => {
    it("runs claim-expiry before DST and aggregates both passes' counters", async () => {
      const { runReconciliation } = await import("../../../src/workers/reminder-reconciliation/reconciliation.js");
      const result = await runReconciliation({ store, tableName: TABLE, now, shardConfig: defaultShardConfig() }, { expiredClaimCandidates: [], dstCandidates: [] });
      expect(result).toEqual({ claimsReverted: 0, dstCancelled: 0, dstCreated: 0, dstDivergences: 0 });
    });
  });
});
