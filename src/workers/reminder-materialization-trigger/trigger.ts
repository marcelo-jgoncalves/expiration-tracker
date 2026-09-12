/**
 * reminder-materialization-trigger — the worker that closes BLOCKER-B (implementation
 * against docs/architecture/reminder-delivery-pipeline.md §4, Codex Round H APPROVED
 * 9.2/10). Consumes the three event types the outbox now emits for exactly this purpose
 * (expiration.item-due-date-changed.v1, expiration.item-deactivated.v1,
 * reminder.policy-changed.v1) and is the ONLY thing standing between "policy saved" and
 * "reminder actually materialized" - before this worker existed, ReminderMaterializer's
 * only production caller was the DST-reconciliation worker.
 *
 * Design principle (§7): every event here is a PURE INVALIDATION SIGNAL. No decision is
 * ever made from event payload fields beyond routing (tenantId/itemId/policyId/
 * previousItemId) - every decision (item ACTIVE? policy enabled? what version?) comes from
 * a strongly-consistent re-read at processing time. This is what makes the whole worker
 * safe under at-least-once, no-ordering delivery: duplicate/out-of-order/concurrent
 * processing of any of these events always converges to the same result, because the
 * result is always derived from current state, never from what the event happened to say.
 *
 * `on policy-changed` (§4/§13.6, Codex Round G/H) is deliberately ONE unified loop over
 * every candidate partition (`previousItemId` and the current target, deduplicated) rather
 * than separate "old side"/"current side" code paths - that separation is exactly what
 * produced three consecutive rounds of edge cases (E1/F1/G1) during design review. Pointer
 * discovery (`POLICYREF#` rows, §5) is used only for `on item-due-date-changed`'s "which
 * policies apply to this item" lookup - it is never authoritative, every policy found is
 * re-dereferenced and validated before use.
 */
import type { ExpirationItem } from "../../modules/expiration/domain/expiration-item.js";
import { itemKey } from "../../modules/expiration/domain/expiration-item.js";
import { policyKey, activePolicyPointerKey, POLICY_REF_SK_PREFIX, type PolicyRef, type ReminderPolicy } from "../../modules/reminder/domain/reminder-policy.js";
import { ReminderMaterializer } from "../../modules/reminder/application/reminder-materializer.js";
import type { ReminderStore } from "../../modules/reminder/ports/reminder-store.js";
import type { ShardConfig } from "../../modules/reminder/domain/shard-config.js";
import { authorizedTenantIdFromPersistedEntity, type AuthorizedTenantId } from "../../modules/identity/domain/authorization.js";

export interface TriggerDeps {
  store: ReminderStore;
  tableName: string;
  now: () => string;
  shardConfig: ShardConfig;
}

export type TriggerEvent =
  | { kind: "ITEM_DUE_DATE_CHANGED"; tenantId: string; itemId: string }
  | { kind: "ITEM_DEACTIVATED"; tenantId: string; itemId: string }
  | { kind: "POLICY_CHANGED"; tenantId: string; policyId: string; itemId: string | null; previousItemId: string | null };

export interface TriggerResult {
  materialized: number;
  reconciled: number;
  cancelledUnconditionally: number;
  skippedOrphanedPointers: number;
}

const EMPTY_RESULT: TriggerResult = { materialized: 0, reconciled: 0, cancelledUnconditionally: 0, skippedOrphanedPointers: 0 };

async function getItem(deps: TriggerDeps, tenantId: AuthorizedTenantId, itemId: string): Promise<ExpirationItem | undefined> {
  return deps.store.get<ExpirationItem>(itemKey(tenantId, itemId));
}

async function getPolicy(deps: TriggerDeps, tenantId: string, policyId: string): Promise<ReminderPolicy | undefined> {
  return deps.store.get<ReminderPolicy>(policyKey(tenantId, policyId));
}

/** Reconciles one policy against its CURRENT target item: cancels stale/disabled occurrences, materializes if enabled. Caller has already confirmed `item` is ACTIVE. */
async function reconcileCurrentTarget(
  deps: TriggerDeps,
  materializer: ReminderMaterializer,
  tenantId: string,
  item: ExpirationItem,
  policy: ReminderPolicy,
): Promise<{ reconciled: number; materialized: number }> {
  const reconciled = await materializer.reconcilePolicyOccurrences({ tenantId, itemId: item.itemId, policy });
  let materialized = 0;
  if (policy.enabled) {
    const result = await materializer.materialize({
      tenantId,
      itemId: item.itemId,
      itemVersion: item.version,
      itemDueDate: item.dueDate,
      policy,
      shardConfig: deps.shardConfig,
    });
    materialized = result.created.length;
  }
  return { reconciled, materialized };
}

