import type { EntityKey, NotificationStore, TransactWriteEntry } from "../../../src/modules/notification/ports/notification-store.js";

// D-328 revisão adversarial (achado real Média, Codex Rodada 7, R7-1): a checagem de condição
// desta fake usava uma convenção de NOMENCLATURA (`valueKey = ':' + nameKey.slice(1)`) para achar
// o valor esperado de cada placeholder de nome, em vez de interpretar de verdade a
// `ConditionExpression` - se um `extraConditions` (occ.ts) algum dia usar sufixos de nome/valor
// diferentes, a checagem simplesmente PULA a condição (`continue`), deixando a escrita suceder
// silenciosamente contra uma condição real que o DynamoDB teria rejeitado (foi exatamente esse
// tipo de fragilidade que a Rodada 7 pegou por acidente, antes de ser corrigida por convenção -
// ver `docs/architecture/reviews/d328-.../round-7-claude-revision.md`). Corrigido: porta o
// avaliador genérico de `ConditionExpression` (attribute_exists/attribute_not_exists, igualdade,
// AND/OR de nível superior respeitando parênteses) que `test/unit/reminder/in-memory-store.ts` já
// tem e já prova battle-tested (D-300) - a expressão em si é a única fonte de verdade, nunca uma
// suposição de convenção de nome, e sintaxe não suportada lança erro em vez de aprovar em
// silêncio.
function resolveAttr(raw: string, names: Record<string, string>): string {
  return raw.startsWith("#") ? (names[raw] ?? raw) : raw;
}

function evalClause(clause: string, existing: (Record<string, unknown> & EntityKey) | undefined, names: Record<string, string>, values: Record<string, unknown>): boolean {
  const trimmed = clause.trim();
  const notExists = /^attribute_not_exists\(([#\w]+)\)$/.exec(trimmed);
  if (notExists) return existing?.[resolveAttr(notExists[1]!, names)] === undefined;
  const exists = /^attribute_exists\(([#\w]+)\)$/.exec(trimmed);
  if (exists) return existing?.[resolveAttr(exists[1]!, names)] !== undefined;
  const eq = /^([#\w]+)\s*=\s*(:\w+)$/.exec(trimmed);
  if (eq) {
    const attr = resolveAttr(eq[1]!, names);
    return existing !== undefined && existing[attr] === values[eq[2]!];
  }
  throw new Error(`InMemoryNotificationStore: unsupported condition clause: ${clause}`);
}

/** Splits `expr` on `separator` at PAREN DEPTH 0 ONLY - occ.ts's `extraConditions` wraps each
 * entry's own expression in its own parens specifically so callers never have to hand-balance
 * parens against the base condition. */
function splitTopLevel(expr: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth === 0 && expr.slice(i, i + separator.length) === separator) {
      parts.push(current.trim());
      current = "";
      i += separator.length;
      continue;
    }
    current += ch;
    i += 1;
  }
  parts.push(current.trim());
  return parts;
}

function evalClauseOrGroup(token: string, existing: (Record<string, unknown> & EntityKey) | undefined, names: Record<string, string>, values: Record<string, unknown>): boolean {
  if (token.startsWith("(") && token.endsWith(")")) {
    let depth = 0;
    let closesAtEnd = true;
    for (let i = 0; i < token.length - 1; i++) {
      if (token[i] === "(") depth += 1;
      if (token[i] === ")") depth -= 1;
      if (depth === 0) {
        closesAtEnd = false;
        break;
      }
    }
    if (closesAtEnd) return evalCondition(token.slice(1, -1), existing, names, values);
  }
  return evalClause(token, existing, names, values);
}

function evalCondition(expression: string, existing: (Record<string, unknown> & EntityKey) | undefined, names: Record<string, string>, values: Record<string, unknown>): boolean {
  return splitTopLevel(expression, " OR ").some((orGroup) => splitTopLevel(orGroup, " AND ").every((clause) => evalClauseOrGroup(clause, existing, names, values)));
}

/** In-memory fake using the generic `ConditionExpression` evaluator above (same one
 * test/unit/reminder/in-memory-store.ts uses) for every Put/Update condition this module's
 * builders produce. */
export class InMemoryNotificationStore implements NotificationStore {
  private readonly items = new Map<string, Record<string, unknown> & EntityKey>();

  private k(key: EntityKey): string {
    return `${key.PK}#${key.SK}`;
  }

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    return this.items.get(this.k(key)) as T | undefined;
  }

  /** Test-only, NOT part of `NotificationStore` (real DynamoDB TTL deletion is a server-side,
   * asynchronous background process - no application code ever calls a "delete" RPC for it). Lets
   * a test simulate a row having been physically removed by TTL cleanup mid-scenario (D-328 R6-1:
   * a paused writer's `expectedVersion` can then coincidentally match a brand-new row recreated at
   * the same key, since both start at `version=1`). */
  _simulateTtlDeletion(key: EntityKey): void {
    this.items.delete(this.k(key));
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
        const existing = this.items.get(this.k(entry.Put.Item as unknown as EntityKey));
        if (!evalCondition(entry.Put.ConditionExpression, existing, entry.Put.ExpressionAttributeNames ?? {}, entry.Put.ExpressionAttributeValues ?? {})) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else if ("ConditionCheck" in entry) {
        const existing = this.items.get(this.k(entry.ConditionCheck.Key));
        if (!evalCondition(entry.ConditionCheck.ConditionExpression, existing, entry.ConditionCheck.ExpressionAttributeNames ?? {}, entry.ConditionCheck.ExpressionAttributeValues ?? {})) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else if ("Update" in entry) {
        const existing = this.items.get(this.k(entry.Update.Key));
        if (!evalCondition(entry.Update.ConditionExpression, existing, entry.Update.ExpressionAttributeNames ?? {}, entry.Update.ExpressionAttributeValues)) {
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

  async queryWhatsAppPortfolioQuotaWindow<T extends EntityKey = Record<string, unknown> & EntityKey>(
    startSkInclusive: string,
    endSkInclusive: string,
  ): Promise<T[]> {
    return [...this.items.values()]
      .filter((i) => i.PK === "WHATSAPP#PORTFOLIO" && String(i.SK) >= startSkInclusive && String(i.SK) <= endSkInclusive)
      .sort((a, b) => String(a.SK).localeCompare(String(b.SK))) as unknown as T[];
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}
