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
  update<T extends EntityKey>(item: T): Promise<void>;
}