/**
 * Dereferences one candidate pointer (fixed or legacy) into a validated, still-live
 * ITEM-scoped policy for this exact item - `undefined` for anything orphaned/stale/
 * tombstoned (P0.4: a `deletedAt`-tombstoned policy is treated exactly like a missing
 * one, never a live target - Claude<->Codex protocol Round 4 finding). Never trusted
 * without this re-check, same discipline the module header describes.
 */
async function derefItemPolicy(deps: TriggerDeps, tenantId: string, itemId: string, policyId: string): Promise<ReminderPolicy | undefined> {
  const policy = await getPolicy(deps, tenantId, policyId);
  if (!policy || policy.deletedAt || policy.tenantId !== tenantId || policy.scope !== "ITEM" || policy.itemId !== itemId) {
    return undefined;
  }
  return policy;
}

/**
 * `expiration.item-due-date-changed.v1`: item is (or should be) ACTIVE with a current due
 * date - discover its ITEM-scoped policy via the fixed pointer (P0.4: at most one per
 * item), falling back to the legacy per-policy `POLICYREF#` pointers only for an item
 * that hasn't gone through the P0.4 migration/self-heal yet (§5, never authoritative -
 * every pointer is re-dereferenced and validated), reconcile+materialize, then run the
 * pre-existing itemVersion staleness safety net.
 */
async function onItemDueDateChanged(deps: TriggerDeps, event: { tenantId: string; itemId: string }): Promise<TriggerResult> {
  const item = await getItem(deps, authorizedTenantIdFromPersistedEntity(event), event.itemId);
  if (!item || item.status !== "ACTIVE") {
    // Defensive (§7): a due-date-changed event should never outlive an ACTIVE item, but if
    // one does (e.g. a race with a fast subsequent deactivation), treat it exactly like the
    // item-deactivated path - never materialize against a non-ACTIVE item.
    return onItemDeactivated(deps, event);
  }

  const materializer = new ReminderMaterializer(deps.store, deps.tableName, deps.now);

  let reconciled = 0;
  let materialized = 0;
  let skippedOrphanedPointers = 0;
  let policiesFound = 0;

  const fixedRef = await deps.store.get<PolicyRef>(activePolicyPointerKey(event.tenantId, event.itemId));
  if (fixedRef) {
    const policy = await derefItemPolicy(deps, event.tenantId, event.itemId, fixedRef.policyId);
    if (policy) {
      policiesFound += 1;
      const result = await reconcileCurrentTarget(deps, materializer, event.tenantId, item, policy);
      reconciled += result.reconciled;
      materialized += result.materialized;
    } else {
      skippedOrphanedPointers += 1; // stale fixed pointer - never trusted, same discipline as legacy pointers below.
    }
  }

  if (policiesFound === 0) {
    // Legacy fallback (pre-P0.4-migration window only, read-only - see reminder-policy.ts
    // POLICY_REF_SK_PREFIX doc): only consulted when the fixed pointer found nothing valid.
    const pointers = await deps.store.queryByItem<PolicyRef>(event.tenantId, event.itemId, POLICY_REF_SK_PREFIX);
    for (const pointer of pointers) {
      const policy = await derefItemPolicy(deps, event.tenantId, event.itemId, pointer.policyId);
      if (!policy) {
        skippedOrphanedPointers += 1; // Corrected by the next policy-changed event, the backfill script, or the P0.4 migration.
        continue;
      }
      const result = await reconcileCurrentTarget(deps, materializer, event.tenantId, item, policy);
      reconciled += result.reconciled;
      materialized += result.materialized;
    }
  }

  await materializer.cancelStaleOccurrences({ tenantId: event.tenantId, itemId: event.itemId, currentItemVersion: item.version });

  return { materialized, reconciled, cancelledUnconditionally: 0, skippedOrphanedPointers };
}

/** `expiration.item-deactivated.v1`: terminal item transition - cancel every live occurrence under the item, unconditionally, no materialize. */
async function onItemDeactivated(deps: TriggerDeps, event: { tenantId: string; itemId: string }): Promise<TriggerResult> {
  const materializer = new ReminderMaterializer(deps.store, deps.tableName, deps.now);
  const cancelledUnconditionally = await materializer.cancelAllOccurrences({ tenantId: event.tenantId, itemId: event.itemId });
  return { ...EMPTY_RESULT, cancelledUnconditionally };
}

/**
 * `reminder.policy-changed.v1` (§4/§13.6, unified loop): re-reads the policy first, then
 * reconciles every candidate partition (previousItemId + current target, deduplicated)
 * against that ONE authoritative read - never per-partition re-reads, so a single fresh
 * fact drives every fenced cancellation/materialize this invocation performs.
 */
