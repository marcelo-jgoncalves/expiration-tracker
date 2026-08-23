import type { EntityKey, Gsi7QueryInput, SubjectStore, TransactWriteEntry } from "../../../src/modules/subject/ports/subject-store.js";
import type { SubjectIdGenerator } from "../../../src/modules/subject/application/id-generator.js";
import type { ExpirationItemLookup } from "../../../src/modules/subject/ports/expiration-item-lookup.js";

/**
 * In-memory fake de SubjectStore, mesmas convenções de test/unit/expiration/in-memory-store.ts
 * (avalia só os 2 formatos de ConditionExpression que este codebase realmente produz).
 */
export class InMemorySubjectStore implements SubjectStore {
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
    for (const entry of entries) {
      if ("Put" in entry) {
        const exists = this.items.has(this.k(entry.Put.Item as unknown as EntityKey));
        if (entry.Put.ConditionExpression.includes("attribute_not_exists(PK)") && exists) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on Put" };
        }
      } else {
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

    for (const entry of entries) {
      if ("Put" in entry) {
        this.items.set(this.k(entry.Put.Item as unknown as EntityKey), entry.Put.Item as Record<string, unknown> & EntityKey);
      } else {
        const key = entry.Update.Key;
        const existing = this.items.get(this.k(key)) ?? { ...key };
        const next: Record<string, unknown> & EntityKey = { ...existing };
        const removedNames = new Set<string>();
        for (const [name, placeholder] of Object.entries(entry.Update.ExpressionAttributeNames)) {
          if (placeholder === "version") {
            next["version"] = ((existing["version"] as number | undefined) ?? 0) + 1;
          } else if (placeholder === "updatedAt") {
            next["updatedAt"] = entry.Update.ExpressionAttributeValues[":now"];
          } else if (name.startsWith("#set")) {
            const valueKey = `:${name.slice(1)}`;
            next[placeholder] = entry.Update.ExpressionAttributeValues[valueKey];
          } else if (name.startsWith("#rem")) {
            removedNames.add(placeholder);
          }
        }
        for (const name of removedNames) delete next[name];
        this.items.set(this.k(key), next);
      }
    }
  }

  async queryGsi7<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi7QueryInput): Promise<T[]> {
    const matches = [...this.items.values()].filter((item) => item["GSI7PK"] === input.gsi7pk);
    matches.sort((a, b) => {
      const sa = String(a["GSI7SK"]);
      const sb = String(b["GSI7SK"]);
      return input.ascending === false ? sb.localeCompare(sa) : sa.localeCompare(sb);
    });
    const limited = input.limit ? matches.slice(0, input.limit) : matches;
    return limited as unknown as T[];
  }

  async queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]> {
    const matches = [...this.items.values()].filter((item) => item["PK"] === pk && (!skPrefix || String(item["SK"]).startsWith(skPrefix)));
    matches.sort((a, b) => String(a["SK"]).localeCompare(String(b["SK"])));
    return matches as unknown as T[];
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}

let counter = 0;
export function makeSubjectIdGenerator(): SubjectIdGenerator {
  return {
    newSubjectId: () => `subject-${++counter}`,
    newAssignmentId: () => `assignment-${++counter}`,
    newAuditEventId: () => `audit-${++counter}`,
  };
}

export function makeItemLookup(existingItemIds: Set<string>): ExpirationItemLookup {
  return {
    itemExists: async (_tenantId, itemId) => existingItemIds.has(itemId),
  };
}
