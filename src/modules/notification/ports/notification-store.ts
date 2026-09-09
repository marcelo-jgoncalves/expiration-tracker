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
  /** D-8 (fatia 4/5, `whatsapp-portfolio-quota.ts`): full-pagination range Query against the
   * tenantless `PK=WHATSAPP#PORTFOLIO` partition, `SK` between `startSkInclusive` and
   * `endSkInclusive`. Real range Query, not a Scan — cost/pagination made explicit by returning
   * every page rather than a single bounded page (round3-claude-revision.md critério 3's "custo/
   * limite de paginação declarado"). Callers use this to compute the rolling-24h distinct-phone
   * count; see that module's hot-partition docstring for the accepted, named cost of this. */
  queryWhatsAppPortfolioQuotaWindow<T extends EntityKey = Record<string, unknown> & EntityKey>(
    startSkInclusive: string,
    endSkInclusive: string,
  ): Promise<T[]>;
}
