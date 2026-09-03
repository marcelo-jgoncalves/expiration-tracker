import { deriveDeliveryRecordMaintenanceDue, deliveryRecordGsi8Keys } from "../../../src/shared/delivery-record-gsi8.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { EntityKey, TransactWriteEntry } from "../../../src/shared/dynamodb/occ.js";
import type {
  DeliveryRecordGsi8Page,
  DeliveryRecordPurgeCandidate,
  DeliveryRecordPurgeCandidateSource,
} from "../../../src/workers/delivery-record-purge/candidate-source.js";

function k(key: EntityKey): string {
  return `${key.PK}#${key.SK}`;
}

/** Narrow evaluator for exactly the `ConditionExpression` shapes `purge.ts` emits (top-level
 * `AND`, `attribute_exists(x)`, `name = value`) — same deliberately-narrow-scope choice as
 * `security-audit-purge-fakes.ts`'s own evaluator (not shared, different port shape). */
function evaluateCondition(expression: string | undefined, names: Record<string, string> | undefined, values: Record<string, unknown> | undefined, item: Record<string, unknown> | undefined): boolean {
  if (!expression) return true;
  const resolveName = (token: string) => (token.startsWith("#") ? (names?.[token] ?? token) : token);
  return expression
    .split(" AND ")
    .map((p) => p.trim())
    .every((atom) => {
      const existsMatch = atom.match(/^attribute_exists\(([^)]+)\)$/);
      if (existsMatch) return item !== undefined && item[resolveName(existsMatch[1]!.trim())] !== undefined;
      const eqMatch = atom.match(/^(\S+)\s*=\s*(\S+)$/);
      if (eqMatch) {
        const [, lhsTok, rhsTok] = eqMatch;
        if (item === undefined) return false;
        const lhs = item[resolveName(lhsTok!)];
        const rhs = rhsTok!.startsWith(":") ? values?.[rhsTok!] : rhsTok;
        return lhs === rhs;
      }
      throw new Error(`Unsupported condition atom in fake evaluator: ${atom}`);
    });
}

/** In-memory fake standing in for the real DynamoDB `GSI8` Query + base-table `GetItem`/
 * `TransactWriteItems` — evaluates the REAL `ConditionExpression` strings `purge.ts` builds
 * (`transactWrite`'s all-or-nothing semantics, including `CancellationReasons` per entry index,
 * mirroring the real SDK's `TransactionCanceledException` shape). Mirrors
 * `security-audit-purge-fakes.ts`'s `FakeSecurityAuditPurgeCandidateSource` exactly. */
export class FakeDeliveryRecordPurgeCandidateSource implements DeliveryRecordPurgeCandidateSource {
  private readonly items = new Map<string, Record<string, unknown> & EntityKey>();
  private readonly lifecycle = new Map<string, string>();
  /** Page size the fake hands back per `queryDue` call — small default so tests can exercise
   * pagination (`lastEvaluatedKey`) without seeding hundreds of rows. */
  pageSize = 1000;
  transactWriteCallCount = 0;

