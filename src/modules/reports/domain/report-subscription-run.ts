/**
 * ReportSubscriptionRun — D-204 decision 5. One row per scheduled execution of a
 * `ReportSubscription`, holding the FROZEN scope (which report types, which recipients) the
 * claim transaction saw — never re-derived later, so a subscription edited mid-flight never
 * changes what an in-progress run delivers. Field VALUES inside each generated report are
 * still read fresh at generation time (the worker re-queries `ReportsService`); only the
 * "what to generate, who to notify" scope is frozen here.
 *
 * D-235 (full-audit-round2 privacy finding E-015): `purgeAfterTtl` set once at first-delivery
 * time, DynamoDB-native TTL (no custom purge worker), same mechanism every other TTL'd entity in
 * this codebase already uses. Retention reuses the SAME 30-day window
 * `aws_s3_bucket_lifecycle_configuration.report_exports` already established (D-215 decision 6,
 * `infra/main.tf`) for the actual dense personal data (the generated CSV object in S3) — this row
 * is only metadata ABOUT that export (recipient user ids, report type list), so once the S3
 * object itself is gone there is no reason for the row describing it to outlive it.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { ReportSubscriptionReportType } from "./report-subscription.js";

export interface ReportSubscriptionRun extends EntityKey {
  // PK = TENANT#<tenantId>#REPORTSUB#<subscriptionId>, SK = RUN#<runId>
  entityType: "ReportSubscriptionRun";
  runId: string;
  subscriptionId: string;
  tenantId: string;
  scheduledFor: string;
  reportTypes: readonly ReportSubscriptionReportType[];
  recipientUserIds: readonly string[];
  createdAt: string;
  /** DynamoDB TTL attribute (epoch seconds) — see the file header's D-235 note. Set once at
   * creation, 30 days out; never re-set on update. */
  purgeAfterTtl: number;
}

export function reportSubscriptionRunKey(tenantId: string, subscriptionId: string, runId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#REPORTSUB#${subscriptionId}`, SK: `RUN#${runId}` };
}

/** Same 30-day figure as `aws_s3_bucket_lifecycle_configuration.report_exports` (D-215 decision
 * 6, `infra/main.tf`) — see D-235 note above for why this metadata row reuses that number rather
 * than inventing a new retention class. */
export const REPORT_SUBSCRIPTION_RUN_RETENTION_DAYS = 30;

export function computeReportSubscriptionRunPurgeAfterTtl(createdAtIso: string): number {
  return Math.floor(Date.parse(createdAtIso) / 1000) + REPORT_SUBSCRIPTION_RUN_RETENTION_DAYS * 24 * 60 * 60;
}
