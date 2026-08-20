/**
 * NotificationAttempt (M4, data-model.md §2 line 37 + full state machine from
 * docs/architecture/reviews/m4-notification-engine-design/codex-proposal-round1.md §3.5,
 * §10). SES SendEmail gives no client-controlled idempotency key and no confirmation until
 * it accepts the request - `SUBMITTING` exists specifically to represent "the external
 * limit may have been crossed without local confirmation" (never silently retried; see
 * email-delivery.ts).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type NotificationAttemptStatus =
  | "PREPARED"
  | "SUBMITTING"
  | "ACCEPTED"
  | "DELIVERED"
  | "BOUNCED"
  | "COMPLAINED"
  | "FAILED_RETRYABLE"
  | "FAILED_TERMINAL"
  | "UNKNOWN"
  | "NOT_SENT_STALE";

export interface NotificationAttempt extends EntityKey {
  // PK = TENANT#<tenantId>#INTENT#<intentId>, SK = ATTEMPT#<attemptNumber padded>#<attemptId>
  entityType: "NotificationAttempt";
  tenantId: string;
  intentId: string;
  attemptId: string;
  attemptNumber: number;
  redriveGeneration: number;
  channel: "EMAIL";
  provider: "SES";
  providerAccountId: string;
  providerMessageId?: string;
  status: NotificationAttemptStatus;
  expectedItemVersion: number;
  commandMessageId: string;
  destinationHash: string;
  templateId: string;
  templateVersion: number;
  submitStartedAt?: string;
  acceptedAt?: string;
  completedAt?: string;
  lastProviderEventAt?: string;
  normalizedFailureCode?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Attempt states in which a real delivery attempt could have reached the destination -
 * used both to decide REPLACEMENT vs CORRECTIVE (corrective-intent-service.ts) and to
 * decide whether a callback/redrive needs conservative handling. Mirrors round3-fixes.md
 * item 3's corrected predicate (SUBMITTING was missing from an earlier draft). */
export const ATTEMPT_STATES_WITH_POSSIBLE_DELIVERY: readonly NotificationAttemptStatus[] = [
  "SUBMITTING",
  "ACCEPTED",
  "DELIVERED",
  "UNKNOWN",
  "BOUNCED",
  "COMPLAINED",
];

export function attemptMayHaveBeenDelivered(status: NotificationAttemptStatus | undefined): boolean {
  return status !== undefined && (ATTEMPT_STATES_WITH_POSSIBLE_DELIVERY as string[]).includes(status);
}

function pad(n: number): string {
  return String(n).padStart(6, "0");
}

export function notificationAttemptKey(tenantId: string, intentId: string, attemptNumber: number, attemptId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#INTENT#${intentId}`, SK: `ATTEMPT#${pad(attemptNumber)}#${attemptId}` };
}

/**
 * Lookup pointer (M4 round3 fechamento #1, achado bloqueante das duas notas cegas de
 * rodada 2): the attempt's own SK embeds `attemptNumber`, which a callback correlating only
 * by `attemptId` (from SES tags) cannot derive. Created atomically with the attempt itself
 * (same TransactWriteItems, ConditionExpression attribute_not_exists(PK) - never overwrites
 * an existing pointer, an attemptId collision is an ID-generation bug, not a silent update).
 * Read with ConsistentRead=true by the callback worker, together with the attempt itself.
 */
export interface NotificationAttemptLookup extends EntityKey {
  // PK = TENANT#<tenantId>#ATTEMPT#<attemptId>, SK = LOOKUP
  entityType: "NotificationAttemptLookup";
  tenantId: string;
  intentId: string;
  attemptSk: string;
  provider: "SES";
  providerAccountId: string;
}

export function notificationAttemptLookupKey(tenantId: string, attemptId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#ATTEMPT#${attemptId}`, SK: "LOOKUP" };
}

export function buildNotificationAttemptLookup(
  attempt: Pick<NotificationAttempt, "tenantId" | "intentId" | "attemptId" | "attemptNumber" | "provider" | "providerAccountId">,
): NotificationAttemptLookup {
  return {
    ...notificationAttemptLookupKey(attempt.tenantId, attempt.attemptId),
    entityType: "NotificationAttemptLookup",
    tenantId: attempt.tenantId,
    intentId: attempt.intentId,
    attemptSk: notificationAttemptKey(attempt.tenantId, attempt.intentId, attempt.attemptNumber, attempt.attemptId).SK,
    provider: attempt.provider,
    providerAccountId: attempt.providerAccountId,
  };
}
