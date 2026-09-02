/**
 * TransientPurgeWorker — D-156, implementing D-127's approved scoping design
 * (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`,
 * `TRANSIENT` row, Prioridade 6). Physically purges `WebhookInbox` rows once `createdAt + 7 days`
 * has passed, and `UploadSlot` rows once their own `privacy-lgpd.md` §4 window has passed
 * (`reservedAt + 7 days` if the slot was ever `CONSUMED`, `reservedAt + 24 hours` otherwise).
 * `InvitationTokenPointer`, the third entity named on the same `privacy-lgpd.md` line, is already
 * resolved via native DynamoDB TTL and is untouched by this worker.
 *
 * D-179/D-188 (MaintenanceDueIndex, slice 7 — mirrors `security-audit-purge`'s (D-187) shape for
 * the poison-record/DLQ mechanism and `invitation-purge`'s (D-182) shape for a multi-transition
 * entity needing pointer refresh at every relevant write): candidates now come from a `Query`
 * against GSI8 (`candidate-source.ts`), replacing the base-table `Scan` this worker used through
 * D-187. GSI8 is discovery-only (D-179 §4): every candidate is revalidated against the base item
 * before any write, and the actual claim/delete uses a `TransactWriteItems` `ConditionCheck` on
 * the owning tenant's `TenantLifecycleRecord.status = ACTIVE` in the SAME transaction as the
 * delete — closing the TOCTOU the pre-GSI8 `Scan`+separate-lifecycle-lookup pattern had.
 *
 * A `RESERVED` `UploadSlot` never gets a GSI8 pointer written for it in the first place (see
 * `shared/transient-purge-gsi8.ts#deriveUploadSlotMaintenanceDue`, and the writers listed there) —
 * so it can never appear in this worker's GSI8 query at all, unlike the pre-GSI8 `Scan` which had
 * to filter it out defensively at read time.
 *
 * **Delete re-asserts `version`** (same shape as membership-purge/invitation-purge, unlike
 * security-audit-purge's version-less append-only family): both `WebhookInbox` and `UploadSlot`
 * carry a real `version` counter bumped on every write, asserted unchanged as the "hasn't moved
 * since the GSI8 query" fence.
 *
 * Poison-record handling (D-179 §8, same shape as every other tenant-fenced migrated worker): when
 * the tenant-ACTIVE `ConditionCheck` specifically fails, this worker increments
 * `maintenanceAttemptCount` and pushes `GSI8SK` forward by a capped exponential backoff; past
 * `MAX_ATTEMPTS` it moves the pointer to `GSI8PK = "DLQ#TRANSIENT"` instead.
 *
 * **Defensive self-heal branch** (same posture as `invitation-purge`'s, D-182): neither entity has
 * a real write path today that could leave a stale/no-longer-eligible GSI8 pointer behind (a
 * WebhookInbox pointer is written once at creation and never touched again except by this worker's
 * own delete; an UploadSlot's CONSUMED/EXPIRED transition is terminal — nothing transitions it back
 * to RESERVED), but the branch below is kept as the only way a malformed/pre-migration row could
 * ever be repaired, exactly mirroring `invitation-purge`'s own reasoning for keeping it despite an
 * identical absence of a real trigger.
 */
