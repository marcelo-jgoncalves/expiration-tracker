import type { EntityKey, IdentityStore, TransactWriteEntry } from "../../../src/modules/identity/ports/identity-store.js";

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

  /**
   * transactWrite - evaluates only the ConditionExpression shapes this codebase actually
   * produces for IdentityStore transactions (W3-07 atomic bootstrap + TenantBusinessMutation
   * lane): occ.ts's `attribute_not_exists(PK) AND attribute_not_exists(SK)` creation
   * condition (Put), and its `attribute_exists(PK) AND #c0 = :c0 [AND #c1 = :c1 ...]`
   * existence+equality condition (ConditionCheck, from buildExistenceConditionCheck - the
   * lifecycle fence). Same "known shapes only, two-pass validate-then-apply" convention as
   * test/unit/expiration/in-memory-store.ts.
   */
  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    // Pass 1: validate every condition without mutating anything.
    for (const entry of entries) {
      if ("Put" in entry) {
        const exists = this.items.has(this.k(entry.Put.Item as unknown as EntityKey));
        if (entry.Put.ConditionExpression.includes("attribute_not_exists(PK)") && exists) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on Put" };
        }
      } else if ("ConditionCheck" in entry) {
        const check = entry.ConditionCheck;
        const existing = this.items.get(this.k(check.Key));
        if (check.ConditionExpression.includes("attribute_exists(PK)") && !existing) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed: item missing" };
        }
        const names = check.ExpressionAttributeNames ?? {};
        const values = check.ExpressionAttributeValues ?? {};
        for (const [nameKey, fieldName] of Object.entries(names)) {
          const valueKey = `:${nameKey.slice(1)}`;
          if (!(valueKey in values)) continue; // not an equality placeholder pair
          const expected = values[valueKey];
          if (!existing || existing[fieldName] !== expected) {
            throw { name: "TransactionCanceledException", message: `ConditionalCheckFailed: ${fieldName} mismatch` };
          }
        }
      } else if ("Update" in entry) {
        const key = entry.Update.Key;
        const existing = this.items.get(this.k(key));
        if (entry.Update.ConditionExpression.includes("attribute_exists(PK)")) {
          if (!existing) {
            throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed: item missing" };
          }
          const expectedVersion = entry.Update.ExpressionAttributeValues[":expectedVersion"];
          const expectedTenantId = entry.Update.ExpressionAttributeValues[":tenantId"];
          if (existing["version"] !== expectedVersion || existing["tenantId"] !== expectedTenantId) {
            throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed: version/tenant mismatch" };
          }
        }
      }
    }

    // Pass 2: apply (Put/Update only - ConditionCheck never mutates).
    for (const entry of entries) {
      if ("Put" in entry) {
        this.items.set(this.k(entry.Put.Item as unknown as EntityKey), entry.Put.Item as Record<string, unknown> & EntityKey);
      } else if ("Update" in entry) {
        const key = entry.Update.Key;
        const existing = this.items.get(this.k(key)) ?? { ...key };
        const next: Record<string, unknown> & EntityKey = { ...existing };
        for (const [name, placeholder] of Object.entries(entry.Update.ExpressionAttributeNames)) {
          if (placeholder === "version") {
            next["version"] = ((existing["version"] as number | undefined) ?? 0) + 1;
          } else if (placeholder === "updatedAt") {
            next["updatedAt"] = entry.Update.ExpressionAttributeValues[":now"];
          } else if (name.startsWith("#set")) {
            const valueKey = `:${name.slice(1)}`;
            next[placeholder] = entry.Update.ExpressionAttributeValues[valueKey];
          }
        }
        this.items.set(this.k(key), next);
      }
    }
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
