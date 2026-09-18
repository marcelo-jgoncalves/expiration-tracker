import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import type { ScanLeaseV2, ScanOutboxV2 } from "./model.js";

export class DynamoDbScanControlStore {
  constructor(private readonly client: DynamoDBDocumentClient, readonly tableName: string) {}
  async getLease(key: EntityKey): Promise<ScanLeaseV2 | undefined> { return (await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }))).Item as ScanLeaseV2 | undefined; }
  async transact(entries: TransactWriteEntry[]): Promise<void> { await this.client.send(new TransactWriteCommand({ TransactItems: entries as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] })); }
  async listDue(gsi1pk: "LEASE#IN_PROGRESS" | "OUTBOX#PENDING", now: string, limit = 100): Promise<Array<ScanLeaseV2 | ScanOutboxV2>> {
    const result = await this.client.send(new QueryCommand({ TableName: this.tableName, IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :pk AND GSI1SK <= :upper", ExpressionAttributeValues: { ":pk": gsi1pk, ":upper": `${now}#\uffff` }, Limit: limit }));
    return (result.Items ?? []) as Array<ScanLeaseV2 | ScanOutboxV2>;
  }
  async markPublished(item: ScanOutboxV2, now: string): Promise<boolean> {
    try { await this.client.send(new UpdateCommand({ TableName: this.tableName, Key: { PK:item.PK, SK:item.SK }, UpdateExpression: "SET #status=:published, updatedAt=:now ADD attemptCount :one REMOVE GSI1PK, GSI1SK", ConditionExpression: "#status=:pending AND eventId=:eventId", ExpressionAttributeNames:{"#status":"status"}, ExpressionAttributeValues:{":published":"PUBLISHED",":pending":"PENDING",":eventId":item.eventId,":now":now,":one":1} })); return true; }
    catch (error) { if ((error as {name?:string}).name === "ConditionalCheckFailedException") return false; throw error; }
  }
}
