/**
 * ReportDeliveryAttempt — D-204 decision 5. One row per (run, recipient) — a recipient
 * invalid/failed at delivery time NEVER contaminates the others in the same run. State
 * machine mirrors `NotificationAttempt` (`notification-attempt.ts`) exactly: `SUBMITTING`
 * exists to represent "the external call (SES) may have been crossed without local
 * confirmation" — claimed with a lease BEFORE any external call, so a crashed worker's retry
 * never blindly resends (same `decideSendAction`/lease-expiry reconciliation this project
 * already established for M4's email pipeline).
 *
 * D-235 (full-audit-round2 privacy finding E-015): `purgeAfterTtl` set once at creation,
 * DynamoDB-native TTL (no custom purge worker), same mechanism every other TTL'd entity in this
 * codebase already uses. Retention reuses the SAME 30-day window
 * `aws_s3_bucket_lifecycle_configuration.report_exports` already established (D-215 decision 6,
 * `infra/main.tf`) for the actual dense personal data (the generated CSV object in S3) - this row
 * is only metadata about ONE recipient's delivery outcome, so once the S3 object itself is gone
 * there is no reason for the row describing an attempt to deliver it to outlive it.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type ReportDeliveryAttemptStatus = "PREPARED" | "SUBMITTING" | "ACCEPTED" | "FAILED_RETRYABLE" | "FAILED_TERMINAL" | "UNKNOWN";

export interface ReportDeliveryAttempt extends EntityKey {
  // PK = TENANT#<tenantId>#REPORTSUB#<subscriptionId>#RUN#<runId>, SK = ATTEMPT#<recipientUserId>
  entityType: "ReportDeliveryAttempt";
  tenantId: string;
  subscriptionId: string;
  runId: string;
  recipientUserId: string;
  status: ReportDeliveryAttemptStatus;
  providerMessageId?: string;
  /** Set only when SUBMITTING was skipped because the recipient failed fresh revalidation
   * (Membership/GlobalUser not ACTIVE at delivery time, D-204 decision 5) — distinct from a
   * SES-level failure, so an operator reading this history can tell "never attempted, member
   * left" apart from "attempted, provider rejected it". */
  skippedReason?: "RECIPIENT_NOT_ELIGIBLE";
  /** Same lease concept as `NotificationAttempt.leaseExpiresAt` / the outbox relay — a
   * SUBMITTING attempt holds this while the SES call is in flight so a concurrent redrive of
   * the same message doesn't race the same attempt. */
  leaseExpiresAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** DynamoDB TTL attribute (epoch seconds) — see the file header's D-235 note. Set once at
   * creation, 30 days out; never re-set on update. */
  purgeAfterTtl: number;
}

export function reportDeliveryAttemptKey(tenantId: string, subscriptionId: string, runId: string, recipientUserId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#REPORTSUB#${subscriptionId}#RUN#${runId}`, SK: `ATTEMPT#${recipientUserId}` };
}

/** Same 30-day figure as `aws_s3_bucket_lifecycle_configuration.report_exports` (D-215 decision
 * 6, `infra/main.tf`) — see D-235 note above for why this metadata row reuses that number rather
 * than inventing a new retention class. */
export const REPORT_DELIVERY_ATTEMPT_RETENTION_DAYS = 30;

export function computeReportDeliveryAttemptPurgeAfterTtl(createdAtIso: string): number {
  return Math.floor(Date.parse(createdAtIso) / 1000) + REPORT_DELIVERY_ATTEMPT_RETENTION_DAYS * 24 * 60 * 60;
}
