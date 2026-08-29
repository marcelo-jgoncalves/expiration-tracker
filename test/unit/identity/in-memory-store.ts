import type { EntityKey, IdentityStore, TransactWriteEntry } from "../../../src/modules/identity/ports/identity-store.js";

/**
 * Generic-enough ConditionExpression evaluator for a `Delete` entry's condition — added for the
 * W3-07 purge pipeline (`system-mutation.ts`'s `PURGE_DELETE`, the first `Delete` entry this
 * fake needs to actually evaluate rather than silently no-op). Supports the operators that
 * module's condition actually uses: `attribute_not_exists`, `begins_with`, a plain `field = :value`
 * equality atom (added for W3-07's B1 fix — `tenant-purge-scan.ts`'s widened
 * `tenantId = :purgeTenantId` alternative), and a top-level `OR` — deliberately narrower than
 * `test/unit/workers/document-purge-fakes.ts`'s evaluator (no `attribute_exists`/`<>`/`<=`/`AND`
 * needed here yet), extend if a future Delete condition needs more.
 */
function evaluateDeleteCondition(expression: string, values: Record<string, unknown>, item: Record<string, unknown> | undefined): boolean {
  function evalAtom(atom: string): boolean {
    atom = atom.trim();
    const notExistsMatch = atom.match(/^attribute_not_exists\(([^)]+)\)$/);
    if (notExistsMatch) return item === undefined;
    const beginsWithMatch = atom.match(/^begins_with\(([^,]+),\s*(:\S+)\)$/);
    if (beginsWithMatch) {
      const [, field, valueKey] = beginsWithMatch;
      const prefix = values[valueKey!.trim()] as string;
      const actual = item?.[field!.trim()] as string | undefined;
      return typeof actual === "string" && actual.startsWith(prefix);
    }
    const equalityMatch = atom.match(/^(\S+)\s*=\s*(:\S+)$/);
    if (equalityMatch) {
      const [, field, valueKey] = equalityMatch;
      const expected = values[valueKey!.trim()];
      const actual = item?.[field!.trim()];
      return item !== undefined && actual === expected;
    }
    throw new Error(`Unsupported Delete condition atom in fake evaluator: ${atom}`);
  }
  return expression.split(" OR ").some((part) => evalAtom(part));
}

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
    // Pass 1: validate every condition without mutating anything. Unlike the previous
    // fail-fast version, this evaluates EVERY entry and records a per-entry Code (mirroring
    // real DynamoDB's TransactionCanceledException.CancellationReasons[] shape) so callers -
    // notably `TenantBusinessMutation`'s lane - can distinguish "the caller's own entry lost
    // an ordinary OCC race" from "the lifecycle fence entry specifically failed", the exact
    // distinction `TenantQuotaService.consume()`'s retry loop depends on (W3-07 writer
    // migration; see tenant-business-mutation.ts's CancellationReasons handling).
    const reasons: Array<{ Code: "None" | "ConditionalCheckFailed" }> = entries.map(() => ({ Code: "None" }));
    let anyFailed = false;

    entries.forEach((entry, i) => {
      if ("Put" in entry) {
        const exists = this.items.has(this.k(entry.Put.Item as unknown as EntityKey));
        if (entry.Put.ConditionExpression.includes("attribute_not_exists(PK)") && exists) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
          return;
        }
        // occ.ts's buildConditionalPut - quota.consume()'s count/resetAt-gated overwrite
        // (W3-07 writer migration). Its ConditionExpression is
        // "#count = :expectedCount AND resetAt = :expectedResetAt" - the value placeholder
        // suffix deliberately does NOT match its name placeholder suffix (mirrors the real
        // production ConditionExpression this mirrors, `identity-store.ts`'s
        // `updateConditional`), so this cannot use the generic #name/:name-suffix pairing the
        // ConditionCheck/Update branches below use. Known-shape fake (see file header) -
        // recognizes this exact pattern by its literal placeholder keys rather than parsing
        // the expression string.
        if (entry.Put.ConditionExpression.includes(":expectedCount") || entry.Put.ConditionExpression.includes(":expectedResetAt")) {
          const existing = this.items.get(this.k(entry.Put.Item as unknown as EntityKey));
          const values = entry.Put.ExpressionAttributeValues ?? {};
          const expectedCount = values[":expectedCount"];
          const expectedResetAt = values[":expectedResetAt"];
          if (!existing || existing["count"] !== expectedCount || existing["resetAt"] !== expectedResetAt) {
            reasons[i] = { Code: "ConditionalCheckFailed" };
            anyFailed = true;
            return;
          }
        }
      } else if ("ConditionCheck" in entry) {
        const check = entry.ConditionCheck;
        const existing = this.items.get(this.k(check.Key));
        if (check.ConditionExpression.includes("attribute_exists(PK)") && !existing) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
          return;
        }
        const names = check.ExpressionAttributeNames ?? {};
        const values = check.ExpressionAttributeValues ?? {};
        for (const [nameKey, fieldName] of Object.entries(names)) {
          const valueKey = `:${nameKey.slice(1)}`;
          if (!(valueKey in values)) continue; // not an equality placeholder pair
          const expected = values[valueKey];
          if (!existing || existing[fieldName] !== expected) {
            reasons[i] = { Code: "ConditionalCheckFailed" };
            anyFailed = true;
            return;
          }
        }
      } else if ("Update" in entry) {
        const key = entry.Update.Key;
        const existing = this.items.get(this.k(key));
        if (entry.Update.ConditionExpression.includes("attribute_exists(PK)")) {
          if (!existing) {
            reasons[i] = { Code: "ConditionalCheckFailed" };
            anyFailed = true;
            return;
          }
          const expectedVersion = entry.Update.ExpressionAttributeValues[":expectedVersion"];
          const expectedTenantId = entry.Update.ExpressionAttributeValues[":tenantId"];
          if (existing["version"] !== expectedVersion || existing["tenantId"] !== expectedTenantId) {
            reasons[i] = { Code: "ConditionalCheckFailed" };
            anyFailed = true;
            return;
          }
          // extraConditions (occ.ts's buildVersionedUpdate) add extra #cN/:cN or caller-named
          // equality placeholder pairs beyond the base version/tenantId/updatedAt/set/rem ones -
          // e.g. system-mutation.ts's `#lifecycleStatus = :expectedFrom` fence on the transition
          // primitive. Evaluate any remaining name/value pair generically, same approach as the
          // ConditionCheck branch above - required for that fence to actually be exercised by
          // this fake rather than silently no-op'd.
          const reservedNames = new Set(["#version", "#tenantId", "#updatedAt"]);
          for (const [nameKey, fieldName] of Object.entries(entry.Update.ExpressionAttributeNames)) {
            if (reservedNames.has(nameKey) || nameKey.startsWith("#set") || nameKey.startsWith("#rem")) continue;
            const valueKey = `:${nameKey.slice(1)}`;
            if (!(valueKey in entry.Update.ExpressionAttributeValues)) continue;
            const expected = entry.Update.ExpressionAttributeValues[valueKey];
            if (existing[fieldName] !== expected) {
              reasons[i] = { Code: "ConditionalCheckFailed" };
              anyFailed = true;
              return;
            }
          }
        }
      } else if ("Delete" in entry) {
        const existing = this.items.get(this.k(entry.Delete.Key));
        if (entry.Delete.ConditionExpression && !evaluateDeleteCondition(entry.Delete.ConditionExpression, entry.Delete.ExpressionAttributeValues ?? {}, existing)) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
          return;
        }
      }
    });

    if (anyFailed) {
      throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: reasons };
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
          } else if (name.startsWith("#rem")) {
            delete next[placeholder];
          }
        }
        this.items.set(this.k(key), next);
      } else if ("Delete" in entry) {
        this.items.delete(this.k(entry.Delete.Key));
      }
    }
  }

  /** Test-only helper for purge tests: seed an arbitrary raw item (not just via putIfAbsent's
   * attribute_not_exists condition), and check presence. */
  seedRaw(item: Record<string, unknown> & EntityKey): void {
    this.items.set(this.k(item), { ...item });
  }

  hasRaw(key: EntityKey): boolean {
    return this.items.has(this.k(key));
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
