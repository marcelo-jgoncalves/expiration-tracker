/**
 * Narrow port for the InvitationPurgeWorker (D-155, `docs/architecture/reviews/
 * quarantine-retention-scoping/estado-final-consolidado.md` Prioridade 5 — `ACCOUNT_ACTIVE
 * (não-fechamento)` = `Invitation`→`Membership`→`Channel`). **This worker's real scope is
 * `Invitation` ONLY** — see `purge.ts`'s file header and D-155's decisions-log entry for the full
 * investigation of why `Membership` and `Channel` are NOT implemented here (both blocked on a
 * missing eligibility timestamp, not out of scope by design).
 *
 * `Invitation` (`src/modules/organization/domain/invitation.ts`) has 4 declared statuses but only
 * 3 are ever actually written: `PENDING` (created), `ACCEPTED` (`accept-invitation.ts`, leads to
 * an active `Membership` — success, never a termination, out of this worker's scope entirely),
 * `REVOKED` (`revoke-invitation.ts`, sets `revokedAt`). **`EXPIRED` is declared in
 * `InvitationStatus` but NO code path ever transitions a row to it** — a `PENDING` invitation
 * whose `expiresAt` has passed simply stays `PENDING` forever with no purge/expiry mechanism
 * (confirmed by reading every writer of `Invitation.status` in `src/modules/organization/
 * application/`: only `create-invitation.ts`, `accept-invitation.ts`, `revoke-invitation.ts`
 * touch it). This worker therefore treats "PENDING past its own `expiresAt`" as the de-facto
 * `EXPIRED` terminal state the design doc's "non-closure termination" concept describes, using
 * `expiresAt` itself as the termination timestamp (there is no separate `expiredAt` field to add,
 * and none is needed — `expiresAt` is already the exact instant the row became terminal).
 *
 * Two independent terminal-state branches, either makes a row a candidate:
 *   - `status = REVOKED` — eligible when `revokedAt + 30 days <= now`.
 *   - `status = PENDING AND expiresAt <= now` — eligible when `expiresAt + 30 days <= now`.
 * `ACCEPTED` rows are never candidates (that Invitation's terminal state is success, not
 * termination — the resulting `Membership` is the durable record now, per `privacy-lgpd.md` §4's
 * own `ACCOUNT_ACTIVE` framing).
 *
 * Same full-table `Scan` tradeoff as D-151/152/153/154 (filtered by `entityType = "Invitation"`,
 * not a GSI6 worklist) — no external side-effect to protect with a claim state.
 */
import type { DynamoDeleteCommandInput, EntityKey } from "../../shared/dynamodb/occ.js";
import type { InvitationStatus } from "../../modules/organization/domain/invitation.js";

export interface InvitationPurgeCandidate extends EntityKey {
  entityType: "Invitation";
  organizationId: string;
  status: InvitationStatus;
  expiresAt: string;
  revokedAt?: string;
  version: number;
}

export interface InvitationPurgeScanPage {
  items: InvitationPurgeCandidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface InvitationPurgeCandidateSource {
  /** `Scan` with `FilterExpression: entityType = :invitation AND (#status = :revoked OR #status =
   * :pending)` — `ACCEPTED` rows are excluded at the scan itself, never even considered a
   * candidate (see file header). */
  scanCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<InvitationPurgeScanPage>;
  /** Single conditioned `DeleteItem` (version-checked — `Invitation` DOES carry a `version`
   * counter, unlike D-153/D-154's entities, so the delete re-asserts it directly instead of
   * re-asserting a domain field observed at scan time). Throws the SDK's real
   * `ConditionalCheckFailedException` (recognized via `occ.ts#isConditionalCheckFailed`) when the
   * condition doesn't hold. */
  deleteCandidate(input: DynamoDeleteCommandInput): Promise<void>;
}

/**
 * Same ACTIVE-tenant fence as D-151/152/153/154's `TenantLifecycleStatusSource` — a tenant
 * mid-closure is the W3-07 tenant-purge pipeline's job, never this worker's; structurally this
 * worker can never touch a closing tenant's rows because its own fence excludes anything not
 * `ACTIVE`. Deliberately the same narrow shape (not re-exported/shared), mirroring the
 * precedents' own choice to keep each purge worker's port surface independently readable.
 */
export interface TenantLifecycleStatusSource {
  getStatus(tenantId: string): Promise<string | undefined>;
}
