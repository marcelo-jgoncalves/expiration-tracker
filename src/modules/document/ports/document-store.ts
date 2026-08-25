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
