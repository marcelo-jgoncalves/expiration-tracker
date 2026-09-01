import type { DocumentArchiveStore, EntityKey, IndexPage, IndexPageInput, TransactWriteEntry } from "../../../src/modules/document-archive/ports/document-archive-store.js";

/**
 * In-memory fake of DocumentArchiveStore, mirroring test/unit/expiration/in-memory-store.ts's
 * conventions but with a real (small) ConditionExpression PARSER rather than a fixed set of
 * known shapes or a naming-convention guess — D-143's `acceptVersion` transaction fences
 * several caller-defined attribute equalities (`documentId=`, `pendingFileScans=0`,
 * `infectedFileScans=0`, an OR-of-states check, etc., built via occ.ts's `extraConditions`)
 * whose ExpressionAttributeNames/Values also carry SET-clause placeholders in the SAME maps —
 * a naming-convention-based evaluator cannot tell a condition's `#name = :value` apart from a
 * SET clause's `#setN = :setN` without parsing the actual ConditionExpression string, and an
 * earlier version of this fake got this wrong (it treated every name/value pair as a condition,
 * so a normal state-transition Update appeared to require the item ALREADY be in its target
 * state before writing it — backwards). This parser handles exactly the grammar
 * `shared/dynamodb/occ.ts`'s builders produce: a top-level `AND`-separated list of clauses,
 * each clause either `attribute_exists(PK|SK)`, `attribute_not_exists(PK|SK)`, a bare
 * `#name = :value` equality, or a parenthesized group of `OR`-joined equalities.
 */
interface ParsedCondition {
  requireExists?: boolean;
  requireAbsent?: boolean;
  /** Each inner array is OR'd together internally; the outer array is AND'd (one entry per
   * top-level clause that resolved to an equality/OR-of-equalities). */
  equalityGroups: Array<Array<{ field: string; value: unknown }>>;
}

function parseCondition(expression: string, names: Record<string, string> | undefined, values: Record<string, unknown> | undefined): ParsedCondition {
  const result: ParsedCondition = { equalityGroups: [] };
  const nameMap = names ?? {};
  const valueMap = values ?? {};

  const resolveEquality = (clause: string): { field: string; value: unknown } | undefined => {
    const match = /^\s*(#\w+)\s*=\s*(:\w+)\s*$/.exec(clause);
    if (!match) return undefined;
    const [, nameKey, valueKey] = match;
    const field = nameMap[nameKey as string];
    if (!field || !(valueKey! in valueMap)) return undefined;
    return { field, value: valueMap[valueKey as string] };
  };

  for (const rawClause of expression.split(" AND ")) {
    const clause = rawClause.trim();
    if (clause === "attribute_exists(PK)" || clause === "attribute_exists(SK)") {
      result.requireExists = true;
      continue;
    }
    if (clause === "attribute_not_exists(PK)" || clause === "attribute_not_exists(SK)") {
      result.requireAbsent = true;
      continue;
    }
    const unwrapped = clause.startsWith("(") && clause.endsWith(")") ? clause.slice(1, -1) : clause;
    const orEqualities = unwrapped
      .split(" OR ")
      .map((part) => resolveEquality(part))
      .filter((eq): eq is { field: string; value: unknown } => eq !== undefined);
    if (orEqualities.length > 0) {
      result.equalityGroups.push(orEqualities);
    }
    // A clause this parser cannot recognize (should not occur for this module's builders) is
    // silently skipped rather than thrown — same "documented limitation" posture as
    // InMemoryIdentityStore, but every clause this service actually emits is covered above.
  }
  return result;
}

function conditionSatisfied(existing: Record<string, unknown> | undefined, parsed: ParsedCondition): boolean {
  if (parsed.requireExists && !existing) return false;
  if (parsed.requireAbsent && existing) return false;
  if (!existing) return parsed.requireAbsent === true || (!parsed.requireExists && parsed.equalityGroups.length === 0);
  for (const group of parsed.equalityGroups) {
    const anyMatches = group.some((eq) => existing[eq.field] === eq.value);
    if (!anyMatches) return false;
  }
  return true;
}
export class InMemoryDocumentArchiveStore implements DocumentArchiveStore {
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

  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    const reasons: Array<{ Code: "None" | "ConditionalCheckFailed" }> = entries.map(() => ({ Code: "None" }));
    let anyFailed = false;

    entries.forEach((entry, i) => {
      if ("Put" in entry) {
        const existing = this.items.get(this.k(entry.Put.Item as unknown as EntityKey));
        const parsed = parseCondition(entry.Put.ConditionExpression, entry.Put.ExpressionAttributeNames, entry.Put.ExpressionAttributeValues);
        if (!conditionSatisfied(existing, parsed)) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else if ("Update" in entry) {
        const existing = this.items.get(this.k(entry.Update.Key));
        const parsed = parseCondition(entry.Update.ConditionExpression, entry.Update.ExpressionAttributeNames, entry.Update.ExpressionAttributeValues);
        if (!conditionSatisfied(existing, parsed)) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else if ("ConditionCheck" in entry) {
        const check = entry.ConditionCheck;
        const existing = this.items.get(this.k(check.Key));
        const parsed = parseCondition(check.ConditionExpression, check.ExpressionAttributeNames, check.ExpressionAttributeValues);
        if (!conditionSatisfied(existing, parsed)) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else if ("Delete" in entry) {
        const del = entry.Delete;
        const existing = this.items.get(this.k(del.Key));
        if (del.ConditionExpression) {
          const parsed = parseCondition(del.ConditionExpression, del.ExpressionAttributeNames, del.ExpressionAttributeValues);
          if (!conditionSatisfied(existing, parsed)) {
            reasons[i] = { Code: "ConditionalCheckFailed" };
            anyFailed = true;
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
          }
        }
        for (const [name, fieldName] of Object.entries(entry.Update.ExpressionAttributeNames ?? {})) {
          if (name.startsWith("#rem")) {
            delete next[fieldName];
          }
        }
        this.items.set(this.k(key), next);
      } else if ("Delete" in entry) {
        this.items.delete(this.k(entry.Delete.Key));
      }
      // ConditionCheck never mutates.
    }
  }

  async queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]> {
    const matches = [...this.items.values()].filter((item) => item["PK"] === pk && (!skPrefix || String(item["SK"]).startsWith(skPrefix)));
    matches.sort((a, b) => String(a["SK"]).localeCompare(String(b["SK"])));
    return matches as unknown as T[];
  }

  async queryIndexPage<T extends EntityKey = Record<string, unknown> & EntityKey>(input: IndexPageInput): Promise<IndexPage<T>> {
    const pkAttribute = `${input.indexName}PK`;
    const skAttribute = `${input.indexName}SK`;
    const ascending = input.ascending ?? true;
    const matches = [...this.items.values()].filter((item) => item[pkAttribute] === input.partitionKeyValue);
    matches.sort((a, b) => {
      const sa = String(a[skAttribute]);
      const sb = String(b[skAttribute]);
      return ascending ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    const startAfter = input.exclusiveStartKey?.[skAttribute] as string | undefined;
    const fromCursor =
      startAfter === undefined ? matches : matches.filter((item) => (ascending ? String(item[skAttribute]) > startAfter : String(item[skAttribute]) < startAfter));
    const limit = input.limit ?? fromCursor.length;
    const page = fromCursor.slice(0, limit);
    const hasMore = fromCursor.length > page.length;
    const last = page[page.length - 1];
    return {
      items: page as unknown as T[],
      lastEvaluatedKey: hasMore && last ? { [pkAttribute]: last[pkAttribute], [skAttribute]: last[skAttribute] } : undefined,
    };
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}
