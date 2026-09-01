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

/**
 * D-136/D-E (performance hot-path): one real DynamoDB physical page per call, never an
 * internal multi-call accumulate-then-slice loop (the pre-D-136 `queryGsi1` did that, and its
 * own `LastEvaluatedKey` could point past items the accumulated+sliced result never returned -
 * a real cursor-skip bug found in the D-136/D-E protocol). `exclusiveStartKey`/
 * `lastEvaluatedKey` are raw DynamoDB key shapes - this port stays SDK-agnostic and
 * HTTP-transport-agnostic; the opaque cursor string is encoded/decoded only at the HTTP edge
 * (item-handlers.ts), never in this port or its callers.
 */
export interface Gsi1PageInput {
  gsi1pk: string;
  ascending?: boolean;
  limit?: number;
  exclusiveStartKey?: Record<string, unknown>;
}
export interface Gsi1Page<T> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
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
  /** Eventually consistent GSI1 query, one physical page per call (data-model.md §3: vencimentos/dashboard). */
  queryGsi1Page<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi1PageInput): Promise<Gsi1Page<T>>;
  /**
   * Query pela partição do item com prefixo opcional de SK — adição puramente aditiva
   * (07-domain-model-escalation-watchers-digest.md, D-040) para listar `ItemWatch` sob a
   * mesma partição de `ExpirationItem`, mesmo padrão de coleção que `Document` (M6) já usa.
   * Não muda nenhum método/comportamento existente — zero risco de regressão ao agregado
   * ExpirationItem já em produção.
   */
  queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]>;
}
