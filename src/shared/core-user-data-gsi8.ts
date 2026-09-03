/**
 * MaintenanceDueIndex (GSI8) pure helpers for the 2 entities purged by `core-user-data-purge`
 * (D-151/D-179/D-190, 9th and LAST of 9 workers) — `ExpirationItem`
 * (`src/modules/expiration/domain/expiration-item.ts`) and `ReminderPolicy`
 * (`src/modules/reminder/domain/reminder-policy.ts`). Lives in `src/shared/` — not either
 * module's own `domain/` — because the 2 entities span 2 different modules (`expiration`,
 * `reminder`), same reasoning as `delivery-record-gsi8.ts`'s shared home.
 *
 * Unlike `delivery-record-gsi8.ts` (fixed `createdAt`-based clock, always due eventually),
 * eligibility here is gated on a `deletedAt` TRANSITION: a row is NOT a candidate at all until
 * `deletedAt` gets set by its owning write path (soft-delete), at which point the
 * `RETENTION_DAYS` clock starts. `deriveCoreUserDataMaintenanceDue()` returns `undefined` when
 * `deletedAt` is absent — the caller must never write a GSI8 pointer for a row that hasn't been
 * soft-deleted yet.
 *
 * Known write-path status (confirmed by a broad `deletedAt` grep across `src/`, task brief
 * step 4): `ExpirationItem.deletedAt` is set at exactly one site today —
 * `expiration-service.ts#deleteItem` (via `transitionStatus`'s `extraSet`) — which is where the
 * GSI8 pointer write is wired. `ReminderPolicy.deletedAt` has NO live write path anywhere in the
 * codebase today (`disablePolicy` only ever sets `enabled: false`, never `deletedAt` — see that
 * method's own doc comment on why the pointer is deliberately left untouched there). This is a
 * PRE-EXISTING condition, not introduced by this migration: the pre-GSI8 `Scan`-based worker
 * had the identical gap (its `attribute_exists(deletedAt)` filter on `ReminderPolicy` could never
 * match either, for the same reason). This module still derives/keys `ReminderPolicy` uniformly
 * with `ExpirationItem` so the day a real soft-delete path is added for it, wiring the pointer
 * write is a one-line call into `reminderPolicyMaintenanceDueGsi8Keys` style helpers below — no
 * further shared-module change needed.
 */
export const CORE_USER_DATA_PURGE_WORK_TYPE = "CORE_USER_DATA";
export const CORE_USER_DATA_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CoreUserDataGsi8EntityType = "ExpirationItem" | "ReminderPolicy";

export interface DeriveCoreUserDataMaintenanceDueInput {
  deletedAt: string | undefined;
}

export interface CoreUserDataMaintenanceDue {
  /** `deletedAt + CORE_USER_DATA_RETENTION_DAYS`. `undefined` when `deletedAt` itself is
   * `undefined` — a row not yet soft-deleted is never a candidate, unlike
   * `delivery-record-gsi8.ts`'s always-due-eventually shape. */
  dueAtIso: string | undefined;
}

export function deriveCoreUserDataMaintenanceDue(input: DeriveCoreUserDataMaintenanceDueInput): CoreUserDataMaintenanceDue {
  if (!input.deletedAt) return { dueAtIso: undefined };
  return { dueAtIso: new Date(Date.parse(input.deletedAt) + CORE_USER_DATA_RETENTION_DAYS * MS_PER_DAY).toISOString() };
}

/** `GSI8PK=WORK#CORE_USER_DATA` / `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>` —
 * identical shape to `deliveryRecordGsi8Keys()`. Only called once `dueAtIso` is known (i.e. after
 * `deriveCoreUserDataMaintenanceDue()` returned a defined value) — never called for a row that
 * isn't soft-deleted. */
export function coreUserDataGsi8Keys(input: {
  dueAtIso: string;
  tenantId: string;
  entityType: CoreUserDataGsi8EntityType;
  sk: string;
}): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${CORE_USER_DATA_PURGE_WORK_TYPE}`,
    GSI8SK: `${input.dueAtIso}#TENANT#${input.tenantId}#${input.entityType}#${input.sk}`,
  };
}
