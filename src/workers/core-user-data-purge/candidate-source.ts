/**
 * Narrow port for the CoreUserDataPurgeWorker (D-151, `docs/architecture/reviews/
 * quarantine-retention-scoping/estado-final-consolidado.md` Prioridade 1 — `CORE_USER_DATA`
 * = `ExpirationItem`/`ReminderPolicy`, "itens, políticas" per `privacy-lgpd.md` §4;
 * `ReminderOccurrence` gets its own, separate TTL-native mechanism, see
 * `src/modules/reminder/domain/reminder-occurrence.ts`'s `purgeAfterTtl` field — never
 * scanned by this worker).
 *
 * Deliberately a full-table `Scan` filtered by `entityType`/`attribute_exists(deletedAt)`,
 * NOT a GSI6 claim/lease worklist like `document-purge`'s — same accepted cost tradeoff
 * `tenant-purge-sweep.ts`'s module doc already documents at this project's scale (DynamoDB
 * bills a Scan for every item read before the filter applies), chosen here specifically to
 * avoid adding a FIFTH consumer to GSI6's closed isolation boundary (`data-model.md` §3,
 * `infra/tests/stack.tftest.hcl`) for a class of soft-deleted row that has no external
 * side-effect (no S3 object, no lease needed) to protect with a claim state.
 */
import type { DynamoDeleteCommandInput, EntityKey } from "../../shared/dynamodb/occ.js";

export interface CoreUserDataPurgeCandidate extends EntityKey {
  entityType: "ExpirationItem" | "ReminderPolicy";
  tenantId: string;
  deletedAt: string;
  version: number;
}

export interface CoreUserDataScanPage {
  items: CoreUserDataPurgeCandidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface CoreUserDataPurgeCandidateSource {
  /** `Scan` with `FilterExpression: (entityType = :item OR entityType = :policy) AND
   * attribute_exists(deletedAt)` — see file header for the cost tradeoff this accepts. */
  scanDeletedCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<CoreUserDataScanPage>;
  /** Single conditioned `DeleteItem` — no companion write needed (unlike `document-purge`'s
   * Delete+Put receipt transaction): D-151's design names no `DELIVERY_RECORD`-class purge
   * receipt for `CORE_USER_DATA`, so this is a plain `DeleteCommand`, not a `TransactWriteItems`
   * of one. Throws the SDK's real `ConditionalCheckFailedException` (recognized via
   * `occ.ts#isConditionalCheckFailed`, not `isTransactionCanceled` — a lone `DeleteItem` fails
   * differently from a `TransactWriteItems` entry) when the condition doesn't hold. */
  deleteCandidate(input: DynamoDeleteCommandInput): Promise<void>;
}

/**
 * Separate, minimal port for the ACTIVE-tenant fence — this worker must never purge a record
 * belonging to a tenant that is mid-closure (`HELD_FOR_RECOVERY`/`DELETING`/`QUIESCING`/
 * `PURGING`/`VERIFIED`/`BLOCKED`/`HELD`/`DELETED`), since that is the tenant-lifecycle
 * pipeline's own job (`src/workers/tenant-purge/`), a completely separate mechanism from this
 * one (per-record retention within a LIVE tenant). A missing lifecycle record is treated as
 * NOT eligible (fail-closed) — every tenant gets one at creation (`create-organization.ts`), so
 * a missing record is itself an anomaly this worker should never paper over by assuming ACTIVE.
 */
export interface TenantLifecycleStatusSource {
  getStatus(tenantId: string): Promise<string | undefined>;
}
