import type { DocumentArchiveStore, EntityKey, IndexPage, IndexPageInput, TransactWriteEntry } from "../../../src/modules/document-archive/ports/document-archive-store.js";
import { documentTypeKey, type DocumentType } from "../../../src/modules/document-archive/domain/document-type.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

/** D-173 item 3: `createDocument()` now runs through `executeTenantBusinessMutation`, which
 * fences on `TenantLifecycleRecord.status = ACTIVE` in the SAME store — fixtures that build
 * their own `InMemoryDocumentArchiveStore` (rather than sharing the identity module's) need
 * this row too, mirroring `document-type-service.test.ts`'s existing `seedTenant` pattern. */
export function seedActiveTenantLifecycle(tenantId: string): Record<string, unknown> & EntityKey {
  const record: TenantLifecycleRecord = {
    ...(tenantLifecycleKey(tenantId) as { PK: string; SK: "LIFECYCLE" }),
    entityType: "TenantLifecycleRecord",
    tenantId,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  };
  return record as unknown as Record<string, unknown> & EntityKey;
}

/** D-173 item 3: `createDocument()`'s transactional `ConditionCheck` requires a real
 * `DocumentType` row (status ACTIVE) to exist at the id `input.documentTypeId` names.
 * Fixtures across this suite pass a literal like "ALVARA" as that id — this seeds one ACTIVE
 * row per literal so existing `createDocument()` fixtures keep working unchanged. */
export function seedActiveDocumentType(tenantId: string, documentTypeId: string): Record<string, unknown> & EntityKey {
  const documentType: DocumentType = {
    ...documentTypeKey(tenantId, documentTypeId),
    entityType: "DocumentType",
    documentTypeId,
    tenantId,
    displayName: documentTypeId,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    GSI1PK: `TENANT#${tenantId}#DOCTYPESTATUS#ACTIVE`,
    GSI1SK: `NAME#${documentTypeId.toLowerCase()}#DOCTYPE#${documentTypeId}`,
  };
  return documentType as unknown as Record<string, unknown> & EntityKey;
}

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
type OrTerm = { kind: "equality"; field: string; value: unknown } | { kind: "exists"; field: string } | { kind: "notExists"; field: string };

interface ParsedCondition {
  requireExists?: boolean;
  requireAbsent?: boolean;
  /** Each inner array is OR'd together internally; the outer array is AND'd (one entry per
   * top-level clause that resolved to an equality/OR-of-equalities). */
  equalityGroups: Array<OrTerm[]>;
}

function parseCondition(expression: string, names: Record<string, string> | undefined, values: Record<string, unknown> | undefined): ParsedCondition {
  const result: ParsedCondition = { equalityGroups: [] };
  const nameMap = names ?? {};
  const valueMap = values ?? {};

  const resolveTerm = (clause: string): OrTerm | undefined => {
    const eq = /^\s*(#\w+)\s*=\s*(:\w+)\s*$/.exec(clause);
    if (eq) {
      const [, nameKey, valueKey] = eq;
      const field = nameMap[nameKey as string];
      if (!field || !(valueKey! in valueMap)) return undefined;
      return { kind: "equality", field, value: valueMap[valueKey as string] };
    }
    // Named-attribute attribute_exists/attribute_not_exists — distinct from the bare
    // PK/SK-only top-level checks below, which this module's builders never wrap in an OR
    // group (only D-163's `reserveFiles()` fence does: "attribute_not_exists(#sealed) OR
    // #sealed = :false", real, valid DynamoDB syntax this fake didn't parse before).
    const notExists = /^\s*attribute_not_exists\((#\w+)\)\s*$/.exec(clause);
    if (notExists) {
      const field = nameMap[notExists[1] as string];
      return field ? { kind: "notExists", field } : undefined;
    }
    const exists = /^\s*attribute_exists\((#\w+)\)\s*$/.exec(clause);
    if (exists) {
      const field = nameMap[exists[1] as string];
      return field ? { kind: "exists", field } : undefined;
    }
    return undefined;
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
    const orTerms = unwrapped
      .split(" OR ")
      .map((part) => resolveTerm(part))
      .filter((term): term is OrTerm => term !== undefined);
    if (orTerms.length > 0) {
      result.equalityGroups.push(orTerms);
    }
    // A clause this parser cannot recognize (should not occur for this module's builders) is
    // silently skipped rather than thrown — same "documented limitation" posture as
    // InMemoryIdentityStore, but every clause this service actually emits is covered above.
  }
  return result;
}

function termSatisfied(existing: Record<string, unknown>, term: OrTerm): boolean {
  switch (term.kind) {
    case "equality":
      return existing[term.field] === term.value;
    case "exists":
      return term.field in existing;
    case "notExists":
      return !(term.field in existing);
  }
}

function conditionSatisfied(existing: Record<string, unknown> | undefined, parsed: ParsedCondition): boolean {
  if (parsed.requireExists && !existing) return false;
  if (parsed.requireAbsent && existing) return false;
  if (!existing) {
    // No item at all: every `notExists` term is trivially satisfied, every `exists`/`equality`
    // term is not — mirrors real DynamoDB's behavior evaluating a ConditionExpression against
    // a nonexistent item.
    return parsed.requireAbsent === true || (!parsed.requireExists && parsed.equalityGroups.every((group) => group.some((term) => term.kind === "notExists")));
  }
  for (const group of parsed.equalityGroups) {
    const anyMatches = group.some((term) => termSatisfied(existing, term));
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

  /** D-146: mirrors `DynamoDbDocumentArchiveStore.updateConditional` — full-item overwrite
   * gated on the counter still matching `expected`, used by `DocumentArchiveGuestRateLimiter`. */
  async updateConditional<T extends EntityKey>(item: T, expected: { count: number; resetAt: string }): Promise<boolean> {
    const key = this.k(item);
    const existing = this.items.get(key) as { count?: unknown; resetAt?: unknown } | undefined;
    if (!existing || existing.count !== expected.count || existing.resetAt !== expected.resetAt) return false;
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

  /** Fake for `scanSatisfiedRequirements` — no pagination needed for this fake's test sizes
   * (unlike `queryIndexPage`/`queryByPk`, whose real callers depend on real paging behavior),
   * so `exclusiveStartKey` is accepted for interface parity but every call returns everything
   * matching in one page. */
  async scanSatisfiedRequirements<T extends EntityKey = Record<string, unknown> & EntityKey>(_exclusiveStartKey?: Record<string, unknown>): Promise<{ items: T[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const matches = [...this.items.values()].filter((item) => item["entityType"] === "Requirement" && item["status"] === "SATISFIED");
    return { items: matches as unknown as T[], lastEvaluatedKey: undefined };
  }

  /** Fake for `scanActiveSeries` (D-147) — same one-page-returns-everything simplification as
   * `scanSatisfiedRequirements` above. */
  async scanActiveSeries<T extends EntityKey = Record<string, unknown> & EntityKey>(_exclusiveStartKey?: Record<string, unknown>): Promise<{ items: T[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const matches = [...this.items.values()].filter((item) => item["entityType"] === "DocumentRequestSeries" && item["status"] === "ACTIVE");
    return { items: matches as unknown as T[], lastEvaluatedKey: undefined };
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}
