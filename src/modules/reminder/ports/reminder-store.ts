/**
 * DynamoDB surface the Reminder module needs - same SDK-agnostic port pattern as
 * src/modules/expiration/ports/expiration-store.ts (AGENTS.md §6: "qualquer módulo futuro
 * com a mesma necessidade deve reusar esse formato de port, não inventar um novo"). This
 * IS that reuse: identical shape (get/putIfAbsent/update/transactWrite/queryGsi1-style),
 * plus one addition this module needs and Expiration didn't - `queryByItem`, to list an
 * item's existing ReminderOccurrence rows (co-located under the item's own PK per
 * data-model.md §2) for materialization diffing, due-date-change cancellation and DST
 * reconciliation.
 *
 * `ReminderProducerStore` is deliberately a SEPARATE, narrower interface (queryGsi3 only)
 * - implementation-blueprint.md §9.2's isolation safeguard ("nenhuma rota tenant-facing
 * tem permissão de Query no GSI3") is enforced structurally here: ReminderStore (used by
 * the policy service, materializer and HTTP handlers - all tenant-facing) has NO method
 * that can reach GSI3. Only ReminderProducerStore, injected exclusively into the
 * ReminderProducer worker, exposes it. test/integration/gsi3-isolation.test.ts asserts
 * this structurally (no tenant-facing dependency graph can reach queryGsi3).
 */
// 2026-08-19 (Engineering Maturity Review): imports from shared/dynamodb/occ.ts directly
// rather than re-exporting through expiration/ports/expiration-store.js - the previous
// indirection was an accidental cross-module ports->ports dependency (this module doesn't
// actually need anything Expiration-specific here, just the generic DynamoDB shapes).
export type { EntityKey, TransactWriteEntry, TransactPutEntry, TransactUpdateEntry } from "../../../shared/dynamodb/occ.js";
export { isTransactionCanceled } from "../../../shared/dynamodb/occ.js";
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";

export interface ReminderStore {
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
  update<T extends EntityKey>(item: T): Promise<void>;
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
  /** All rows under an item's own partition whose SK begins with "OCC#" (ReminderOccurrence rows). Strongly consistent - base-partition read, not a GSI (data-model.md §5). */
  queryByItem<T extends EntityKey = Record<string, unknown> & EntityKey>(tenantId: string, itemId: string): Promise<T[]>;
}

export interface Gsi3QueryInput {
  gsi3pk: string;
}

/** Narrow port, injected ONLY into the ReminderProducer worker (see file header). */
export interface ReminderProducerStore {
  queryGsi3<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi3QueryInput): Promise<T[]>;
  /** Strongly consistent read of the base item, used by the producer to reconstruct tenant context before claiming (data-model.md §3: "tenantId preservado... para reconstrução segura do contexto"). */
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  /** Conditional SCHEDULED -> CLAIMED transition (implementation-blueprint.md §9.3 point 3). */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}
