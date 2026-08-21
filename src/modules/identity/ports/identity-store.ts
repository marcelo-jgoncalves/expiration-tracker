/**
 * Minimal DynamoDB surface the identity module needs, following the SDK-agnostic port
 * pattern established in src/shared/idempotency/idempotency.ts (M0): callers inject an
 * implementation of this port, so the module is unit-testable without live AWS. M1's
 * infra layer (infra/lib) provisions the real table; src/modules/identity/persistence
 * wires a DocumentClient-backed adapter to this same port for production use.
 */
export interface EntityKey {
  PK: string;
  SK: string;
}

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
}
