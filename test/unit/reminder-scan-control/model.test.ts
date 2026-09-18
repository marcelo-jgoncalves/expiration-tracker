import { describe, expect, it } from "vitest";
import { acquireControlChain, checkpointControlChain, reclaimControlChain, scanLeaseKey, type ControlTransitionDeps, type ScanLeaseV2 } from "../../../src/workers/reminder-scan-control/model.js";

const ref={shardFnVersion:2,shardId:17,minuteISO:"2026-09-17T18:49:00.000Z"};
const deps:ControlTransitionDeps={tableName:"Control",now:()=>"2026-09-17T18:49:05.000Z",newEventId:(()=>{let n=0;return()=>`event-${++n}`;})(),correlationId:()=>"corr",rolloutEpoch:4};

describe("dedicated reminder scan control model",()=>{
  it("acquires lease and durable continuation in one transaction",()=>{
    const tx=acquireControlChain(deps,ref,"2026-09-17T18:49:05.000Z","owner",200_000) as Array<{Put?:{TableName:string;Item:Record<string,unknown>}}>;
    expect(tx).toHaveLength(2);expect(tx[0]?.Put?.TableName).toBe("Control");expect(tx[1]?.Put?.Item["entityType"]).toBe("REMINDER_SCAN_CONTINUATION_OUTBOX");expect(tx[1]?.Put?.Item["payload"]).toMatchObject({commandType:"reminder.scan-continuation.v2",data:{controlBackend:"DEDICATED_V1",leaseVersion:1,rolloutEpoch:4}});
  });
  it("keeps lease versions monotonic across reclaim",()=>{
    const lease={...scanLeaseKey(ref),entityType:"REMINDER_SCAN_LEASE",status:"IN_PROGRESS",ownerToken:"old",version:7,rolloutEpoch:4,observedNow:"2026-09-17T18:40:00.000Z",leaseUntil:"2026-09-17T18:48:00.000Z",pagesProcessed:2,candidatesPublished:400,createdAt:"2026-09-17T18:40:00.000Z",updatedAt:"2026-09-17T18:40:00.000Z",purgeAfterTtl:1} satisfies ScanLeaseV2;
    const tx=reclaimControlChain(deps,lease,ref,"2026-09-17T18:49:05.000Z","new",200_000) as Array<{Update?:{ExpressionAttributeValues?:Record<string,unknown>};Put?:{Item:Record<string,unknown>}}>;
    expect(tx[0]?.Update?.ExpressionAttributeValues?.[":nextVersion"]).toBe(8);expect(tx[1]?.Put?.Item["SK"]).toBe("OUTBOX#8");
  });
  it("completes without creating a continuation outbox",()=>{
    const lease={...scanLeaseKey(ref),entityType:"REMINDER_SCAN_LEASE",status:"IN_PROGRESS",ownerToken:"owner",version:3,rolloutEpoch:4,observedNow:"2026-09-17T18:49:05.000Z",leaseUntil:"2026-09-17T18:52:00.000Z",pagesProcessed:1,candidatesPublished:200,createdAt:"2026-09-17T18:49:05.000Z",updatedAt:"2026-09-17T18:49:05.000Z",purgeAfterTtl:1} satisfies ScanLeaseV2;
    const tx=checkpointControlChain(deps,lease,ref,undefined,undefined,10,200_000) as Array<{Update?:{UpdateExpression:string}}> ;expect(tx).toHaveLength(1);expect(tx[0]?.Update?.UpdateExpression).toContain("#status = :complete");
  });
});
