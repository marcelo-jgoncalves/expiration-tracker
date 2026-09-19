/**
 * Narrow port for DispatchOutboxRelay and OutboxSweeperReminderDispatch (M3.5,
 * docs/architecture/m3.5-runtime-design.md "Decisão central"). Deliberately separate from
 * ExpirationStore/ReminderStore - this is generic outbox bookkeeping, not domain state.
 */
import type { EntityKey } from "../dynamodb/occ.js";
import type { OutboxRecord } from "./outbox.js";

export interface OutboxRelayStore {
  /** Conditional lease acquisition - `UpdateItem` with
   * `ConditionExpression: attribute_not_exists(leaseOwner) OR leaseExpiresAt < :now`.
   * Returns false if another relay/sweeper execution already holds the lease. */
  tryAcquireLease(key: EntityKey, leaseOwner: string, leaseExpiresAt: string, now: string): Promise<boolean>;
  /** `UpdateItem` transition PENDING -> PUBLISHED, only called after SendMessage confirmed. */
  markPublished(key: EntityKey): Promise<void>;
  /** Sweeper only: GSI6PK=RECON#OUTBOX#PENDING, filtered by age only - one query covers every
   * destination (real finding, 2026-09-19: a per-destination `destination` filter here forced
   * `sweepPendingDispatch` to re-scan this same shared partition once per destination, 12x the
   * necessary read cost, timing out the Lambda under any real backlog). Routing by destination
   * happens per-record in `publishOne`/`sweepPendingDispatch`, same as the real-time relay
   * already does - never here. */
  listPendingReminderDispatch(input: { olderThan: string; pageSize?: number }): Promise<OutboxRecord[]>;
}
