import type { EntityKey, ImportStore, TransactWriteEntry } from "../../../src/modules/import/ports/import-store.js";
import type { ImportObjectStore } from "../../../src/modules/import/ports/import-object-store.js";
import type { ImportIdGenerator } from "../../../src/modules/import/application/id-generator.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

/** W3-07 (D-070 chunk 8/N): ImportService.reserveImport's job creation now fences through
 * TenantBusinessMutation, which requires a TenantLifecycleRecord to exist in THIS store (the
 * import module's own physical partition in production, a separate in-memory Map here). Same
 * synchronous-seed convention as test/unit/subject/in-memory-store.ts / document's fake. */
export function activeLifecycleRecord(tenantId: string, now = "2026-08-29T00:00:00.000Z"): Record<string, unknown> & EntityKey {
  return {
    ...tenantLifecycleKey(tenantId),
    entityType: "TenantLifecycleRecord",
    tenantId,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

/** Mesmas convenções de test/unit/subject/in-memory-store.ts (avalia só os formatos de
 * ConditionExpression que este codebase realmente produz). */
export class InMemoryImportStore implements ImportStore {
  private readonly items = new Map<string, Record<string, unknown> & EntityKey>();

  constructor(seed: (Record<string, unknown> & EntityKey)[] = []) {
    for (const item of seed) this.items.set(this.k(item), item);
  }

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

  /** W3-07 (D-070 chunk 8/N): extended with a `ConditionCheck` branch (previously silently a
   * no-op, since the loop only matched "Put"/"Update" - the lifecycle fence's ConditionCheck
   * entry was accepted unconditionally, meaning a fence added at a call site through this fake
   * would never actually be exercised by a test). Now mirrors the same CancellationReasons-aware
   * two-pass validate-then-apply convention as test/unit/subject/in-memory-store.ts /
   * test/unit/document/in-memory-store.ts, so a lifecycle-fence rejection here is never confused
   * with an ordinary OCC version conflict on the caller's own entry. */
  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    const reasons: Array<{ Code: "None" | "ConditionalCheckFailed" }> = entries.map(() => ({ Code: "None" }));
    let anyFailed = false;

    entries.forEach((entry, i) => {
      if ("Put" in entry) {
        const item = entry.Put.Item as Record<string, unknown> & EntityKey;
        const key = this.k(item);
        if (entry.Put.ConditionExpression?.includes("attribute_not_exists(PK)") && this.items.has(key)) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else if ("Update" in entry) {
        const existing = this.items.get(this.k(entry.Update.Key));
        if (!existing) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
          return;
        }
        const match = /#version = :expectedVersion/.test(entry.Update.ConditionExpression);
        const expectedVersion = entry.Update.ExpressionAttributeValues[":expectedVersion"] as number | undefined;
        if (match && expectedVersion !== undefined && existing["version"] !== expectedVersion) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
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
          if (!(valueKey in values)) continue;
          const expected = values[valueKey];
          if (!existing || existing[fieldName] !== expected) {
            reasons[i] = { Code: "ConditionalCheckFailed" };
            anyFailed = true;
            return;
          }
        }
      }
    });

    if (anyFailed) {
      throw Object.assign(new Error("TransactionCanceledException"), { name: "TransactionCanceledException", CancellationReasons: reasons });
    }

    for (const entry of entries) {
      if ("Put" in entry) {
        const item = entry.Put.Item as Record<string, unknown> & EntityKey;
        this.items.set(this.k(item), item);
      } else if ("Update" in entry) {
        const existing = this.items.get(this.k(entry.Update.Key))!;
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
