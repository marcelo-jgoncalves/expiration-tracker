import type {
  EntityKey,
  ExpirationStore,
  Gsi1QueryInput,
  TransactWriteEntry,
} from "../../../src/modules/expiration/ports/expiration-store.js";
import type { ExpirationIdGenerator } from "../../../src/modules/expiration/application/id-generator.js";

/**
 * In-memory fake of ExpirationStore, mirroring test/unit/identity/in-memory-store.ts's
 * conventions. transactWrite evaluates only the three ConditionExpression shapes this
 * codebase actually produces (occ.ts's versioned-update condition, the
 * attribute_not_exists(PK) AND attribute_not_exists(SK) creation condition, and
 * shared/idempotency/idempotency.ts's transitionIdempotencyStatus() "#status = :expected"
 * condition, exercised via ExpirationService.renewItem's abort()/reacquisition paths) -
 * documented limitation, same spirit as InMemoryIdentityStore.
 */
export class InMemoryExpirationStore implements ExpirationStore {
  private readonly items = new Map<string, Record<string, unknown> & EntityKey>();

  private k(key: EntityKey): string {
    return `${key.PK}#${key.SK}`;
  }

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    return this.items.get(this.k(key)) as T | undefined;
  }

  async putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    const key = this.k(item);
    if (this.items.has(key)) return false;
    this.items.set(key, item as unknown as Record<string, unknown> & EntityKey);
    return true;
  }

  async update<T extends EntityKey>(item: T): Promise<void> {
    this.items.set(this.k(item), item as unknown as Record<string, unknown> & EntityKey);
  }

  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    // Pass 1: validate every condition without mutating anything.
    for (const entry of entries) {
      if ("Put" in entry) {
        const exists = this.items.has(this.k(entry.Put.Item as unknown as EntityKey));
        if (entry.Put.ConditionExpression.includes("attribute_not_exists(PK)") && exists) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on Put" };
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
        } else if (entry.Update.ConditionExpression === "#status = :expected") {
          const expectedStatus = entry.Update.ExpressionAttributeValues[":expected"];
          if (!existing || existing["status"] !== expectedStatus) {
            throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed: status mismatch" };
          }
        }
      }
    }

    // Pass 2: apply.
    for (const entry of entries) {
      if ("Put" in entry) {
        this.items.set(this.k(entry.Put.Item as unknown as EntityKey), entry.Put.Item as Record<string, unknown> & EntityKey);
      } else if ("Update" in entry) {
        const key = entry.Update.Key;
        const existing = this.items.get(this.k(key)) ?? { ...key };
        const next: Record<string, unknown> & EntityKey = { ...existing };
        // shared/idempotency/idempotency.ts's transitionIdempotencyStatus() builds its own
        // SET/REMOVE clauses over a fixed, known field set (status/requestHash/responseRef/
        // completedAt) rather than occ.ts's #setN convention - handled by name here, same
        // "known shapes only" spirit as the ConditionExpression check above. A field present in
        // ExpressionAttributeValues (as `:<placeholder>`) is a SET; one absent from it but named
        // in ExpressionAttributeNames is a REMOVE.
        const IDEMPOTENCY_TRANSITION_FIELDS = new Set(["status", "requestHash", "responseRef", "completedAt"]);
        for (const [name, placeholder] of Object.entries(entry.Update.ExpressionAttributeNames)) {
          if (placeholder === "version") {
            next["version"] = ((existing["version"] as number | undefined) ?? 0) + 1;
          } else if (placeholder === "updatedAt") {
            next["updatedAt"] = entry.Update.ExpressionAttributeValues[":now"];
          } else if (name.startsWith("#set")) {
            const valueKey = `:${name.slice(1)}`;
            next[placeholder] = entry.Update.ExpressionAttributeValues[valueKey];
          } else if (IDEMPOTENCY_TRANSITION_FIELDS.has(placeholder)) {
            const valueKey = `:${placeholder}`;
            if (valueKey in entry.Update.ExpressionAttributeValues) {
              next[placeholder] = entry.Update.ExpressionAttributeValues[valueKey];
            } else {
              delete next[placeholder];
            }
          }
        }
        this.items.set(this.k(key), next);
      }
    }
  }

  async queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]> {
    const matches = [...this.items.values()].filter(
      (item) => item["PK"] === pk && (!skPrefix || String(item["SK"]).startsWith(skPrefix)),
    );
    matches.sort((a, b) => String(a["SK"]).localeCompare(String(b["SK"])));
    return matches as unknown as T[];
  }

  async queryGsi1<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi1QueryInput): Promise<T[]> {
    const matches = [...this.items.values()].filter((item) => item["GSI1PK"] === input.gsi1pk);
    matches.sort((a, b) => {
      const sa = String(a["GSI1SK"]);
      const sb = String(b["GSI1SK"]);
      return input.ascending === false ? sb.localeCompare(sa) : sa.localeCompare(sb);
    });
    const limited = input.limit ? matches.slice(0, input.limit) : matches;
    return limited as unknown as T[];
  }

  /** Test-only helper mirroring InMemoryIdentityStore.allKeys(), for audit/outbox assertions. */
  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}

let counter = 0;
export function makeExpirationIdGenerator(): ExpirationIdGenerator {
  return {
    newItemId: () => `item-${++counter}`,
    newAuditEventId: () => `audit-${++counter}`,
    newEventId: () => `evt-${++counter}`,
    newPolicyId: () => `policy-${++counter}`,
  };
}
