/**
 * ReportSubscription — D-204 (Roadmap P1 item 15, `docs/architecture/reviews/
 * scheduled-reports-scoping/estado-final-consolidado.md` decision 1). A per-tenant
 * subscription to a subset of `ReportsService`'s 7 CSV reports, delivered on a weekly
 * cadence to a fixed recipient list — created/managed via `ADMIN_ROLES` HTTP routes (same
 * tier as D-195's manual report routes), fired by a scheduled worker that discovers due
 * subscriptions via GSI8 (never GSI10 — decision 2, `local.gsi8_worker_types`'s
 * `REPORT_SUBSCRIPTION` namespace).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

/** The 7 report types `ReportsService` already exposes (D-195) — a subscription selects a
 * non-empty subset, never invents a new report kind. */
export type ReportSubscriptionReportType =
  | "EXPIRED_ITEMS"
  | "EXPIRING_SOON_ITEMS"
  | "RENEWED_ITEMS"
  | "EXPIRATION_ITEMS_BY_ASSIGNEE"
  | "MISSING_REQUIREMENTS"
  | "REQUIREMENTS_BY_SUBJECT"
  | "REQUIREMENTS_BY_ASSIGNEE";

export const REPORT_SUBSCRIPTION_REPORT_TYPES: readonly ReportSubscriptionReportType[] = [
  "EXPIRED_ITEMS",
  "EXPIRING_SOON_ITEMS",
  "RENEWED_ITEMS",
  "EXPIRATION_ITEMS_BY_ASSIGNEE",
  "MISSING_REQUIREMENTS",
  "REQUIREMENTS_BY_SUBJECT",
  "REQUIREMENTS_BY_ASSIGNEE",
];

/** v1 supports only WEEKLY (decision 1) — deliberately narrow, same "don't invent granularity
 * no design specified" discipline as `field-schema.ts`'s single-field v1. Modeled as a union
 * (not a hardcoded literal) so a future MONTHLY addition is a type-level, not structural,
 * change. */
export type ReportSubscriptionCadence = "WEEKLY";

/** D-204 decision 1: teto nomeado de destinatários por assinatura. */
export const MAX_REPORT_SUBSCRIPTION_RECIPIENTS = 10;

export interface ReportSubscription extends EntityKey {
  // PK = TENANT#<tenantId>#REPORTSUB#<subscriptionId>, SK = META
  entityType: "ReportSubscription";
  subscriptionId: string;
  tenantId: string;
  reportTypes: readonly ReportSubscriptionReportType[];
  cadence: ReportSubscriptionCadence;
  /** ISO 8601 day-of-week, 1 (Monday) through 7 (Sunday) — same convention as `Intl`/ISO, never
   * JS `Date.getDay()`'s 0=Sunday to avoid the exact off-by-one class of bug that convention
   * invites. */
  dayOfWeek: number;
  localTime: string; // "HH:mm", same convention as ReminderTrigger.localTime
  timeZone: string; // IANA, same convention as ReminderPolicy.timeZone
  /** userIds, never raw e-mails (D-204 decision: revalidated FRESH — Membership ACTIVE +
   * GlobalUser ACTIVE — at delivery time, never trusted from creation time). */
  recipientUserIds: readonly string[];
  createdBy: string;
  /** Advanced atomically (ConditionCheck on `version`) by the scheduled worker's claim
   * transaction (decision 4) — the single source of truth for "is this subscription due". */
  nextRunAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** GSI8 (MaintenanceDueIndex, D-179) discovery pointer — `report_subscription` worker type,
   * `local.gsi8_worker_types` in `infra/modules/dynamo-table/main.tf`. Discovery-only, never a
   * source of eligibility (same posture every GSI8 consumer already holds): the claim
   * transaction re-reads/re-validates this exact row (`version` ConditionCheck) before firing,
   * never trusts the index query's projected attributes. */
  GSI8PK: string;
  GSI8SK: string;
}

export function reportSubscriptionKey(tenantId: string, subscriptionId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#REPORTSUB#${subscriptionId}`, SK: "META" };
}

export const REPORT_SUBSCRIPTION_GSI8_WORKER_TYPE = "REPORT_SUBSCRIPTION";

export function reportSubscriptionGsi8Keys(input: { dueAtIso: string; tenantId: string; subscriptionId: string }): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${REPORT_SUBSCRIPTION_GSI8_WORKER_TYPE}`,
    GSI8SK: `${input.dueAtIso}#TENANT#${input.tenantId}#${input.subscriptionId}`,
  };
}

export interface ValidateReportSubscriptionInput {
  reportTypes: readonly string[];
  recipientUserIds: readonly string[];
}

/** Fail-closed validation shared by create/update (mirrors `isValidFieldValue`'s "HTTP schema
 * validates shape, domain validates business rules" split — a schema can enforce array
 * length/string format, but not "every reportType is one of the 7 real ones" without
 * duplicating this exact list into JSON Schema, which would drift the moment an 8th report is
 * added). */
export function validateReportSubscriptionInput(input: ValidateReportSubscriptionInput): string | undefined {
  if (input.reportTypes.length === 0) {
    return "reportTypes must be non-empty.";
  }
  const invalidType = input.reportTypes.find((t) => !REPORT_SUBSCRIPTION_REPORT_TYPES.includes(t as ReportSubscriptionReportType));
  if (invalidType) {
    return `Unknown reportType: ${invalidType}.`;
  }
  if (input.recipientUserIds.length === 0) {
    return "recipientUserIds must be non-empty.";
  }
  if (input.recipientUserIds.length > MAX_REPORT_SUBSCRIPTION_RECIPIENTS) {
    return `recipientUserIds exceeds the cap of ${MAX_REPORT_SUBSCRIPTION_RECIPIENTS}.`;
  }
  return undefined;
}
