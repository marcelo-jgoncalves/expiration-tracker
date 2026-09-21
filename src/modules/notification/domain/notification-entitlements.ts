/**
 * NotificationEntitlements (M4, docs/architecture/reviews/m4-notification-engine-design/
 * codex-proposal-round1.md §3.4). Distinct from consumption/quota (TenantQuotaService,
 * identity/application/quota.ts "NOTIFICATION_EMAIL" QuotaType) - entitlement answers "does
 * the plan allow this channel at all", quota answers "how much has been consumed this
 * window". Consumption happens in the delivery worker, never in the router (a
 * cancelled/deferred message must not consume quota).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface NotificationEntitlements extends EntityKey {
  SK: "ENTITLEMENTS";
  entityType: "NotificationEntitlements";
  tenantId: string;
  email: { enabled: boolean; monthlyLimit?: number };
  whatsapp: { enabled: boolean };
  planVersion: number;
  validUntil?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function notificationEntitlementsKey(tenantId: string): { PK: string; SK: "ENTITLEMENTS" } {
  return { PK: `TENANT#${tenantId}#NOTIFICATION`, SK: "ENTITLEMENTS" };
}

/** Default free-plan entitlement, seeded at organization creation (`CreateOrganizationService`,
 * PENDING_PROTOCOL_REVIEW — see decisions-log.md). Before this, NO tenant ever had this record
 * (real, synthetic, or dev) - `routeNotificationIntent`'s `entitlement.emailEnabled === undefined`
 * check (`notification-router.ts`) fails closed WITH RETRY, so every reminder for every tenant
 * retried forever and never reached a delivery attempt. `email.enabled: true` with no
 * `monthlyLimit` (the field is declared but not read/enforced anywhere yet - no artificial cap
 * invented here) unblocks the product's core value prop (email reminders) with no billing
 * dependency (D-052 blocked). `whatsapp.enabled: false` regardless of plan - WhatsApp needs its
 * own legal clearance (E-019) independent of any entitlement default chosen here. */
export function defaultNotificationEntitlements(tenantId: string, now: string): NotificationEntitlements {
  return {
    ...notificationEntitlementsKey(tenantId),
    entityType: "NotificationEntitlements",
    tenantId,
    email: { enabled: true },
    whatsapp: { enabled: false },
    planVersion: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
