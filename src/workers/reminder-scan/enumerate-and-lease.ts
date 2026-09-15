/**
 * ReminderScan enumeration + acquire/reclaim worker - D-300
 * (`docs/architecture/reviews/reminder-producer-implementation-plan-scoping/DECISION.md` §1),
 * the EventBridge Scheduler side of the dual-trigger `reminder-producer-handler.ts`
 * (`SCAN_MODE=PAGED`): "EventBridge Scheduler - enumeração + acquire/reclaim". Mirrors the exact
 * shard-generation x lookback-minute enumeration loop `producer.ts`'s `runProducerTick` already
 * uses (same `activeGenerations`/lookback semantics), but instead of querying GSI3 itself, this
 * worker only decides - PER (shardFnVersion, shardId, minute) - whether to acquire a fresh lease,
 * reclaim a stale one, or leave an already-active/already-completed one alone. The actual GSI3
 * paging happens in `scan-page.ts`, driven by the continuation message either transition writes.
 */
import { activeGenerations, type ShardConfig } from "../../modules/reminder/domain/shard-config.js";
import { isTransactionCanceled, type EntityKey, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { buildAcquireLeaseTransaction, buildReclaimLeaseTransaction, leaseKey, type LeaseTransitionDeps, type ReminderScanLease, type ShardMinuteRef } from "./lease.js";

export interface EnumerationStore {
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}

export interface EnumerationDeps extends LeaseTransitionDeps {
  store: EnumerationStore;
  shardConfig: ShardConfig;
  /** Same default/reasoning as producer.ts's own lookbackMinutes (PERF-12 1k load test finding)
   * - kept as a SEPARATE input (never imported from producer.ts) so this worker has no
   * dependency on the file it complements. */
  lookbackMinutes?: number;
  /** DECISION.md §3: 200s. */
  leaseDurationMs: number;
  newOwnerToken: () => string;
}

export interface EnumerationResult {
  acquired: ShardMinuteRef[];
  reclaimed: ShardMinuteRef[];
  /** IN_PROGRESS, `leaseUntil` still in the future - some other invocation's chain is genuinely
   * active; correctly left alone. */
  contended: number;
  /** Already COMPLETED - this (shard, minute) was fully scanned by an earlier tick; nothing to
   * do. Not the same as `contended` (still surfaced separately for the "how much of the
   * lookback window is dead weight" observability signal DECISION.md §3's capacity model
   * assumes). */
  completed: number;
  /** This invocation's own acquire/reclaim attempt lost a race to a concurrent tick/enumeration -
   * benign, never a failure (DECISION.md: lease contention is always log/metric, never a
   * throw). */
  lostRace: number;
  minutesScanned: string[];
  shardPartitionsScanned: number;
}

function minuteFloor(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

/** Runs one enumeration tick for wall-clock minute `tickMinute` (already floored to the minute by
 * the caller/Lambda trigger, same contract as `producer.ts`'s `runProducerTick`). */
export async function runEnumerationTick(deps: EnumerationDeps, tickMinute: Date): Promise<EnumerationResult> {
  const generations = activeGenerations(deps.shardConfig, deps.now());
  const lookback = deps.lookbackMinutes ?? 15;

  const minutesToScan: Date[] = [];
  for (let i = lookback; i >= 0; i--) {
    minutesToScan.push(minuteFloor(new Date(tickMinute.getTime() - i * 60_000)));
  }

  const acquired: ShardMinuteRef[] = [];
  const reclaimed: ShardMinuteRef[] = [];
  let contended = 0;
  let completed = 0;
  let lostRace = 0;
  let partitions = 0;

  for (const minute of minutesToScan) {
    const minuteISO = minute.toISOString();
    for (const generation of generations) {
      for (let shardId = 0; shardId < generation.shardCount; shardId++) {
        partitions += 1;
        const ref: ShardMinuteRef = { shardFnVersion: generation.shardFnVersion, shardId, minuteISO };
        const existing = await deps.store.get<ReminderScanLease>(leaseKey(ref));

        if (!existing) {
          const { tx } = buildAcquireLeaseTransaction(deps, ref, deps.newOwnerToken(), deps.leaseDurationMs);
          try {
            await deps.store.transactWrite(tx);
            acquired.push(ref);
          } catch (err) {
            if (isTransactionCanceled(err)) {
              lostRace += 1;
              continue;
            }
            throw err;
          }
          continue;
        }

        if (existing.status === "COMPLETED") {
          completed += 1;
          continue;
        }

        // IN_PROGRESS: reclaim only once leaseUntil has passed (same invariant lease.ts's
        // buildReclaimLeaseTransaction condition enforces server-side - this check here is
        // just this worker's own decision of WHICH transition to attempt, not a substitute for
        // that condition, which is what actually prevents stealing a still-alive lease under a
        // race between this read and the transactWrite below).
        if (existing.leaseUntil < deps.now()) {
          const { tx } = buildReclaimLeaseTransaction(deps, ref, deps.newOwnerToken(), deps.leaseDurationMs);
          try {
            await deps.store.transactWrite(tx);
            reclaimed.push(ref);
          } catch (err) {
            if (isTransactionCanceled(err)) {
              lostRace += 1;
              continue;
            }
            throw err;
          }
        } else {
          contended += 1;
        }
      }
    }
  }

  return {
    acquired,
    reclaimed,
    contended,
    completed,
    lostRace,
    minutesScanned: minutesToScan.map((d) => d.toISOString()),
    shardPartitionsScanned: partitions,
  };
}
