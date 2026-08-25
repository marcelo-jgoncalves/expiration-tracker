import type { EntityKey, DocumentStore, TransactWriteEntry } from "../../../src/modules/document/ports/document-store.js";

/** In-memory fake mirroring test/unit/notification/in-memory-store.ts's transactWrite
 * condition-evaluation logic exactly (same two ConditionExpression shapes shared occ.ts
 * builders produce across every module). */
export class InMemoryDocumentStore implements DocumentStore {
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
      }
    }
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}
