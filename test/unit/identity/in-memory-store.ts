import type { EntityKey, IdentityStore } from "../../../src/modules/identity/ports/identity-store.js";

/**
 * In-memory fake of the DynamoDB-backed IdentityStore port, mirroring the semantics
 * required by the identity module (attribute_not_exists(PK) for putIfAbsent). Used by
 * unit + the cross-tenant negative suite so tests exercise real resolver/authz/quota
 * logic without requiring live AWS credentials, same convention as M0's occ/idempotency
 * tests.
 */
export class InMemoryIdentityStore implements IdentityStore {
  private readonly items = new Map<string, Record<string, unknown> & EntityKey>();

  private k(key: EntityKey): string {
    return `${key.PK}#${key.SK}`;
  }

  async putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    const k = this.k(item);
    if (this.items.has(k)) return false;
    this.items.set(k, item as unknown as Record<string, unknown> & EntityKey);
    return true;
  }

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    return this.items.get(this.k(key)) as T | undefined;
  }

  async update<T extends EntityKey>(item: T): Promise<void> {
    this.items.set(this.k(item), item as unknown as Record<string, unknown> & EntityKey);
  }

  async updateConditional<T extends EntityKey>(
    item: T,
    expected: { count: number; resetAt: string },
  ): Promise<boolean> {
    const k = this.k(item);
    const stored = this.items.get(k) as (Record<string, unknown> & EntityKey) | undefined;
    const currentCount = stored?.["count"];
    const currentResetAt = stored?.["resetAt"];
    if (currentCount !== expected.count || currentResetAt !== expected.resetAt) return false;
    this.items.set(k, item as unknown as Record<string, unknown> & EntityKey);
    return true;
  }

  /** Test-only helper to list raw keys, for cross-tenant leakage assertions. */
  allKeys(): string[] {
    return [...this.items.keys()];
  }
}

let counter = 0;
export function makeIdGenerator() {
  return {
    newUserId: () => `user-${++counter}`,
    newSessionId: () => `session-${++counter}`,
  };
}
