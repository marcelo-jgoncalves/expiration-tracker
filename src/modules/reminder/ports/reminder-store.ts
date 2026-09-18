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
import type { ReminderDueWorkItem } from "../domain/reminder-due-work.js";

export interface ReminderStore {
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
  putOccurrenceWithDueWork<T extends EntityKey>(occurrence: T, dueWork: ReminderDueWorkItem): Promise<boolean>;
  update<T extends EntityKey>(item: T): Promise<void>;
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
  /**
   * All rows under an item's own partition whose SK begins with `skPrefix` (default
   * `"OCC#"`, ReminderOccurrence rows). Strongly consistent - base-partition read, not a
   * GSI (data-model.md §5). BLOCKER-B reuses this exact query shape with `"POLICYREF#"` to
   * discover which ITEM-scoped policies point at an item (reminder-delivery-pipeline.md
   * §5) - deliberately generalized rather than adding a second near-identical method.
   */
  queryByItem<T extends EntityKey = Record<string, unknown> & EntityKey>(tenantId: string, itemId: string, skPrefix?: string): Promise<T[]>;
}

export interface Gsi3QueryInput {
  gsi3pk: string;
}

/**
 * D-300 (`reminder-producer-implementation-plan-scoping/DECISION.md` §2/§3): input for a SINGLE
 * GSI3 page, as opposed to `queryGsi3` above (which auto-paginates internally and returns
 * everything at once - the exact behavior that makes one producer invocation unable to bound its
 * own duration under a burst, PERF-12's root cause). `exclusiveStartKey` is the plain object form
 * (already deserialized via `deserializeCanonicalKey` - see `src/shared/dynamodb/canonical-key.ts`)
 * - callers own canonical (de)serialization, this port stays a thin DynamoDB wrapper.
 */
export interface Gsi3PageQueryInput {
  gsi3pk: string;
  exclusiveStartKey?: Record<string, unknown>;
  /** Page size cap (DECISION.md §3: "200 candidatos/página"). */
  limit: number;
}

export interface Gsi3Page<T> {
  items: T[];
  /** Present only if more pages remain for this `gsi3pk`. */
  lastEvaluatedKey?: Record<string, unknown>;
}

/** Narrow port, injected ONLY into the ReminderProducer worker (see file header). */
export interface ReminderProducerStore {
  queryGsi3<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi3QueryInput): Promise<T[]>;
  /** D-300: exactly ONE DynamoDB page per call (never the internal auto-pagination loop
   * `queryGsi3` uses) - `scan-page.ts` calls this once per Lambda invocation and checkpoints the
   * returned `lastEvaluatedKey` via the lease item before the next invocation continues. */
  queryGsi3Page<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi3PageQueryInput): Promise<Gsi3Page<T>>;
  /** Strongly consistent read of the base item, used by the producer to reconstruct tenant context before claiming (data-model.md §3: "tenantId preservado... para reconstrução segura do contexto"). */
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  /** Conditional SCHEDULED -> CLAIMED transition (implementation-blueprint.md §9.3 point 3). */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}
