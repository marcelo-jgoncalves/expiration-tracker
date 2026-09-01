/** Composition root for the activity module against real DynamoDB (D-149). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbAuditPartitionStore } from "../../../modules/activity/persistence/dynamodb-audit-partition-store.js";
import { ActivityService } from "../../../modules/activity/application/activity-service.js";

export function buildActivityDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbAuditPartitionStore(client, tableName);
  const activity = new ActivityService({ store });
  return { store, activity };
}
