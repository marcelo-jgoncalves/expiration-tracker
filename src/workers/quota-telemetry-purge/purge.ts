/**
 * QuotaTelemetryPurgeWorker — D-154, widened to `EphemeralTelemetryMutation` by D-136 D-D.
 * Physically purges `TenantQuotaRecord`/`EphemeralTelemetryRecord` rows
 * (`src/modules/identity/application/quota.ts`) once `resetAt + 30 days` (`privacy-lgpd.md` §4:
 * "fim da janela + 30 dias") has passed, within `ACTIVE` tenants only.
 *
 * D-179/D-186 (MaintenanceDueIndex, slice 5 — mirrors the D-180 membership-purge pilot / D-182
 * invitation-purge slice exactly): candidates now come from a `Query` against GSI8
 * (`candidate-source.ts`), replacing the `Scan`+bounded-pages this worker used through D-185.
 * GSI8 is discovery-only (D-179 §4): every candidate is revalidated against the base item before
 * any write, and the actual claim/delete uses a `TransactWriteItems` `ConditionCheck` on the
 * owning tenant's `TenantLifecycleRecord.status = ACTIVE` in the SAME transaction as the delete.
 *
 * **No OCC `version` field re-asserted at delete time** (same deviation as the pre-GSI8 worker,
 * same reason): neither entity has a `version` counter — the delete's own `ConditionExpression`
 * re-asserts `resetAt` exactly as observed at revalidation time instead, so a concurrent
 * `consume()`/`release()` that rolls the window forward (or resets the count) between revalidation
 * and delete aborts this worker's delete rather than racing it.
 *
 * Poison-record handling (D-179 §8, same shape as membership-purge/invitation-purge): when the
 * tenant-ACTIVE `ConditionCheck` specifically fails, this worker increments
 * `maintenanceAttemptCount` and pushes `GSI8SK` forward by a capped exponential backoff; past
 * `MAX_ATTEMPTS` it moves the pointer to `GSI8PK = "DLQ#QUOTA_TELEMETRY"` instead.
 *
 * **No obsolete-pointer/self-heal branch** (unlike Invitation/Membership, deliberately): neither
 * entity has a terminal state that stops it from being a candidate — `deriveQuotaTelemetryMaintenanceDue()`
 * never returns `undefined`, and every write that sets `resetAt` also refreshes the GSI8 pointer
 * in the same write (`quota.ts`'s `consume()`, `identity-store.ts`'s `incrementTelemetryCounter`).
 * A row `queryDue()` returns therefore always had `GSI8PK`/`GSI8SK` at query time, and nothing in
 * this codebase ever removes those fields from a live row without also deleting it — so unlike
 * invitation-purge's defensive self-heal (guarding against a hypothetical writer that forgets to
 * clear the pointer on a terminal transition), there is no analogous gap here to defend against.
 */
