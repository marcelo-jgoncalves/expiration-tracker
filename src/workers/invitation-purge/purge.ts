/**
 * InvitationPurgeWorker — D-155's approved Prioridade 5, `Invitation` leg. Physically purges
 * `Invitation` rows (`src/modules/organization/domain/invitation.ts`) once terminal (`REVOKED` or
 * expired-`PENDING`) + 30 days has passed, for a tenant that is itself still `ACTIVE`.
 *
 * D-179/D-181 (MaintenanceDueIndex, slice 2 — mirrors the D-180 membership-purge pilot exactly):
 * candidates now come from a `Query` against GSI8 (`candidate-source.ts`), replacing the
 * `Scan`+`Limit`+bounded-pages this worker used through D-181. GSI8 is discovery-only (D-179 §4):
 * every candidate is revalidated against the base item before any write, and the actual
 * claim/delete uses a `TransactWriteItems` `ConditionCheck` on the owning tenant's
 * `TenantLifecycleRecord.status = ACTIVE` in the SAME transaction as the delete.
 *
 * Poison-record handling (D-179 §8, same shape as membership-purge): when the tenant-ACTIVE
 * `ConditionCheck` specifically fails, this worker increments `maintenanceAttemptCount` and pushes
 * `GSI8SK` forward by a capped exponential backoff; past `MAX_ATTEMPTS` it moves the pointer to
 * `GSI8PK = "DLQ#INVITATION_PURGE"` instead.
 *
 * **No obsolete-pointer reactivation case for Invitation** (unlike Membership, which can be
 * reactivated REMOVED->ACTIVE via accept-invitation.ts): once an `Invitation` reaches `REVOKED` or
 * `ACCEPTED` it is terminal — there is no code path that transitions a row back to `PENDING` or out
 * of `REVOKED`/`ACCEPTED`. `ACCEPTED` clears its own GSI8 pointer atomically at the transition
 * (`accept-invitation.ts`), so it never appears in a GSI8 query at all. The stale-pointer self-heal
 * branch below is still implemented (same defensive posture as membership-purge, and it is the
 * only way a malformed/pre-migration row could ever be repaired), but there is no real write path
 * in this codebase that would ever produce a stale INVITATION_PURGE pointer today.
 */
import { isTransactionCanceled, getCancellationReasonCodes, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { tenantLifecycleKey } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import {
  INVITATION_RETENTION_DAYS,
  deriveInvitationMaintenanceDue,
  invitationGsi8Keys,
} from "../../modules/organization/domain/invitation.js";
import type { InvitationPurgeCandidateSource } from "./candidate-source.js";

export { INVITATION_RETENTION_DAYS };

const TENANT_ACTIVE_STATUS = "ACTIVE";
const DLQ_GSI8PK = "DLQ#INVITATION_PURGE";

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
 * `deriveInvitationMaintenanceDue()`, the single pure source of truth (D-179 §2). */
export function isPurgeEligibleByTermination(candidate: { status: "REVOKED" | "PENDING"; revokedAt?: string; expiresAt: string }, nowIso: string): boolean {
  const due = deriveInvitationMaintenanceDue(candidate);
  return due !== undefined && Date.parse(due.dueAtIso) <= Date.parse(nowIso);
}

export interface InvitationPurgeDeps {
  candidates: InvitationPurgeCandidateSource;
  tableName: string;
  now: () => string;
}

export interface InvitationPurgeResult {
  scanned: number;
  purged: number;
  skippedTooRecent: number;
  skippedTenantNotActive: number;
  skippedConcurrentlyModified: number;
  /** A stale GSI8 pointer (no real path produces this today for Invitation, see file header)
   * self-healed by removing GSI8PK/GSI8SK, never counted as a purge. */
  skippedStalePointer: number;
  /** Candidates moved to the DLQ#INVITATION_PURGE namespace this run, having exceeded
   * MAX_ATTEMPTS of a failing tenant-ACTIVE revalidation. */
  quarantinedCount: number;
  /** Age in seconds of the oldest due candidate this run's GSI8 query returned. `undefined` when
   * no candidate was returned at all. */
  oldestCandidateAgeSeconds: number | undefined;
}

export async function runInvitationPurge(deps: InvitationPurgeDeps): Promise<InvitationPurgeResult> {
  const result: InvitationPurgeResult = {
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

      const invitation = await deps.candidates.getInvitation({ PK: candidate.PK, SK: candidate.SK });
      if (!invitation) continue; // already purged by a prior/concurrent run - idempotent no-op

      const due = deriveInvitationMaintenanceDue(invitation);
      if (!due) {
        // Row is no longer a real candidate (see file header - no real path produces this for
        // Invitation today, but the self-heal is defensive against a malformed/pre-migration
        // row). Conditioned on the exact version observed here; a lost race is a no-op.
        try {
          await deps.candidates.transactWrite([
            {
              Update: {
                TableName: deps.tableName,
                Key: { PK: candidate.PK, SK: candidate.SK },
                UpdateExpression: "REMOVE GSI8PK, GSI8SK",
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": invitation.version },
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
            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK) AND #version = :version",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: { ":version": invitation.version },
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
          // Invitation row itself changed concurrently - transient, self-resolves next run.
          result.skippedConcurrentlyModified += 1;
          continue;
        }

        if (!tenantCheckFailed) throw err; // unrecognized cancellation shape - never swallowed

        result.skippedTenantNotActive += 1;
        const nextAttempt = (invitation.maintenanceAttemptCount ?? 0) + 1;
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
                  ":v": invitation.version,
                  ":work": invitationGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: candidate.tenantId, invitationId: invitation.invitationId }).GSI8PK,
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
                  ":sk": invitationGsi8Keys({ dueAtIso: backoffDueAtIso(nextAttempt, nowIso), tenantId: candidate.tenantId, invitationId: invitation.invitationId }).GSI8SK,
                  ":attempt": nextAttempt,
                  ":v": invitation.version,
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
