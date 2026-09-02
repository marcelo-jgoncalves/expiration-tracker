/**
 * MembershipPurgeWorker — D-127's approved Prioridade 5 (`ACCOUNT_ACTIVE`, não-fechamento),
 * `Membership` leg, unblocked by D-158's `removedAt` field. Physically purges `Membership` rows
 * (`src/modules/organization/domain/membership.ts`) once `status = REMOVED` and `removedAt + 30
 * days` has passed, for a tenant that is itself still `ACTIVE`.
 *
 * D-179/D-180 (MaintenanceDueIndex pilot slice): candidates now come from a `Query` against GSI8
 * (`candidate-source.ts`), replacing the `Scan`+`Limit`+bounded-pages this worker used through
 * D-169 — D-170 confirmed that pattern permanently starves any candidate past a single run's page
 * cap, since a stateless scheduled invocation restarts from the same physical hash order every
 * time. GSI8 is discovery-only (D-179 §4): every candidate is revalidated against the base item
 * before any write, and the actual claim/delete uses a `TransactWriteItems` `ConditionCheck` on
 * the owning tenant's `TenantLifecycleRecord.status = ACTIVE` in the SAME transaction as the
 * delete — closing the TOCTOU the pre-D-179 worker had (a separate cached `GetItem` read).
 *
 * Poison-record handling (D-179 §8): when the tenant-ACTIVE `ConditionCheck` specifically fails
 * (not the delete's own version check — that is an ordinary, self-resolving race), this worker
 * increments `maintenanceAttemptCount` (observed on the revalidation read, never recomputed per
 * retry) and pushes `GSI8SK` forward by a capped exponential backoff; past `MAX_ATTEMPTS` it moves
 * the pointer to `GSI8PK = "DLQ#MEMBERSHIP_PURGE"` instead. Both writes are conditioned on the
 * `version` observed at revalidation — a `ConditionalCheckFailedException` here means someone else
 * already advanced the same counter, treated as an idempotent no-op, the exact same discipline
 * this worker already used for the delete itself (`isConditionalCheckFailed` ->
 * `skippedConcurrentlyModified`, never retried with recomputed data).
 */