async function onPolicyChanged(
  deps: TriggerDeps,
  event: { tenantId: string; policyId: string; itemId: string | null; previousItemId: string | null },
): Promise<TriggerResult> {
  const policy = await getPolicy(deps, event.tenantId, event.policyId);
  if (!policy) {
    // Hard-delete unsupported today (reminder-delivery-pipeline.md §5/§13.6 G1) - nothing
    // to reconcile against, and no version exists to fence a cancellation with.
    return EMPTY_RESULT;
  }

  // P0.4 (Claude<->Codex protocol Round 4 finding): a soft-deleted (tombstoned) policy is
  // never a current target, exactly like one whose scope left ITEM - its retirement event
  // still needs `previousItemId` reconciled below, just never re-materialized as live.
  const currentTarget = policy.scope === "ITEM" && !policy.deletedAt ? policy.itemId! : null;
  const targets = [...new Set([event.previousItemId, currentTarget].filter((t): t is string => t !== null))];

  const materializer = new ReminderMaterializer(deps.store, deps.tableName, deps.now);
  let reconciled = 0;
  let materialized = 0;
  let cancelledUnconditionally = 0;

  for (const target of targets) {
    const isCurrentTarget = currentTarget !== null && target === currentTarget;
    if (isCurrentTarget) {
      const item = await getItem(deps, authorizedTenantIdFromPersistedEntity(event), target);
      if (!item || item.status !== "ACTIVE") continue; // an item-deactivated event, if any, handles cleanup
      const result = await reconcileCurrentTarget(deps, materializer, event.tenantId, item, policy);
      reconciled += result.reconciled;
      materialized += result.materialized;
    } else {
      // Not (or no longer) this policy's target - cancel every live occurrence for this
      // policy under this partition, fenced by the policy version just read above (§4/§7,
      // Codex Round F/G: closes the TOCTOU gap a plain read-then-cancel still had).
      cancelledUnconditionally += await materializer.reconcilePolicyOccurrencesUnconditionally({ tenantId: event.tenantId, itemId: target, policy });
    }
  }

  return { materialized, reconciled, cancelledUnconditionally, skippedOrphanedPointers: 0 };
}

export async function handleTriggerEvent(deps: TriggerDeps, event: TriggerEvent): Promise<TriggerResult> {
  switch (event.kind) {
    case "ITEM_DUE_DATE_CHANGED":
      return onItemDueDateChanged(deps, event);
    case "ITEM_DEACTIVATED":
      return onItemDeactivated(deps, event);
    case "POLICY_CHANGED":
      return onPolicyChanged(deps, event);
  }
}

/**
 * The SQS message body this worker's queue actually receives - built by the
 * SQS_REMINDER_MATERIALIZATION_TRIGGER_V1 outbox sender (composition/reminder.ts), which
 * folds the OutboxRecord's own `tenantId`/`eventType` envelope fields around the bare
 * domain event `data` (matching schemas/events/item-due-date-changed.v1.json,
 * item-deactivated.v1.json, reminder-policy-changed.v1.json exactly - no extra wrapping).
 */
export interface TriggerMessage {
  eventType: string;
  tenantId: string;
  data: Record<string, unknown>;
}

export class UnrecognizedTriggerEventTypeError extends Error {
  constructor(eventType: string) {
    super(`Unrecognized reminder-materialization-trigger eventType: ${eventType}`);
    this.name = "UnrecognizedTriggerEventTypeError";
  }
}

/** Maps one SQS message body to a `TriggerEvent` - the only place that knows the wire
 * shape, so `handleTriggerEvent` above stays wire-format-agnostic (testable with plain
 * TriggerEvent objects, as reminder-materialization-trigger.test.ts already does). */
export function parseTriggerEvent(message: TriggerMessage): TriggerEvent {
  const { tenantId, data } = message;
  switch (message.eventType) {
    case "expiration.item-due-date-changed.v1":
      return { kind: "ITEM_DUE_DATE_CHANGED", tenantId, itemId: data["itemId"] as string };
    case "expiration.item-deactivated.v1":
      return { kind: "ITEM_DEACTIVATED", tenantId, itemId: data["itemId"] as string };
    case "reminder.policy-changed.v1":
      return {
        kind: "POLICY_CHANGED",
        tenantId,
        policyId: data["policyId"] as string,
        itemId: (data["itemId"] as string | null) ?? null,
        previousItemId: (data["previousItemId"] as string | null) ?? null,
      };
    default:
      throw new UnrecognizedTriggerEventTypeError(message.eventType);
  }
}
