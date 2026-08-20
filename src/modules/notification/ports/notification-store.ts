/**
 * DynamoDB surface the Notification module needs - same SDK-agnostic port pattern as
 * expiration/ports/expiration-store.ts and reminder/ports/reminder-store.ts.
 */
export type { EntityKey, TransactWriteEntry, TransactPutEntry, TransactUpdateEntry } from "../../../shared/dynamodb/occ.js";
export { isTransactionCanceled } from "../../../shared/dynamodb/occ.js";
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";

export interface NotificationStore {
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey, consistentRead?: boolean): Promise<T | undefined>;
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
  update<T extends EntityKey>(item: T): Promise<void>;
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
  /** Strongly consistent read of all `ATTEMPT#`-prefixed rows under an intent's own
   * partition (`TENANT#t#INTENT#i`) - same base-partition-query pattern as
   * ReminderStore.queryByItem. Used to find the most recent NotificationAttempt for a given
   * intent (corrective-intent-service.ts's REPLACEMENT vs CORRECTIVE decision). */
  queryAttemptsByIntent<T extends EntityKey = Record<string, unknown> & EntityKey>(tenantId: string, intentId: string): Promise<T[]>;
}
