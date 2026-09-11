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
