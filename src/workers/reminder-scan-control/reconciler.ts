import { parseScanLeasePk,reclaimControlChain,type ControlTransitionDeps,type ScanLeaseV2,type ScanOutboxV2 } from "./model.js";
import { relayControlOutbox } from "./relay.js";
export interface ControlReconcilerDeps extends ControlTransitionDeps { store:{listDue(pk:"LEASE#IN_PROGRESS"|"OUTBOX#PENDING",now:string,limit?:number):Promise<Array<ScanLeaseV2|ScanOutboxV2>>;transact(entries:import("../../shared/dynamodb/occ.js").TransactWriteEntry[]):Promise<void>;markPublished(item:ScanOutboxV2,now:string):Promise<boolean>};send(payload:ScanOutboxV2["payload"]):Promise<void>;newOwnerToken:()=>string;leaseDurationMs:number }
export async function reconcileControlPlane(deps:ControlReconcilerDeps):Promise<{reclaimed:number;published:number;lostRace:number}>{
  const observedNow=deps.now();let reclaimed=0,published=0,lostRace=0;
  for(const item of await deps.store.listDue("LEASE#IN_PROGRESS",observedNow)){const lease=item as ScanLeaseV2;try{await deps.store.transact(reclaimControlChain(deps,lease,parseScanLeasePk(lease.PK),observedNow,deps.newOwnerToken(),deps.leaseDurationMs));reclaimed++;}catch(error){if((error as {name?:string}).name==="TransactionCanceledException")lostRace++;else throw error;}}
  for(const item of await deps.store.listDue("OUTBOX#PENDING",observedNow)){if(await relayControlOutbox({send:deps.send,markPublished:deps.store.markPublished.bind(deps.store),now:deps.now},item as ScanOutboxV2)==="PUBLISHED")published++;}
  return {reclaimed,published,lostRace};
}
