import { useMutation } from "@tanstack/react-query";
import { requestWhatsAppPhoneConfirmation, confirmWhatsAppPhoneConfirmation } from "../api/notifications.js";

/** Item 26 (NEXT_SESSION_PROMPT.md, 2026-09-23) - "Enviar código" on NotificationPreferences.tsx.
 * Same mutation-per-call shape as useWhatsAppOptIn - no OCC needed, the phone itself is the key. */
export function useRequestWhatsAppPhoneConfirmation() {
  return useMutation({
    mutationFn: (phoneE164: string) => requestWhatsAppPhoneConfirmation(phoneE164),
  });
}

export function useConfirmWhatsAppPhoneConfirmation() {
  return useMutation({
    mutationFn: ({ phoneE164, code }: { phoneE164: string; code: string }) => confirmWhatsAppPhoneConfirmation(phoneE164, code),
  });
}
