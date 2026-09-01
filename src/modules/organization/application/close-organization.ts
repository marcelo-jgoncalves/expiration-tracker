/**
 * CloseOrganizationService — W3-07 purge orchestrator (D-124, implementing D-121's approved
 * design, Rodada 2 Fix 1 with Rodada 3 Fix 8's corrected step ordering), extended by D-127
 * (quarantine/recovery window, `docs/architecture/reviews/quarantine-retention-scoping/
 * estado-final-consolidado.md`).
 *
 * The single real trigger surface for tenant deletion: moves the tenant's `TenantLifecycleRecord`
 * `ACTIVE -> HELD_FOR_RECOVERY` (was `ACTIVE -> DELETING` pre-D-127 — the 30-day quarantine is now
 * the first hop, not `DELETING`) and launches the SAME tenant-purge Step Functions execution that
 * drives every remaining transition, now starting with a 30-day `Wait` before anything physical
 * happens. Before D-124 this service existed, both `transitionTenantLifecycle` and
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
 * (`HELD_FOR_RECOVERY`/`DELETING`/`QUIESCING`/`PURGING`), including when this call performed no
 * write at all. That is the established `start-extraction-run.ts` idiom, not an oversight: gating
 * the launch on "did I just write the record" orphans the tenant forever whenever the DynamoDB
 * transition commits but the subsequent `StartExecution` fails transiently — the record would sit
 * with no execution behind it, and every retry would skip the launch because the write already
 * happened. Step Functions' own name-based uniqueness is what makes calling it every time safe —
 * D-127 changed the name from the bare `tenantId` to `${tenantId}-${closureAttemptId}` (see
 * `tenant-lifecycle-record.ts`'s `closureAttemptId` field doc for why: a second close() after a
 * REAL cancellation must never collide with the prior, by-then-stopped execution's name).
 *
 * `attachTenantPurgeExecutionArn` runs AFTER `StartExecution` succeeds, best-effort: a failure or
 * a lost race there (the attempt already moved on) is swallowed, never surfaced to the HTTP
 * caller — the ARN is a repair/cancellation convenience (`CancelOrganizationClosureService`,
 * the sweeper's reconciliation), not load-bearing for the purge pipeline itself, and every retry
 * of `close()` naturally re-attempts it via the same unconditional-call idiom as `StartExecution`.
 */
import { randomUUID } from "node:crypto";
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { OrganizationClosureUnavailableError, NotFoundError } from "../../../shared/errors/app-error.js";
import {
  SystemMutationConflictError,
  transitionTenantLifecycle,
  attachTenantPurgeExecutionArn,
  type SystemMutationStore,
} from "../../../shared/tenant-lifecycle/system-mutation.js";
import type { TenantLifecycleRecord, TenantLifecycleStatus } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { TenantPurgeExecutionStarter } from "../../../shared/tenant-lifecycle/tenant-purge-execution-starter.js";

const RECOVERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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
 * repeats the idempotent launch. D-127: `HELD_FOR_RECOVERY` joins this set (design finding 4 —
 * without it, a repeated close() after `ACTIVE -> HELD_FOR_RECOVERY` commits but `StartExecution`
 * fails would fall into `CLOSURE_UNAVAILABLE_STATUSES`'s exhaustiveness guard below and
 * permanently strand the tenant in quarantine with no execution driving it out). */
const IN_FLIGHT_STATUSES: ReadonlySet<TenantLifecycleStatus> = new Set(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING"]);

export interface CloseOrganizationResult {
  tenantId: string;
  status: TenantLifecycleStatus;
  /** False when the record was already HELD_FOR_RECOVERY+ and this call only repeated the launch. */
  transitioned: boolean;
}

export class CloseOrganizationService {
  constructor(
    private readonly store: SystemMutationStore,
    private readonly reader: TenantLifecycleReader,
    private readonly executions: TenantPurgeExecutionStarter,
    private readonly tableName: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newClosureAttemptId: () => string = randomUUID,
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
    let closureAttemptId = record.closureAttemptId;
    if (record.status === "ACTIVE") {
      closureAttemptId = this.newClosureAttemptId();
      const recoveryDeadline = new Date(Date.parse(this.now()) + RECOVERY_WINDOW_MS).toISOString();
      try {
        await transitionTenantLifecycle({
          store: this.store,
          tableName: this.tableName,
          tenantId,
          from: "ACTIVE",
          to: "HELD_FOR_RECOVERY",
          expectedVersion: record.version,
          recoveryDeadline,
          closureAttemptId,
          now: this.now,
        });
        transitioned = true;
      } catch (err) {
        if (!(err instanceof SystemMutationConflictError)) throw err;
        // A concurrent close() (double-click, retried request) won the race. Re-read once: if the
        // record legitimately landed on an in-flight state, this call simply joins that closure
        // and proceeds to the shared idempotent launch below (using the WINNING call's
        // closureAttemptId, never the one this call generated and lost the race with). Anything
        // else — still ACTIVE, or raced into a stuck state — is genuinely unexpected and is not
        // papered over.
        const after = await this.reader.read(tenantId);
        if (!after || !IN_FLIGHT_STATUSES.has(after.status)) throw err;
        closureAttemptId = after.closureAttemptId;
      }
    } else if (!IN_FLIGHT_STATUSES.has(record.status)) {
      // Exhaustiveness guard: ACTIVE, the 4 unavailable states, and the 4 in-flight states cover
      // every TenantLifecycleStatus. Reaching here means a status was added without deciding what
      // closing should do with it — fail loudly rather than silently launching an execution.
      throw new OrganizationClosureUnavailableError(undefined, { organizationId: tenantId, status: record.status });
    }

    if (!closureAttemptId) {
      // Unreachable in practice (every path above either just minted one or re-read a record that
      // must have one, since only ACTIVE -> HELD_FOR_RECOVERY ever creates the in-flight states
      // this branch is reached from) — fail loudly rather than starting an execution with a name
      // that silently degrades to the pre-D-127 bare-tenantId shape.
      throw new OrganizationClosureUnavailableError(undefined, { organizationId: tenantId, status: record.status });
    }

    const { executionArn } = await this.executions.startExecution({ name: `${tenantId}-${closureAttemptId}`, input: { tenantId } });
    // Best-effort, never surfaced to the caller — see file header for why a lost race or a
    // transient failure here is safe to swallow.
    try {
      await attachTenantPurgeExecutionArn({ store: this.store, tableName: this.tableName, tenantId, closureAttemptId, executionArn, now: this.now });
    } catch {
      // Swallowed deliberately — see file header. The next close() retry (or the sweeper) repairs it.
    }

    return { tenantId, status: transitioned ? "HELD_FOR_RECOVERY" : record.status, transitioned };
  }
}
