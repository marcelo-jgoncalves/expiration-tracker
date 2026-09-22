import { useMutation } from "@tanstack/react-query";
import { recordWhatsAppOptIn } from "../api/notifications.js";

/** A18 (D-286) - "Ativar WhatsApp" on NotificationPreferences.tsx. Create-once on the backend
 * (same phone number twice is a no-op, never a conflict) - no OCC needed, unlike
 * useUpdateNotificationPreferences. */
export function useWhatsAppOptIn() {
  return useMutation({
    mutationFn: (phoneE164: string) => recordWhatsAppOptIn(phoneE164),
  });
}
