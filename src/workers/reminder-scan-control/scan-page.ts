import { dueWorkPartition, dueWorkUpperBound, type ReminderDueWorkItem } from "../../modules/reminder/domain/reminder-due-work.js";
import type { ReminderDueWorkStore } from "../../modules/reminder/ports/reminder-due-work-store.js";
import { deserializeCanonicalKey, serializeCanonicalKey } from "../../shared/dynamodb/canonical-key.js";
import { isSoleConditionalCancellation } from "../../shared/dynamodb/occ.js";
import { mapWithConcurrency } from "../../shared/concurrency/map-with-concurrency.js";
import { DependencyUnavailableError, InternalError } from "../../shared/errors/app-error.js";
import { nextAttemptDelayMs } from "../../shared/outbox/outbox.js";
import type { ClaimCandidateCommand, ClaimQueuePort } from "../reminder-scan/scan-page.js";
import { checkpointControlChain, scanLeaseKey, type ControlTransitionDeps, type ScanContinuationV2, type ScanLeaseV2, type ScanRef } from "./model.js";

export interface ControlScanDeps extends ControlTransitionDeps {
  controlStore: { getLease(key:{PK:string;SK:string}):Promise<ScanLeaseV2|undefined>; transact(entries:import("../../shared/dynamodb/occ.js").TransactWriteEntry[]):Promise<void> };
  dueStore: ReminderDueWorkStore; claimQueue: ClaimQueuePort; pageSize:number; leaseDurationMs:number; sleep:(ms:number)=>Promise<void>;
}
export type ControlScanOutcome = {kind:"PROCESSED"; candidatesPublished:number; completed:boolean}|{kind:"STALE_NO_OP"}|{kind:"STALE_EPOCH_DROPPED"}|{kind:"LOST_CHECKPOINT_RACE"};
function candidate(deps:ControlScanDeps, row:ReminderDueWorkItem):ClaimCandidateCommand { return {messageVersion:1,messageId:deps.newEventId(),commandType:"reminder.claim-candidate.v1",createdAt:deps.now(),correlationId:deps.correlationId(),tenantId:row.tenantId,deduplicationKey:`${row.tenantId}|${row.occurrencePK}|${row.occurrenceSK}|${deps.rolloutEpoch}`,data:{PK:row.occurrencePK,SK:row.occurrenceSK,entityKind:row.entityKind,rolloutEpoch:deps.rolloutEpoch}}; }
async function send(deps:ControlScanDeps, entries:ClaimCandidateCommand[]):Promise<void>{
  for(let attempt=0;attempt<3;attempt++){const outcome=await deps.claimQueue.sendMessageBatch(entries);if(outcome.failedEntryIds.length===0)return;if(outcome.failedEntryIds.some(x=>x.senderFault))throw new InternalError("reminder-scan-control: malformed candidate batch");if(attempt<2)await deps.sleep(nextAttemptDelayMs(attempt));}
  throw new DependencyUnavailableError("reminder-scan-control: candidate batch failed after retries");
}
export async function runControlScanPage(deps:ControlScanDeps, message:ScanContinuationV2):Promise<ControlScanOutcome>{
  if(message.data.controlBackend!=="DEDICATED_V1"||message.data.rolloutEpoch<deps.rolloutEpoch)return {kind:"STALE_EPOCH_DROPPED"};
  const ref:ScanRef={shardFnVersion:message.data.shardFnVersion,shardId:message.data.shardId,minuteISO:message.data.minuteISO};
  const lease=await deps.controlStore.getLease(scanLeaseKey(ref));
  if(!lease||lease.status!=="IN_PROGRESS"||lease.ownerToken!==message.data.ownerToken||lease.version!==message.data.leaseVersion||lease.rolloutEpoch!==message.data.rolloutEpoch||lease.lastEvaluatedKey!==message.data.lastEvaluatedKey||lease.leaseUntil<deps.now())return {kind:"STALE_NO_OP"};
  const page=await deps.dueStore.queryDuePage({partitionKey:dueWorkPartition({shardFnVersion:ref.shardFnVersion,shardId:ref.shardId,scheduledAt:ref.minuteISO}),upperBound:dueWorkUpperBound(lease.observedNow),exclusiveStartKey:deserializeCanonicalKey(message.data.lastEvaluatedKey),limit:deps.pageSize});
  const commands=page.items.map(row=>candidate(deps,row)); const chunks:ClaimCandidateCommand[][]=[];for(let i=0;i<commands.length;i+=10)chunks.push(commands.slice(i,i+10));
  const sent=await mapWithConcurrency(chunks,5,async part=>send(deps,part)); const failure=sent.find(result=>!result.ok);if(failure&&!failure.ok)throw failure.error;
  const next=serializeCanonicalKey(page.lastEvaluatedKey);
  try{await deps.controlStore.transact(checkpointControlChain(deps,lease,ref,message.data.lastEvaluatedKey,next,commands.length,deps.leaseDurationMs));}
  catch(error){if(isSoleConditionalCancellation(error,0))return {kind:"LOST_CHECKPOINT_RACE"};throw error;}
  return {kind:"PROCESSED",candidatesPublished:commands.length,completed:next===undefined};
}
