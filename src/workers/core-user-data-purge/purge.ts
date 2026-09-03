/**
 * CoreUserDataPurgeWorker — D-151, implementing D-127's approved scoping design
 * (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`,
 * `CORE_USER_DATA` row, Prioridade 1). Physically purges `ExpirationItem`/`ReminderPolicy` rows
 * once `deletedAt + 30 days` (`privacy-lgpd.md` §4) has passed, within `ACTIVE` tenants only.
 *
 * D-179/D-190 (MaintenanceDueIndex, slice 9 — the LAST of 9): candidates now come from a `Query`
 * against GSI8 (`candidate-source.ts`), replacing the base-table `Scan` this worker used through
 * D-189. GSI8 is discovery-only (D-179 §4): every candidate is revalidated against the base item
 * before any write, and the actual claim/delete uses a `TransactWriteItems` `ConditionCheck` on
 * the owning tenant's `TenantLifecycleRecord.status = ACTIVE` in the SAME transaction as the
 * delete — closing the TOCTOU the pre-GSI8 `Scan`+separate-lifecycle-lookup pattern had.
 *
 * **`version` AND `deletedAt` both re-asserted at delete time** — same shape as
 * `delivery-record-purge`'s real OCC counter, PLUS this worker's own pre-GSI8 discipline
 * (unchanged by the migration, task brief's single most important correctness property): if a
 * record were ever un-deleted between revalidation and this delete (no such path exists in this
 * codebase today for either entity), the delete's ConditionExpression fails closed instead of
 * silently discarding a live record.
 *
 * Poison-record handling (D-179 §8, same shape as delivery-record-purge/security-audit-purge):
 * when the tenant-ACTIVE `ConditionCheck` specifically fails, this worker increments
 * `maintenanceAttemptCount` and pushes `GSI8SK` forward by a capped exponential backoff; past
 * `MAX_ATTEMPTS` it moves the pointer to `GSI8PK = "DLQ#CORE_USER_DATA"` instead.
 *
 * **Known, accepted, pre-existing gap (unchanged by this migration)**: `ReminderPolicy` has no
 * live write path setting `deletedAt` anywhere in the codebase today — see
 * `shared/core-user-data-gsi8.ts`'s doc comment. In practice only `ExpirationItem` rows appear
 * under `WORK#CORE_USER_DATA` until such a path is added; this worker's logic handles both
 * entity types uniformly and needs no change when that day comes.
 */
