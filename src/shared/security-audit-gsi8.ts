/**
 * MaintenanceDueIndex (GSI8) pure helpers for the 4 `AuditEvent`-family entities purged by
 * `security-audit-purge` (D-153/D-179/D-187, 6th of 9 workers). Lives in `src/shared/` — not any
 * single module's `domain/` — because the 4 entities this worker covers span 4 different modules
 * (`expiration`, `organization`, `subject`, `activity`); a shared, module-agnostic home avoids
 * picking one module as an arbitrary owner of a cross-module concern, same reasoning that already
 * put `EntityKey`/`TransactWriteEntry` in `shared/dynamodb/occ.ts`. Never imports from
 * `src/modules/**` (only string/date primitives), so `dependency-cruiser`'s
 * `shared-must-not-reach-modules` rule holds trivially.
 *
 * All 4 entities are append-only by construction (no `update()`/`delete()` anywhere) — the GSI8
 * pointer is written EXACTLY ONCE, at creation, inside each entity's own `build*Event()` function
 * (never a separate write), and is only ever removed by this worker's own delete of the whole row
 * (there is no terminal-state transition to clear it early, unlike Membership/Invitation).
 */
export const SECURITY_AUDIT_PURGE_WORK_TYPE = "SECURITY_AUDIT";
export const SECURITY_AUDIT_RETENTION_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SecurityAuditGsi8EntityType = "AuditEvent" | "MembershipAuditEvent" | "SubjectAuditEvent" | "TenantAuditEvent";

export interface DeriveSecurityAuditMaintenanceDueInput {
  occurredAt: string;
}

export interface SecurityAuditMaintenanceDue {
  /** `occurredAt + SECURITY_AUDIT_RETENTION_DAYS` — NEVER `undefined`: append-only rows have no
   * terminal state, `occurredAt` alone determines eligibility (same shape as D-186's
   * `deriveQuotaTelemetryMaintenanceDue`, different reason — token-bucket vs. append-only). */
  dueAtIso: string;
}

export function deriveSecurityAuditMaintenanceDue(input: DeriveSecurityAuditMaintenanceDueInput): SecurityAuditMaintenanceDue {
  return { dueAtIso: new Date(Date.parse(input.occurredAt) + SECURITY_AUDIT_RETENTION_DAYS * MS_PER_DAY).toISOString() };
}

/** `GSI8PK=WORK#SECURITY_AUDIT` / `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>` —
 * identical shape to `quotaTelemetryGsi8Keys()` (D-186): none of the 4 entities has an id separate
 * from its own `SK`, so the row's own `SK` is embedded verbatim to keep the pointer unique per
 * row and the `KEYS_ONLY` projection self-sufficient (no extra read needed to parse `tenantId`
 * back out for the tenant-ACTIVE `ConditionCheck`). */
export function securityAuditGsi8Keys(input: {
  dueAtIso: string;
  tenantId: string;
  entityType: SecurityAuditGsi8EntityType;
  sk: string;
}): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${SECURITY_AUDIT_PURGE_WORK_TYPE}`,
    GSI8SK: `${input.dueAtIso}#TENANT#${input.tenantId}#${input.entityType}#${input.sk}`,
  };
}