import { isTransactionCanceled, getCancellationReasonCodes, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { tenantLifecycleKey } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import {
  QUOTA_TELEMETRY_RETENTION_DAYS,
  deriveQuotaTelemetryMaintenanceDue,
  quotaTelemetryGsi8Keys,
} from "../../modules/identity/application/quota.js";
import type { QuotaTelemetryPurgeCandidateSource } from "./candidate-source.js";

export { QUOTA_TELEMETRY_RETENTION_DAYS };

const TENANT_ACTIVE_STATUS = "ACTIVE";
const DLQ_GSI8PK = "DLQ#QUOTA_TELEMETRY";

/** Same rationale as membership-purge's own `MAX_PAGES`. */
const MAX_PAGES = 25;

/** Same rationale as membership-purge's own `MAX_ATTEMPTS`. */
const MAX_ATTEMPTS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Capped exponential backoff (1, 2, 4, 8, 16 days, then quarantined) — identical shape to
 * membership-purge's `backoffDueAtIso()`. */
function backoffDueAtIso(attemptNumber: number, nowIso: string): string {
  const days = Math.min(2 ** (attemptNumber - 1), 16);
  return new Date(Date.parse(nowIso) + days * MS_PER_DAY).toISOString();
}

/** Preserved for the existing eligibility-boundary tests — now a thin wrapper over
 * `deriveQuotaTelemetryMaintenanceDue()`, the single pure source of truth (D-179 §2). */
export function isPurgeEligibleByWindowEnd(resetAt: string, nowIso: string): boolean {
  const due = deriveQuotaTelemetryMaintenanceDue({ resetAt });
  return Date.parse(due.dueAtIso) <= Date.parse(nowIso);
}

export interface QuotaTelemetryPurgeDeps {
  candidates: QuotaTelemetryPurgeCandidateSource;
  tableName: string;
  now: () => string;
}

export interface QuotaTelemetryPurgeResult {
  scanned: number;
  purged: number;
  skippedTooRecent: number;
  skippedTenantNotActive: number;
  skippedConcurrentlyModified: number;
  /** Candidates moved to the DLQ#QUOTA_TELEMETRY namespace this run, having exceeded
   * MAX_ATTEMPTS of a failing tenant-ACTIVE revalidation. */
  quarantinedCount: number;
  /** Age in seconds of the oldest due candidate this run's GSI8 query returned. `undefined` when
   * no candidate was returned at all. */
  oldestCandidateAgeSeconds: number | undefined;
}

export async function runQuotaTelemetryPurge(deps: QuotaTelemetryPurgeDeps): Promise<QuotaTelemetryPurgeResult> {
  const result: QuotaTelemetryPurgeResult = {
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

      const due = deriveQuotaTelemetryMaintenanceDue(row);
      if (Date.parse(due.dueAtIso) > nowMs) {
        // Defensive only - queryDue()'s own `GSI8SK < :before` filter means this should never be
        // reachable in practice (the pointer is refreshed atomically on every resetAt-changing
        // write), but eligibility is always re-derived here, never assumed.
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
            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK) AND #resetAt = :resetAt",
            ExpressionAttributeNames: { "#resetAt": "resetAt" },
            ExpressionAttributeValues: { ":resetAt": row.resetAt },
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
          // Row itself changed concurrently - transient, self-resolves next run.
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
                ConditionExpression: "resetAt = :resetAt AND GSI8PK = :work",
                ExpressionAttributeValues: {
                  ":dlq": DLQ_GSI8PK,
                  ":attempt": nextAttempt,
                  ":resetAt": row.resetAt,
                  ":work": quotaTelemetryGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: candidate.tenantId, entityType: row.entityType, sk: candidate.SK }).GSI8PK,
                },
              },
            }
          : {
              Update: {
                TableName: deps.tableName,
                Key: { PK: candidate.PK, SK: candidate.SK },
                UpdateExpression: "SET GSI8SK = :sk, maintenanceAttemptCount = :attempt",
                ConditionExpression: "resetAt = :resetAt",
                ExpressionAttributeValues: {
                  ":sk": quotaTelemetryGsi8Keys({
                    dueAtIso: backoffDueAtIso(nextAttempt, nowIso),
                    tenantId: candidate.tenantId,
                    entityType: row.entityType,
                    sk: candidate.SK,
                  }).GSI8SK,
                  ":attempt": nextAttempt,
                  ":resetAt": row.resetAt,
                },
              },
            };

        try {
          await deps.candidates.transactWrite([backoffUpdate]);
          if (quarantine) result.quarantinedCount += 1;
        } catch (backoffErr) {
          // Idempotent, same discipline as membership-purge's own poison-record handling.
          if (!isTransactionCanceled(backoffErr)) throw backoffErr;
        }
      }
    }

    if (!gsi8Page.lastEvaluatedKey) break;
    exclusiveStartKey = gsi8Page.lastEvaluatedKey;
  }

  return result;
}
