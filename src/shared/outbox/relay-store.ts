/**
 * Narrow port for DispatchOutboxRelay and OutboxSweeperReminderDispatch (M3.5,
 * docs/architecture/m3.5-runtime-design.md "Decisão central"). Deliberately separate from
 * ExpirationStore/ReminderStore - this is generic outbox bookkeeping, not domain state.
 */
import type { EntityKey } from "../dynamodb/occ.js";
import type { OutboxDestination, OutboxRecord } from "./outbox.js";

export interface OutboxRelayStore {
  /** Conditional lease acquisition - `UpdateItem` with
   * `ConditionExpression: attribute_not_exists(leaseOwner) OR leaseExpiresAt < :now`.
   * Returns false if another relay/sweeper execution already holds the lease. */
  tryAcquireLease(key: EntityKey, leaseOwner: string, leaseExpiresAt: string, now: string): Promise<boolean>;
  /** `UpdateItem` transition PENDING -> PUBLISHED, only called after SendMessage confirmed. */
  markPublished(key: EntityKey): Promise<void>;
  /** Sweeper only: GSI6PK=RECON#OUTBOX#PENDING, filtered by `destination` and age. */
  listPendingReminderDispatch(input: { destination: OutboxDestination; olderThan: string; pageSize?: number }): Promise<OutboxRecord[]>;
}
