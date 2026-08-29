/**
 * TenantBusinessMutation lane — W3-07 (D-067), approved design's "fence estrutural único"
 * (`docs/architecture/reviews/w3-07-tenant-fence-round3-active-only-design/
 * claude-analysis-active-only-fence.md` §F.1/§L/§Q roadmap item 2).
 *
 * The single supported way for a tenant-scoped business mutation to commit: it appends a
 * `ConditionCheck` against `TenantLifecycleRecord.status = ACTIVE` to the caller's own
 * `TransactWriteItems` entries and submits them together, atomically, via
 * `shared/dynamodb/occ.ts`'s existing `buildExistenceConditionCheck` builder — never a
 * hand-written `ConditionExpression`, never a parallel transaction-execution path.
 *
 * Concurrency contract (approved design §Q, Round E, endorsed by Codex): "ACTIVE->DELETING
 * blocks new admissions; operations already admitted atomically before the transition may
 * finish." The linearization point is THIS call's own TransactWriteItems commit, not the
 * instant any external effect (Textract/Bedrock/SES/S3) is later triggered by the caller —
 * callers that gate an external effect on this lane must treat "this transaction committed"
 * as the admission fact, not "the tenant was ACTIVE when I read it earlier".
 *
 * Scope note (this session, W3-07 chunk 2/N): this is the executor itself plus one proof-of-
 * concept call site (`ItemWatchService.removeWatcher`, see NEXT_SESSION_PROMPT.md for which
 * other writers still need migrating). The full structural boundary the approved design
 * calls for (an architecture test / ESLint rule that makes `store.transactWrite([...])`
 * un-callable directly from business modules, forcing every tenant mutation through this
 * function) is `Q` roadmap item 3 and is NOT implemented yet — today this lane is enforced by
 * convention only, the same interim state the design doc's roadmap explicitly separates from
 * item 2 (this file).
 */
import { buildExistenceConditionCheck, isTransactionCanceled, type TransactWriteEntry } from "../dynamodb/occ.js";
import { TenantNotActiveError } from "../errors/app-error.js";
import { tenantLifecycleKey, TENANT_ACTIVE_STATUS } from "./tenant-lifecycle-record.js";

/** Minimal surface this lane needs from a store - both IdentityStore and ExpirationStore
 * (and any future module's port) satisfy this structurally, since they share the same
 * physical single-table design and the same `transactWrite(entries)` shape from occ.ts. */
export interface TenantMutationStore {
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}

export interface TenantBusinessMutationInput {
  store: TenantMutationStore;
  tableName: string;
  tenantId: string;
  /** The caller's own TransactWriteItems entries (Put/Update/Delete/ConditionCheck) built
   * via occ.ts's builders — this lane only APPENDS the lifecycle fence, it never inspects or
   * rewrites these. Must be non-empty (a fence with no actual mutation is a no-op that would
   * silently swallow a caller bug). */
  entries: TransactWriteEntry[];
}

/**
 * Commits `entries` plus a `ConditionCheck` asserting `TenantLifecycleRecord.status =
 * ACTIVE` for `tenantId`, in the SAME TransactWriteItems call. Throws `TenantNotActiveError`
 * (never the raw `TransactionCanceledException`) when the fence specifically is what failed
 * so callers can distinguish "tenant is being deleted" from an ordinary OCC version conflict
 * on their own entries — callers that need to tell the two apart should check
 * `err.details?.tenantId` is populated, or inspect `CancellationReasons` on the underlying
 * SDK error themselves (this lane does not yet thread `CancellationReasons` through in typed
 * form — a documented gap, see the file header's scope note and `Q` roadmap item 2's
 * "CancellationReasons tipado" obligation, deferred to the writer-migration chunk that will
 * actually need to distinguish per-entry causes for compensation).
 */
export async function executeTenantBusinessMutation(input: TenantBusinessMutationInput): Promise<void> {
  if (input.entries.length === 0) {
    throw new TenantNotActiveError("TenantBusinessMutation called with zero entries — nothing to fence.", {
      tenantId: input.tenantId,
    });
  }

  const fence = buildExistenceConditionCheck({
    tableName: input.tableName,
    key: tenantLifecycleKey(input.tenantId),
    extra: { status: TENANT_ACTIVE_STATUS },
  });

  try {
    await input.store.transactWrite([...input.entries, fence]);
  } catch (err) {
    if (isTransactionCanceled(err)) {
      // The fence is always appended LAST, so its CancellationReasons index is
      // input.entries.length. Real DynamoDB's TransactionCanceledException always populates
      // CancellationReasons (one entry per TransactItem, "None" for entries that were not the
      // cause) - inspecting it lets callers whose own entry can independently fail an OCC/
      // create-race condition (e.g. TenantQuotaService.consume()'s retry loop) tell that apart
      // from "the tenant is being deleted" instead of every cancellation collapsing into
      // TenantNotActiveError, which would make an ordinary concurrent-write conflict
      // unretriable. Closes the "CancellationReasons tipado" gap this file's header used to
      // note as deferred (W3-07 writer-migration chunk, quota.consume() being the writer that
      // actually needed the distinction).
      const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
      const fenceIndex = input.entries.length;
      const fenceFailed = !reasons || reasons[fenceIndex]?.Code === "ConditionalCheckFailed";
      if (fenceFailed) {
        throw new TenantNotActiveError("Tenant is not ACTIVE; mutation rejected.", { tenantId: input.tenantId });
      }
    }
    throw err;
  }
}

/**
 * Discriminated-result sibling of `executeTenantBusinessMutation` for callers that already run
 * their own bounded OCC-retry loop (finalizer/malware-result workers, `advance-after-evidence.ts`
 * and its submission sibling — W3-07 chunk 6/N) and need to distinguish three outcomes without a
 * try/catch at every call site: committed; lost an ordinary OCC race on the caller's own entries
 * (retry, same as before this lane existed); or the lifecycle fence itself rejected the mutation
 * (never retried — the tenant is being deleted). Same pattern `TenantQuotaService`'s private
 * `tryFencedWrite` established, promoted here so every writer with its own retry loop can reuse
 * it instead of re-deriving the try/catch dance.
 */
export type TenantBusinessMutationResult = { ok: true } | { ok: false; reason: "OCC_CONFLICT" } | { ok: false; reason: "TENANT_NOT_ACTIVE" };

export async function tryTenantBusinessMutation(input: TenantBusinessMutationInput): Promise<TenantBusinessMutationResult> {
  try {
    await executeTenantBusinessMutation(input);
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === "TenantNotActiveError") return { ok: false, reason: "TENANT_NOT_ACTIVE" };
    if (isTransactionCanceled(err)) return { ok: false, reason: "OCC_CONFLICT" };
    throw err;
  }
}
