import type { DocumentObjectReference } from "../../../src/modules/document/domain/document-object-reference.js";
import type { DocumentObjectStore } from "../../../src/modules/document/ports/document-object-store.js";
import type { DocumentStore, TransactWriteEntry } from "../../../src/modules/document/ports/document-store.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

/**
 * Generic-enough ConditionExpression evaluator to exercise the REAL `extraConditions` strings
 * `purge.ts` builds via `buildVersionedUpdate`/`buildVersionedDelete` — not a stand-in that only
 * checks version, which would let the claim/fence logic under test silently do nothing. Supports
 * exactly the operators this design's conditions use: `attribute_exists`/`attribute_not_exists`,
 * `=`, `<>`, `<=`, top-level `AND`, and `OR` inside a single parenthesized group (never nested
 * parens, never mixed AND/OR without grouping — the only shapes `occ.ts` ever emits).
 */
function evaluateCondition(expression: string, names: Record<string, string>, values: Record<string, unknown>, item: Record<string, unknown> | undefined): boolean {
  const resolveName = (token: string): string => (token.startsWith("#") ? (names[token] ?? token) : token);
  const resolveValue = (token: string): unknown => (token.startsWith(":") ? values[token] : token);

  function evalAtom(atom: string): boolean {
    atom = atom.trim();
    const existsMatch = atom.match(/^attribute_exists\(([^)]+)\)$/);
    if (existsMatch) return item !== undefined && item[resolveName(existsMatch[1]!.trim())] !== undefined;
    const notExistsMatch = atom.match(/^attribute_not_exists\(([^)]+)\)$/);
    if (notExistsMatch) return item === undefined || item[resolveName(notExistsMatch[1]!.trim())] === undefined;
    const cmpMatch = atom.match(/^(\S+)\s*(<>|<=|=)\s*(\S+)$/);
    if (cmpMatch) {
      const [, lhsTok, op, rhsTok] = cmpMatch;
      const lhs = item?.[resolveName(lhsTok!)];
      const rhs = resolveValue(rhsTok!);
      if (op === "=") return lhs === rhs;
      if (op === "<>") return lhs !== rhs;
      if (op === "<=") return (lhs as string) <= (rhs as string);
    }
    throw new Error(`Unsupported condition atom in fake evaluator: ${atom}`);
  }

  function evalGroup(group: string): boolean {
    group = group.trim();
    if (group.startsWith("(") && group.endsWith(")")) group = group.slice(1, -1);
    if (group.includes(" OR ")) return group.split(" OR ").some((part) => evalGroup(part));
    if (group.includes(" AND ")) return group.split(" AND ").every((part) => evalGroup(part));
    return evalAtom(group);
  }

  // Split top-level AND (never inside the single level of parens this design produces).
  const topLevelParts: string[] = [];
  let depth = 0;
  let current = "";
  const tokens = expression.split(/(\(|\)|\s+AND\s+)/);
  for (const tok of tokens) {
    if (tok === "(") depth += 1;
    if (tok === ")") depth -= 1;
    if (/^\s+AND\s+$/.test(tok) && depth === 0) {
      topLevelParts.push(current);
      current = "";
    } else {
      current += tok;
    }
  }
  topLevelParts.push(current);

  return topLevelParts.every((part) => evalGroup(part));
}

export class FakeDocumentPurgeStore implements DocumentStore {
  private readonly items = new Map<string, Record<string, unknown> & EntityKey>();

  seed(item: Record<string, unknown> & EntityKey): void {
    this.items.set(this.k(item), { ...item });
  }

  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    return Promise.resolve(this.items.get(this.k(key)) as T | undefined);
  }

  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    const key = this.k(item);
    if (this.items.has(key)) return Promise.resolve(false);
    this.items.set(key, item as unknown as Record<string, unknown> & EntityKey);
    return Promise.resolve(true);
  }

  update<T extends EntityKey>(item: T): Promise<void> {
    this.items.set(this.k(item), item as unknown as Record<string, unknown> & EntityKey);
    return Promise.resolve();
  }

  queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(): Promise<T[]> {
    return Promise.resolve([] as T[]);
  }

  private k(key: EntityKey): string {
    return `${key.PK}#${key.SK}`;
  }

  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    // Validate ALL conditions first (transactional all-or-nothing), then apply.
    for (const entry of entries) {
      if ("Update" in entry) {
        const existing = this.items.get(this.k(entry.Update.Key));
        if (!evaluateCondition(entry.Update.ConditionExpression, entry.Update.ExpressionAttributeNames ?? {}, entry.Update.ExpressionAttributeValues, existing)) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on Update" };
        }
      } else if ("Delete" in entry) {
        const existing = this.items.get(this.k(entry.Delete.Key));
        if (entry.Delete.ConditionExpression && !evaluateCondition(entry.Delete.ConditionExpression, entry.Delete.ExpressionAttributeNames ?? {}, entry.Delete.ExpressionAttributeValues ?? {}, existing)) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on Delete" };
        }
      } else if ("Put" in entry) {
        const exists = this.items.has(this.k(entry.Put.Item as unknown as EntityKey));
        if (entry.Put.ConditionExpression.includes("attribute_not_exists(PK)") && exists) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on Put" };
        }
      }
    }

    for (const entry of entries) {
      if ("Update" in entry) {
        const key = entry.Update.Key;
        const existing = this.items.get(this.k(key)) ?? { ...key };
        const next: Record<string, unknown> & EntityKey = { ...existing };
        for (const [name, placeholder] of Object.entries(entry.Update.ExpressionAttributeNames ?? {})) {
          if (placeholder === "version") next["version"] = ((existing["version"] as number | undefined) ?? 0) + 1;
          else if (placeholder === "updatedAt") next["updatedAt"] = entry.Update.ExpressionAttributeValues[":now"];
          else if (name.startsWith("#set")) next[placeholder] = entry.Update.ExpressionAttributeValues[`:${name.slice(1)}`];
          else if (name.startsWith("#rem")) delete next[placeholder];
        }
        this.items.set(this.k(key), next);
      } else if ("Delete" in entry) {
        this.items.delete(this.k(entry.Delete.Key));
      } else if ("Put" in entry) {
        this.items.set(this.k(entry.Put.Item as unknown as EntityKey), entry.Put.Item as Record<string, unknown> & EntityKey);
      }
    }
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}

export class FakeDocumentObjectStore implements DocumentObjectStore {
  readonly deletedVersions: DocumentObjectReference[] = [];

  headObject() {
    return Promise.resolve(undefined);
  }

  copyObject(_source: DocumentObjectReference, destinationBucket: string, destinationKey: string) {
    return Promise.resolve({ bucket: destinationBucket, key: destinationKey, versionId: "copied" });
  }

  deleteObjectVersion(ref: DocumentObjectReference): Promise<void> {
    this.deletedVersions.push(ref);
    return Promise.resolve();
  }
}
