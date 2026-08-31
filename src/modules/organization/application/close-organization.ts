/**
 * CloseOrganizationService — W3-07 purge orchestrator (D-124, implementing D-121's approved
 * design, Rodada 2 Fix 1 with Rodada 3 Fix 8's corrected step ordering).
 *
 * The single real trigger surface for tenant deletion: moves the tenant's `TenantLifecycleRecord`
 * `ACTIVE -> DELETING` and launches the tenant-purge Step Functions execution that drives every
 * remaining transition. Before this service existed, both `transitionTenantLifecycle` and
 * `purgeTenant()` were real, working, and completely unreachable — nothing in production ever
 * called either.
 *
 * Step ordering is load-bearing and was corrected during the design protocol (Rodada 3 Fix 8): the
 * terminal-state check runs BEFORE the unconditional `StartExecution`, not after. Rodada 2's
 * original wording implied any post-`ACTIVE` status should trigger a fresh launch, which would
 * have re-launched executions for VERIFIED/DELETED/BLOCKED/HELD tenants — states where a purge
 * execution is either finished or deliberately parked awaiting an operator.
 *
 * `StartExecution` IS called unconditionally for the genuinely in-flight states
 * (`DELETING`/`QUIESCING`/`PURGING`), including when this call performed no write at all. That is
 * the established `start-extraction-run.ts` idiom, not an oversight: gating the launch on "did I
 * just write the record" orphans the tenant forever whenever the DynamoDB transition commits but
 * the subsequent `StartExecution` fails transiently — the record would sit in DELETING with no
 * execution behind it, and every retry would skip the launch because the write already happened.
 * Step Functions' own name-based uniqueness (`name: tenantId`) is what makes calling it every
 * time safe.
 */
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { OrganizationClosureUnavailableError, NotFoundError } from "../../../shared/errors/app-error.js";
import { SystemMutationConflictError, transitionTenantLifecycle, type SystemMutationStore } from "../../../shared/tenant-lifecycle/system-mutation.js";
import type { TenantLifecycleRecord, TenantLifecycleStatus } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { TenantPurgeExecutionStarter } from "../../../shared/tenant-lifecycle/tenant-purge-execution-starter.js";

/** Same narrow read contract the orchestrator's transition handler uses — `ConsistentRead: true`
 * is mandatory, since this read produces the `expectedVersion` the OCC-fenced transition below is
 * conditioned on. */
export interface TenantLifecycleReader {
  read(tenantId: string): Promise<TenantLifecycleRecord | undefined>;
}

/** States where a purge is either already finished or parked awaiting a human — closing is
 * refused outright rather than re-launched. Named "unavailable", not "terminal": an operator can
 * still remediate BLOCKED/HELD (`tenant-lifecycle-record.ts`), so these are not all true terminal
 * states. */
const CLOSURE_UNAVAILABLE_STATUSES: ReadonlySet<TenantLifecycleStatus> = new Set(["VERIFIED", "DELETED", "BLOCKED", "HELD"]);

/** The genuinely in-flight states — a close() call landing here performs no write and only
 * repeats the idempotent launch. */
const IN_FLIGHT_STATUSES: ReadonlySet<TenantLifecycleStatus> = new Set(["DELETING", "QUIESCING", "PURGING"]);

export interface CloseOrganizationResult {
  tenantId: string;
  status: TenantLifecycleStatus;
  /** False when the record was already DELETING+ and this call only repeated the launch. */
  transitioned: boolean;
}

export class CloseOrganizationService {
  constructor(
    private readonly store: SystemMutationStore,
    private readonly reader: TenantLifecycleReader,
    private readonly executions: TenantPurgeExecutionStarter,
    private readonly tableName: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async close(ctx: RequestContext): Promise<CloseOrganizationResult> {
    const tenantId = ctx.tenant.tenantId;
    authorize({ context: ctx, action: "organization:close", resource: { tenantId } });

    const record = await this.reader.read(tenantId);
    if (!record) {
      throw new NotFoundError("Organization lifecycle record not found.", { organizationId: tenantId });
    }
    if (CLOSURE_UNAVAILABLE_STATUSES.has(record.status)) {
      throw new OrganizationClosureUnavailableError(undefined, { organizationId: tenantId, status: record.status });
    }

    let transitioned = false;
    if (record.status === "ACTIVE") {
      try {
        await transitionTenantLifecycle({
          store: this.store,
          tableName: this.tableName,
          tenantId,
          from: "ACTIVE",
          to: "DELETING",
          expectedVersion: record.version,
          now: this.now,
        });
        transitioned = true;
      } catch (err) {
        if (!(err instanceof SystemMutationConflictError)) throw err;
        // A concurrent close() (double-click, retried request) won the race. Re-read once: if the
        // record legitimately landed on an in-flight state, this call simply joins that closure
        // and proceeds to the shared idempotent launch below. Anything else — still ACTIVE, or
        // raced into a stuck state — is genuinely unexpected and is not papered over.
        const after = await this.reader.read(tenantId);
        if (!after || !IN_FLIGHT_STATUSES.has(after.status)) throw err;
      }
    } else if (!IN_FLIGHT_STATUSES.has(record.status)) {
      // Exhaustiveness guard: ACTIVE, the 4 unavailable states, and the 3 in-flight states cover
      // every TenantLifecycleStatus. Reaching here means a status was added without deciding what
      // closing should do with it — fail loudly rather than silently launching an execution.
      throw new OrganizationClosureUnavailableError(undefined, { organizationId: tenantId, status: record.status });
    }

    await this.executions.startExecution({ name: tenantId, input: { tenantId } });

    return { tenantId, status: transitioned ? "DELETING" : record.status, transitioned };
  }
}
