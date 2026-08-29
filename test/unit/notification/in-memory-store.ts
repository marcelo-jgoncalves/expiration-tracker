import type { EntityKey, NotificationStore, TransactWriteEntry } from "../../../src/modules/notification/ports/notification-store.js";

/** In-memory fake mirroring test/unit/reminder/in-memory-store.ts's transactWrite
 * condition-evaluation logic exactly (same two ConditionExpression shapes the shared
 * occ.ts builders produce across every module). */
export class InMemoryNotificationStore implements NotificationStore {
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

  /**
   * W3-07 (D-067, SES fence): now also evaluates `ConditionCheck` entries (the
   * `TenantLifecycleRecord.status = ACTIVE` fence `executeTenantBusinessMutation` appends) and
   * threads per-entry `CancellationReasons` through a `TransactionCanceledException`, mirroring
   * `test/unit/identity/in-memory-store.ts`'s two-pass validate-then-apply convention exactly -
   * required so the lifecycle fence on `email-delivery-workflow.ts`'s SUBMITTING claim is
   * actually exercised by tests instead of silently no-op'd (a ConditionCheck-blind fake would
   * let a DELETING-tenant claim succeed here even though real DynamoDB would reject it).
   */
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

  async queryAttemptsByIntent<T extends EntityKey = Record<string, unknown> & EntityKey>(tenantId: string, intentId: string): Promise<T[]> {
    const pk = `TENANT#${tenantId}#INTENT#${intentId}`;
    return [...this.items.values()].filter((i) => i.PK === pk && String(i.SK).startsWith("ATTEMPT#")) as unknown as T[];
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}
