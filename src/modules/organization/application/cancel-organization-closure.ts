/**
 * CancelOrganizationClosureService — D-127 (quarantine/recovery window,
 * `docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`, round-2
 * Fix 3 "caminho de resolução próprio, não o RequestContext normal").
 *
 * The real cancellation path for a tenant closure still inside its 30-day `HELD_FOR_RECOVERY`
 * window. Deliberately NOT built on `RequestContextResolver`/`resolveWorkingOrganization()` — a
 * tenant in `HELD_FOR_RECOVERY` is, by construction, not `ACTIVE`, and every normal resolution
 * path in this codebase requires `TenantLifecycleRecord.status === ACTIVE`
 * (`resolve-request-context.ts`). Building a `RequestContext` for this action is not merely
 * inconvenient, it is structurally impossible on the normal path, so this service reads
 * `IdentityMapping` -> `GlobalUser` -> `Membership` directly (the same three rows
 * `resolveActiveMembership()` ultimately reads, just without the ACTIVE-lifecycle gate baked in)
 * and calls `authorizeCancelClosure()` — never `authorize()` — for the same reason.
 *
 * `StopExecution` runs BEFORE any restoration write and is load-bearing: restoring `ACTIVE` first
 * would let a `TenantBusinessMutation` land while the Step Functions execution is still alive and
 * could advance `HELD_FOR_RECOVERY -> DELETING` (deadline firing) at any moment — a genuine race
 * between "tenant is usable again" and "tenant is about to be purged". Stopping the execution
 * first removes that race entirely: once `StopExecution` is confirmed, nothing else can advance
 * the lifecycle record for this attempt, so the OCC-fenced `HELD_FOR_RECOVERY -> ACTIVE` write
 * that follows is racing nothing but a already-lost cause (see `close()` re-read handling below).
 */
import { authorizeCancelClosure } from "../../identity/domain/authorization.js";
import { AuthenticationError, NotFoundError, OrganizationClosureUnavailableError } from "../../../shared/errors/app-error.js";
import {
  SystemMutationConflictError,
  transitionTenantLifecycle,
  type SystemMutationStore,
} from "../../../shared/tenant-lifecycle/system-mutation.js";
import type { TenantLifecycleRecord } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { TenantPurgeExecutionStopper } from "../../../shared/tenant-lifecycle/tenant-purge-execution-stopper.js";
import { identityMappingKey, type IdentityMapping } from "../../identity/persistence/identity-mapping-repository.js";
import { globalUserKey, type GlobalUser } from "../../identity/persistence/global-user-repository.js";
import { membershipKey } from "../domain/membership.js";
import type { Membership } from "../domain/membership.js";

/** Strongly-consistent single-row reader — the minimal surface this service needs from whatever
 * physical store backs identity/organization rows (in production, the same DynamoDB table
 * `IdentityStore`/`OrganizationStore` already point at). Kept as its own narrow port (rather than
 * depending on either module's full store interface) so this service's dependency footprint is
 * exactly what it reads, nothing more. */
export interface ConsistentKeyValueReader {
  get<T>(key: { PK: string; SK: string }): Promise<T | undefined>;
}

export interface TenantLifecycleReader {
  read(tenantId: string): Promise<TenantLifecycleRecord | undefined>;
}

export interface CancelOrganizationClosureInput {
  /** Cognito `sub` claim — already signature/expiry-validated by the API Gateway authorizer,
   * same trust boundary `resolve-request-context.ts` documents for `ValidatedClaims.sub`. */
  cognitoSub: string;
  tenantId: string;
}

export interface CancelOrganizationClosureResult {
  tenantId: string;
  status: "ACTIVE";
}

export class CancelOrganizationClosureService {
  constructor(
    private readonly reader: ConsistentKeyValueReader,
    private readonly lifecycle: TenantLifecycleReader,
    private readonly store: SystemMutationStore,
    private readonly stopper: TenantPurgeExecutionStopper,
    private readonly tableName: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async cancel(input: CancelOrganizationClosureInput): Promise<CancelOrganizationClosureResult> {
    const { cognitoSub, tenantId } = input;

    // 1. Dedicated identity resolution — IdentityMapping -> GlobalUser -> Membership, never
    // RequestContextResolver (see file header).
    const mapping = await this.reader.get<IdentityMapping>(identityMappingKey(cognitoSub));
    if (!mapping) {
      throw new AuthenticationError("No identity mapping for this credential.");
    }
    const user = await this.reader.get<GlobalUser>(globalUserKey(mapping.userId));
    if (!user) {
      throw new AuthenticationError("GlobalUser missing for an existing IdentityMapping.", { userId: mapping.userId });
    }
    const membership = await this.reader.get<Membership>(membershipKey(tenantId, mapping.userId));
    if (!membership) {
      throw new NotFoundError("No membership for this user in this organization.", { organizationId: tenantId });
    }

    // 2. Dedicated authorization primitive — never authorize().
    authorizeCancelClosure({
      identityStatus: user.identityStatus,
      membershipStatus: membership.status,
      membershipRole: membership.role,
    });

    // 3. Accept EXCLUSIVELY HELD_FOR_RECOVERY — any other lifecycle status is refused outright,
    // never silently treated as "nothing to cancel" (which would hide a genuinely stale/expired
    // cancellation attempt from the caller).
    const record = await this.lifecycle.read(tenantId);
    if (!record) {
      throw new NotFoundError("Organization lifecycle record not found.", { organizationId: tenantId });
    }
    if (record.status !== "HELD_FOR_RECOVERY") {
      throw new OrganizationClosureUnavailableError(
        "This organization is not currently in a cancellable recovery window.",
        { organizationId: tenantId, status: record.status },
      );
    }
    if (!record.executionArn || !record.closureAttemptId) {
      // Genuinely unexpected: every ACTIVE -> HELD_FOR_RECOVERY transition stamps
      // closureAttemptId, and CloseOrganizationService's own unconditional StartExecution+attach
      // idiom means executionArn is only transiently absent (repaired by the next close() retry
      // or the sweeper) — surfacing this as "unavailable" rather than guessing at a StopExecution
      // target is the fail-closed choice.
      throw new OrganizationClosureUnavailableError(
        "This organization's closure attempt has no execution attached yet - retry shortly.",
        { organizationId: tenantId, status: record.status },
      );
    }

    // 4. StopExecution BEFORE any write — see file header. A failure here fails the whole
    // cancellation (nothing changes, safe to retry) rather than ever restoring ACTIVE with the
    // execution potentially still alive.
    await this.stopper.stopExecution({ executionArn: record.executionArn });

    // 5. Only now, OCC-fenced against the exact version read above: if the deadline fired (or
    // anything else moved the record) between steps 3 and 5, this fails with
    // SystemMutationConflictError instead of silently reporting success over a tenant that is
    // actually already advancing toward DELETING.
    try {
      await transitionTenantLifecycle({
        store: this.store,
        tableName: this.tableName,
        tenantId,
        from: "HELD_FOR_RECOVERY",
        to: "ACTIVE",
        expectedVersion: record.version,
        now: this.now,
      });
    } catch (err) {
      if (err instanceof SystemMutationConflictError) {
        throw new OrganizationClosureUnavailableError(
          "The recovery window closed (or was already cancelled) before this request completed - the execution was stopped, but the organization could not be reactivated.",
          { organizationId: tenantId },
        );
      }
      throw err;
    }

    return { tenantId, status: "ACTIVE" };
  }
}
