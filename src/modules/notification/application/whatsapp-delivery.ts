/**
 * WhatsAppDeliveryWorker core decision logic (fatia 2/5, pure - no AWS SDK). `decideSendAction`
 * and `nextStatusAfterSendAttempt` in `email-delivery.ts` are ALREADY channel-agnostic (they
 * operate purely on `NotificationAttemptStatus`/the shared three-way failure-kind shape, never
 * on anything SES-specific) - re-exported here under WhatsApp-flavored names rather than
 * duplicated, so the two channels can never drift into two copies of the same state machine.
 * `EmailSendFailureKind`/`WhatsAppSendFailureKind` are structurally identical unions (both
 * `"CONCLUSIVE_RETRYABLE" | "CONCLUSIVE_TERMINAL" | "AMBIGUOUS"`, D-2) so this re-export is
 * type-safe without a cast.
 */
import type { WhatsAppSendFailureKind } from "../ports/whatsapp-provider.js";
import { decideSendAction, nextStatusAfterSendAttempt, type SendAction } from "./email-delivery.js";

export type { SendAction };
export { decideSendAction };

export type WhatsAppSendOutcome =
  | { kind: "ACCEPTED"; providerMessageId: string }
  | { kind: "FAILURE"; failureKind: WhatsAppSendFailureKind };

export function nextWhatsAppStatusAfterSendAttempt(outcome: WhatsAppSendOutcome): ReturnType<typeof nextStatusAfterSendAttempt> {
  return nextStatusAfterSendAttempt(outcome);
}
