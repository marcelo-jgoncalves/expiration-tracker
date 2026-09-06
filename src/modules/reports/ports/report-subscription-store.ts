/**
 * DynamoDB surface the `ReportSubscription` scheduler AND HTTP CRUD (D-213) need - same minimal
 * SDK-agnostic port pattern as `expiration/ports/expiration-store.ts`. `get`/`transactWrite`
 * (D-211/D-212: fresh re-read before acting - GSI8 is discovery-only - and the 2-action claim,
 * `Update` advancing `nextRunAt` + `Outbox` `Put`) plus `queryGsi1Page` (D-213: list a tenant's
 * subscriptions via the GSI1 pointer `reportSubscriptionGsi1Keys` builds) - no `putIfAbsent`
 * needed since create always goes through `executeTenantBusinessMutation`'s `transactWrite`
 * (the tenant-ACTIVE fence), same as every other module's tenant-fenced create.
 */
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";

export type { EntityKey, TransactWriteEntry };
export { isTransactionCanceled } from "../../../shared/dynamodb/occ.js";

export interface Gsi1PageInput {
  gsi1pk: string;
  ascending?: boolean;
  limit?: number;
  exclusiveStartKey?: Record<string, unknown>;
}
export interface Gsi1Page<T> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ReportSubscriptionStore {
  /** Strongly consistent single-item read - the scheduler's claim always re-reads fresh before
   * acting, GSI8 is discovery-only (never a source of eligibility), same posture every other
   * GSI8 consumer holds. */
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  /** Commits every entry atomically. Throws an error recognized by isTransactionCanceled() if
   * ANY entry's ConditionExpression fails - callers must not assume partial application. */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
  /** Eventually consistent GSI1 query, one physical page per call (D-136/D-E cursor-skip
   * lesson - never an internal multi-call accumulate-then-slice loop). */
  queryGsi1Page<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi1PageInput): Promise<Gsi1Page<T>>;
}
