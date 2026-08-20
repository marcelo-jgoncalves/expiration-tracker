/**
 * EmailDeliveryWorker core decision logic (M4, pure - no AWS SDK). Models SES's fundamental
 * limitation: no client-controlled idempotency key, and no confirmation until the request
 * is accepted (docs/architecture/reviews/m4-notification-engine-design/
 * codex-proposal-round1.md §10). `SUBMITTING` represents "the external limit may have been
 * crossed without local confirmation" - never retried automatically (round3-fixes.md item
 * 4, ratified as normative: at-most-once, possible loss preferred over automatic duplicate).
 */
import type { NotificationAttemptStatus } from "../domain/notification-attempt.js";
import type { EmailSendFailureKind } from "../ports/email-provider.js";

export type SendAction =
  | { action: "SEND" }
  | { action: "SKIP_IN_PROGRESS" } // SUBMITTING, lease still held elsewhere - not this worker's duplicate to resolve
  | { action: "RECONCILE_UNKNOWN" } // SUBMITTING, lease expired - do NOT call SES again; mark UNKNOWN
  | { action: "SKIP_RESOLVED" }; // ACCEPTED/DELIVERED/BOUNCED/COMPLAINED/FAILED_TERMINAL/UNKNOWN/NOT_SENT_STALE - nothing to do

/**
 * `leaseExpiresAt` mirrors the same lease concept as the outbox relay
 * (shared/outbox/relay-store.ts) - a `SUBMITTING` attempt holds a lease while the SES call
 * is in flight so a concurrent duplicate delivery of the same SQS message doesn't race the
 * same attempt.
 */
export function decideSendAction(
  attempt: { status: NotificationAttemptStatus; leaseExpiresAt?: string },
  nowIso: string,
): SendAction {
  if (attempt.status === "PREPARED" || attempt.status === "FAILED_RETRYABLE") {
    return { action: "SEND" };
  }
  if (attempt.status === "SUBMITTING") {
    const expired = !attempt.leaseExpiresAt || attempt.leaseExpiresAt < nowIso;
    return expired ? { action: "RECONCILE_UNKNOWN" } : { action: "SKIP_IN_PROGRESS" };
  }
  return { action: "SKIP_RESOLVED" };
}

export type SendOutcome =
  | { kind: "ACCEPTED"; providerMessageId: string }
  | { kind: "FAILURE"; failureKind: EmailSendFailureKind; normalizedCode?: string };

/** Next attempt status after an actual SES call was made (action was SEND). Conclusive
 * failures (provider is certain the request never went through) are classified precisely
 * because they change retry eligibility; AMBIGUOUS failures (timeout/connection drop after
 * the request may have reached SES) always land on UNKNOWN, never FAILED_RETRYABLE - a
 * blind automatic retry there could duplicate a message SES actually accepted. */
export function nextStatusAfterSendAttempt(outcome: SendOutcome): NotificationAttemptStatus {
  if (outcome.kind === "ACCEPTED") return "ACCEPTED";
  switch (outcome.failureKind) {
    case "CONCLUSIVE_RETRYABLE":
      return "FAILED_RETRYABLE";
    case "CONCLUSIVE_TERMINAL":
      return "FAILED_TERMINAL";
    case "AMBIGUOUS":
      return "UNKNOWN";
  }
}
