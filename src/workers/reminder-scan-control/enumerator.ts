import { activeGenerations, type ShardConfig } from "../../modules/reminder/domain/shard-config.js";
import { acquireControlChain, scanLeaseKey, type ControlTransitionDeps, type ScanLeaseV2, type ScanRef } from "./model.js";

export interface ControlEnumeratorDeps extends ControlTransitionDeps {
  store: { getLease(key: {PK:string;SK:string}): Promise<ScanLeaseV2 | undefined>; transact(entries: import("../../shared/dynamodb/occ.js").TransactWriteEntry[]): Promise<void> };
  shardConfig: ShardConfig; lookbackMinutes: number; leaseDurationMs: number; newOwnerToken: () => string;
}
export interface ControlEnumerationResult { acquired: number; completed: number; active: number; lostRace: number; partitions: number }
const minuteFloor = (date: Date) => new Date(Math.floor(date.getTime()/60_000)*60_000);
export async function runControlEnumeration(deps: ControlEnumeratorDeps, tick: Date): Promise<ControlEnumerationResult> {
  const observedNow = deps.now(); const result = { acquired:0, completed:0, active:0, lostRace:0, partitions:0 };
  // Never finalize the open wall-clock minute: more occurrences can still be committed into
  // that partition after this tick observes it. Processing starts at M-1, adding at most 60s
  // latency while keeping COMPLETED terminal and safe.
  for (let offset=deps.lookbackMinutes; offset>=1; offset--) {
    const minuteISO = minuteFloor(new Date(tick.getTime()-offset*60_000)).toISOString();
    for (const generation of activeGenerations(deps.shardConfig, observedNow)) for (let shardId=0; shardId<generation.shardCount; shardId++) {
      result.partitions++; const ref: ScanRef = { shardFnVersion:generation.shardFnVersion, shardId, minuteISO };
      const existing = await deps.store.getLease(scanLeaseKey(ref));
      if (existing) { if (existing.status === "COMPLETED") result.completed++; else result.active++; continue; }
      try { await deps.store.transact(acquireControlChain(deps, ref, observedNow, deps.newOwnerToken(), deps.leaseDurationMs)); result.acquired++; }
      catch (error) { if ((error as {name?:string}).name === "TransactionCanceledException") result.lostRace++; else throw error; }
    }
  }
  return result;
}
