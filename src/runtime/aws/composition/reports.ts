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
import { DynamoDbReportSubscriptionStore } from "../../../modules/reports/persistence/dynamodb-report-subscription-store.js";
import { DynamoDbScheduledReportsCandidateSource } from "../../../workers/scheduled-reports/dynamodb-candidate-source.js";
import { UlidIdGenerator, newCorrelationId } from "../ids.js";

export function buildReportsDeps(client: DynamoDBDocumentClient, tableName: string) {
  const itemStore = new DynamoDbExpirationStore(client, tableName);
  const documentStore = new DynamoDbDocumentArchiveStore(client, tableName);
  const reports = new ReportsService({ documentStore, itemStore });
  return { reports };
}

/** D-211 fatia 2 (D-204 decision 3): composition root for the ScheduledReportsScheduler Lambda
 * - separate store/candidate-source from `buildReportsDeps` above, since `ReportSubscription` is
 * a distinct entity `ReportsService` never touches (that service only reads Document/Expiration
 * data, read-only). */
export function buildScheduledReportsDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbReportSubscriptionStore(client, tableName);
  const candidates = new DynamoDbScheduledReportsCandidateSource(client, tableName);
  const ids = new UlidIdGenerator();
  return {
    store,
    candidates,
    tableName,
    now: () => new Date().toISOString(),
    newEventId: () => ids.newEventId(),
    correlationId: () => newCorrelationId(),
  };
}
