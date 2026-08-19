/** Composition root for the expiration module against real DynamoDB (M3.5). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbExpirationStore } from "../../../modules/expiration/persistence/dynamodb-expiration-store.js";
import { ExpirationService } from "../../../modules/expiration/application/expiration-service.js";
import { UlidIdGenerator } from "../ids.js";

export function buildExpirationDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbExpirationStore(client, tableName);
  const ids = new UlidIdGenerator();
  const expiration = new ExpirationService({ store, tableName, ids });
  return { store, expiration };
}
