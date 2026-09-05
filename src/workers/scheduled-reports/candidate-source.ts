/**
 * Narrow port for the ScheduledReportsScheduler (D-204 decision 3, `docs/architecture/reviews/
 * scheduled-reports-scoping/estado-final-consolidado.md`) - discovers due `ReportSubscription`s
 * via GSI8 (`GSI8PK=WORK#REPORT_SUBSCRIPTION`, `GSI8SK=<nextRunAt>#TENANT#<tenantId>#
 * <subscriptionId>`, KEYS_ONLY), same shape as `requirement-reindex/candidate-source.ts`
 * (mesmo padrão, decision 3 names explicitly). GSI8 is discovery-only, never a source of
 * eligibility - the worker always re-fetches the full `ReportSubscription` fresh before acting,
 * same posture every other GSI8 consumer holds.
 */
import type { EntityKey } from "../../shared/dynamodb/occ.js";

export interface ReportSubscriptionGsi8Candidate extends EntityKey {
  dueAtIso: string;
  tenantId: string;
  subscriptionId: string;
}

export interface ReportSubscriptionGsi8Page {
  items: ReportSubscriptionGsi8Candidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ScheduledReportsCandidateSource {
  /** `Query GSI8PK = "WORK#REPORT_SUBSCRIPTION" AND GSI8SK < :before`, ordered by due date.
   * `tenantId`/`subscriptionId` are parsed from the base table's own `PK` (`reportSubscriptionKey()`'s
   * shape), never re-derived from `GSI8SK` - `KEYS_ONLY` already returns them for free. */
  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<ReportSubscriptionGsi8Page>;
}
