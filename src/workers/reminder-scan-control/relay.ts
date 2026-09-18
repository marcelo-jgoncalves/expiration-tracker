import type { ScanOutboxV2 } from "./model.js";
export interface ControlRelayDeps { send(payload:ScanOutboxV2["payload"]):Promise<void>; markPublished(item:ScanOutboxV2,now:string):Promise<boolean>; now:()=>string }
export async function relayControlOutbox(deps:ControlRelayDeps,item:ScanOutboxV2):Promise<"PUBLISHED"|"ALREADY_PUBLISHED">{
  if(item.entityType!=="REMINDER_SCAN_CONTINUATION_OUTBOX"||item.status!=="PENDING")return "ALREADY_PUBLISHED";
  await deps.send(item.payload); return await deps.markPublished(item,deps.now())?"PUBLISHED":"ALREADY_PUBLISHED";
}
