/**
 * K-way merge + composite cursor logic for the Admin Activity feed (D-149,
 * admin-activity-log-scoping/estado-final-consolidado.md decisão 4) — the single hardest
 * piece of this feature (design doc's own scoring history: 5 rounds, 3 failed specifically
 * on cursor semantics). Kept as PURE functions with no I/O so the semantics can be unit
 * tested exhaustively without a DynamoDB double.
 *
 * Composite cursor contract: one field per partition, each holding the REAL {PK, SK} of the
 * last item from THAT partition that actually made it into the page returned to the client —
 * never the raw fetch-batch's last item (which may have been fetched-but-discarded at the
 * merge cutoff — using that would permanently lose events). A partition that contributed zero
 * items to a page does NOT advance its cursor (caller must carry the previous value forward
 * unchanged). Accepted cost: a partition may re-fetch an already-seen-but-unconsumed item on
 * the next page — never deterministic loss.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export const AUDIT_PARTITIONS = ["expiration", "organization", "subject", "tenant"] as const;
export type AuditPartition = (typeof AUDIT_PARTITIONS)[number];

export interface FetchedAuditItem<T = unknown> {
  key: EntityKey;
  occurredAt: string;
  auditEventId: string;
  raw: T;
}

export interface MergedAuditItem<T = unknown> extends FetchedAuditItem<T> {
  partition: AuditPartition;
}

export interface MergeInput<T = unknown> {
  /** Fetched batch per partition, already sorted in `ascending` order internally (this is
   * what a real DynamoDB Query with ScanIndexForward=ascending naturally returns since SK
   * embeds occurredAt) — merge does not re-sort within a partition, only across them. */
  fetched: Record<AuditPartition, FetchedAuditItem<T>[]>;
  limit: number;
  ascending: boolean;
}

export interface MergeResult<T = unknown> {
  /** Globally sorted page, length <= limit. */
  page: MergedAuditItem<T>[];
  /** Only set for a partition that contributed >=1 item to `page` — the LAST (in that
   * partition's own order) consumed item's real key. Caller must never invent an entry for a
   * partition absent here; it must keep whatever cursor it already had for that partition. */
  consumedLast: Partial<Record<AuditPartition, EntityKey>>;
}

function compareOccurrence(a: FetchedAuditItem, b: FetchedAuditItem, ascending: boolean): number {
  const direction = ascending ? 1 : -1;
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -direction : direction;
  if (a.auditEventId === b.auditEventId) return 0;
  return a.auditEventId < b.auditEventId ? -direction : direction;
}

/**
 * Merges up to 4 partitions' fetched batches into a single page of at most `limit` items,
 * sorted by (occurredAt, auditEventId) in the requested direction. Uses a stable sort over
 * the tagged concatenation of all batches — stability is load-bearing: it preserves each
 * partition's own internal order, so "the last item of partition P appearing in the merged
 * page" is unambiguously the correct resume point for P (a partition's own batch is already
 * sorted in the target order before this call).
 */
export function mergeAuditPage<T = unknown>(input: MergeInput<T>): MergeResult<T> {
  const tagged: MergedAuditItem<T>[] = [];
  for (const partition of AUDIT_PARTITIONS) {
    for (const item of input.fetched[partition]) {
      tagged.push({ ...item, partition });
    }
  }
  tagged.sort((a, b) => compareOccurrence(a, b, input.ascending));

  const page = tagged.slice(0, Math.max(0, input.limit));

  const consumedLast: Partial<Record<AuditPartition, EntityKey>> = {};
  for (const item of page) {
    // Iterating the page in its own (already-globally-sorted) order and overwriting on every
    // hit for a partition leaves the LAST occurrence of that partition standing — exactly the
    // resume point contract above.
    consumedLast[item.partition] = item.key;
  }

  return { page, consumedLast };
}

/**
 * True if any partition has fetched-but-unconsumed items left over from this page's batch, OR
 * the caller-supplied `partitionHasMoreBeyondBatch` says the underlying Query itself has more
 * rows beyond what was fetched. Either condition means the feed is not exhausted.
 */
export function computeHasMore(
  fetched: Record<AuditPartition, FetchedAuditItem[]>,
  page: MergedAuditItem[],
  partitionHasMoreBeyondBatch: Partial<Record<AuditPartition, boolean>>,
): boolean {
  const consumedCountByPartition: Partial<Record<AuditPartition, number>> = {};
  for (const item of page) {
    consumedCountByPartition[item.partition] = (consumedCountByPartition[item.partition] ?? 0) + 1;
  }
  for (const partition of AUDIT_PARTITIONS) {
    const fetchedCount = fetched[partition].length;
    const consumedCount = consumedCountByPartition[partition] ?? 0;
    if (fetchedCount > consumedCount) return true;
    if (partitionHasMoreBeyondBatch[partition]) return true;
  }
  return false;
}
