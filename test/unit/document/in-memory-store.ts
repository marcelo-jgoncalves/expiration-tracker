import type { EntityKey, DocumentStore, TransactWriteEntry } from "../../../src/modules/document/ports/document-store.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

/** W3-07 (evidence-mutation worker fencing): the 4 evidence-mutation workers now fence through
 * TenantBusinessMutation, which requires a TenantLifecycleRecord to exist. Every test file below
 * seeds this synchronously via `new InMemoryDocumentStore([activeLifecycleRecord("t1")])` rather
 * than an async putIfAbsent call in every single `it()`, since all of this module's evidence
 * tests use tenant "t1" - same convention quota.test.ts/item-watch-service.test.ts already
 * established for the async-seed case. */
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

/** In-memory fake mirroring test/unit/notification/in-memory-store.ts's transactWrite
 * condition-evaluation logic exactly (same two ConditionExpression shapes shared occ.ts
 * builders produce across every module). */
export class InMemoryDocumentStore implements DocumentStore {
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

  /**
   * W3-07 (evidence-mutation worker fencing): now also evaluates `ConditionCheck` entries (the
   * `TenantLifecycleRecord.status = ACTIVE` fence `executeTenantBusinessMutation`/
   * `tryTenantBusinessMutation` append) and threads per-entry `CancellationReasons` through a
   * `TransactionCanceledException`, mirroring `test/unit/identity/in-memory-store.ts`'s two-pass
   * validate-then-apply convention. Required for two reasons: (1) so the lifecycle fence is
   * actually exercised by tests instead of silently no-op'd, and (2) so an ORDINARY OCC version
   * conflict on the caller's own Update entry (e.g. two evidence workers racing) is NOT
   * misclassified as a lifecycle-fence rejection — without CancellationReasons,
   * `executeTenantBusinessMutation` cannot tell the two apart and defaults to treating every
   * cancellation as TenantNotActiveError, which broke this fake's own pre-existing concurrent-
   * evidence-race regression tests the moment the fence was added.
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
        for (const [name, placeholder] of Object.entries(entry.Update.ExpressionAttributeNames ?? {})) {
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

  async queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]> {
    return [...this.items.values()].filter((item) => item.PK === pk && (skPrefix === undefined || item.SK.startsWith(skPrefix))) as T[];
  }
}
