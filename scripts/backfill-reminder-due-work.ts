import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { buildReminderDueWorkItem } from "../src/modules/reminder/domain/reminder-due-work.js";

const mainTable = process.env["TABLE_NAME"];
const dueTable = process.env["REMINDER_DUE_WORK_TABLE_NAME"];
if (!mainTable || !dueTable) throw new Error("TABLE_NAME and REMINDER_DUE_WORK_TABLE_NAME are required");
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
type Occurrence = { PK:string; SK:string; entityType:"ReminderOccurrence"|"DocumentChasingOccurrence"; tenantId:string; occurrenceId:string; scheduledAt:string; shardFnVersion:number; shard:string; purgeAfterTtl?:number };

async function pass() {
  let cursor: Record<string, unknown> | undefined;
  let scanned = 0, created = 0, existing = 0;
  do {
    const page = await client.send(new ScanCommand({
      TableName: mainTable, ConsistentRead: true,
      FilterExpression: "#status = :scheduled AND (#type = :reminder OR #type = :chasing)",
      ExpressionAttributeNames: { "#status":"status", "#type":"entityType" },
      ExpressionAttributeValues: { ":scheduled":"SCHEDULED", ":reminder":"ReminderOccurrence", ":chasing":"DocumentChasingOccurrence" },
      ExclusiveStartKey: cursor,
    }));
    const occurrences = (page.Items ?? []) as Occurrence[];
    scanned += occurrences.length;
    for (let offset=0; offset<occurrences.length; offset+=25) {
      await Promise.all(occurrences.slice(offset, offset+25).map(async (occurrence) => {
        const now = new Date().toISOString();
        const item = buildReminderDueWorkItem({
          entityKind: occurrence.entityType === "ReminderOccurrence" ? "REMINDER" : "CHASING",
          tenantId: occurrence.tenantId, occurrenceId: occurrence.occurrenceId,
          occurrenceKey: { PK:occurrence.PK, SK:occurrence.SK }, scheduledAt: occurrence.scheduledAt,
          shardFnVersion: occurrence.shardFnVersion, shardId: Number(occurrence.shard), now,
          purgeAfterTtl: occurrence.purgeAfterTtl ?? Math.floor(Date.parse(occurrence.scheduledAt)/1000)+30*86400,
        });
        try {
          await client.send(new PutCommand({ TableName:dueTable, Item:item, ConditionExpression:"attribute_not_exists(PK) AND attribute_not_exists(SK)" }));
          created++;
        } catch (error) {
          if ((error as {name?:string}).name === "ConditionalCheckFailedException") existing++;
          else throw error;
        }
      }));
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return { scanned, created, existing };
}

for (let iteration=1; iteration<=10; iteration++) {
  const result=await pass(); console.log(JSON.stringify({iteration,...result}));
  if (result.created===0) process.exit(0);
}
throw new Error("Backfill did not converge after 10 passes");
