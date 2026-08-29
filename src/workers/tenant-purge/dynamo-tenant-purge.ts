/**
 * Tenant-wide DynamoDB purge — W3-07 (this session), the `PURGE_DELETE`-consuming half of the
 * purge pipeline. Design basis: `docs/architecture/reviews/w3-07-tenant-fence-round3-active-only-design/
 * claude-analysis-active-only-fence.md` (tenant-wide purge / quiescence sections) — the approved
 * design's mechanism for the main table is a tenant-scoped SCAN, not a dedicated GSI: no generic
 * "every item for tenant X" index exists in this codebase today (every GSI serves one specific
 * per-entity-type access pattern — see `infra/modules/dynamo-table/main.tf`'s GSI1-GSI7 comments
 * and `w3-07-writer-inventory.md`), and adding one is a larger infra change than this session's
 * scope (see `NEXT_SESSION_PROMPT.md`). A Scan filtered to `begins_with(PK, "TENANT#<id>#")` is
 * the same class of mechanism the design doc's non-versioned-bucket S3 fallback already uses
 * ("re-scan convergente").
 *
 * Deletion itself is NOT a bare `BatchWriteCommand` — every row goes through
 * `system-mutation.ts`'s `PURGE_DELETE`/`purgeTenantItem`, so it gets the same structural
 * containment (single allowlisted lane, idempotent-by-construction ConditionExpression) every
 * other write in this codebase gets. `TenantLifecycleRecord` and `IdentityMapping` are excluded
 * HERE, at the pure-logic layer, independent of whatever the scan's own filter does — belt and
 * suspenders: `TenantLifecycleRecord` physically lives under the `TENANT#<id>#` prefix (it WOULD
 * be returned by a naive prefix scan) and must survive as a permanent tombstone (D-061/D-068's
 * whole admission-fence design depends on this record continuing to exist after DELETED);
 * `IdentityMapping` normally lives outside the `TENANT#` prefix (`IDENTITY#<cognitoSub>`) but is
 * excluded by entityType too, defensively, in case a future writer ever changes that.
 *
 * Idempotent/resumable by construction: `scanTenantItems` is a pure pagination port (the caller
 * supplies `exclusiveStartKey`), and `purgeTenantItem`'s delete is a no-op on an already-purged
 * key. Re-running `purgeTenantDynamoItems` from scratch (no checkpoint) after an interruption is
 * therefore correct, just re-does already-completed pages; passing back the last
 * `onCheckpoint`-reported key lets a real orchestrator skip re-scanning pages it already
 * finished, without which correctness would still hold, only efficiency would suffer.
 */
import type { SystemMutationStore } from "../../shared/tenant-lifecycle/system-mutation.js";
import { purgeTenantItem, SystemMutationConflictError } from "../../shared/tenant-lifecycle/system-mutation.js";

/** The two entity types that must NEVER be deleted by this pipeline, no matter what a scan
 * returns. See file header. */
const NEVER_PURGE_ENTITY_TYPES = new Set(["TenantLifecycleRecord", "IdentityMapping"]);

export interface TenantScanItem {
  PK: string;
  SK: string;
  entityType?: string;
  [key: string]: unknown;
}

export interface TenantScanPage {
  items: TenantScanItem[];
  /** Present iff there are more pages. Opaque — pass back verbatim as `exclusiveStartKey`. */
  lastEvaluatedKey?: Record<string, unknown>;
}

/** Minimal surface this module needs to enumerate a tenant's rows in the main table. The real
 * adapter (`shared/dynamodb/tenant-purge-scan.ts`) does a `Scan` with
 * `FilterExpression: begins_with(PK, :prefix)` — a Scan, not a Query, because no GSI keyed
 * purely by tenantId exists (see file header). */
export interface TenantPurgeCandidateSource {
  scanTenantItems(tenantId: string, exclusiveStartKey?: Record<string, unknown>): Promise<TenantScanPage>;
}

