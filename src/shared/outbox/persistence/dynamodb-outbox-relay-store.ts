/** Real DynamoDB adapter for OutboxRelayStore (M3.5). Wired into both
 * DispatchOutboxRelay and OutboxSweeperReminderDispatch composition roots - the two
 * EXACTLY-two roles with `gsi6Read()` (see infra/lib/dynamo-table.ts). */
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey } from "../../dynamodb/occ.js";
import type { OutboxRecord } from "../outbox.js";
import type { OutboxRelayStore } from "../relay-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../dynamodb/sdk-errors.js";

export class DynamoDbOutboxRelayStore implements OutboxRelayStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async tryAcquireLease(key: EntityKey, leaseOwner: string, leaseExpiresAt: string, now: string): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: key,
          UpdateExpression: "SET leaseOwner = :owner, leaseExpiresAt = :expires",
          ConditionExpression: "attribute_not_exists(leaseOwner) OR leaseExpiresAt < :now",
          ExpressionAttributeValues: { ":owner": leaseOwner, ":expires": leaseExpiresAt, ":now": now },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "OutboxRelayStore.tryAcquireLease");
    }
  }

  async markPublished(key: EntityKey): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: key,
          // Bug found by Codex implementation review: without also removing GSI6PK/GSI6SK,
          // published records stayed indexed under RECON#OUTBOX#PENDING forever - not a
          // duplicate-send risk (publishOne already checks status === "PUBLISHED"), but the
          // sweeper's query would keep growing to include every record ever published,
          // reading and discarding them on every run.
          UpdateExpression: "SET #status = :published REMOVE leaseOwner, leaseExpiresAt, GSI6PK, GSI6SK",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":published": "PUBLISHED" },
        }),
      );
    } catch (err) {
      throw mapDynamoError(err, "OutboxRelayStore.markPublished");
    }
  }

  async listPendingReminderDispatch(input: { destination: string; olderThan: string; pageSize?: number }): Promise<OutboxRecord[]> {
    try {
      const items: OutboxRecord[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: "GSI6",
            KeyConditionExpression: "GSI6PK = :pk AND GSI6SK < :before",
            FilterExpression: "destination = :destination",
            ExpressionAttributeValues: {
              ":pk": "RECON#OUTBOX#PENDING",
              ":before": input.olderThan,
              ":destination": input.destination,
            },
            Limit: input.pageSize,
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        items.push(...((result.Items ?? []) as OutboxRecord[]));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return items;
    } catch (err) {
      throw mapDynamoError(err, "OutboxRelayStore.listPendingReminderDispatch");
    }
  }
}
