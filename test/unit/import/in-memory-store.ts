import type { EntityKey, ImportStore, TransactWriteEntry } from "../../../src/modules/import/ports/import-store.js";
import type { ImportObjectStore } from "../../../src/modules/import/ports/import-object-store.js";
import type { ImportIdGenerator } from "../../../src/modules/import/application/id-generator.js";

/** Mesmas convenções de test/unit/subject/in-memory-store.ts (avalia só os formatos de
 * ConditionExpression que este codebase realmente produz). */
export class InMemoryImportStore implements ImportStore {
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
        const item = entry.Put.Item as Record<string, unknown> & EntityKey;
        const key = this.k(item);
        if (entry.Put.ConditionExpression?.includes("attribute_not_exists(PK)") && this.items.has(key)) {
          throw Object.assign(new Error("TransactionCanceledException"), { name: "TransactionCanceledException" });
        }
        this.items.set(key, item);
      } else {
        const existing = this.items.get(this.k(entry.Update.Key));
        if (!existing) throw Object.assign(new Error("TransactionCanceledException"), { name: "TransactionCanceledException" });
        // Same two ConditionExpression shapes as the other fakes - version-match update only.
        const match = /#version = :expectedVersion/.test(entry.Update.ConditionExpression);
        const expectedVersion = entry.Update.ExpressionAttributeValues[":expectedVersion"] as number | undefined;
        if (match && expectedVersion !== undefined && existing["version"] !== expectedVersion) {
          throw Object.assign(new Error("TransactionCanceledException"), { name: "TransactionCanceledException" });
        }
        const updated = { ...existing };
        for (const [name, value] of Object.entries(entry.Update.ExpressionAttributeValues)) {
          if (name.startsWith(":set")) {
            const idx = name.slice(4);
            const attrName = entry.Update.ExpressionAttributeNames[`#set${idx}`];
            if (attrName) updated[attrName] = value;
          }
        }
        updated["version"] = (existing["version"] as number) + 1;
        this.items.set(this.k(entry.Update.Key), updated);
      }
    }
  }

  async queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]> {
    const results: T[] = [];
    for (const item of this.items.values()) {
      if (item.PK === pk && (!skPrefix || item.SK.startsWith(skPrefix))) results.push(item as unknown as T);
    }
    return results;
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}

export class FakeImportObjectStore implements ImportObjectStore {
  private readonly objects = new Map<string, Buffer>();

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const value = this.objects.get(`${bucket}/${key}`);
    if (!value) throw new Error(`FakeImportObjectStore: object not found: ${bucket}/${key}`);
    return value;
  }

  async putObject(bucket: string, key: string, body: string, _contentType: string): Promise<void> {
    this.objects.set(`${bucket}/${key}`, Buffer.from(body, "utf-8"));
  }

  seed(bucket: string, key: string, body: string): void {
    this.objects.set(`${bucket}/${key}`, Buffer.from(body, "utf-8"));
  }
}

let counter = 0;
export function makeImportIdGenerator(): ImportIdGenerator {
  return {
    newImportJobId: () => `importjob-${++counter}`,
  };
}