export interface DynamoTenantPurgeDeps {
  store: SystemMutationStore;
  candidates: TenantPurgeCandidateSource;
  tableName: string;
  now?: () => string;
  /** Invoked after each page is fully processed (every item in it either purged or excluded) —
   * lets a real caller persist progress durably before moving to the next page, so a crash mid-run
   * can resume from the last COMPLETED page rather than the beginning. Optional: correctness does
   * not depend on it (see file header), only resume efficiency does. */
  onCheckpoint?: (lastEvaluatedKey: Record<string, unknown> | undefined) => Promise<void>;
}

export interface DynamoTenantPurgeResult {
  itemsPurged: number;
  itemsExcluded: number;
  /** Number of PURGE_DELETE calls that hit the safety-condition rejection
   * (`SystemMutationConflictError`) — should always be 0 in practice (the scan is already
   * tenant-scoped); a nonzero value here means the scan/filter returned a row that does not
   * actually belong to the tenant, a bug worth surfacing rather than silently swallowing. */
  itemsRejectedBySafetyCondition: number;
  /** `undefined` means the purge ran to completion (no more pages). A defined value here would
   * only occur if the caller aborted early — this function itself always runs to completion or
   * throws, it never stops partway on its own. */
  checkpoint: undefined;
}

/**
 * W3-07 review finding (Codex round on the purge pipeline, B2, 2026-08-29): the approved design
 * (`claude-analysis-active-only-fence.md` §K) requires convergence be confirmed by "re-scan vazio
 * após a última deleção, não uma única varredura" — a single traversal that happened to delete
 * everything it saw is NOT the same guarantee, especially on a RESUMED run: `purge-tenant.ts`
 * used to trust a persisted `dynamoDone: true` forever and skip scanning entirely on resume, so a
 * late-arriving row (a bug elsewhere, a race with an admitted-but-slow writer, a stale checkpoint)
 * would never be re-detected. This function performs one full, unconditional re-scan (ignoring
 * any checkpoint) and reports whether the tenant's namespace is actually empty — `purge-tenant.ts`
 * now calls this unconditionally after the purge phase, whether that phase ran fresh or was
 * skipped via checkpoint, and never reports SUCCESS if it finds anything.
 */
export async function verifyTenantDynamoPurgeEmpty(
  deps: Pick<DynamoTenantPurgeDeps, "candidates">,
  tenantId: string,
): Promise<{ remainingItems: number }> {
  let remainingItems = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  for (;;) {
    const page = await deps.candidates.scanTenantItems(tenantId, exclusiveStartKey);
    for (const item of page.items) {
      if (item.entityType && NEVER_PURGE_ENTITY_TYPES.has(item.entityType)) continue;
      remainingItems += 1;
    }
    exclusiveStartKey = page.lastEvaluatedKey;
    if (!exclusiveStartKey) break;
  }

  return { remainingItems };
}

export async function purgeTenantDynamoItems(
  deps: DynamoTenantPurgeDeps,
  input: { tenantId: string; startAfter?: Record<string, unknown> },
): Promise<DynamoTenantPurgeResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  let itemsPurged = 0;
  let itemsExcluded = 0;
  let itemsRejectedBySafetyCondition = 0;
  let exclusiveStartKey = input.startAfter;

  for (;;) {
    const page = await deps.candidates.scanTenantItems(input.tenantId, exclusiveStartKey);

    for (const item of page.items) {
      if (item.entityType && NEVER_PURGE_ENTITY_TYPES.has(item.entityType)) {
        itemsExcluded += 1;
        continue;
      }
      try {
        await purgeTenantItem({
          store: deps.store,
          tableName: deps.tableName,
          tenantId: input.tenantId,
          key: { PK: item.PK, SK: item.SK },
          now,
        });
        itemsPurged += 1;
      } catch (err) {
        if (err instanceof SystemMutationConflictError) {
          itemsRejectedBySafetyCondition += 1;
          continue;
        }
        throw err;
      }
    }

    exclusiveStartKey = page.lastEvaluatedKey;
    if (deps.onCheckpoint) await deps.onCheckpoint(exclusiveStartKey);
    if (!exclusiveStartKey) break;
  }

  return { itemsPurged, itemsExcluded, itemsRejectedBySafetyCondition, checkpoint: undefined };
}
