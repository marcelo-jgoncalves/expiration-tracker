/**
 * REPLACEMENT vs CORRECTIVE decision (M4, docs/architecture/m4-notification-engine-design.md
 * fechamento de rodada 3, item 3 - corrects an ambiguity flagged in Codex's round2 blind
 * score and refined again in round3 after round3's own first draft omitted `SUBMITTING`).
 *
 * Triggered whenever a stale NotificationIntent (item/policy version mismatch, FR-014) is
 * detected, in either the router (before routing) or the delivery worker (immediately
 * before the external call) - both call the SAME predicate so the classification can never
 * disagree between the two call sites.
 */
import type { NotificationAttemptStatus } from "../domain/notification-attempt.js";
import { attemptMayHaveBeenDelivered } from "../domain/notification-attempt.js";
import type { NotificationIntentKind } from "../../reminder/domain/notification-intent.js";

export interface CorrectiveIntentDecision {
  kind: Extract<NotificationIntentKind, "REPLACEMENT" | "CORRECTIVE">;
}

/**
 * `latestAttemptStatus` is the status of the most recent NotificationAttempt against the
 * stale intent being superseded, or `undefined` if no attempt was ever created for it.
 * REPLACEMENT: no attempt exists, or the latest is in a state where the external delivery
 * limit could not have been crossed (PREPARED/FAILED_RETRYABLE/FAILED_TERMINAL/
 * NOT_SENT_STALE) - nothing stale could have reached the recipient, so the new intent is
 * treated as if it were the first communication.
 * CORRECTIVE: the latest attempt is SUBMITTING, ACCEPTED, DELIVERED, UNKNOWN, BOUNCED or
 * COMPLAINED - a real send attempt occurred (or may have), so the new intent must
 * explicitly communicate a correction rather than silently resend the current content.
 */
export function decideCorrectiveIntentKind(latestAttemptStatus: NotificationAttemptStatus | undefined): CorrectiveIntentDecision {
  return { kind: attemptMayHaveBeenDelivered(latestAttemptStatus) ? "CORRECTIVE" : "REPLACEMENT" };
}

export function correctiveIdempotencyKey(input: {
  tenantId: string;
  supersededIntentId: string;
  currentItemVersion: number;
  kind: "REPLACEMENT" | "CORRECTIVE";
}): string {
  return `${input.tenantId}|${input.supersededIntentId}|${input.currentItemVersion}|${input.kind}`;
}
