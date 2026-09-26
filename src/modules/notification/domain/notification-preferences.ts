/**
 * NotificationPreferences (M4, docs/architecture/m4-notification-engine-design.md §3.3 base
 * + delta 1 de rodada 2). Not in the original data-model.md - new M4 entity.
 *
 * Consent default (decision of Marcelo, round1-decisions-resolved.md §1): expiration
 * reminder e-mail is treated as transactional/essential to the product, not marketing - the
 * record is created automatically at onboarding with `emailEnabled: true`,
 * `consentSource: "ONBOARDING"` (D-332: `CreateOrganizationService`/`AcceptInvitationService`,
 * both real onboarding entry points - this was only a documented intention until D-332, see
 * `notification-preferences-service.ts`'s header for the gap this closed). A missing record is
 * NOT treated as "no consent" by the router (that would silently stop every reminder for any
 * tenant/user created BEFORE D-332, no-backfill posture, decisions-log.md) - see
 * notification-router.ts's fail-closed matrix for the distinct, narrower failure mode of a
 * genuinely missing/corrupt record.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type NotificationConsentSource = "ONBOARDING" | "USER_SETTINGS" | "MIGRATED_DEFAULT";

export interface NotificationPreferences extends EntityKey {
  SK: "NOTIFICATION_PREFERENCES";
  entityType: "NotificationPreferences";
  tenantId: string;
  userId: string;
  emailEnabled: boolean;
  locale: string;
  quietHours: {
    enabled: boolean;
    startLocal: string; // HH:mm
    endLocal: string; // HH:mm
    timeZone: string; // IANA
  } | null;
  consentSource: NotificationConsentSource;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function notificationPreferencesKey(tenantId: string, userId: string): { PK: string; SK: "NOTIFICATION_PREFERENCES" } {
  return { PK: `TENANT#${tenantId}#USER#${userId}`, SK: "NOTIFICATION_PREFERENCES" };
}

/** Onboarding default - called at real onboarding since D-332 (`CreateOrganizationService`,
 * `AcceptInvitationService`) and, for pre-D-332 tenants/users, lazily via
 * `NotificationPreferencesService.getOrCreatePreferences()`. */
export function defaultNotificationPreferences(input: {
  tenantId: string;
  userId: string;
  locale: string;
  now: string;
  consentSource?: NotificationConsentSource;
}): NotificationPreferences {
  return {
    ...notificationPreferencesKey(input.tenantId, input.userId),
    entityType: "NotificationPreferences",
    tenantId: input.tenantId,
    userId: input.userId,
    emailEnabled: true,
    locale: input.locale,
    quietHours: null,
    consentSource: input.consentSource ?? "ONBOARDING",
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
