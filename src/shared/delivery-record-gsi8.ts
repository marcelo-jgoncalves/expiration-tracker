/**
 * MaintenanceDueIndex (GSI8) pure helpers for the 2 entities purged by `delivery-record-purge`
 * (D-152/D-179/D-18x, 8th of 9 workers) — `NotificationIntent`
 * (`src/modules/reminder/domain/notification-intent.ts`) and `NotificationAttempt`
 * (`src/modules/notification/domain/notification-attempt.ts`). Lives in `src/shared/` — not
 * either module's own `domain/` — because the 2 entities span 2 different modules (`reminder`,
 * `notification`), same reasoning as `security-audit-gsi8.ts`'s shared home. Never imports from
 * `src/modules/**`, so `dependency-cruiser`'s `shared-must-not-reach-modules` rule holds
 * trivially.
 *
 * Both entities are never updated after creation in practice (no undelete path, no status
 * transition named in `purge.ts`'s own docs) — the GSI8 pointer is written EXACTLY ONCE, at
 * creation, at each of the 3 real write sites (`reminder-dispatch/dispatch.ts`,
 * `notification/application/notification-router-workflow.ts`'s `applyStaleDecision`/
 * `applyRoutedDecision`), never a separate write. No terminal-state transition exists that could
 * leave a stale pointer behind — same "no self-heal branch" shape as `security-audit-gsi8.ts`.
 */
export const DELIVERY_RECORD_PURGE_WORK_TYPE = "DELIVERY_RECORD";
export const DELIVERY_RECORD_RETENTION_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DeliveryRecordGsi8EntityType = "NotificationIntent" | "NotificationAttempt";

export interface DeriveDeliveryRecordMaintenanceDueInput {
  createdAt: string;
}

export interface DeliveryRecordMaintenanceDue {
  /** `createdAt + DELIVERY_RECORD_RETENTION_DAYS` — NEVER `undefined`: every delivery record
   * eventually ages out on a fixed retention clock regardless of any deletion action (unlike
   * `CORE_USER_DATA`'s `deletedAt`-gated eligibility), so `createdAt` alone always determines
   * a due date. */
  dueAtIso: string;
}

export function deriveDeliveryRecordMaintenanceDue(input: DeriveDeliveryRecordMaintenanceDueInput): DeliveryRecordMaintenanceDue {
  return { dueAtIso: new Date(Date.parse(input.createdAt) + DELIVERY_RECORD_RETENTION_DAYS * MS_PER_DAY).toISOString() };
}

/** `GSI8PK=WORK#DELIVERY_RECORD` / `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>` —
 * identical shape to `securityAuditGsi8Keys()`: neither entity has an id separate from its own
 * `SK`, so the row's own `SK` is embedded verbatim to keep the pointer unique per row and the
 * `KEYS_ONLY` projection self-sufficient (no extra read needed to parse `tenantId`/`entityType`
 * back out for the tenant-ACTIVE `ConditionCheck`). */
export function deliveryRecordGsi8Keys(input: {
  dueAtIso: string;
  tenantId: string;
  entityType: DeliveryRecordGsi8EntityType;
  sk: string;
}): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${DELIVERY_RECORD_PURGE_WORK_TYPE}`,
    GSI8SK: `${input.dueAtIso}#TENANT#${input.tenantId}#${input.entityType}#${input.sk}`,
  };
}
