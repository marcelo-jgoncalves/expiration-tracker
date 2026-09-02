/**
 * Narrow port for the MembershipPurgeWorker (D-127, `docs/architecture/reviews/
 * quarantine-retention-scoping/estado-final-consolidado.md` Prioridade 5 — `ACCOUNT_ACTIVE
 * (não-fechamento)` = `Invitation`→`Membership`→`Channel`). D-155 implemented `Invitation` only —
 * `Membership` was blocked because `status = REMOVED` never recorded a timestamp. D-158 added
 * `Membership.removedAt` (set by `remove-membership.ts`/`leave-organization.ts`, cleared on
 * reactivation by `accept-invitation.ts`), unblocking this worker. `Channel` remains genuinely out
 * of scope — no persisted `Channel` entity exists; the closest candidate, `NotificationPreferences`,
 * has no terminal state of its own and depends on the same clock this worker now has, but joining
 * against it is a separate, un-approved design decision, not implemented here (see D-155's
 * decisions-log entry for the full investigation, unchanged by this worker).
 *
 * Single terminal-state branch: `status = REMOVED AND removedAt + 30 days <= now`. `ACTIVE`/
 * `SUSPENDED` rows are never candidates — `SUSPENDED` is reversible, not a termination.
 *
 * Same full-table `Scan` tradeoff as D-151..D-156 (filtered by `entityType = "Membership"`, not a
 * GSI worklist) — no external side-effect to protect with a claim state.
 */
import type { DynamoDeleteCommandInput, EntityKey } from "../../shared/dynamodb/occ.js";
import type { MembershipStatus } from "../../modules/organization/domain/membership.js";

export interface MembershipPurgeCandidate extends EntityKey {
  entityType: "Membership";
  organizationId: string;
  status: MembershipStatus;
  removedAt?: string;
  version: number;
}

export interface MembershipPurgeScanPage {
  items: MembershipPurgeCandidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface MembershipPurgeCandidateSource {
  /** `Scan` with `FilterExpression: entityType = :membership AND #status = :removed AND
   * attribute_exists(removedAt)` — the `attribute_exists` guard is belt-and-suspenders against a
   * pre-D-158 `REMOVED` row that predates the field (never happened in `dev`, kept anyway since
   * `dev` is reseedable and reused across sessions). */
  scanCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<MembershipPurgeScanPage>;
  /** Single conditioned `DeleteItem` (version-checked via `buildConditionalDelete`, same choice
   * as `Invitation` in D-155 — `Membership` carries `organizationId`, not `tenantId`, so
   * `buildVersionedDelete`'s required attribute name doesn't fit). Throws the SDK's real
   * `ConditionalCheckFailedException` (recognized via `occ.ts#isConditionalCheckFailed`) when the
   * condition doesn't hold. */
  deleteCandidate(input: DynamoDeleteCommandInput): Promise<void>;
}

/**
 * Same ACTIVE-tenant fence as every other purge worker in this family — a tenant mid-closure is
 * the W3-07 tenant-purge pipeline's job, never this worker's; structurally this worker can never
 * touch a closing tenant's rows because its own fence excludes anything not `ACTIVE`.
 */
export interface TenantLifecycleStatusSource {
  getStatus(tenantId: string): Promise<string | undefined>;
}
