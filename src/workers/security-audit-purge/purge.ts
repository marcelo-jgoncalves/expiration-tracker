/**
 * SecurityAuditPurgeWorker — D-153, implementing D-127's approved scoping design
 * (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`,
 * `SECURITY_AUDIT` row, Prioridade 3). Physically purges the 4 `AuditEvent`-family rows
 * (`AuditEvent`/`MembershipAuditEvent`/`SubjectAuditEvent`/`TenantAuditEvent`) once
 * `occurredAt + 365 days` has passed, within `ACTIVE` tenants only.
 *
 * D-179/D-187 (MaintenanceDueIndex, slice 6 — mirrors the D-186 quota-telemetry-purge slice for
 * the poison-record/DLQ shape, since this worker DOES have a tenant-ACTIVE fence unlike D-183/
 * D-185's requirement-reindex/document-file-reconciliation): candidates now come from a `Query`
 * against GSI8 (`candidate-source.ts`), replacing the base-table `Scan` this worker used through
 * D-186. GSI8 is discovery-only (D-179 §4): every candidate is revalidated against the base item
 * before any write, and the actual claim/delete uses a `TransactWriteItems` `ConditionCheck` on
 * the owning tenant's `TenantLifecycleRecord.status = ACTIVE` in the SAME transaction as the
 * delete — closing the TOCTOU the pre-GSI8 `Scan`+separate-lifecycle-lookup pattern had.
 *
 * **Interaction with `GET /activity` (D-149), re-verified for this migration (task brief)**:
 * `ActivityService` paginates each of the 4 partitions via a composite cursor holding the real
 * `{PK,SK}` of the last item consumed (`src/modules/activity/domain/cursor.ts`), passed back as
 * `ExclusiveStartKey` on the next page's `Query` (`dynamodb-audit-partition-store.ts`). GSI8 does
 * not change any of this: `ActivityService`/`merge.ts` never touch GSI8, and this worker's delete
 * still targets the exact same base-table `{PK,SK}` as before — a DynamoDB `Query`'s
 * `ExclusiveStartKey` remains a pure B-tree position marker, independent of whether the item at
 * that key still exists (`dynamodb-audit-partition-store.ts#queryPage` forwards it straight into
 * `QueryCommand` with no existence check). D-153's original conclusion (no correctness bug, no fix
 * needed) still holds after this migration, confirmed by re-reading rather than assumed.
 *
 * **No OCC `version` field re-asserted at delete time** (same deviation as every purge worker for
 * an entity family with no `version` counter): none of the 4 entities carries one, because none is
 * ever updated after creation. The claim transaction's `Delete` re-asserts `occurredAt` exactly as
 * observed at revalidation time instead — sufficient here specifically because these rows are
 * never mutated in place, so there is no "did some OTHER field change" case a version check would
 * additionally catch.
 *
 * Poison-record handling (D-179 §8, same shape as membership-purge/invitation-purge/
 * quota-telemetry-purge): when the tenant-ACTIVE `ConditionCheck` specifically fails, this worker
 * increments `maintenanceAttemptCount` and pushes `GSI8SK` forward by a capped exponential
 * backoff; past `MAX_ATTEMPTS` it moves the pointer to `GSI8PK = "DLQ#SECURITY_AUDIT"` instead.
 *
 * **No obsolete-pointer/self-heal branch** (same absence as D-186 quota-telemetry-purge, different
 * cause): all 4 entities are append-only by construction — there is no terminal-state transition
 * that could leave a stale pointer behind, and the ONLY way a row stops being a GSI8 candidate is
 * this worker deleting it outright (which removes the pointer along with the whole item). A row
 * `queryDue()` returns therefore always had a live, correctly-computed `GSI8PK`/`GSI8SK` at query
 * time, so there is no analogous gap to defend against.
 */
import { isTransactionCanceled, getCancellationReasonCodes, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { tenantLifecycleKey } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { SECURITY_AUDIT_RETENTION_DAYS, deriveSecurityAuditMaintenanceDue, securityAuditGsi8Keys } from "../../shared/security-audit-gsi8.js";
import type { SecurityAuditPurgeCandidateSource } from "./candidate-source.js";

export { SECURITY_AUDIT_RETENTION_DAYS };

const TENANT_ACTIVE_STATUS = "ACTIVE";
const DLQ_GSI8PK = "DLQ#SECURITY_AUDIT";

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
 * `deriveSecurityAuditMaintenanceDue()`, the single pure source of truth (D-179 §2). */
export function isPurgeEligibleByAge(occurredAt: string, nowIso: string): boolean {
  const due = deriveSecurityAuditMaintenanceDue({ occurredAt });
  return Date.parse(due.dueAtIso) <= Date.parse(nowIso);
}

export interface SecurityAuditPurgeDeps {
  candidates: SecurityAuditPurgeCandidateSource;
  tableName: string;
  now: () => string;
}

export interface SecurityAuditPurgeResult {
  scanned: number;
  purged: number;
  skippedTooRecent: number;
  skippedTenantNotActive: number;
  skippedConcurrentlyModified: number;
  /** Candidates moved to the DLQ#SECURITY_AUDIT namespace this run, having exceeded MAX_ATTEMPTS
   * of a failing tenant-ACTIVE revalidation. */
  quarantinedCount: number;
  /** Age in seconds of the oldest due candidate this run's GSI8 query returned. `undefined` when
   * no candidate was returned at all. */
  oldestCandidateAgeSeconds: number | undefined;
}

export async function runSecurityAuditPurge(deps: SecurityAuditPurgeDeps): Promise<SecurityAuditPurgeResult> {
  const result: SecurityAuditPurgeResult = {
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

      const due = deriveSecurityAuditMaintenanceDue({ occurredAt: row.occurredAt });
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
            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK) AND #occurredAt = :occurredAt",
            ExpressionAttributeNames: { "#occurredAt": "occurredAt" },
            ExpressionAttributeValues: { ":occurredAt": row.occurredAt },
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
          // Row itself changed concurrently - transient, self-resolves next run. In practice this
          // should never fire for an append-only row (nothing mutates occurredAt), but the check
          // stays symmetric with every other migrated worker's cancellation handling.
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
                ConditionExpression: "occurredAt = :occurredAt AND GSI8PK = :work",
                ExpressionAttributeValues: {
                  ":dlq": DLQ_GSI8PK,
                  ":attempt": nextAttempt,
                  ":occurredAt": row.occurredAt,
                  ":work": securityAuditGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: candidate.tenantId, entityType: row.entityType, sk: candidate.SK }).GSI8PK,
                },
              },
            }
          : {
              Update: {
                TableName: deps.tableName,
                Key: { PK: candidate.PK, SK: candidate.SK },
                UpdateExpression: "SET GSI8SK = :sk, maintenanceAttemptCount = :attempt",
                ConditionExpression: "occurredAt = :occurredAt",
                ExpressionAttributeValues: {
                  ":sk": securityAuditGsi8Keys({
                    dueAtIso: backoffDueAtIso(nextAttempt, nowIso),
                    tenantId: candidate.tenantId,
                    entityType: row.entityType,
                    sk: candidate.SK,
                  }).GSI8SK,
                  ":attempt": nextAttempt,
                  ":occurredAt": row.occurredAt,
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
