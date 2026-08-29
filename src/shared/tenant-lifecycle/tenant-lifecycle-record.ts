/**
 * TenantLifecycleRecord — W3-07 tenant deletion fence (D-067, `docs/architecture/decisions-log.md`;
 * design approved via Claude<->Codex protocol, 9.2/9.1, `docs/architecture/reviews/
 * w3-07-tenant-fence-round3-active-only-design/claude-analysis-active-only-fence.md` §G/§H).
 *
 * A tombstone item that outlives the tenant's own data cascade — same pattern as
 * `IdentityMapping` (identity-mapping-repository.ts): it lives outside the normal purge
 * cascade permanently, because it is the one artifact that must survive to prove "this
 * tenant existed and was deleted" and to block first-login from silently reprovisioning a
 * deleted tenant (the root cause the design doc traces D-063's failure to).
 *
 * Lives under `src/shared/` (not `src/modules/identity/domain/`) deliberately: it is
 * consumed by `src/shared/tenant-lifecycle/tenant-business-mutation.ts`, a shared/
 * infrastructure-level fencing primitive every tenant-scoped business mutation across
 * modules will eventually route through — and `shared/**` must never import from
 * `modules/**` (`.dependency-cruiser.cjs`'s `shared-must-not-reach-modules` rule). Placing
 * the record's own domain type here, instead of in `identity/domain` with the lane
 * importing it back out, keeps the dependency direction modules -> shared intact.
 */
import type { EntityKey } from "../dynamodb/occ.js";

/**
 * Forward-only state machine (approved design §G):
 *   ACTIVE -> DELETING -> QUIESCING -> PURGING -> VERIFIED -> DELETED
 * Any of DELETING/QUIESCING/PURGING/VERIFIED can additionally move to BLOCKED/HELD (stuck
 * state — legal hold or a purge error that keeps failing) and back to the SAME state once
 * remediated. ACTIVE is never re-entered from any other state (no "un-delete") and DELETED
 * is a true terminal — nothing transitions out of it (the sweeper described in the design
 * doc repairs residue in place, it never re-opens the lifecycle record's status).
 */
export type TenantLifecycleStatus =
  | "ACTIVE"
  | "DELETING"
  | "QUIESCING"
  | "PURGING"
  | "VERIFIED"
  | "DELETED"
  | "BLOCKED"
  | "HELD";

export interface TenantLifecycleRecord extends EntityKey {
  SK: "LIFECYCLE";
  entityType: "TenantLifecycleRecord";
  tenantId: string;
  status: TenantLifecycleStatus;
  /** Set when entering BLOCKED/HELD and cleared on remediation back to the prior state — a
   * short machine-readable reason for the stuck state (e.g. "PURGE_S3_ERRORS",
   * "LEGAL_HOLD"), never free text containing tenant PII. */
  blockedReason?: string;
  /** The state BLOCKED/HELD was entered from, so remediation knows where to resume —
   * required whenever status is BLOCKED/HELD, absent otherwise. */
  blockedFrom?: TenantLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function tenantLifecycleKey(tenantId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#LIFECYCLE`, SK: "LIFECYCLE" };
}

/**
 * Statuses under which a `TenantBusinessMutation` may be admitted — deliberately just
 * `ACTIVE` (approved design §H invariant 1: "Nenhuma mutação de negócio tenant-scoped
 * commita em DynamoDB sem ConditionCheck de TenantLifecycleRecord.status = ACTIVE").
 */
export const TENANT_ACTIVE_STATUS: TenantLifecycleStatus = "ACTIVE";

/** Forward-only transition graph. A state maps to the set of states it may legally move to
 * next; BLOCKED/HELD's own allowed targets depend on `blockedFrom` (checked separately by
 * `canResumeFromBlocked`, since the graph itself can't express "return to wherever you came
 * from" as a fixed edge list). */
const FORWARD_TRANSITIONS: Record<TenantLifecycleStatus, ReadonlySet<TenantLifecycleStatus>> = {
  ACTIVE: new Set(["DELETING"]),
  DELETING: new Set(["QUIESCING", "BLOCKED", "HELD"]),
  QUIESCING: new Set(["PURGING", "BLOCKED", "HELD"]),
  PURGING: new Set(["VERIFIED", "BLOCKED", "HELD"]),
  VERIFIED: new Set(["DELETED", "BLOCKED", "HELD"]),
  DELETED: new Set([]),
  BLOCKED: new Set([]), // only canResumeFromBlocked() below, not a fixed forward edge
  HELD: new Set([]),
};

/**
 * True if `from -> to` is a legal forward transition, OR a remediation resume out of
 * BLOCKED/HELD back to the exact state it was blocked from. Never true for anything that
 * would re-enter ACTIVE or leave DELETED — those two guarantees are the entire point of
 * this fence (approved design §H invariant 4, §Q "no ACTIVE reversion, no DELETED
 * resurrection").
 */
export function canTransition(from: TenantLifecycleStatus, to: TenantLifecycleStatus, blockedFrom?: TenantLifecycleStatus): boolean {
  if (to === "ACTIVE") return false; // never re-enter ACTIVE from anywhere
  if (from === "DELETED") return false; // DELETED is terminal, nothing leaves it
  if ((from === "BLOCKED" || from === "HELD") && blockedFrom) {
    return to === blockedFrom;
  }
  return FORWARD_TRANSITIONS[from]?.has(to) ?? false;
}

export class InvalidTenantLifecycleTransitionError extends Error {
  constructor(
    public readonly from: TenantLifecycleStatus,
    public readonly to: TenantLifecycleStatus,
  ) {
    super(`Invalid TenantLifecycleRecord transition: ${from} -> ${to}`);
    this.name = "InvalidTenantLifecycleTransitionError";
  }
}

/** Throws InvalidTenantLifecycleTransitionError instead of returning false — for callers
 * (e.g. the future lifecycle-transition worker) that want a fail-fast assertion rather than
 * a boolean they must remember to check. */
export function assertValidTransition(from: TenantLifecycleStatus, to: TenantLifecycleStatus, blockedFrom?: TenantLifecycleStatus): void {
  if (!canTransition(from, to, blockedFrom)) {
    throw new InvalidTenantLifecycleTransitionError(from, to);
  }
}
