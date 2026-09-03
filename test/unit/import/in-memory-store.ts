import type { EntityKey, ImportStore, TransactWriteEntry } from "../../../src/modules/import/ports/import-store.js";
import type { ImportObjectStore } from "../../../src/modules/import/ports/import-object-store.js";
import type { ImportIdGenerator } from "../../../src/modules/import/application/id-generator.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

/** W3-07 (D-070 chunk 8/N): ImportService.reserveImport's job creation now fences through
 * TenantBusinessMutation, which requires a TenantLifecycleRecord to exist in THIS store (the
 * import module's own physical partition in production, a separate in-memory Map here). Same
 * synchronous-seed convention as test/unit/subject/in-memory-store.ts / document's fake. */
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

/** Splits a ConditionExpression/UpdateExpression's top-level " AND "-joined clauses, respecting
 * paren nesting (occ.ts's `extraConditions` wrap each clause in its own parens before ANDing it
 * in) - avoids the fake special-casing one literal clause shape (e.g. only `#version =
 * :expectedVersion`) and silently no-op'ing any other equality condition a caller adds (D-076
 * item 3: `transitionIdempotencyStatus`'s `#status = :expected` condition is exactly such a case
 * this fake previously never evaluated at all, so `abort()` silently no-op'd through this store). */
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

/** Generic equality-condition evaluator for a single clause (after unwrapping outer parens) -
 * `#name = :value` against `existing`. Returns true (pass) for clause shapes this fake does not
 * recognize (best-effort fake, same discipline as the rest of this file) rather than failing
 * closed on an unrecognized clause. */
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

/** Generic SET/REMOVE apply for an UpdateExpression, replacing the old `:setN`/`#setN`-only
 * convention - covers both `occ.ts`'s generated `#setN`/`#remN` placeholders AND a caller's own
 * literally-named placeholders (e.g. `transitionIdempotencyStatus`'s `#status`/`#requestHash`/
 * `#responseRef`/`#completedAt`), which the old convention silently never applied at all. */
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

/** Mesmas convenções de test/unit/subject/in-memory-store.ts (avalia só os formatos de
 * ConditionExpression que este codebase realmente produz). */
export class InMemoryImportStore implements ImportStore {
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

  /** W3-07 (D-070 chunk 8/N): extended with a `ConditionCheck` branch (previously silently a
   * no-op, since the loop only matched "Put"/"Update" - the lifecycle fence's ConditionCheck
   * entry was accepted unconditionally, meaning a fence added at a call site through this fake
   * would never actually be exercised by a test). Now mirrors the same CancellationReasons-aware
   * two-pass validate-then-apply convention as test/unit/subject/in-memory-store.ts /
   * test/unit/document/in-memory-store.ts, so a lifecycle-fence rejection here is never confused
   * with an ordinary OCC version conflict on the caller's own entry. */
  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    const reasons: Array<{ Code: "None" | "ConditionalCheckFailed" }> = entries.map(() => ({ Code: "None" }));
    let anyFailed = false;

    entries.forEach((entry, i) => {
      if ("Put" in entry) {
        const item = entry.Put.Item as Record<string, unknown> & EntityKey;
        const key = this.k(item);
        if (entry.Put.ConditionExpression?.includes("attribute_not_exists(PK)") && this.items.has(key)) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
        }
      } else if ("Update" in entry) {
        const existing = this.items.get(this.k(entry.Update.Key));
        const cond = entry.Update.ConditionExpression;
        const requiresExists = cond.includes("attribute_exists(PK)");
        if (requiresExists && !existing) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
          return;
        }
        // Generic equality-clause evaluation (D-076 item 3 fix): previously only recognized
        // `#version = :expectedVersion` literally, silently ignoring every other equality
        // condition a caller's ConditionExpression names - including
        // `transitionIdempotencyStatus`'s `#status = :expected`, which made `abort()`
        // unconditionally "succeed" through this fake without ever checking the prior status.
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
      }
    });

    if (anyFailed) {
      throw Object.assign(new Error("TransactionCanceledException"), { name: "TransactionCanceledException", CancellationReasons: reasons });
    }

    for (const entry of entries) {
      if ("Put" in entry) {
        const item = entry.Put.Item as Record<string, unknown> & EntityKey;
        this.items.set(this.k(item), item);
      } else if ("Update" in entry) {
        const existing = this.items.get(this.k(entry.Update.Key)) ?? { ...entry.Update.Key };
        const updated: Record<string, unknown> & EntityKey = { ...existing };
        applyUpdateExpression(entry.Update.UpdateExpression, entry.Update.ExpressionAttributeNames ?? {}, entry.Update.ExpressionAttributeValues ?? {}, updated);
        // Only bump `version` if this update's own placeholders actually reference it (occ.ts's
        // buildVersionedUpdate convention) - transitionIdempotencyStatus's update has no notion
        // of a version field at all, and idempotency records never carry one.
        if (Object.values(entry.Update.ExpressionAttributeNames ?? {}).includes("version")) {
          updated["version"] = ((existing as Record<string, unknown>)["version"] as number | undefined ?? 0) + 1;
        }
        this.items.set(this.k(entry.Update.Key), updated);
      }
    }
  }

  async queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]> {
    const results: T[] = [];
    for (const item of this.items.values()) {
      if (item.PK === pk && (!skPrefix || item.SK.startsWith(skPrefix))) results.push(item as unknown as T);
    }
    return results;
  }

  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}

export class FakeImportObjectStore implements ImportObjectStore {
  private readonly objects = new Map<string, Buffer>();

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const value = this.objects.get(`${bucket}/${key}`);
    // Real S3Client (@aws-sdk/client-s3) throws an error named "NoSuchKey" when the object
    // doesn't exist - import-service.ts#rawCsvNotYetUploaded relies on that name to distinguish
    // "file hasn't arrived yet" (§3: UPLOADED -> POST /mapping -> stays UPLOADED, mapping-only
    // write) from a genuine failure, so this fake mirrors the real error's `name`.
    if (!value) throw Object.assign(new Error(`FakeImportObjectStore: object not found: ${bucket}/${key}`), { name: "NoSuchKey" });
    return value;
  }

  async putObject(bucket: string, key: string, body: string, _contentType: string): Promise<void> {
    this.objects.set(`${bucket}/${key}`, Buffer.from(body, "utf-8"));
  }

  seed(bucket: string, key: string, body: string): void {
    this.objects.set(`${bucket}/${key}`, Buffer.from(body, "utf-8"));
  }
}

let counter = 0;
export function makeImportIdGenerator(): ImportIdGenerator {
  return {
    newImportJobId: () => `importjob-${++counter}`,
  };
}