import { isTransactionCanceled, getCancellationReasonCodes, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { tenantLifecycleKey } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { CORE_USER_DATA_RETENTION_DAYS, deriveCoreUserDataMaintenanceDue, coreUserDataGsi8Keys } from "../../shared/core-user-data-gsi8.js";
import type { CoreUserDataPurgeCandidateSource } from "./candidate-source.js";

export { CORE_USER_DATA_RETENTION_DAYS };

const TENANT_ACTIVE_STATUS = "ACTIVE";
const DLQ_GSI8PK = "DLQ#CORE_USER_DATA";

/** Same rationale as every other purge worker's own `MAX_PAGES`. */
const MAX_PAGES = 25;

/** Same rationale as every other purge worker's own `MAX_ATTEMPTS`. */
const MAX_ATTEMPTS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Capped exponential backoff (1, 2, 4, 8, 16 days, then quarantined) — identical shape to every
 * other migrated worker's `backoffDueAtIso()`. */
function backoffDueAtIso(attemptNumber: number, nowIso: string): string {
  const days = Math.min(2 ** (attemptNumber - 1), 16);
  return new Date(Date.parse(nowIso) + days * MS_PER_DAY).toISOString();
}

/** Preserved for the existing eligibility-boundary tests — now a thin wrapper over
 * `deriveCoreUserDataMaintenanceDue()`, the single pure source of truth (D-179 §2). */
export function isPurgeEligibleByAge(deletedAt: string, nowIso: string): boolean {
  const due = deriveCoreUserDataMaintenanceDue({ deletedAt });
  return due.dueAtIso !== undefined && Date.parse(due.dueAtIso) <= Date.parse(nowIso);
}

export interface CoreUserDataPurgeDeps {
  candidates: CoreUserDataPurgeCandidateSource;
  tableName: string;
  now: () => string;
}

export interface CoreUserDataPurgeResult {
  scanned: number;
  purged: number;
  skippedTooRecent: number;
  skippedTenantNotActive: number;
  skippedConcurrentlyModified: number;
  /** Candidates moved to the DLQ#CORE_USER_DATA namespace this run, having exceeded
   * MAX_ATTEMPTS of a failing tenant-ACTIVE revalidation. */
  quarantinedCount: number;
  /** Age in seconds of the oldest due candidate this run's GSI8 query returned. `undefined` when
   * no candidate was returned at all. */
  oldestCandidateAgeSeconds: number | undefined;
}

export async function runCoreUserDataPurge(deps: CoreUserDataPurgeDeps): Promise<CoreUserDataPurgeResult> {
  const result: CoreUserDataPurgeResult = {
    scanned: 0,
    purged: 0,
    skippedTooRecent: 0,
    skippedTenantNotActive: 0,
    skippedConcurrentlyModified: 0,
    quarantinedCount: 0,
    oldestCandidateAgeSeconds: undefined,
  };
  const nowIso = deps.now();
  const nowMs = Date.parse(nowIso);

  let exclusiveStartKey: Record<string, unknown> | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const gsi8Page = await deps.candidates.queryDue({ before: nowIso, exclusiveStartKey });

    if (page === 0 && gsi8Page.items.length > 0) {
      const oldest = gsi8Page.items[0]!;
      result.oldestCandidateAgeSeconds = Math.max(0, Math.floor((nowMs - Date.parse(oldest.dueAtIso)) / 1000));
    }

    for (const candidate of gsi8Page.items) {
      result.scanned += 1;

      const row = await deps.candidates.getCandidate({ PK: candidate.PK, SK: candidate.SK });
      if (!row) continue; // already purged by a prior/concurrent run - idempotent no-op

      const due = deriveCoreUserDataMaintenanceDue({ deletedAt: row.deletedAt });
      if (!due.dueAtIso || Date.parse(due.dueAtIso) > nowMs) {
        // Defensive only - queryDue()'s own `GSI8SK < :before` filter means this should never be
        // reachable in practice, but eligibility is always re-derived here, never assumed.
        result.skippedTooRecent += 1;
        continue;
      }

      const claimEntries: TransactWriteEntry[] = [
        {
          ConditionCheck: {
            TableName: deps.tableName,
            Key: tenantLifecycleKey(candidate.tenantId),
            ConditionExpression: "#status = :active",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":active": TENANT_ACTIVE_STATUS },
          },
        },
        {
          Delete: {
            TableName: deps.tableName,
            Key: { PK: candidate.PK, SK: candidate.SK },
            // The single most important correctness property here (task brief): re-assert
            // deletedAt is still set to the EXACT value this revalidation observed, so a
            // concurrent restore (setting a different deletedAt, or removing it) between
            // revalidation and delete never gets silently overwritten by this delete.
            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK) AND #version = :version AND #deletedAt = :deletedAt",
            ExpressionAttributeNames: { "#version": "version", "#deletedAt": "deletedAt" },
            ExpressionAttributeValues: { ":version": row.version, ":deletedAt": row.deletedAt },
          },
        },
      ];

      try {
        await deps.candidates.transactWrite(claimEntries);
        result.purged += 1;
        continue;
      } catch (err) {
        if (!isTransactionCanceled(err)) throw err;
        const reasons = getCancellationReasonCodes(err);
        const tenantCheckFailed = reasons?.[0] === "ConditionalCheckFailed";
        const deleteCheckFailed = reasons?.[1] === "ConditionalCheckFailed";

        if (deleteCheckFailed && !tenantCheckFailed) {
          // Row itself changed concurrently (version/deletedAt no longer match) - transient,
          // self-resolves next run.
          result.skippedConcurrentlyModified += 1;
          continue;
        }

        if (!tenantCheckFailed) throw err; // unrecognized cancellation shape - never swallowed

        result.skippedTenantNotActive += 1;
        const nextAttempt = (row.maintenanceAttemptCount ?? 0) + 1;
        const quarantine = nextAttempt > MAX_ATTEMPTS;
        const backoffUpdate: TransactWriteEntry = quarantine
          ? {
              Update: {
                TableName: deps.tableName,
                Key: { PK: candidate.PK, SK: candidate.SK },
                UpdateExpression: "SET GSI8PK = :dlq, maintenanceAttemptCount = :attempt",
                ConditionExpression: "version = :version AND GSI8PK = :work",
                ExpressionAttributeValues: {
                  ":dlq": DLQ_GSI8PK,
                  ":attempt": nextAttempt,
                  ":version": row.version,
                  ":work": coreUserDataGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: candidate.tenantId, entityType: row.entityType, sk: candidate.SK }).GSI8PK,
                },
              },
            }
          : {
              Update: {
                TableName: deps.tableName,
                Key: { PK: candidate.PK, SK: candidate.SK },
                UpdateExpression: "SET GSI8SK = :sk, maintenanceAttemptCount = :attempt",
                ConditionExpression: "version = :version",
                ExpressionAttributeValues: {
                  ":sk": coreUserDataGsi8Keys({
                    dueAtIso: backoffDueAtIso(nextAttempt, nowIso),
                    tenantId: candidate.tenantId,
                    entityType: row.entityType,
                    sk: candidate.SK,
                  }).GSI8SK,
                  ":attempt": nextAttempt,
                  ":version": row.version,
                },
              },
            };

        try {
          await deps.candidates.transactWrite([backoffUpdate]);
          if (quarantine) result.quarantinedCount += 1;
        } catch (backoffErr) {
          // Idempotent, same discipline as every other migrated worker's poison-record handling.
          if (!isTransactionCanceled(backoffErr)) throw backoffErr;
        }
      }
    }

    if (!gsi8Page.lastEvaluatedKey) break;
    exclusiveStartKey = gsi8Page.lastEvaluatedKey;
  }

  return result;
}