  /** Seeds a row exactly as the real writer would leave it — computes GSI8PK/GSI8SK itself via
   * `deriveDeliveryRecordMaintenanceDue()`/`deliveryRecordGsi8Keys()`, same as every real
   * creation site does. Pass `GSI8PK`/`GSI8SK` explicitly in `overrides` to simulate a
   * hand-crafted pointer a test wants to exercise directly. */
  seed(item: DeliveryRecordPurgeCandidate): void {
    const due = deriveDeliveryRecordMaintenanceDue({ createdAt: item.createdAt });
    const gsi8 = deliveryRecordGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: item.tenantId, entityType: item.entityType, sk: item.SK });
    this.items.set(k(item), { ...gsi8, ...item });
  }

  setTenantStatus(tenantId: string, status: string): void {
    this.lifecycle.set(k(tenantLifecycleKey(tenantId)), status);
  }

  get(key: EntityKey): (Record<string, unknown> & EntityKey) | undefined {
    return this.items.get(k(key));
  }

  /** Test-only escape hatch to simulate a row disappearing between the GSI8 query and the claim
   * transaction (e.g. a second concurrent run winning the race first). */
  removeDirectly(key: EntityKey): void {
    this.items.delete(k(key));
  }

  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<DeliveryRecordGsi8Page> {
    const all = [...this.items.values()]
      .filter((i) => i["GSI8PK"] === "WORK#DELIVERY_RECORD" && typeof i["GSI8SK"] === "string" && (i["GSI8SK"] as string) < input.before)
      .sort((a, b) => (a["GSI8SK"] as string).localeCompare(b["GSI8SK"] as string));
    const startIndex = input.exclusiveStartKey ? all.findIndex((i) => k(i) === k(input.exclusiveStartKey as unknown as EntityKey)) + 1 : 0;
    const page = all.slice(startIndex, startIndex + this.pageSize);
    const lastEvaluatedKey = startIndex + this.pageSize < all.length ? { PK: page[page.length - 1]!.PK, SK: page[page.length - 1]!.SK } : undefined;
    return Promise.resolve({
      items: page.map((i) => ({
        PK: i.PK,
        SK: i.SK,
        dueAtIso: (i["GSI8SK"] as string).split("#TENANT#")[0]!,
        tenantId: i["tenantId"] as string,
        entityType: i["entityType"] as DeliveryRecordPurgeCandidate["entityType"],
      })),
      lastEvaluatedKey,
    });
  }

  getCandidate(key: EntityKey): Promise<DeliveryRecordPurgeCandidate | undefined> {
    return Promise.resolve(this.items.get(k(key)) as unknown as DeliveryRecordPurgeCandidate | undefined);
  }

  transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    this.transactWriteCallCount += 1;

    // Evaluate every entry's condition against CURRENT state (all-or-nothing) - the first
    // failing index is reported in CancellationReasons exactly like the real SDK.
    const failedIndex = entries.findIndex((entry) => {
      if ("ConditionCheck" in entry) {
        const c = entry.ConditionCheck;
        const isLifecycle = c.Key.SK === "LIFECYCLE";
        const current = isLifecycle ? { status: this.lifecycle.get(k(c.Key)) } : this.items.get(k(c.Key));
        return !evaluateCondition(c.ConditionExpression, c.ExpressionAttributeNames, c.ExpressionAttributeValues, current as Record<string, unknown> | undefined);
      }
      if ("Update" in entry) {
        const u = entry.Update;
        return !evaluateCondition(u.ConditionExpression, u.ExpressionAttributeNames, u.ExpressionAttributeValues, this.items.get(k(u.Key)));
      }
      if ("Delete" in entry) {
        const d = entry.Delete;
        return !evaluateCondition(d.ConditionExpression, d.ExpressionAttributeNames, d.ExpressionAttributeValues, this.items.get(k(d.Key)));
      }
      return false;
    });

    if (failedIndex !== -1) {
      const err = {
        name: "TransactionCanceledException",
        message: "Transaction cancelled",
        CancellationReasons: entries.map((_, i) => ({ Code: i === failedIndex ? "ConditionalCheckFailed" : "None" })),
      };
      return Promise.reject(err);
    }

    // Phase 2: apply every entry (conditions already proven to hold).
    for (const entry of entries) {
      if ("Update" in entry) {
        const u = entry.Update;
        const current = { ...(this.items.get(k(u.Key)) ?? ({} as Record<string, unknown> & EntityKey)) };
        applyUpdateExpression(current, u.UpdateExpression, u.ExpressionAttributeNames, u.ExpressionAttributeValues);
        this.items.set(k(u.Key), current as Record<string, unknown> & EntityKey);
      } else if ("Delete" in entry) {
        this.items.delete(k(entry.Delete.Key));
      }
      // ConditionCheck entries never mutate anything.
    }
    return Promise.resolve();
  }
}

/** Minimal `SET`/`REMOVE` applier for the exact UpdateExpression shapes `purge.ts` emits
 * (`SET a = :x, b = :y` / `REMOVE a, b`) — never a general DynamoDB expression parser. */
function applyUpdateExpression(item: Record<string, unknown>, expression: string, names: Record<string, string> | undefined, values: Record<string, unknown> | undefined): void {
  const resolveName = (token: string) => (token.startsWith("#") ? (names?.[token] ?? token) : token);
  const setMatch = expression.match(/SET (.+?)(?:\s+REMOVE|$)/);
  const removeMatch = expression.match(/REMOVE (.+)$/);
  if (setMatch) {
    for (const clause of setMatch[1]!.split(",")) {
      const [lhs, rhs] = clause.split("=").map((s) => s.trim());
      item[resolveName(lhs!)] = rhs!.startsWith(":") ? values?.[rhs!] : rhs;
    }
  }
  if (removeMatch) {
    for (const attr of removeMatch[1]!.split(",")) {
      delete item[resolveName(attr.trim())];
    }
  }
}
