import type { EntityKey, TransactWriteEntry } from "../../../src/modules/reminder/ports/reminder-store.js";
import type { ReminderStore, ReminderProducerStore, Gsi3QueryInput, Gsi3Page, Gsi3PageQueryInput } from "../../../src/modules/reminder/ports/reminder-store.js";
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

/**
 * Small generic evaluator for the condition-clause shapes this codebase's builders
 * actually produce (attribute_exists/attribute_not_exists, and `<attr> = :value`
 * equality, ANDed/ORed at a single level - never deeper nesting) - P0.4 added the first
 * Put/Delete conditions beyond the two hardcoded shapes this fake originally special-
 * cased, so conditions are now evaluated structurally instead of by substring matching.
 */
/** Resolves a raw attribute reference (either a literal name or a `#placeholder`) to the real
 * attribute name via `names`. */
function resolveAttr(raw: string, names: Record<string, string>): string {
  return raw.startsWith("#") ? (names[raw] ?? raw) : raw;
}

function evalClause(clause: string, existing: (Record<string, unknown> & EntityKey) | undefined, names: Record<string, string>, values: Record<string, unknown>): boolean {
  const trimmed = clause.trim();
  // D-300 (lease.ts): attribute_not_exists/attribute_exists must accept a `#placeholder` name,
  // not just a literal one - occ.ts's extraConditions always uses placeholders.
  const notExists = /^attribute_not_exists\(([#\w]+)\)$/.exec(trimmed);
  if (notExists) return existing?.[resolveAttr(notExists[1]!, names)] === undefined;
  const exists = /^attribute_exists\(([#\w]+)\)$/.exec(trimmed);
  if (exists) return existing?.[resolveAttr(exists[1]!, names)] !== undefined;
  // D-300 (lease.ts reclaim/checkpoint conditions): ordering comparisons over ISO-string
  // (lexicographically ordered by construction) or numeric attributes.
  const cmp = /^([#\w]+)\s*(<=|>=|<|>)\s*(:\w+)$/.exec(trimmed);
  if (cmp) {
    const attr = resolveAttr(cmp[1]!, names);
    const existingValue = existing?.[attr];
    const expected = values[cmp[3]!];
    if (existingValue === undefined) return false;
    switch (cmp[2]) {
      case "<":
        return (existingValue as never) < (expected as never);
      case "<=":
        return (existingValue as never) <= (expected as never);
      case ">":
        return (existingValue as never) > (expected as never);
      case ">=":
        return (existingValue as never) >= (expected as never);
      default:
        return false;
    }
  }
  const eq = /^([#\w]+)\s*=\s*(:\w+)$/.exec(trimmed);
  if (eq) {
    const attr = resolveAttr(eq[1]!, names);
    return existing !== undefined && existing[attr] === values[eq[2]!];
  }
  throw new Error(`InMemoryReminderStore: unsupported condition clause: ${clause}`);
}

/** Splits `expr` on `separator` at PAREN DEPTH 0 ONLY - a naive `String.split(" AND ")` would
 * incorrectly split INSIDE a parenthesized group (e.g. occ.ts's `extraConditions`, which wraps
 * each entry's own multi-clause expression in its own parens specifically so callers never have
 * to hand-balance parens against the base condition - see occ.ts's doc comment). D-300's
 * checkpoint condition is the first real exerciser of a multi-clause extraConditions entry
 * against this fake (`(#ownerToken = :x AND #leaseUntil >= :y AND ...)`), which surfaced this
 * gap - naive splitting shredded that group into invalid fragments. */
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

/** A token wrapped in its own balanced outer parens (occ.ts's `extraConditions` shape) is
 * recursively evaluated as a nested condition; otherwise it's a leaf clause. */
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
        const existing = this.items.get(this.k(entry.Put.Item as unknown as EntityKey));
        if (!evalCondition(entry.Put.ConditionExpression, existing, entry.Put.ExpressionAttributeNames ?? {}, entry.Put.ExpressionAttributeValues ?? {})) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on Put", CancellationReasons: cancellationReasons(entries, index) };
        }
      } else if ("ConditionCheck" in entry) {
        const existing = this.items.get(this.k(entry.ConditionCheck.Key));
        if (!evalCondition(entry.ConditionCheck.ConditionExpression, existing, entry.ConditionCheck.ExpressionAttributeNames ?? {}, entry.ConditionCheck.ExpressionAttributeValues ?? {})) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on ConditionCheck", CancellationReasons: cancellationReasons(entries, index) };
        }
      } else if ("Delete" in entry) {
        // Unconditional deletes (no ConditionExpression) always succeed, matching real
        // DynamoDB semantics (deleting an absent key is a no-op, not an error). P0.4 added
        // the first CONDITIONED Delete (pointer ownership) - evaluated the same way as
        // Put/ConditionCheck when present.
        if (entry.Delete.ConditionExpression) {
          const existing = this.items.get(this.k(entry.Delete.Key));
          if (!evalCondition(entry.Delete.ConditionExpression, existing, entry.Delete.ExpressionAttributeNames ?? {}, entry.Delete.ExpressionAttributeValues ?? {})) {
            throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on Delete", CancellationReasons: cancellationReasons(entries, index) };
          }
        }
      } else {
        // D-300 (lease.ts) real finding: this branch used to hardcode "check version + tenantId
        // only", completely ignoring any `extraConditions` (ownerToken/leaseUntil/
        // lastEvaluatedKey for D-300's lease transitions) AND silently passing for an unscoped
        // update (buildUnscopedVersionedUpdate has no `:tenantId` value at all, so
        // `undefined === undefined` vacuously succeeded). Now uses the SAME generic
        // evalCondition evaluator as Put/ConditionCheck/Delete above - the condition string is
        // the single source of truth, never re-derived ad hoc per entry kind.
        const key = entry.Update.Key;
        const existing = this.items.get(this.k(key));
        if (!evalCondition(entry.Update.ConditionExpression, existing, entry.Update.ExpressionAttributeNames ?? {}, entry.Update.ExpressionAttributeValues)) {
          throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed on Update", CancellationReasons: cancellationReasons(entries, index) };
        }
      }
    });

    for (const entry of entries) {
      if ("ConditionCheck" in entry) {
        continue;
      } else if ("Delete" in entry) {
        this.items.delete(this.k(entry.Delete.Key));
      } else if ("Put" in entry) {
        this.items.set(this.k(entry.Put.Item as unknown as EntityKey), entry.Put.Item as Record<string, unknown> & EntityKey);
      } else {
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
            // Mirrors occ.ts's REMOVE clause support (M3.5) - #remN names are attributes to
            // delete, e.g. GSI6PK/GSI6SK when a claim/DST pointer stops applying.
            delete next[placeholder];
          }
        }
        this.items.set(this.k(key), next);
      }
    }
  }

  async queryByItem<T extends EntityKey = Record<string, unknown> & EntityKey>(tenantId: string, itemId: string, skPrefix = "OCC#"): Promise<T[]> {
    const pk = `TENANT#${tenantId}#ITEM#${itemId}`;
    return [...this.items.values()].filter((i) => i.PK === pk && String(i.SK).startsWith(skPrefix)) as unknown as T[];
  }

  /** Emulates a GSI3 (KEYS_ONLY projection) query: returns only PK/SK/GSI3PK/GSI3SK, exactly like DynamoDB would. */
  async queryGsi3<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi3QueryInput): Promise<T[]> {
    return [...this.items.values()]
      .filter((i) => i["GSI3PK"] === input.gsi3pk)
      .map((i) => ({ PK: i.PK, SK: i.SK, GSI3PK: i["GSI3PK"], GSI3SK: i["GSI3SK"] })) as unknown as T[];
  }

  /** D-300: single-page emulation, sorted by PK#SK so pagination is deterministic across
   * calls with the same underlying map (real DynamoDB orders by sort key within a partition;
   * this fake's rows span several GSI3PK partitions collapsed into one Map, so PK#SK is the
   * closest stable stand-in a test can rely on). `limit` truncates the match set; a
   * `lastEvaluatedKey` (this fake's own `{ PK, SK }` shape) is returned whenever the match set
   * is longer than `limit ` - tests then re-call with `exclusiveStartKey` to fetch the next page. */
  async queryGsi3Page<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi3PageQueryInput): Promise<Gsi3Page<T>> {
    const all = [...this.items.values()]
      .filter((i) => i["GSI3PK"] === input.gsi3pk)
      .map((i) => ({ PK: i.PK, SK: i.SK, GSI3PK: i["GSI3PK"], GSI3SK: i["GSI3SK"] }))
      .sort((a, b) => this.k(a).localeCompare(this.k(b)));

    const startAfterKey = input.exclusiveStartKey ? `${input.exclusiveStartKey["PK"]}#${input.exclusiveStartKey["SK"]}` : undefined;
    const startIndex = startAfterKey ? all.findIndex((i) => this.k(i) === startAfterKey) + 1 : 0;
    const page = all.slice(startIndex, startIndex + input.limit);
    const hasMore = startIndex + input.limit < all.length;

    return {
      items: page as unknown as T[],
      lastEvaluatedKey: hasMore ? { PK: page[page.length - 1]!.PK, SK: page[page.length - 1]!.SK } : undefined,
    };
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
