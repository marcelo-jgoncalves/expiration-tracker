/**
 * Narrow port for the DeliveryRecordPurgeWorker (D-152, `docs/architecture/reviews/
 * quarantine-retention-scoping/estado-final-consolidado.md` Prioridade 2 — `DELIVERY_RECORD`
 * = "intents/attempts" per `privacy-lgpd.md` §4 line 41, mapped to real code as
 * `NotificationIntent` (`src/modules/reminder/domain/notification-intent.ts`) and
 * `NotificationAttempt` (`src/modules/notification/domain/notification-attempt.ts`) — NOT
 * `AuditEvent`/`MembershipAuditEvent` (those are `SECURITY_AUDIT`, Prioridade 3, a completely
 * different LGPD class and out of scope here; see `purge.ts`'s module doc for the explicit
 * verification this worker did NOT confuse the two).
 *
 * Same deliberate full-table `Scan` tradeoff as `core-user-data-purge/candidate-source.ts` (see
 * that file's doc comment) — filtered by `entityType`/`attribute_exists(createdAt)`, not a GSI6
 * worklist: neither entity has an external side-effect (S3 object, lease) to protect with a
 * claim state, and adding a 5th GSI6 consumer for a class with no such need would widen that
 * closed isolation boundary (`data-model.md` §3, `infra/tests/stack.tftest.hcl`) for no reason.
 */
import type { DynamoDeleteCommandInput, EntityKey } from "../../shared/dynamodb/occ.js";

export interface DeliveryRecordPurgeCandidate extends EntityKey {
  entityType: "NotificationIntent" | "NotificationAttempt";
  tenantId: string;
  createdAt: string;
  version: number;
}

export interface DeliveryRecordScanPage {
  items: DeliveryRecordPurgeCandidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface DeliveryRecordPurgeCandidateSource {
  /** `Scan` with `FilterExpression: (entityType = :intent OR entityType = :attempt) AND
   * attribute_exists(createdAt)` — see file header for the cost tradeoff this accepts. */
  scanCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<DeliveryRecordScanPage>;
  /** Single conditioned `DeleteItem` — no companion write/receipt needed, same reasoning as
   * `core-user-data-purge`'s `deleteCandidate`. Throws the SDK's real
   * `ConditionalCheckFailedException` (recognized via `occ.ts#isConditionalCheckFailed`) when
   * the condition doesn't hold. */
  deleteCandidate(input: DynamoDeleteCommandInput): Promise<void>;
}

/**
 * Same ACTIVE-tenant fence as `core-user-data-purge`'s `TenantLifecycleStatusSource` — a tenant
 * mid-closure is the tenant-purge pipeline's job, never this worker's. Deliberately the same
 * narrow shape (not re-exported/shared) so each purge worker's port surface stays independently
 * readable, mirroring the precedent's own choice not to share this interface across workers.
 */
export interface TenantLifecycleStatusSource {
  getStatus(tenantId: string): Promise<string | undefined>;
}
