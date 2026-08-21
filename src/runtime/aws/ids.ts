/**
 * Real ID generator (M3.5) - implements every module's ID-generator port
 * (ExpirationIdGenerator, ReminderIdGenerator, identity's IdGenerator, plus the
 * newEventId/correlationId shape workers expect) with ulid, already a project dependency.
 * One instance per Lambda invocation composition root - never shared as a singleton with
 * mutable state, ulid itself is stateless.
 */
import { ulid } from "ulid";
import type { ExpirationIdGenerator } from "../../modules/expiration/application/id-generator.js";
import type { ReminderIdGenerator } from "../../modules/reminder/application/id-generator.js";
import type { IdGenerator as IdentityIdGenerator } from "../../modules/identity/application/resolve-request-context.js";

export class UlidIdGenerator implements ExpirationIdGenerator, ReminderIdGenerator, IdentityIdGenerator {
  newItemId(): string {
    return `item_${ulid()}`;
  }
  newAuditEventId(): string {
    return `audit_${ulid()}`;
  }
  newEventId(): string {
    return `evt_${ulid()}`;
  }
  newPolicyId(): string {
    return `policy_${ulid()}`;
  }
  newTriggerId(): string {
    return `trigger_${ulid()}`;
  }
  newIntentId(): string {
    return `intent_${ulid()}`;
  }
  newAttemptId(): string {
    return `attempt_${ulid()}`;
  }
  newUserId(): string {
    return `user_${ulid()}`;
  }
  newSessionId(): string {
    return `session_${ulid()}`;
  }
}

export function newCorrelationId(): string {
  return `corr_${ulid()}`;
}
