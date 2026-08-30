import type { EntityKey, Gsi4QueryInput, OrganizationStore, TransactWriteEntry } from "../../../src/modules/organization/ports/organization-store.js";

/**
 * In-memory fake de OrganizationStore, mesma convenção de test/unit/subject/in-memory-store.ts.
 * Escopo desta wave (B2B-3.2/B2B-3.3): `transactWrite` só valida entradas `Put` condicionadas
 * a `attribute_not_exists(PK)` — `CreateOrganization` é uma criação pura, sem `Update`/
 * `ConditionCheck`. Suporte a `Update` (decremento de `ownerCount`, transições de status de
 * Membership) fica para quando Wave B2B-7/B2B-8 tiver um writer real que precise disso (mesma
 * nota de escopo do wave tracker) - não é uma lacuna esquecida.
 */
export class InMemoryOrganizationStore implements OrganizationStore {
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

  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    for (const entry of entries) {
      if (!("Put" in entry)) {
        throw new Error("InMemoryOrganizationStore.transactWrite: only Put entries are supported this wave (see file header).");
      }
      const item = entry.Put.Item as unknown as EntityKey;
      if (entry.Put.ConditionExpression.includes("attribute_not_exists(PK)") && this.items.has(this.k(item))) {
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: entries.map(() => ({ Code: "ConditionalCheckFailed" })) };
      }
    }
    for (const entry of entries) {
      if ("Put" in entry) {
        const item = entry.Put.Item as unknown as Record<string, unknown> & EntityKey;
        this.items.set(this.k(item), item);
      }
    }
  }

  async queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]> {
    const matches = [...this.items.values()].filter((item) => item["PK"] === pk && (!skPrefix || String(item["SK"]).startsWith(skPrefix)));
    matches.sort((a, b) => String(a["SK"]).localeCompare(String(b["SK"])));
    return matches as unknown as T[];
  }

  async queryGsi4<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi4QueryInput): Promise<T[]> {
    const matches = [...this.items.values()].filter((item) => item["GSI4PK"] === input.gsi4pk);
    matches.sort((a, b) => String(a["GSI4SK"]).localeCompare(String(b["GSI4SK"])));
    const limited = input.limit ? matches.slice(0, input.limit) : matches;
    return limited as unknown as T[];
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}
