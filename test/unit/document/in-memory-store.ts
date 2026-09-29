import type { EntityKey, DocumentStore, TransactWriteEntry } from "../../../src/modules/document/ports/document-store.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

/** Ported from test/unit/import/in-memory-store.ts (D-076 item 3 fix, 2026-09-29 data-architecture
 * audit eixo (b)): this fake's original Update handling only recognized the literal
 * `attribute_exists(PK)` + `version`/`tenantId` shape `buildVersionedUpdate()` produces, silently
 * treating any OTHER ConditionExpression as unconditioned success and any OTHER SET/REMOVE
 * placeholder as a no-op - including `transitionIdempotencyStatus()`'s `#status = :expected`
 * condition and named (`#status`/`#requestHash`/...) SET clauses, never the `#setN` convention.
 * `IdempotencyStore.complete()` (idempotency.ts) started routing through that exact shape once it
 * was hardened to use `transitionIfStatus()` instead of a blind `update()` - this fake silently
 * "succeeding" without ever actually persisting `status: "COMPLETED"` left retried idempotency
 * keys stuck IN_PROGRESS forever (real test failures, not a production bug - confirmed the same
 * fix already exists in `import`'s fake for the same reason). */
function splitTopLevelAnd(expr: string): string[] {
  const clauses: string[] = [];
  let depth = 0;
  let current = "";
  const tokens = expr.split(/(\s+AND\s+)/);
  for (const token of tokens) {
    if (/^\s+AND\s+$/.test(token) && depth === 0) {
      clauses.push(current.trim());
      current = "";
      continue;
    }
    for (const ch of token) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
    }
    current += token;
  }
  if (current.trim()) clauses.push(current.trim());
  return clauses;
}

function evaluateEqualityClause(
  clause: string,
  names: Record<string, string>,
  values: Record<string, unknown>,
  existing: (Record<string, unknown> & EntityKey) | undefined,
): boolean {
  let c = clause.trim();
  while (c.startsWith("(") && c.endsWith(")")) c = c.slice(1, -1).trim();
  const match = /^(#\S+)\s*=\s*(:\S+)$/.exec(c);
  if (!match) return true; // unrecognized clause shape - ignore, not a hard failure.
  const nameKey = match[1];
  const valueKey = match[2];
  if (nameKey === undefined || valueKey === undefined) return true;
  const fieldName = names[nameKey];
  if (fieldName === undefined || !(valueKey in values)) return true;
  return existing !== undefined && existing[fieldName] === values[valueKey];
}

function applyUpdateExpression(
  expr: string,
  names: Record<string, string>,
  values: Record<string, unknown>,
  target: Record<string, unknown>,
): void {
  const setMatch = /SET\s+(.+?)(?:\s+REMOVE\s+(.+))?$/.exec(expr);
  if (!setMatch) return;
  const setPart = setMatch[1];
  const removePart = setMatch[2];
  for (const assignment of (setPart ?? "").split(",")) {
    const m = /^\s*(#\S+)\s*=\s*(:\S+)\s*$/.exec(assignment);
    if (!m) continue;
    const nameKey = m[1];
    const valueKey = m[2];
    if (nameKey === undefined || valueKey === undefined) continue;
    const fieldName = names[nameKey];
    if (fieldName === undefined || !(valueKey in values)) continue;
    target[fieldName] = values[valueKey];
  }
  if (removePart) {
    for (const nameKey of removePart.split(",").map((s) => s.trim())) {
      const fieldName = names[nameKey];
      if (fieldName !== undefined) delete target[fieldName];
    }
  }
}

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
        const cond = entry.Update.ConditionExpression;
        if (cond.includes("attribute_exists(PK)") && !existing) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
          return;
        }
        const names = entry.Update.ExpressionAttributeNames ?? {};
        const values = entry.Update.ExpressionAttributeValues ?? {};
        for (const clause of splitTopLevelAnd(cond)) {
          if (clause.startsWith("attribute_exists(") || clause.startsWith("attribute_not_exists(")) continue;
          if (!evaluateEqualityClause(clause, names, values, existing)) {
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
        applyUpdateExpression(entry.Update.UpdateExpression, entry.Update.ExpressionAttributeNames ?? {}, entry.Update.ExpressionAttributeValues ?? {}, next);
        // Only bump `version` if this update's own placeholders actually reference it
        // (occ.ts's buildVersionedUpdate convention) - transitionIdempotencyStatus's update has
        // no notion of a version field at all, idempotency records never carry one.
        if (Object.values(entry.Update.ExpressionAttributeNames ?? {}).includes("version")) {
          next["version"] = ((existing["version"] as number | undefined) ?? 0) + 1;
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
