import type { EntityKey, Gsi4QueryInput, OrganizationStore, TransactWriteEntry } from "../../../src/modules/organization/ports/organization-store.js";

/**
 * In-memory fake de OrganizationStore, mesma convenção de test/unit/subject/in-memory-store.ts.
 * Escopo original (B2B-3.2/B2B-3.3): `transactWrite` só validava `Put` condicionado a
 * `attribute_not_exists(PK)` — `CreateOrganization` é uma criação pura. Wave B2B-5 (D-095)
 * acrescenta suporte a `Update` — só o formato exato de `buildAttributeOnceUpdate()`
 * (`shared/dynamodb/occ.ts`: `SET #attr = :value` condicionado a `attribute_not_exists(#attr)`),
 * o único que este módulo produz até agora (o cap transacional de `GlobalUser.
 * hasCreatedOrganization` em `bff-auth-service.ts`) — mesma convenção de "formatos conhecidos
 * apenas" já estabelecida por `test/unit/identity/in-memory-store.ts`. `CancellationReasons` é
 * populado por índice real (não mais "falha tudo"), para que
 * `getCancellationReasonCodes()`-based callers consigam distinguir qual entry específico falhou.
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
    const reasons: Array<{ Code: "None" | "ConditionalCheckFailed" }> = entries.map(() => ({ Code: "None" }));
    let anyFailed = false;

    entries.forEach((entry, i) => {
      if ("Put" in entry) {
        const item = entry.Put.Item as unknown as EntityKey;
        if (entry.Put.ConditionExpression.includes("attribute_not_exists(PK)") && this.items.has(this.k(item))) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else if ("Update" in entry) {
        const attrName = entry.Update.ExpressionAttributeNames?.["#attr"];
        if (!attrName || entry.Update.ExpressionAttributeValues?.[":value"] === undefined) {
          throw new Error("InMemoryOrganizationStore.transactWrite: unsupported Update shape - only buildAttributeOnceUpdate() is known.");
        }
        const existing = this.items.get(this.k(entry.Update.Key));
        if (entry.Update.ConditionExpression.includes(`attribute_not_exists(#attr)`) && existing && existing[attrName] !== undefined) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else {
        throw new Error("InMemoryOrganizationStore.transactWrite: only Put/Update entries are supported (see file header).");
      }
    });

    if (anyFailed) {
      throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: reasons };
    }

    for (const entry of entries) {
      if ("Put" in entry) {
        const item = entry.Put.Item as unknown as Record<string, unknown> & EntityKey;
        this.items.set(this.k(item), item);
      } else if ("Update" in entry) {
        const key = entry.Update.Key;
        const attrName = entry.Update.ExpressionAttributeNames!["#attr"]!;
        const value = entry.Update.ExpressionAttributeValues![":value"];
        const existing = this.items.get(this.k(key)) ?? { ...key };
        this.items.set(this.k(key), { ...existing, [attrName]: value });
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

  /** Test-only: unconditional overwrite, for simulating a state transition the module's real
   * writers don't have a call site for yet (e.g. Organization deletion lifecycle - real writer
   * is Wave B2B-9). Never a stand-in for a real OCC-conditioned write. */
  forceUpdate<T extends EntityKey>(item: T): void {
    this.items.set(this.k(item), item as unknown as Record<string, unknown> & EntityKey);
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}
