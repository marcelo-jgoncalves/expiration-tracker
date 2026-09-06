/** Composition root for the reports module against real DynamoDB (Roadmap P0.7).
 * Reuses the SAME store instances `buildExpirationDeps`/`buildDocumentArchiveDeps` already
 * build (both are returned from their own composition functions precisely so a third
 * composition like this one never has to construct its own persistence adapter — same "reuse
 * the store, never duplicate the adapter" posture `DashboardService`'s composition already
 * established for the exact same two stores). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDbExpirationStore } from "../../../modules/expiration/persistence/dynamodb-expiration-store.js";
import { DynamoDbDocumentArchiveStore } from "../../../modules/document-archive/persistence/dynamodb-document-archive-store.js";
import { ReportsService } from "../../../modules/reports/application/reports-service.js";
import { ReportSubscriptionService } from "../../../modules/reports/application/report-subscription-service.js";
import { DynamoDbReportSubscriptionStore } from "../../../modules/reports/persistence/dynamodb-report-subscription-store.js";
import { S3ReportExportStore } from "../../../modules/reports/persistence/s3-report-export-store.js";
import { DynamoDbScheduledReportsCandidateSource } from "../../../workers/scheduled-reports/dynamodb-candidate-source.js";
import { DynamoDbNotificationRecipientResolver } from "../../../modules/notification/persistence/dynamodb-recipient-resolver.js";
import { SesEmailAdapter, createSesClient } from "../../../modules/notification/providers/ses-email-adapter.js";
import { UlidIdGenerator, newCorrelationId } from "../ids.js";

/** `reportExportsBucketName` optional so every OTHER caller of this composition (the
 * subscription CRUD/CSV routes, which never touch S3) keeps working unchanged - only
 * `reports-handler.ts`'s download route actually needs `subscriptionStore`/`exportStore` wired
 * (D-204 fatia 3, decision 7). */
export function buildReportsDeps(client: DynamoDBDocumentClient, tableName: string, reportExportsBucketName?: string) {
  const itemStore = new DynamoDbExpirationStore(client, tableName);
  const documentStore = new DynamoDbDocumentArchiveStore(client, tableName);
  const reports = new ReportsService({ documentStore, itemStore });
  const ids = new UlidIdGenerator();
  const subscriptionStore = new DynamoDbReportSubscriptionStore(client, tableName);
  const subscriptions = new ReportSubscriptionService({ store: subscriptionStore, tableName, ids, now: () => new Date().toISOString() });
  const exportStore = reportExportsBucketName ? new S3ReportExportStore(new S3Client({}), reportExportsBucketName) : undefined;
  return { reports, subscriptions, subscriptionStore, exportStore };
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

/** D-204 fatia 3: composition root for ReportSubscriptionDeliveryWorker. Reuses the SAME
 * `ReportsService`/`ReportSubscriptionStore` shapes `buildReportsDeps` above already builds
 * (a fresh instance here, not the shared one, since this Lambda's own module-level singleton
 * never overlaps with the reports-handler Lambda's) - `documentStore`/`itemStore` read-only,
 * same as `buildReportsDeps`. `DynamoDbNotificationRecipientResolver`/`SesEmailAdapter` are the
 * SAME adapters `buildEmailDeliveryDeps` (`notification.ts`) already establishes for M4's SES
 * pipeline - no new provider/port, this worker is just a second consumer of the same one. */
export function buildReportSubscriptionDeliveryDeps(
  client: DynamoDBDocumentClient,
  tableName: string,
  reportExportsBucketName: string,
  sesFromAddress: string,
  sesConfigurationSet: string,
  downloadBaseUrl: string,
) {
  const itemStore = new DynamoDbExpirationStore(client, tableName);
  const documentStore = new DynamoDbDocumentArchiveStore(client, tableName);
  const reports = new ReportsService({ documentStore, itemStore });
  const store = new DynamoDbReportSubscriptionStore(client, tableName);
  const exportStore = new S3ReportExportStore(new S3Client({}), reportExportsBucketName);
  const recipients = new DynamoDbNotificationRecipientResolver(client, tableName);
  const emailProvider = new SesEmailAdapter(createSesClient(), sesFromAddress, sesConfigurationSet);
  return { store, tableName, reports, exportStore, recipients, emailProvider, downloadBaseUrl, now: () => new Date().toISOString() };
}