import { isTransactionCanceled, getCancellationReasonCodes, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { tenantLifecycleKey } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import {
  WEBHOOK_INBOX_RETENTION_DAYS,
  deriveWebhookInboxMaintenanceDue,
  deriveUploadSlotMaintenanceDue,
  transientPurgeGsi8Keys,
} from "../../shared/transient-purge-gsi8.js";
import type { TransientPurgeCandidate, TransientPurgeCandidateSource, UploadSlotPurgeCandidate } from "./candidate-source.js";

export { WEBHOOK_INBOX_RETENTION_DAYS };

const TENANT_ACTIVE_STATUS = "ACTIVE";
const DLQ_GSI8PK = "DLQ#TRANSIENT";

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

/** Preserved for the existing eligibility-boundary tests — thin wrapper over
 * `deriveWebhookInboxMaintenanceDue()`, the single pure source of truth (D-179 §2). */
export function isWebhookInboxPurgeEligible(createdAt: string, nowIso: string): boolean {
  const due = deriveWebhookInboxMaintenanceDue({ createdAt });
  return Date.parse(due.dueAtIso) <= Date.parse(nowIso);
}

/** Preserved for the existing eligibility-boundary tests — thin wrapper over
 * `deriveUploadSlotMaintenanceDue()`. Returns `false` (never a candidate) for `RESERVED`. */
export function isUploadSlotPurgeEligible(candidate: Pick<UploadSlotPurgeCandidate, "status" | "reservedAt">, nowIso: string): boolean {
  const due = deriveUploadSlotMaintenanceDue(candidate);
  return due !== undefined && Date.parse(due.dueAtIso) <= Date.parse(nowIso);
}

/** Re-derives the maintenance-due date for whichever entity type a candidate turns out to be —
 * `undefined` means "no longer a real candidate" (stale-pointer self-heal case; RESERVED for
 * UploadSlot, though no writer ever leaves a pointer around for that state). */
function deriveDue(candidate: TransientPurgeCandidate): { dueAtIso: string } | undefined {
  if (candidate.entityType === "WebhookInbox") return deriveWebhookInboxMaintenanceDue(candidate);
  return deriveUploadSlotMaintenanceDue(candidate);
}

export interface TransientPurgeDeps {
  candidates: TransientPurgeCandidateSource;
  tableName: string;
  now: () => string;
}

export interface TransientPurgeResult {
  scanned: number;
  purged: number;
  skippedTooRecent: number;
  skippedTenantNotActive: number;
  skippedConcurrentlyModified: number;
  /** A stale/no-longer-eligible GSI8 pointer self-healed by removing GSI8PK/GSI8SK, never counted
   * as a purge — see file header for why no real write path produces this today. */
  skippedStalePointer: number;
  /** Candidates moved to the DLQ#TRANSIENT namespace this run, having exceeded MAX_ATTEMPTS of a
   * failing tenant-ACTIVE revalidation. */
  quarantinedCount: number;
  /** Age in seconds of the oldest due candidate this run's GSI8 query returned. `undefined` when
   * no candidate was returned at all. */
  oldestCandidateAgeSeconds: number | undefined;
}

export async function runTransientPurge(deps: TransientPurgeDeps): Promise<TransientPurgeResult> {
  const result: TransientPurgeResult = {
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

      const row = await deps.candidates.getCandidate({ PK: candidate.PK, SK: candidate.SK });
      if (!row) continue; // already purged by a prior/concurrent run - idempotent no-op

      const due = deriveDue(row);
      if (!due) {
        // Row is no longer a real candidate (see file header). Conditioned on the exact version
        // observed here; a lost race is a no-op.
        try {
          await deps.candidates.transactWrite([
            {
              Update: {
                TableName: deps.tableName,
                Key: { PK: candidate.PK, SK: candidate.SK },
                UpdateExpression: "REMOVE GSI8PK, GSI8SK",
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": row.version },
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
            ExpressionAttributeValues: { ":version": row.version },
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
                ConditionExpression: "version = :v AND GSI8PK = :work",
                ExpressionAttributeValues: {
                  ":dlq": DLQ_GSI8PK,
                  ":attempt": nextAttempt,
                  ":v": row.version,
                  ":work": transientPurgeGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: candidate.tenantId, entityType: row.entityType, sk: candidate.SK }).GSI8PK,
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
                  ":sk": transientPurgeGsi8Keys({
                    dueAtIso: backoffDueAtIso(nextAttempt, nowIso),
                    tenantId: candidate.tenantId,
                    entityType: row.entityType,
                    sk: candidate.SK,
                  }).GSI8SK,
                  ":attempt": nextAttempt,
                  ":v": row.version,
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