import { isTransactionCanceled, getCancellationReasonCodes, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { tenantLifecycleKey } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import {
  MEMBERSHIP_RETENTION_DAYS,
  deriveMembershipMaintenanceDue,
  membershipGsi8Keys,
} from "../../modules/organization/domain/membership.js";
import type { MembershipPurgeCandidateSource } from "./candidate-source.js";

export { MEMBERSHIP_RETENTION_DAYS };

const TENANT_ACTIVE_STATUS = "ACTIVE";
const DLQ_GSI8PK = "DLQ#MEMBERSHIP_PURGE";

/** Hard cap on GSI8 pages drained per invocation — same rationale as this worker's own former
 * `MAX_PAGES`: bounds a single invocation against a pathological backlog; the query is ordered by
 * due date, so anything beyond this cap is still picked up (in order) by the next scheduled run —
 * unlike the pre-D-179 `Scan`, nothing is ever skipped permanently. */
const MAX_PAGES = 25;

/** Retries a stuck (tenant-not-ACTIVE) candidate this many times, at capped-exponential backoff,
 * before quarantining it to the DLQ namespace — bounds how long a single poison record can keep
 * reappearing in every run's GSI8 query. */
const MAX_ATTEMPTS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Capped exponential backoff (1, 2, 4, 8, 16 days, then quarantined) — same "cheap, boring,
 * capped" shape as every other retry policy already in this codebase; no fractional/jitter
 * refinement, this is a daily-cadence batch worker, not a hot path. */
function backoffDueAtIso(attemptNumber: number, nowIso: string): string {
  const days = Math.min(2 ** (attemptNumber - 1), 16);
  return new Date(Date.parse(nowIso) + days * MS_PER_DAY).toISOString();
}

/** Preserved for the existing eligibility-boundary test — now a thin wrapper over
 * `deriveMembershipMaintenanceDue()`, the single pure source of truth (D-179 §2). */
export function isPurgeEligibleByRemoval(removedAt: string, nowIso: string): boolean {
  const due = deriveMembershipMaintenanceDue({ status: "REMOVED", removedAt });
  return due !== undefined && Date.parse(due.dueAtIso) <= Date.parse(nowIso);
}

export interface MembershipPurgeDeps {
  candidates: MembershipPurgeCandidateSource;
  tableName: string;
  now: () => string;
}

export interface MembershipPurgeResult {
  scanned: number;
  purged: number;
  skippedTooRecent: number;
  skippedTenantNotActive: number;
  skippedConcurrentlyModified: number;
  /** New in D-179/D-180 — a stale GSI8 pointer (row reactivated or otherwise no longer a real
   * candidate) self-healed by removing GSI8PK/GSI8SK, never counted as a purge. */
  skippedStalePointer: number;
  /** New in D-179/D-180 — candidates moved to the DLQ#MEMBERSHIP_PURGE namespace this run,
   * having exceeded MAX_ATTEMPTS of a failing tenant-ACTIVE revalidation. Returned so the
   * handler (never this pure worker, AGENTS.md §7/D-007) can emit it as a metric. */
  quarantinedCount: number;
  /** New in D-179/D-180 — age in seconds of the oldest due candidate this run's GSI8 query
   * returned (before any processing), computed purely from `dueAtIso` vs `now`, no extra I/O.
   * `undefined` when no candidate was returned at all. The primary shard-trigger signal named
   * by D-179 §9 (only relevant once real sharding exists — not in this pilot). */
  oldestCandidateAgeSeconds: number | undefined;
}

export async function runMembershipPurge(deps: MembershipPurgeDeps): Promise<MembershipPurgeResult> {
  const result: MembershipPurgeResult = {
    scanned: 0,
    purged: 0,
    skippedTooRecent: 0,
    skippedTenantNotActive: 0,
    skippedConcurrentlyModified: 0,
    skippedStalePointer: 0,
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

      const membership = await deps.candidates.getMembership({ PK: candidate.PK, SK: candidate.SK });
      if (!membership) continue; // already purged by a prior/concurrent run - idempotent no-op

      const due = deriveMembershipMaintenanceDue(membership);
      if (!due) {
        // Row is no longer a real candidate at all (reactivated since being indexed) - self-heal
        // by clearing the pointer instead of leaving it to reappear in every future run's Query
        // forever. Conditioned on the exact version observed here; a lost race is a no-op, never
        // a throw (same discipline as the delete below).
        try {
          await deps.candidates.transactWrite([
            {
              Update: {
                TableName: deps.tableName,
                Key: { PK: candidate.PK, SK: candidate.SK },
                UpdateExpression: "REMOVE GSI8PK, GSI8SK",
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": membership.version },
              },
            },
          ]);
        } catch (err) {
          if (!isTransactionCanceled(err)) throw err;
        }
        result.skippedStalePointer += 1;
        continue;
      }
      if (Date.parse(due.dueAtIso) > nowMs) {
        // Defensive only - queryDue()'s own `GSI8SK < :before` filter means this should never be
        // reachable in practice, but eligibility is always re-derived here, never assumed from
        // the fact that the Query returned this row (D-179 §4 - GSI8 is discovery-only).
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
            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK) AND #version = :version",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: { ":version": membership.version },
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
          // Membership row itself changed concurrently - transient, self-resolves next run
          // against fresh state. Never counted as a poison attempt.
          result.skippedConcurrentlyModified += 1;
          continue;
        }

        if (!tenantCheckFailed) throw err; // unrecognized cancellation shape - never swallowed

        result.skippedTenantNotActive += 1;
        const nextAttempt = (membership.maintenanceAttemptCount ?? 0) + 1;
        const quarantine = nextAttempt > MAX_ATTEMPTS;
        const backoffUpdate: TransactWriteEntry = quarantine
          ? {
              Update: {
                TableName: deps.tableName,
                Key: { PK: candidate.PK, SK: candidate.SK },
                UpdateExpression: "SET GSI8PK = :dlq, maintenanceAttemptCount = :attempt",
                ConditionExpression: "version = :v AND GSI8PK = :work",
                ExpressionAttributeValues: {
                  ":dlq": DLQ_GSI8PK,
                  ":attempt": nextAttempt,
                  ":v": membership.version,
                  ":work": membershipGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: candidate.tenantId, membershipId: membership.membershipId }).GSI8PK,
                },
              },
            }
          : {
              Update: {
                TableName: deps.tableName,
                Key: { PK: candidate.PK, SK: candidate.SK },
                UpdateExpression: "SET GSI8SK = :sk, maintenanceAttemptCount = :attempt",
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: {
                  ":sk": membershipGsi8Keys({ dueAtIso: backoffDueAtIso(nextAttempt, nowIso), tenantId: candidate.tenantId, membershipId: membership.membershipId }).GSI8SK,
                  ":attempt": nextAttempt,
                  ":v": membership.version,
                },
              },
            };

        try {
          await deps.candidates.transactWrite([backoffUpdate]);
          if (quarantine) result.quarantinedCount += 1;
        } catch (backoffErr) {
          // Idempotent: someone else already advanced maintenanceAttemptCount/GSI8SK for this
          // exact row (a concurrent invocation, or this same run's retry of a transient error) -
          // the desired effect (counter advanced, pointer repositioned) is already guaranteed by
          // whoever won the condition. Never recomputed and retried (D-179 §8's explicit choice).
          if (!isTransactionCanceled(backoffErr)) throw backoffErr;
        }
      }
    }

    if (!gsi8Page.lastEvaluatedKey) break;
    exclusiveStartKey = gsi8Page.lastEvaluatedKey;
  }

  return result;
}
