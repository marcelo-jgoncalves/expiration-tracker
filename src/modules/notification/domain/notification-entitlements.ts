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
