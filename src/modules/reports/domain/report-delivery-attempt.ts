/**
 * ReportDeliveryAttempt — D-204 decision 5. One row per (run, recipient) — a recipient
 * invalid/failed at delivery time NEVER contaminates the others in the same run. State
 * machine mirrors `NotificationAttempt` (`notification-attempt.ts`) exactly: `SUBMITTING`
 * exists to represent "the external call (SES) may have been crossed without local
 * confirmation" — claimed with a lease BEFORE any external call, so a crashed worker's retry
 * never blindly resends (same `decideSendAction`/lease-expiry reconciliation this project
 * already established for M4's email pipeline).
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
}

export function reportDeliveryAttemptKey(tenantId: string, subscriptionId: string, runId: string, recipientUserId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#REPORTSUB#${subscriptionId}#RUN#${runId}`, SK: `ATTEMPT#${recipientUserId}` };
}
