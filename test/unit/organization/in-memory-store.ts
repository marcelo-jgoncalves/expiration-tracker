import type { EntityKey, Gsi4QueryInput, OrganizationStore, TransactWriteEntry } from "../../../src/modules/organization/ports/organization-store.js";

/**
 * In-memory fake de OrganizationStore, mesma convenção de test/unit/subject/in-memory-store.ts.
 * B2B-8 (D-099) introduziu Update/Delete com formatos genuinamente mais ricos que o único
 * shape conhecido até B2B-5 (`buildAttributeOnceUpdate`) — upsert de Membership com condição OR
 * e `if_not_exists`, decremento/incremento condicionado de `ownerCount`, consumo de token com
 * duas cláusulas AND. Em vez de acumular um branch por shape (a convenção anterior), este fake
 * ganhou um mini-avaliador de ConditionExpression/UpdateExpression cobrindo só os operadores que
 * o código real deste módulo produz (documentados abaixo) — nunca uma reimplementação genérica
 * do DynamoDB, só o suficiente para simular os writers reais deste módulo em teste unitário.
 *
 * Operadores de condição suportados: `attribute_not_exists(x)`, `attribute_exists(x)`,
 * `x = :v`, `x > :v`, combinados com `AND`/`OR` (sem parênteses aninhados — nenhum writer real
 * produz isso hoje). Operadores de update: `SET x = :v`, `SET x = if_not_exists(x, :v)`,
 * `SET x = x + :v`, `SET x = x - :v`, e um `REMOVE x[, y...]` opcional após o `SET` (D-157,
 * `accept-invitation.ts` limpa `removedAt` ao reativar uma Membership `REMOVED`).
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

  async updateConditional<T extends EntityKey>(item: T, expected: { count: number; resetAt: string }): Promise<boolean> {
    const key = this.k(item);
    const existing = this.items.get(key) as unknown as { count?: number; resetAt?: string } | undefined;
    if (existing && (existing.count !== expected.count || existing.resetAt !== expected.resetAt)) return false;
    this.items.set(key, item as unknown as Record<string, unknown> & EntityKey);
    return true;
  }

  /** Resolve um token `#name`/`literal` contra ExpressionAttributeNames. */
  private resolveName(token: string, names: Record<string, string> | undefined): string {
    return token.startsWith("#") ? (names?.[token] ?? token) : token;
  }

  /** Resolve um token `:value`/literal contra ExpressionAttributeValues. */
  private resolveValue(token: string, values: Record<string, unknown> | undefined): unknown {
    return token.startsWith(":") ? values?.[token] : token;
  }

  private evalConditionClause(clause: string, item: Record<string, unknown> | undefined, names?: Record<string, string>, values?: Record<string, unknown>): boolean {
    const trimmed = clause.trim();
    const notExists = /^attribute_not_exists\(([^)]+)\)$/.exec(trimmed);
    if (notExists) return item?.[this.resolveName(notExists[1]!.trim(), names)] === undefined;
    const exists = /^attribute_exists\(([^)]+)\)$/.exec(trimmed);
    if (exists) return item?.[this.resolveName(exists[1]!.trim(), names)] !== undefined;
    const gt = /^(\S+)\s*>\s*(\S+)$/.exec(trimmed);
    if (gt) {
      const left = item?.[this.resolveName(gt[1]!, names)];
      const right = this.resolveValue(gt[2]!, values);
      return (left as string | number) > (right as string | number);
    }
    const eq = /^(\S+)\s*=\s*(\S+)$/.exec(trimmed);
    if (eq) {
      const left = item?.[this.resolveName(eq[1]!, names)];
      const right = this.resolveValue(eq[2]!, values);
      return left === right;
    }
    throw new Error(`InMemoryOrganizationStore: unsupported ConditionExpression clause "${clause}" (see file header for supported operators).`);
  }

  /** Suporta só `AND` ou só `OR` numa expressão (nenhum writer real deste módulo mistura os
   * dois nem usa parênteses aninhados). */
  private evalCondition(expression: string | undefined, item: Record<string, unknown> | undefined, names?: Record<string, string>, values?: Record<string, unknown>): boolean {
    if (!expression) return true;
    if (expression.includes(" OR ")) {
      return expression.split(" OR ").some((clause) => this.evalConditionClause(clause, item, names, values));
    }
    return expression.split(" AND ").every((clause) => this.evalConditionClause(clause, item, names, values));
  }

  private applyUpdate(expression: string, existing: Record<string, unknown> | undefined, key: EntityKey, names?: Record<string, string>, values?: Record<string, unknown>): Record<string, unknown> & EntityKey {
    const removeSplit = /^(SET .+?)(?: REMOVE (.+))?$/.exec(expression.trim());
    if (!removeSplit) throw new Error(`InMemoryOrganizationStore: unsupported UpdateExpression "${expression}" (only SET [, REMOVE] is supported).`);
    const [, setExpression, removeExpression] = removeSplit;
    const setMatch = /^SET (.+)$/.exec(setExpression!.trim());
    if (!setMatch) throw new Error(`InMemoryOrganizationStore: unsupported UpdateExpression "${expression}" (only SET is supported).`);
    const result: Record<string, unknown> = { ...key, ...existing };

    // Split top-level clauses on commas that are not inside if_not_exists(...) parens.
    const clauses: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of setMatch[1]!) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        clauses.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim()) clauses.push(current);

    for (const rawClause of clauses) {
      const clause = rawClause.trim();
      const eqMatch = /^(\S+)\s*=\s*(.+)$/.exec(clause);
      if (!eqMatch) throw new Error(`InMemoryOrganizationStore: unsupported SET clause "${clause}".`);
      const [, targetToken, rhs] = eqMatch;
      const targetName = this.resolveName(targetToken!.trim(), names);

      const ifNotExists = /^if_not_exists\(([^,]+),\s*(\S+)\)$/.exec(rhs!.trim());
      if (ifNotExists) {
        const existingValue = result[this.resolveName(ifNotExists[1]!.trim(), names)];
        result[targetName] = existingValue !== undefined ? existingValue : this.resolveValue(ifNotExists[2]!.trim(), values);
        continue;
      }
      const arithmetic = /^(\S+)\s*([+-])\s*(\S+)$/.exec(rhs!.trim());
      if (arithmetic) {
        const base = Number(result[this.resolveName(arithmetic[1]!, names)] ?? 0);
        const delta = Number(this.resolveValue(arithmetic[3]!, values));
        result[targetName] = arithmetic[2] === "+" ? base + delta : base - delta;
        continue;
      }
      result[targetName] = this.resolveValue(rhs!.trim(), values);
    }

    if (removeExpression) {
      for (const token of removeExpression.split(",")) {
        delete result[this.resolveName(token.trim(), names)];
      }
    }

    return result as Record<string, unknown> & EntityKey;
  }

  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    // Wave B2B-14 (D-119): real DynamoDB rejects an explicitly-empty ExpressionAttributeNames
    // outright (`ValidationException: ExpressionAttributeNames must not be empty`) - this fake
    // previously accepted `{}` silently, which is exactly why update-organization-settings.ts's
    // real bug (passing `{}` instead of omitting the key when there's nothing to map) was never
    // caught by any unit test. Mirrors the real API's behavior for every entry kind, not just
    // Update, so no future writer can hit the same invisible gap.
    for (const entry of entries) {
      const names = "Put" in entry ? entry.Put.ExpressionAttributeNames : "Update" in entry ? entry.Update.ExpressionAttributeNames : "Delete" in entry ? entry.Delete.ExpressionAttributeNames : undefined;
      if (names !== undefined && Object.keys(names).length === 0) {
        throw { name: "ValidationException", message: "ExpressionAttributeNames must not be empty" };
      }
    }

    const reasons: Array<{ Code: "None" | "ConditionalCheckFailed" }> = entries.map(() => ({ Code: "None" }));
    let anyFailed = false;

    entries.forEach((entry, i) => {
      if ("Put" in entry) {
        const item = entry.Put.Item as unknown as EntityKey;
        const existing = this.items.get(this.k(item));
        if (entry.Put.ConditionExpression && !this.evalCondition(entry.Put.ConditionExpression, existing, entry.Put.ExpressionAttributeNames, entry.Put.ExpressionAttributeValues)) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else if ("Update" in entry) {
        const existing = this.items.get(this.k(entry.Update.Key));
        if (!this.evalCondition(entry.Update.ConditionExpression, existing, entry.Update.ExpressionAttributeNames, entry.Update.ExpressionAttributeValues)) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else if ("Delete" in entry) {
        const existing = this.items.get(this.k(entry.Delete.Key));
        if (!this.evalCondition(entry.Delete.ConditionExpression, existing, entry.Delete.ExpressionAttributeNames, entry.Delete.ExpressionAttributeValues)) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else {
        throw new Error("InMemoryOrganizationStore.transactWrite: only Put/Update/Delete entries are supported (see file header).");
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
        const existing = this.items.get(this.k(entry.Update.Key));
        const updated = this.applyUpdate(entry.Update.UpdateExpression, existing, entry.Update.Key, entry.Update.ExpressionAttributeNames, entry.Update.ExpressionAttributeValues);
        this.items.set(this.k(entry.Update.Key), updated);
      } else if ("Delete" in entry) {
        this.items.delete(this.k(entry.Delete.Key));
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
   * writers don't have a call site for yet. Never a stand-in for a real OCC-conditioned write. */
  forceUpdate<T extends EntityKey>(item: T): void {
    this.items.set(this.k(item), item as unknown as Record<string, unknown> & EntityKey);
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}
