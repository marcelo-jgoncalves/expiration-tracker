/** DynamoDB surface the Document module needs — same port pattern as reminder-store.ts/
 * expiration-store.ts (AGENTS.md §6). */
export type { EntityKey, TransactWriteEntry, TransactPutEntry, TransactUpdateEntry } from "../../../shared/dynamodb/occ.js";
export { isTransactionCanceled, isConditionalCheckFailed } from "../../../shared/dynamodb/occ.js";
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";

export interface DocumentStore {
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey, consistentRead?: boolean): Promise<T | undefined>;
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
  update<T extends EntityKey>(item: T): Promise<void>;
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
  /** BLOCKER-A: lists a Document's item partition (`TENANT#t#ITEM#i`) filtered by SK prefix
   * (`DOC#`) — same shape as ExpirationStore.queryByPk/ReminderStore's item-partition query,
   * no new GSI needed since Document is already keyed under the item's own partition
   * (data-model.md line 34). */
  queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]>;
}

/** Global (non-tenant-prefixed) GSI6 key for slots pending reconciliation — same convention
 * already used by reminder-reconciliation/outbox-sweeper (WORKSTATE#CLAIMED,
 * RECON#OUTBOX#PENDING). Documented explicitly here because adding a THIRD real consumer of
 * GSI6 is itself a real structural change (M6 design §"riscos") to an isolation boundary that
 * used to be closed to exactly 2 roles — see infra/tests/stack.tftest.hcl's
 * gsi6_access_granted_only_to_reconciliation_and_sweeper test, renamed as part of this
 * milestone to include upload-slot-reconciliation. */
export const GSI6PK_RECON_UPLOAD_PENDING = "RECON#UPLOAD#PENDING";

/** Real bug found via Camada 3 verification against AWS real (2026-08-25, dev account):
 * `reserveUpload` never actually wrote `GSI6PK`/`GSI6SK` onto the `UploadSlot` it created -
 * confirmed empirically (a fabricated expired RESERVED slot with no GSI6 attributes was
 * invisible to the real deployed worker, `resultCount: 0`; the SAME item with these two
 * attributes added manually was found and correctly reconciled on the next invocation).
 * Every expired upload reservation in production was silently never cleaned up. Same
 * `<sortKey>#TENANT#<tenantId>#<ENTITY>#<id>` uniqueness-suffix convention as
 * `buildExpiredClaimGsi6Sk`/`buildDstCandidateGsi6Sk` (reminder module) - required because
 * GSI6SK must be unique per GSI6PK partition, and two slots can share the same expiresAt. */
export function buildUploadSlotGsi6Sk(expiresAt: string, tenantId: string, uploadSlotId: string): string {
  return `${expiresAt}#TENANT#${tenantId}#SLOT#${uploadSlotId}`;
}

/** W3-06 (D-061): purge worklist pointers, same global WORKSTATE convention. `PENDING` is the
 * candidate queue (written by `DocumentDeletionService` in the same transaction as the
 * soft-delete); `CLAIMED` is the lease state `DocumentPurgeWorker` moves a `Document` into while
 * it performs the (non-transactional) S3 deletion. `DocumentPurgeReceipt` never needs `CLAIMED`
 * - it has no external side effect to protect with a lease, so it is deleted directly from
 * `PENDING` in one conditioned transaction. */
export const GSI6PK_PURGE_PENDING = "WORKSTATE#PURGE_PENDING";
export const GSI6PK_PURGE_CLAIMED = "WORKSTATE#PURGE_CLAIMED";

export function buildDocumentPurgeGsi6Sk(purgeAfter: string, tenantId: string, documentId: string): string {
  return `${purgeAfter}#TENANT#${tenantId}#DOCUMENT#${documentId}`;
}

export function buildDocumentPurgeClaimGsi6Sk(claimExpiresAt: string, tenantId: string, documentId: string): string {
  return `${claimExpiresAt}#TENANT#${tenantId}#DOCUMENT#${documentId}`;
}

export function buildPurgeReceiptGsi6Sk(purgeAfter: string, tenantId: string, documentId: string): string {
  return `${purgeAfter}#TENANT#${tenantId}#PURGERECEIPT#${documentId}`;
}

export interface Gsi6QueryInput {
  gsi6pk: string;
  before: string;
  pageSize?: number;
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  cursor?: string;
}

/** Narrow port, injected ONLY into the UploadSlotReconciliationWorker — same isolation
 * safeguard pattern as ReminderProducerStore/ReminderReconciliationCandidateSource. */
export interface UploadSlotReconciliationSource {
  queryExpiredSlots<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi6QueryInput): Promise<Page<T>>;
}
