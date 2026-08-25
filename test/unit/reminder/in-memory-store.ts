import type { EntityKey, TransactWriteEntry } from "../../../src/modules/reminder/ports/reminder-store.js";
import type { ReminderStore, ReminderProducerStore, Gsi3QueryInput } from "../../../src/modules/reminder/ports/reminder-store.js";
import type { ReminderIdGenerator } from "../../../src/modules/reminder/application/id-generator.js";

/**
 * In-memory fake implementing BOTH ReminderStore and ReminderProducerStore, mirroring
 * test/unit/expiration/in-memory-store.ts's transactWrite condition-evaluation logic
 * exactly (same two ConditionExpression shapes this codebase produces). A real deployment
 * NEVER hands both ports to the same caller (see reminder-store.ts's isolation
 * commentary) - this fake implements both purely so tests can share one backing map
 * without duplicating the DynamoDB-emulation logic; test/integration/gsi3-isolation.test.ts
 * verifies the structural separation at the port-interface level instead of relying on
 * this fake to enforce it.
 */
/** Emulates the AWS SDK's per-entry CancellationReasons array (only the failing index gets
 * a real code; the rest are reported "None", same as DynamoDB) - dispatch.ts inspects this
 * to distinguish a genuine duplicate-delivery race (index 1, the occurrence's own condition)
 * from the freshness-fence ConditionChecks losing a race against a concurrent change. */
function cancellationReasons(entries: TransactWriteEntry[], failedIndex: number): { Code?: string }[] {
  return entries.map((_, i) => (i === failedIndex ? { Code: "ConditionalCheckFailed" } : { Code: "None" }));
}

export class InMemoryReminderStore implements ReminderStore, ReminderProducerStore {
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
    entries.forEach((entry, index) => {
      if ("Put" in entry) {
        const exists = this.items.has(this.k(entry.Put.Item as unknown as EntityKey));
        if (entry.Put.ConditionExpression.includes("attribute_not_exists(PK)") && exists) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on Put", CancellationReasons: cancellationReasons(entries, index) };
        }
      } else if ("ConditionCheck" in entry) {
        const existing = this.items.get(this.k(entry.ConditionCheck.Key));
        const values = entry.ConditionCheck.ExpressionAttributeValues ?? {};
        const names = entry.ConditionCheck.ExpressionAttributeNames ?? {};
        const ok =
          !!existing &&
          Object.entries(names).every(([placeholder, attr]) => existing[attr] === values[`:${placeholder.slice(1)}`]);
        if (!ok) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on ConditionCheck", CancellationReasons: cancellationReasons(entries, index) };
        }
      } else {
        const key = entry.Update.Key;
        const existing = this.items.get(this.k(key));
        if (entry.Update.ConditionExpression.includes("attribute_exists(PK)")) {
          if (!existing) {
            throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed: item missing", CancellationReasons: cancellationReasons(entries, index) };
          }
          const expectedVersion = entry.Update.ExpressionAttributeValues[":expectedVersion"];
          const expectedTenantId = entry.Update.ExpressionAttributeValues[":tenantId"];
          if (existing["version"] !== expectedVersion || existing["tenantId"] !== expectedTenantId) {
            throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed: version/tenant mismatch", CancellationReasons: cancellationReasons(entries, index) };
          }
        }
      }
    });

    for (const entry of entries) {
      if ("ConditionCheck" in entry) {
        continue;
      } else if ("Put" in entry) {
        this.items.set(this.k(entry.Put.Item as unknown as EntityKey), entry.Put.Item as Record<string, unknown> & EntityKey);
      } else {
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
            // Mirrors occ.ts's REMOVE clause support (M3.5) - #remN names are attributes to
            // delete, e.g. GSI6PK/GSI6SK when a claim/DST pointer stops applying.
            delete next[placeholder];
          }
        }
        this.items.set(this.k(key), next);
      }
    }
  }

  async queryByItem<T extends EntityKey = Record<string, unknown> & EntityKey>(tenantId: string, itemId: string): Promise<T[]> {
    const pk = `TENANT#${tenantId}#ITEM#${itemId}`;
    return [...this.items.values()].filter((i) => i.PK === pk && String(i.SK).startsWith("OCC#")) as unknown as T[];
  }

  /** Emulates a GSI3 (KEYS_ONLY projection) query: returns only PK/SK/GSI3PK/GSI3SK, exactly like DynamoDB would. */
  async queryGsi3<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi3QueryInput): Promise<T[]> {
    return [...this.items.values()]
      .filter((i) => i["GSI3PK"] === input.gsi3pk)
      .map((i) => ({ PK: i.PK, SK: i.SK, GSI3PK: i["GSI3PK"], GSI3SK: i["GSI3SK"] })) as unknown as T[];
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}

let counter = 0;
export function makeReminderIdGenerator(): ReminderIdGenerator {
  return {
    newPolicyId: () => `policy-${++counter}`,
    newTriggerId: () => `trigger-${++counter}`,
    newEventId: () => `evt-${++counter}`,
    newIntentId: () => `intent-${++counter}`,
  };
}
