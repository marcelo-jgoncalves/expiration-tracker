/**
 * Narrow port for the TransientPurgeWorker (D-156, `docs/architecture/reviews/
 * quarantine-retention-scoping/estado-final-consolidado.md` `TRANSIENT` row, Prioridade 6 — the
 * remainder after `InvitationTokenPointer` was already resolved via native TTL, `privacy-lgpd.md`
 * §4 line 42). Investigated both remaining named entities:
 *
 * - `WebhookInbox` (`src/modules/notification/application/ses-callback-workflow.ts`) — created on
 *   every inbound SES/SNS delivery callback, one row per `(tenantId, providerAccountId,
 *   snsMessageId)`, purely an idempotency/audit record once its correlated `NotificationAttempt`
 *   has been updated. NO `purgeAfterTtl` field, no TTL wiring, no other purge path anywhere in the
 *   codebase — genuinely unresolved, matches D-154's "TenantQuotaRecord" shape exactly (a real gap,
 *   not a duplicate of an existing mechanism). Clock: `createdAt` (the inbox row's own creation
 *   time — the moment the webhook was received; `occurredAt`, the provider's event timestamp, is a
 *   few seconds earlier at most and not the field the design's "7 dias" language is anchored to).
 *
 * - `UploadSlot` (`src/modules/document/domain/upload-slot.ts`) — reserved by `reserveUpload()`,
 *   resolved to `CONSUMED` (successful upload) by `advance-after-evidence.ts` or to `EXPIRED` (never
 *   confirmed in time) by `UploadSlotReconciliationWorker` (`src/workers/upload-slot-reconciliation/
 *   reconciliation.ts`). That reconciliation worker only flips `status`; it never deletes the row.
 *   The entity already carries a `purgeAfter` field and a ready-made, already-approved formula for
 *   it — `computeUploadSlotPurgeAfter()` (`src/modules/document/domain/retention.ts`, M6 design,
 *   directly encodes `privacy-lgpd.md`'s "7 dias; slot incompleto: 24h") — but BOTH are dead: no
 *   writer ever calls `computeUploadSlotPurgeAfter`, `purgeAfter` is set once at reservation time to
 *   the short-lived `expiresAt` and never recomputed, and — decisively — `purgeAfter` is a plain
 *   ISO-string attribute, not `purgeAfterTtl` (the table's actual native-TTL attribute name,
 *   `infra/modules/dynamo-table/main.tf`), so DynamoDB's TTL sweeper never looks at it regardless.
 *   Genuinely unresolved, same shape as `UploadSlot`'s neighbor investigation in D-154. A slot still
 *   `RESERVED` is still an active, in-flight reservation — never a purge candidate regardless of
 *   age (a stuck reconciliation sweep is an operational incident to fix, not a reason to physically
 *   delete a row a client may still be racing to confirm); this worker is scoped strictly to
 *   `CONSUMED`/`EXPIRED`/`RELEASED` slots. "Incompleto" (24h window) = never reached `CONSUMED`
 *   (i.e. `status !== "CONSUMED"`); "confirmed" (7-day window) = `status === "CONSUMED"` — exactly
 *   `computeUploadSlotPurgeAfter`'s own `wasConfirmed` parameter, reused verbatim rather than
 *   reinvented.
 *
 * Single `Scan` (same deliberate full-table tradeoff as D-151/152/153/154/155's candidate sources)
 * filtered to `entityType IN (WebhookInbox, UploadSlot)` — both entity types share one page so one
 * worker invocation drains the whole `TRANSIENT` remainder, mirroring the design doc's own grouping
 * of both rows under a single "TRANSIENT" line.
 */
import type { DynamoDeleteCommandInput, EntityKey } from "../../shared/dynamodb/occ.js";
import type { UploadSlotStatus } from "../../modules/document/domain/upload-slot.js";

export interface WebhookInboxPurgeCandidate extends EntityKey {
  entityType: "WebhookInbox";
  tenantId: string;
  createdAt: string;
  version: number;
}

export interface UploadSlotPurgeCandidate extends EntityKey {
  entityType: "UploadSlot";
  tenantId: string;
  reservedAt: string;
  status: UploadSlotStatus;
  version: number;
}

export type TransientPurgeCandidate = WebhookInboxPurgeCandidate | UploadSlotPurgeCandidate;

export interface TransientPurgeScanPage {
  items: TransientPurgeCandidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface TransientPurgeCandidateSource {
  /** `Scan` with `FilterExpression: entityType IN (:webhookInbox, :uploadSlot)` — see file header
   * for the cost tradeoff this accepts. */
  scanCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<TransientPurgeScanPage>;
  /** Single conditioned `DeleteItem` (`buildVersionedDelete` — both entities carry a real `version`
   * counter, unlike D-153/D-154's append-only/counter-only entities). Throws the SDK's real
   * `ConditionalCheckFailedException` (recognized via `occ.ts#isConditionalCheckFailed`) when the
   * condition doesn't hold. */
  deleteCandidate(input: DynamoDeleteCommandInput): Promise<void>;
}

/**
 * Same ACTIVE-tenant fence as every other purge worker's `TenantLifecycleStatusSource` — a tenant
 * mid-closure is the tenant-purge pipeline's job, never this worker's. Deliberately the same narrow
 * shape (not re-exported/shared), mirroring the precedents' own choice to keep each purge worker's
 * port surface independently readable.
 */
export interface TenantLifecycleStatusSource {
  getStatus(tenantId: string): Promise<string | undefined>;
}
