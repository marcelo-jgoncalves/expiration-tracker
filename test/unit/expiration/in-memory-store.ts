import type {
  EntityKey,
  ExpirationStore,
  Gsi1PageInput,
  Gsi1Page,
  TransactWriteEntry,
} from "../../../src/modules/expiration/ports/expiration-store.js";
import type { ExpirationIdGenerator } from "../../../src/modules/expiration/application/id-generator.js";
import type { MemberEligibilityChecker } from "../../../src/modules/expiration/ports/member-eligibility.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

/** Wave B2B-11: fake `MemberEligibilityChecker` for tests that don't exercise
 * assignee/watcher eligibility rejection specifically - every candidate is eligible, matching
 * this module's test suite's behavior before this wave (assigneeUserId/watcher userId were
 * never validated). `item-watch-service.test.ts` uses a configurable variant instead where the
 * rejection behavior itself is under test. */
export function allowAllMemberEligibilityChecker(): MemberEligibilityChecker {
  return { isEligibleMember: async () => true };
}

/** Configurable fake - `eligibleUserIds` is the closed set of userIds this Organization
 * considers real, active members; anything else is rejected. */
export function fakeMemberEligibilityChecker(eligibleUserIds: readonly string[]): MemberEligibilityChecker {
  const eligible = new Set(eligibleUserIds);
  return { isEligibleMember: async (_organizationId, userId) => eligible.has(userId) };
}

/**
 * W3-07 (D-070, ExpirationService.commit() migration, chunk 9/N): ExpirationService.commit()
 * now fences every mutation (createItem/updateItem/archiveItem/deleteItem/renewItem) through
 * TenantBusinessMutation, which requires a TenantLifecycleRecord to exist and be ACTIVE.
 * `new InMemoryExpirationStore([activeLifecycleRecord("tenant-1")])` seeds it synchronously in
 * one line, same convention document/in-memory-store.ts's `activeLifecycleRecord` already
 * established, rather than duplicating an async seedLifecycle() helper per test file.
 */
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

/**
 * In-memory fake of ExpirationStore, mirroring test/unit/identity/in-memory-store.ts's
 * conventions. transactWrite evaluates only the three ConditionExpression shapes this
 * codebase actually produces (occ.ts's versioned-update condition, the
 * attribute_not_exists(PK) AND attribute_not_exists(SK) creation condition, and
 * shared/idempotency/idempotency.ts's transitionIdempotencyStatus() "#status = :expected"
 * condition, exercised via ExpirationService.renewItem's abort()/reacquisition paths) -
 * documented limitation, same spirit as InMemoryIdentityStore.
 */
export class InMemoryExpirationStore implements ExpirationStore {
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

  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    // Pass 1: validate every condition without mutating anything, recording a per-entry Code
    // (mirroring real DynamoDB's TransactionCanceledException.CancellationReasons[] shape) so
    // callers - notably the TenantBusinessMutation lane's fence-vs-ordinary-OCC-conflict
    // distinction in tenant-business-mutation.ts - can tell which specific entry failed. W3-07
    // (ExpirationService.commit() migration, chunk 9/N): previously this fake threw fail-fast
    // with no CancellationReasons at all, which the lane's `!reasons` branch treats as "the
    // fence failed" unconditionally - a real caller-side OCC conflict on the item's own Update
    // entry (e.g. a stale expectedVersion) would have been silently misclassified as
    // TenantNotActiveError instead of the expected ConflictError, exactly the bug
    // TenantQuotaService.consume()'s migration found and fixed in the real fake
    // (test/unit/identity/in-memory-store.ts) - same fix applied here.
    const reasons: Array<{ Code: "None" | "ConditionalCheckFailed" }> = entries.map(() => ({ Code: "None" }));
    let anyFailed = false;

