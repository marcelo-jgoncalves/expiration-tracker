/**
 * Minimal DynamoDB surface the identity module needs, following the SDK-agnostic port
 * pattern established in src/shared/idempotency/idempotency.ts (M0): callers inject an
 * implementation of this port, so the module is unit-testable without live AWS. M1's
 * infra layer (infra/lib) provisions the real table; src/modules/identity/persistence
 * wires a DocumentClient-backed adapter to this same port for production use.
 */
import type { TransactWriteEntry } from "../../../shared/dynamodb/occ.js";

export interface EntityKey {
  PK: string;
  SK: string;
}

// Re-exported for callers that build transactions against IdentityStore (W3-07 atomic
// bootstrap, decisions-log.md D-067) - canonical definitions live in shared/dynamodb/occ.ts,
// same convention already established by expiration/ports/expiration-store.ts.
export type { TransactWriteEntry };

export interface IdentityStore {
  /** PutItem with ConditionExpression attribute_not_exists(PK) - true if this call created the item. */
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  /** Unconditional overwrite - only for bookkeeping writes with no concurrent-writer risk (see quota.ts for the counter case, which needs updateConditional instead). */
  update<T extends EntityKey>(item: T): Promise<void>;
  /**
   * PutItem gated on the counter field(s) still matching `expected` at write time (full audit
   * round1, eixo Governança de Produto, criterio 3 - TenantQuota.consume() did a
   * read-modify-write over the unconditional `update`, allowing lost updates under concurrent
   * requests for the same tenant/quotaType). Returns false on conditional-check failure so the
   * caller can re-read and retry instead of silently overwriting a concurrent writer's count.
   */
  updateConditional<T extends EntityKey>(item: T, expected: { count: number; resetAt: string }): Promise<boolean>;
  /**
   * Commits every entry atomically - added for W3-07 (D-067) atomic bootstrap
   * (`IdentityMapping` + `TenantLifecycleRecord(ACTIVE)` + `User` in a single
   * TransactWriteItems) and for `TenantBusinessMutation` callers built against this store.
   * Same contract as ExpirationStore.transactWrite (expiration/ports/expiration-store.ts,
   * M2): throws an error recognized by occ.ts's isTransactionCanceled() if ANY entry's
   * ConditionExpression fails - callers must not assume partial application.
   */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
  /**
   * Atomic `ADD`-only `UpdateItem` for the `EphemeralTelemetryMutation` lane (D-136 D-D,
   * `docs/architecture/reviews/performance-hotpath-scoping/estado-final-consolidado.md`) — the
   * cheap counterpart to `transactWrite` for `API_REQUEST` quota telemetry. Deliberately NOT a
   * `Get` + conditional write: no `ConditionExpression` at all, so it never repeats the W3-07
   * lifecycle `ConditionCheck` `transactWrite` pays on every call — the design's approved trade
   * is that the caller has already read `ACTIVE` (stale) upstream and this lane only records
   * telemetry, never a business admission. `ADD` on a key with no existing item creates it
   * (real DynamoDB `UpdateItem` semantics), so this also replaces the old `Get`-then-`Put`
   * bootstrap for the counter's first write in a window. Returns the post-increment count so
   * the caller can compare it against its own limit without a second round trip.
   */
  incrementTelemetryCounter(input: TelemetryIncrementInput): Promise<{ count: number }>;
}

export interface TelemetryIncrementInput {
  key: EntityKey;
  tenantId: string;
  quotaType: string;
  windowSeconds: number;
  /** ISO timestamp the current fixed window closes at - a pure function of the window bucket
   * the caller already derived, written on every increment (idempotent: identical value every
   * time within the same window, since the window bucket determines it deterministically). */
  resetAt: string;
  /** Epoch SECONDS - the main table's native TTL attribute (`infra/modules/dynamo-table/main.tf`,
   * always `purgeAfterTtl`, confirmed against the Terraform test asserting that exact attribute
   * name) - best-effort early cleanup only, never the removal guarantee (AWS does not bound TTL
   * deletion latency); the real guarantee is the QuotaTelemetryPurgeWorker's explicit
   * resetAt+30d sweep (D-154), widened to this entity type alongside this change. */
  purgeAfterTtl: number;
}
