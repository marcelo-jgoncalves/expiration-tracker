/** Composition root for the reports module against real DynamoDB (Roadmap P0.7).
 * Reuses the SAME store instances `buildExpirationDeps`/`buildDocumentArchiveDeps` already
 * build (both are returned from their own composition functions precisely so a third
 * composition like this one never has to construct its own persistence adapter — same "reuse
 * the store, never duplicate the adapter" posture `DashboardService`'s composition already
 * established for the exact same two stores). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbExpirationStore } from "../../../modules/expiration/persistence/dynamodb-expiration-store.js";
import { DynamoDbDocumentArchiveStore } from "../../../modules/document-archive/persistence/dynamodb-document-archive-store.js";
import { ReportsService } from "../../../modules/reports/application/reports-service.js";

export function buildReportsDeps(client: DynamoDBDocumentClient, tableName: string) {
  const itemStore = new DynamoDbExpirationStore(client, tableName);
  const documentStore = new DynamoDbDocumentArchiveStore(client, tableName);
  const reports = new ReportsService({ documentStore, itemStore });
  return { reports };
}
