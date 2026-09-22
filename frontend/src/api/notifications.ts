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

/** `POST /notifications/whatsapp-opt-in` (D-286) - create-once, always 201 whether this call
 * created the row or found an existing one for the exact same phone (`preferences-handlers.ts`'s
 * own doc comment). No GET counterpart exists yet - there is no way to ask "is this user already
 * opted in" ahead of a submit, a real, named gap (see NotificationPreferences.tsx). */
export function recordWhatsAppOptIn(phoneE164: string): Promise<{ optIn: { phoneE164: string; optedInAt: string } }> {
  return apiClient.post<{ optIn: { phoneE164: string; optedInAt: string } }>("/notifications/whatsapp-opt-in", { phoneE164, source: "USER_SETTINGS" });
}
