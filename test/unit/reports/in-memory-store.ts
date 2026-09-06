import type { EntityKey, Gsi1Page, Gsi1PageInput, TransactWriteEntry } from "../../../src/modules/reports/ports/report-subscription-store.js";

/**
 * In-memory fake of `ReportSubscriptionStore` (D-211/D-212/D-213), same conventions as
 * `test/unit/expiration/in-memory-store.ts`'s `InMemoryExpirationStore.transactWrite` -
 * evaluates the ConditionExpression shapes the scheduler's claim transaction and the D-213 CRUD
 * service actually produce (`occ.ts`'s versioned-update/versioned-delete condition, and the
 * outbox record's `attribute_not_exists(PK) AND attribute_not_exists(SK)` creation condition).
 */
export class InMemoryReportSubscriptionStore {
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

  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    const reasons: Array<{ Code: "None" | "ConditionalCheckFailed" }> = entries.map(() => ({ Code: "None" }));
    let anyFailed = false;

    entries.forEach((entry, i) => {
      if ("Put" in entry) {
        const exists = this.items.has(this.k(entry.Put.Item as unknown as EntityKey));
        if (entry.Put.ConditionExpression.includes("attribute_not_exists(PK)") && exists) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else if ("Update" in entry) {
        const existing = this.items.get(this.k(entry.Update.Key));
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
          }
        }
      } else if ("Delete" in entry) {
        const existing = this.items.get(this.k(entry.Delete.Key));
        if (!existing) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
          return;
        }
        const expectedVersion = entry.Delete.ExpressionAttributeValues?.[":expectedVersion"];
        const expectedTenantId = entry.Delete.ExpressionAttributeValues?.[":tenantId"];
        if (existing["version"] !== expectedVersion || existing["tenantId"] !== expectedTenantId) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      }
    });

    if (anyFailed) {
      throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: reasons };
    }

    for (const entry of entries) {
      if ("Put" in entry) {
        this.items.set(this.k(entry.Put.Item as unknown as EntityKey), entry.Put.Item as Record<string, unknown> & EntityKey);
      } else if ("Update" in entry) {
        const key = entry.Update.Key;
        const existing = this.items.get(this.k(key)) ?? { ...key };
        const next: Record<string, unknown> & EntityKey = { ...existing };
        for (const [name, placeholder] of Object.entries(entry.Update.ExpressionAttributeNames ?? {})) {
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
      } else if ("Delete" in entry) {
        this.items.delete(this.k(entry.Delete.Key));
      }
    }
  }

  async queryGsi1Page<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi1PageInput): Promise<Gsi1Page<T>> {
    const ascending = input.ascending ?? true;
    const matches = [...this.items.values()].filter((item) => item["GSI1PK"] === input.gsi1pk);
    matches.sort((a, b) => {
      const sa = String(a["GSI1SK"]);
      const sb = String(b["GSI1SK"]);
      return ascending ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    const startAfter = input.exclusiveStartKey?.["GSI1SK"] as string | undefined;
    const fromCursor = startAfter === undefined ? matches : matches.filter((item) => (ascending ? String(item["GSI1SK"]) > startAfter : String(item["GSI1SK"]) < startAfter));
    const limit = input.limit ?? fromCursor.length;
    const page = fromCursor.slice(0, limit);
    const hasMore = fromCursor.length > page.length;
    const last = page[page.length - 1];
    return {
      items: page as unknown as T[],
      lastEvaluatedKey: hasMore && last ? { GSI1PK: last["GSI1PK"], GSI1SK: last["GSI1SK"] } : undefined,
    };
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}
