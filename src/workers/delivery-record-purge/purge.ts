/**
 * DeliveryRecordPurgeWorker — D-152, implementing D-127's approved scoping design
 * (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`,
 * `DELIVERY_RECORD` row, Prioridade 2). Physically purges `NotificationIntent`/
 * `NotificationAttempt` rows once `createdAt + 180 days` has passed, within `ACTIVE` tenants
 * only.
 *
 * D-179/D-18x (MaintenanceDueIndex, slice 8 — mirrors the D-187 security-audit-purge slice for
 * the poison-record/DLQ shape, since this worker DOES have a tenant-ACTIVE fence): candidates now
 * come from a `Query` against GSI8 (`candidate-source.ts`), replacing the base-table `Scan` this
 * worker used through D-188. GSI8 is discovery-only (D-179 §4): every candidate is revalidated
 * against the base item before any write, and the actual claim/delete uses a `TransactWriteItems`
 * `ConditionCheck` on the owning tenant's `TenantLifecycleRecord.status = ACTIVE` in the SAME
 * transaction as the delete — closing the TOCTOU the pre-GSI8 `Scan`+separate-lifecycle-lookup
 * pattern had.
 *
 * **`version` field re-asserted at delete time** (difference from D-187's 4 entities, which carry
 * no `version` counter — same shape as D-188's `UploadSlot`/`WebhookInbox` instead): both
 * `NotificationIntent` and `NotificationAttempt` carry a real OCC `version` counter used by their
 * own update paths elsewhere in the system. The claim transaction's `Delete` conditions on the
 * exact `version` observed at revalidation time, with `createdAt` ALSO re-asserted as
 * defense-in-depth — same reasoning as this worker's pre-GSI8 `purge.ts`: nothing mutates
 * `createdAt` today, but re-asserting it makes "the field this worker's eligibility decision
 * depends on hasn't changed since revalidation" structural rather than merely true because
 * nothing currently writes it.
 *
 * Poison-record handling (D-179 §8, same shape as security-audit-purge/quota-telemetry-purge):
 * when the tenant-ACTIVE `ConditionCheck` specifically fails, this worker increments
 * `maintenanceAttemptCount` and pushes `GSI8SK` forward by a capped exponential backoff; past
 * `MAX_ATTEMPTS` it moves the pointer to `GSI8PK = "DLQ#DELIVERY_RECORD"` instead.
 *
 * **No obsolete-pointer/self-heal branch** (same absence as D-187 security-audit-purge): neither
 * entity is ever updated after creation in practice — the GSI8 pointer is written exactly once,
 * at creation, and the only way a row stops being a GSI8 candidate is this worker deleting it
 * outright (which removes the pointer along with the whole item).
 *
 * **Known, accepted, out-of-scope gap (D-152, unchanged by this migration)**:
 * `NotificationAttemptLookup` is NOT purged by this worker and becomes orphaned after a
 * `NotificationAttempt` is deleted — see `candidate-source.ts`'s doc comment.
 */
import { isTransactionCanceled, getCancellationReasonCodes, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { tenantLifecycleKey } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { DELIVERY_RECORD_RETENTION_DAYS, deriveDeliveryRecordMaintenanceDue, deliveryRecordGsi8Keys } from "../../shared/delivery-record-gsi8.js";
import type { DeliveryRecordPurgeCandidateSource } from "./candidate-source.js";

export { DELIVERY_RECORD_RETENTION_DAYS };

const TENANT_ACTIVE_STATUS = "ACTIVE";
const DLQ_GSI8PK = "DLQ#DELIVERY_RECORD";

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
 * `deriveDeliveryRecordMaintenanceDue()`, the single pure source of truth (D-179 §2). */
export function isPurgeEligibleByAge(createdAt: string, nowIso: string): boolean {
  const due = deriveDeliveryRecordMaintenanceDue({ createdAt });
  return Date.parse(due.dueAtIso) <= Date.parse(nowIso);
}

export interface DeliveryRecordPurgeDeps {
  candidates: DeliveryRecordPurgeCandidateSource;
  tableName: string;
  now: () => string;
}

export interface DeliveryRecordPurgeResult {
  scanned: number;
  purged: number;
  skippedTooRecent: number;
  skippedTenantNotActive: number;
  skippedConcurrentlyModified: number;
  /** Candidates moved to the DLQ#DELIVERY_RECORD namespace this run, having exceeded MAX_ATTEMPTS
   * of a failing tenant-ACTIVE revalidation. */
  quarantinedCount: number;
  /** Age in seconds of the oldest due candidate this run's GSI8 query returned. `undefined` when
   * no candidate was returned at all. */
  oldestCandidateAgeSeconds: number | undefined;
}

export async function runDeliveryRecordPurge(deps: DeliveryRecordPurgeDeps): Promise<DeliveryRecordPurgeResult> {
  const result: DeliveryRecordPurgeResult = {
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

      const due = deriveDeliveryRecordMaintenanceDue({ createdAt: row.createdAt });
      if (Date.parse(due.dueAtIso) > nowMs) {
        // Defensive only - queryDue()'s own `GSI8SK < :before` filter means this should never be
        // reachable in practice (the pointer is written once, correctly, at creation), but
        // eligibility is always re-derived here, never assumed.
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
            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK) AND #version = :version AND #createdAt = :createdAt",
            ExpressionAttributeNames: { "#version": "version", "#createdAt": "createdAt" },
            ExpressionAttributeValues: { ":version": row.version, ":createdAt": row.createdAt },
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
          // Row itself changed concurrently (version/createdAt no longer match) - transient,
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
                  ":work": deliveryRecordGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: candidate.tenantId, entityType: row.entityType, sk: candidate.SK }).GSI8PK,
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
                  ":sk": deliveryRecordGsi8Keys({
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
