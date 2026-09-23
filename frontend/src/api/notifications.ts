/**
 * A18 (Block 8, D-2xx) — Minhas preferências de notificação. `notification/http/preferences-
 * handlers.ts`, allowlisted in `src/modules/bff/domain/proxy-allowlist.ts`. Same one-layer
 * convention as `subjects.ts`: every call site goes through these functions, never `apiClient`
 * inline. `expectedVersion` travels only via the `If-Match` header (`apiClient.put`'s own
 * convention) — this module, unlike `document-archive`'s, never duplicates it in the body.
 */
import { apiClient } from "./apiClient.js";
import type { NotificationPreferences, UpdateNotificationPreferencesInput } from "./types.js";

/** `GET /notifications/preferences` - `notification:configure`, READ_ONLY_ROLES (every real role
 * configures their OWN preferences). Lazily creates the record with the documented default on
 * first call - never 404s for a user who predates onboarding wiring. */
export function fetchNotificationPreferences(options?: { signal?: AbortSignal }): Promise<{ preferences: NotificationPreferences }> {
  return apiClient.get<{ preferences: NotificationPreferences }>("/notifications/preferences", { signal: options?.signal });
}

export function updateNotificationPreferences(input: UpdateNotificationPreferencesInput, expectedVersion: number): Promise<{ preferences: NotificationPreferences }> {
  return apiClient.put<{ preferences: NotificationPreferences }>("/notifications/preferences", input, { expectedVersion });
}

/** `POST /notifications/whatsapp-opt-in/request-confirmation` (item 26) - sends a 6-digit code to
 * `phoneE164` over WhatsApp. Never returns the code itself. Real send is gated server-side on the
 * `WHATSAPP` channel flag — off in every environment today (pending E-019), so this currently
 * rejects with a 503 until that flag flips. */
export function requestWhatsAppPhoneConfirmation(phoneE164: string): Promise<{ expiresAt: string }> {
  return apiClient.post<{ expiresAt: string }>("/notifications/whatsapp-opt-in/request-confirmation", { phoneE164 });
}

/** `POST /notifications/whatsapp-opt-in/confirm` (item 26) - verifies the code sent by
 * `requestWhatsAppPhoneConfirmation` and, only on success, records the `WhatsAppOptIn` server-side. */
export function confirmWhatsAppPhoneConfirmation(phoneE164: string, code: string): Promise<{ optIn: { phoneE164: string; optedInAt: string } }> {
  return apiClient.post<{ optIn: { phoneE164: string; optedInAt: string } }>("/notifications/whatsapp-opt-in/confirm", { phoneE164, code });
}