    entries.forEach((entry, i) => {
      if ("Put" in entry) {
        const exists = this.items.has(this.k(entry.Put.Item as unknown as EntityKey));
        if (entry.Put.ConditionExpression.includes("attribute_not_exists(PK)") && exists) {
          reasons[i] = { Code: "ConditionalCheckFailed" };
          anyFailed = true;
          return;
        }
      } else if ("Update" in entry) {
        const key = entry.Update.Key;
        const existing = this.items.get(this.k(key));
        if (entry.Update.ConditionExpression.includes("attribute_exists(PK)")) {
          if (!existing) {
            reasons[i] = { Code: "ConditionalCheckFailed" };
            anyFailed = true;
            return;
          }
          const expectedVersion = entry.Update.ExpressionAttributeValues[":expectedVersion"];
          const expectedTenantId = entry.Update.ExpressionAttributeValues[":tenantId"];
          if (existing["version"] !== expectedVersion || existing["tenantId"] !== expectedTenantId) {
            reasons[i] = { Code: "ConditionalCheckFailed" };
            anyFailed = true;
            return;
          }
        } else if (entry.Update.ConditionExpression === "#status = :expected") {
          const expectedStatus = entry.Update.ExpressionAttributeValues[":expected"];
          if (!existing || existing["status"] !== expectedStatus) {
            reasons[i] = { Code: "ConditionalCheckFailed" };
            anyFailed = true;
            return;
          }
        }
      } else if ("ConditionCheck" in entry) {
        // W3-07 (D-067): the TenantBusinessMutation lane's lifecycle fence
        // (buildExistenceConditionCheck's "attribute_exists(PK) AND #c0 = :c0 [...]" shape) -
        // same evaluator as test/unit/identity/in-memory-store.ts's transactWrite.
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
      throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: reasons };
    }

    // Pass 2: apply.
    for (const entry of entries) {
      if ("Put" in entry) {
        this.items.set(this.k(entry.Put.Item as unknown as EntityKey), entry.Put.Item as Record<string, unknown> & EntityKey);
      } else if ("Update" in entry) {
        const key = entry.Update.Key;
        const existing = this.items.get(this.k(key)) ?? { ...key };
        const next: Record<string, unknown> & EntityKey = { ...existing };
        // shared/idempotency/idempotency.ts's transitionIdempotencyStatus() builds its own
        // SET/REMOVE clauses over a fixed, known field set (status/requestHash/responseRef/
        // completedAt) rather than occ.ts's #setN convention - handled by name here, same
        // "known shapes only" spirit as the ConditionExpression check above. A field present in
        // ExpressionAttributeValues (as `:<placeholder>`) is a SET; one absent from it but named
        // in ExpressionAttributeNames is a REMOVE.
        const IDEMPOTENCY_TRANSITION_FIELDS = new Set(["status", "requestHash", "responseRef", "completedAt"]);
        for (const [name, placeholder] of Object.entries(entry.Update.ExpressionAttributeNames ?? {})) {
          if (placeholder === "version") {
            next["version"] = ((existing["version"] as number | undefined) ?? 0) + 1;
          } else if (placeholder === "updatedAt") {
            next["updatedAt"] = entry.Update.ExpressionAttributeValues[":now"];
          } else if (name.startsWith("#set")) {
            const valueKey = `:${name.slice(1)}`;
            next[placeholder] = entry.Update.ExpressionAttributeValues[valueKey];
          } else if (IDEMPOTENCY_TRANSITION_FIELDS.has(placeholder)) {
            const valueKey = `:${placeholder}`;
            if (valueKey in entry.Update.ExpressionAttributeValues) {
              next[placeholder] = entry.Update.ExpressionAttributeValues[valueKey];
            } else {
              delete next[placeholder];
            }
          }
        }
        this.items.set(this.k(key), next);
      }
    }
  }

  async queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]> {
    const matches = [...this.items.values()].filter(
      (item) => item["PK"] === pk && (!skPrefix || String(item["SK"]).startsWith(skPrefix)),
    );
    matches.sort((a, b) => String(a["SK"]).localeCompare(String(b["SK"])));
    return matches as unknown as T[];
  }

  /** D-136/D-E: one page per call, real cursor semantics (never an internal multi-call loop) -
   * `exclusiveStartKey.GSI1SK` marks the resume boundary, same ordering discipline as the real
   * DynamoDB adapter's `ExclusiveStartKey`. */
  async queryGsi1Page<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi1PageInput): Promise<Gsi1Page<T>> {
    const ascending = input.ascending ?? true;
    const matches = [...this.items.values()].filter((item) => item["GSI1PK"] === input.gsi1pk);
    matches.sort((a, b) => {
      const sa = String(a["GSI1SK"]);
      const sb = String(b["GSI1SK"]);
      return ascending ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    const startAfter = input.exclusiveStartKey?.["GSI1SK"] as string | undefined;
    const fromCursor = startAfter === undefined
      ? matches
      : matches.filter((item) => (ascending ? String(item["GSI1SK"]) > startAfter : String(item["GSI1SK"]) < startAfter));
    const limit = input.limit ?? fromCursor.length;
    const page = fromCursor.slice(0, limit);
    const hasMore = fromCursor.length > page.length;
    const last = page[page.length - 1];
    return {
      items: page as unknown as T[],
      lastEvaluatedKey: hasMore && last ? { GSI1PK: last["GSI1PK"], GSI1SK: last["GSI1SK"] } : undefined,
    };
  }

  /** Test-only helper mirroring InMemoryIdentityStore.allKeys(), for audit/outbox assertions. */
  allItems(): (Record<string, unknown> & EntityKey)[] {
    return [...this.items.values()];
  }
}

let counter = 0;
export function makeExpirationIdGenerator(): ExpirationIdGenerator {
  return {
    newItemId: () => `item-${++counter}`,
    newAuditEventId: () => `audit-${++counter}`,
    newEventId: () => `evt-${++counter}`,
    newPolicyId: () => `policy-${++counter}`,
  };
}
