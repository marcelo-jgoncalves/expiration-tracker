/**
 * DynamoDB surface the `ReportSubscription` scheduler needs (D-211 fatia 2, D-204 decision 4) -
 * same minimal SDK-agnostic port pattern as `expiration/ports/expiration-store.ts`. Only `get`
 * (fresh re-read before acting - GSI8 is discovery-only) and `transactWrite` (the 2-action claim:
 * `Update` advancing `nextRunAt` + `Outbox` `Put`) are needed here - no `putIfAbsent`/`update`,
 * since subscription creation/management (ADMIN_ROLES HTTP route, decision 1) is a separate,
 * not-yet-built slice this port intentionally doesn't presume the shape of.
 */
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";

export type { EntityKey, TransactWriteEntry };
export { isTransactionCanceled } from "../../../shared/dynamodb/occ.js";

export interface ReportSubscriptionStore {
  /** Strongly consistent single-item read - the scheduler's claim always re-reads fresh before
   * acting, GSI8 is discovery-only (never a source of eligibility), same posture every other
   * GSI8 consumer holds. */
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  /** Commits every entry atomically. Throws an error recognized by isTransactionCanceled() if
   * ANY entry's ConditionExpression fails - callers must not assume partial application. */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}
