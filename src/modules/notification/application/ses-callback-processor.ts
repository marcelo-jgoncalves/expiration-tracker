/**
 * SesCallbackWorker monotonic transition logic (M4, pure - no AWS SDK).
 * docs/architecture/reviews/m4-notification-engine-design/codex-proposal-round1.md §11.4:
 * precedence COMPLAINED > BOUNCED > DELIVERED > ACCEPTED > SUBMITTING. A callback never
 * regresses the attempt to a lower-precedence state (e.g. DELIVERED -> ACCEPTED), duplicate
 * callbacks are idempotent no-ops, and an out-of-order callback only applies if its target
 * state outranks the current one.
 */
import type { NotificationAttemptStatus } from "../domain/notification-attempt.js";

export type SesCallbackEventKind = "DELIVERY" | "BOUNCE" | "COMPLAINT";

const CALLBACK_TARGET_STATUS: Record<SesCallbackEventKind, NotificationAttemptStatus> = {
  DELIVERY: "DELIVERED",
  BOUNCE: "BOUNCED",
  COMPLAINT: "COMPLAINED",
};

/** Only the states a callback can ever move an attempt INTO participate in the precedence
 * order - PREPARED, SUBMITTING, the FAILED_ states and NOT_SENT_STALE are not valid callback
 * targets, but a
 * callback arriving while the attempt is still SUBMITTING/UNKNOWN (callback beat the local
 * MessageId persistence) is a normal, expected race - it still applies, since it's strictly
 * new information the local state doesn't have yet. */
const PRECEDENCE: Record<string, number> = {
  SUBMITTING: 0,
  UNKNOWN: 0,
  ACCEPTED: 1,
  DELIVERED: 2,
  BOUNCED: 3,
  COMPLAINED: 4,
};

export type CallbackApplication = { apply: true; nextStatus: NotificationAttemptStatus } | { apply: false; reason: "NO_OP_NOT_HIGHER_PRECEDENCE" };

export function decideCallbackApplication(currentStatus: NotificationAttemptStatus, eventKind: SesCallbackEventKind): CallbackApplication {
  const targetStatus = CALLBACK_TARGET_STATUS[eventKind];
  const currentRank = PRECEDENCE[currentStatus] ?? -1;
  const targetRank = PRECEDENCE[targetStatus] ?? -1;
  if (targetRank <= currentRank) {
    return { apply: false, reason: "NO_OP_NOT_HIGHER_PRECEDENCE" };
  }
  return { apply: true, nextStatus: targetStatus };
}

/** Complaint suppression policy (round1-decisions-resolved.md §3, decision of Marcelo):
 * a COMPLAINT callback always suppresses future e-mail to that recipient automatically and
 * permanently - no manual review gate for the initial suppression. */
export function complaintRequiresSuppression(eventKind: SesCallbackEventKind): boolean {
  return eventKind === "COMPLAINT";
}
