/**
 * DynamoDB surface the expiration module needs. Follows the same SDK-agnostic port
 * pattern established by src/modules/identity/ports/identity-store.ts (M1): callers
 * inject an implementation, so domain/application logic is unit-testable without live
 * AWS. Unlike IdentityStore, this port also exposes `transactWrite` because
 * data-model.md §5's load-bearing sentence requires item update + outbox record (and,
 * for M2, the AuditEvent) to commit in a single `TransactWriteItems` — the aggregate
 * write, the critical `ItemDueDateChanged` outbox record and the audit trail must never
 * be individually visible without the others.
 */
import type { EntityKey, TransactPutEntry, TransactUpdateEntry, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";

// Re-exported for backward compatibility with existing importers (application/http layers
// of this and other modules) - canonical definitions now live in shared/dynamodb/occ.ts.
export type { EntityKey, TransactPutEntry, TransactUpdateEntry, TransactWriteEntry };
export { TRANSACTION_CANCELED, isTransactionCanceled } from "../../../shared/dynamodb/occ.js";

export interface Gsi1QueryInput {
  gsi1pk: string;
  ascending?: boolean;
  limit?: number;
}

export interface ExpirationStore {
  /** Strongly consistent single-item read (data-model.md §5: authorization/edition/pre-send reads must be consistent). */
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  /** PutItem with ConditionExpression attribute_not_exists(PK) - true if this call created the item. */
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
  /** Unconditional overwrite of an existing item - used only for non-OCC bookkeeping records (e.g. idempotency status transitions), never for ExpirationItem/AuditEvent. */
  update<T extends EntityKey>(item: T): Promise<void>;
  /**
   * Commits every entry atomically. Throws an error recognized by
   * isTransactionCanceled() if ANY entry's ConditionExpression fails - callers must not
   * assume partial application.
   */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
  /** Eventually consistent GSI1 query (data-model.md §3: vencimentos/dashboard). */
  queryGsi1<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi1QueryInput): Promise<T[]>;
}
