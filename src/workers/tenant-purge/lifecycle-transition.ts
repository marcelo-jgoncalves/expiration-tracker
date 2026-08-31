/**
 * W3-07 purge orchestrator (D-124, implementing D-121's approved design — Rodada 2 Fix 3).
 *
 * The ONE transition handler behind all four forward `Task` states of the tenant-purge state
 * machine (`AdvanceToPurging`, `AdvanceToVerified`, `AdvanceToDeleted`, `MarkBlocked`) —
 * parameterized by `from`/`to` in each ASL state's own `Parameters`, deliberately not four
 * bespoke handlers (one contract to review, test and grant IAM to, per the approved design).
 *
 * Idempotency is the load-bearing property here, not a nicety: a Step Functions `Task` can be
 * retried after a Lambda timeout whose `TransactWriteItems` actually committed, so an invocation
 * that finds the record ALREADY at `to` must report success rather than throwing on its own
 * earlier success. Everything else — the record sitting at neither `from` nor `to` — is a genuine
 * unexpected state and throws, which is exactly where ASL's native `Catch` applies (unlike
 * `purgeTenant()`'s PARTIAL/SUCCESS/FAILED, which is a normal resolved value routed by a `Choice`;
 * see Rodada 2 Fix 2).
 */
import { SystemMutationConflictError, transitionTenantLifecycle, type SystemMutationStore } from "../../shared/tenant-lifecycle/system-mutation.js";
import type { TenantLifecycleRecord, TenantLifecycleStatus } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";

/** Narrow read port — `ConsistentRead` is mandatory (see `read`'s doc comment), so it is part of
 * the contract rather than left to each adapter's default. */
export interface TenantLifecycleReader {
  /**
   * MUST use `ConsistentRead: true`. This read produces the `expectedVersion` the OCC-fenced
   * transition below is conditioned on; an eventually-consistent read could hand back a stale
   * version and turn every ordinary transition into a spurious conflict retry.
   */
  read(tenantId: string): Promise<TenantLifecycleRecord | undefined>;
}

export interface LifecycleTransitionDeps {
  store: SystemMutationStore;
  reader: TenantLifecycleReader;
  tableName: string;
  now?: () => string;
}

export interface LifecycleTransitionInput {
  tenantId: string;
  from: TenantLifecycleStatus;
  to: TenantLifecycleStatus;
  /** Required by the SystemMutation lane when `to` is BLOCKED/HELD; ignored otherwise. */
  blockedReason?: string;
}

export interface LifecycleTransitionOutput {
  tenantId: string;
  status: TenantLifecycleStatus;
  /** True when this invocation found the record already at `to` and committed nothing — the
   * idempotent no-op branch. The ASL treats it exactly like a fresh advance. */
  alreadyAdvanced: boolean;
}

/** Thrown when the lifecycle record is at neither `from` nor `to` — a genuine unexpected state
 * (something else moved the tenant), never a retryable race. Surfaces to Step Functions as this
 * class name, which is what an ASL `Catch`'s `ErrorEquals` matches on. */
export class UnexpectedTenantLifecycleStateError extends Error {
  constructor(tenantId: string, expected: TenantLifecycleStatus, actual: TenantLifecycleStatus | "MISSING") {
    super(`Tenant "${tenantId}" lifecycle record is "${actual}", expected "${expected}" — refusing to transition.`);
    this.name = "UnexpectedTenantLifecycleStateError";
  }
}

export async function advanceTenantLifecycle(deps: LifecycleTransitionDeps, input: LifecycleTransitionInput): Promise<LifecycleTransitionOutput> {
  const record = await deps.reader.read(input.tenantId);
  if (!record) {
    throw new UnexpectedTenantLifecycleStateError(input.tenantId, input.from, "MISSING");
  }
  if (record.status === input.to) {
    return { tenantId: input.tenantId, status: input.to, alreadyAdvanced: true };
  }
  if (record.status !== input.from) {
    throw new UnexpectedTenantLifecycleStateError(input.tenantId, input.from, record.status);
  }

  try {
    await transitionTenantLifecycle({
      store: deps.store,
      tableName: deps.tableName,
      tenantId: input.tenantId,
      from: input.from,
      to: input.to,
      expectedVersion: record.version,
      ...(input.blockedReason ? { blockedReason: input.blockedReason } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
  } catch (err) {
    if (!(err instanceof SystemMutationConflictError)) throw err;
    // A concurrent writer won the OCC race. The only benign explanation is that it made the
    // SAME move we were about to make (a duplicate Task invocation), so re-read ONCE and accept
    // it only if the record actually landed on `to`. Anything else rethrows — this deliberately
    // never loops, so a genuinely contended record fails loudly instead of spinning.
    const after = await deps.reader.read(input.tenantId);
    if (after?.status === input.to) {
      return { tenantId: input.tenantId, status: input.to, alreadyAdvanced: true };
    }
    throw err;
  }

  return { tenantId: input.tenantId, status: input.to, alreadyAdvanced: false };
}
