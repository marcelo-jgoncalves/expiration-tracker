/**
 * ReportSubscriptionRun — D-204 decision 5. One row per scheduled execution of a
 * `ReportSubscription`, holding the FROZEN scope (which report types, which recipients) the
 * claim transaction saw — never re-derived later, so a subscription edited mid-flight never
 * changes what an in-progress run delivers. Field VALUES inside each generated report are
 * still read fresh at generation time (the worker re-queries `ReportsService`); only the
 * "what to generate, who to notify" scope is frozen here.
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
}

export function reportSubscriptionRunKey(tenantId: string, subscriptionId: string, runId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#REPORTSUB#${subscriptionId}`, SK: `RUN#${runId}` };
}
