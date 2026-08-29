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
import { InternalError, TenantNotActiveError } from "../errors/app-error.js";
import { tenantLifecycleKey, TENANT_ACTIVE_STATUS } from "./tenant-lifecycle-record.js";

/**
 * Best-effort cross-validation that every entry the caller asks this lane to fence is actually
 * scoped to the `tenantId` the lane fences against (W3-07 Codex round-1 review, D-072 —
 * `TenantBusinessMutation` previously trusted `input.tenantId` blindly, so a caller bug passing
 * `tenantId: A` with entries actually built for tenant B would silently commit under A's fence).
 *
 * This does NOT prove the entry's item belongs to the fenced tenant — it only cross-checks two
 * independent, cheap signals against the fenced `tenantId`, either of which alone is bypassable
 * but which together close the specific gap D-075 flagged as the most serious remaining one
 * ("declared tenantId matches, but the physical PK/TableName point elsewhere"):
 *
 * 1. A `tenantId` value the CALLER already put into the entry, at a fixed convention `occ.ts`'s
 *    builders read/write from: `buildVersionedCreate`/`buildConditionalPut` read it from
 *    `Item.tenantId` (these builders do NOT themselves add/require a `tenantId`, they pass
 *    through whatever `item` the caller supplies verbatim; the convention exists only because
 *    every real call site in this codebase happens to already populate it, not because the
 *    builder enforces it); `buildVersionedUpdate`/`buildVersionedDelete` read it from
 *    `ExpressionAttributeValues[":tenantId"]` (these DO always populate it themselves, from
 *    `input.tenantId`, since it is baked into their own base condition — a real, structural
 *    guarantee for Update/Delete that Put/Create does not share).
 * 2. The entry's own `TableName` (must equal `input.tableName` — a `TransactWriteItems` call can
 *    mix table names per-entry, so nothing upstream of this lane otherwise proves every entry
 *    targets the table the fence's own `ConditionCheck` is written against) and its physical
 *    key's `PK` (`Item.PK` for Put, `Key.PK` for Update/Delete/ConditionCheck) — every tenant-
 *    scoped entity in this codebase's data model keys its `PK` as `TENANT#<tenantId>#...`
 *    (verified against every domain key-builder in `src/modules/**\/domain/*.ts` and
 *    `src/shared/{idempotency,outbox,tenant-lifecycle}` as of this check's introduction — see
 *    `docs/architecture/w3-07-writer-inventory.md`). When a `PK` matches that shape, the tenant
 *    segment it encodes MUST equal `input.tenantId`, independent of whatever `Item.tenantId`/
 *    `:tenantId` claims — this is the check that catches a `Put` whose `Item.tenantId` was
 *    forged/copy-pasted to match the fence while its `PK` genuinely targets another tenant's key
 *    space, which check 1 alone cannot see. A handful of legitimate global/cross-tenant entities
 *    exist in this codebase (`IDENTITY#cognitoSub#...`, `GUESTTOKEN#...`, `SESSION#...`,
 *    `LOGINATTEMPT#...`, `TEXTRACTJOB#...`) that are NOT `TENANT#`-prefixed by design — no current
 *    call site routes one of these through `TenantBusinessMutation` (verified by the same review),
 *    so a `PK` that does not match `TENANT#<id>#...` at all is intentionally left unchecked here
 *    rather than rejected, to avoid this lane guessing at a convention it does not own.
 *
 * `ConditionCheck` entries participate in the `PK`-based check (their `Key.PK` is inspected same
 * as Update/Delete) but not the declared-`tenantId` check — `buildExistenceConditionCheck`/
 * `buildVersionConditionCheck` have no `tenantId` convention, and forcing one would be a false
 * requirement, not a real safety property.
 *
 * Net: still not a full structural proof (an entry with NO `TENANT#`-prefixed `PK` and no
 * declared `tenantId` — e.g. a hypothetical future global entity mistakenly routed through this
 * lane — passes through unchecked; see the dedicated test for that residual case), but it now
 * catches BOTH the "declared tenantId is wrong" bug AND the "declared tenantId lies, physical key
 * tells the truth" attack the original best-effort check could not see. Closing the last residual
 * gap fully would need a branded tenant-scoped entry type ordinary `TransactWriteEntry` values
 * cannot satisfy, or making `PK`-prefix membership mandatory for every entity — larger, Type 1
 * changes, deferred exactly as documented in `decisions-log.md`.
 */
function entryTableName(entry: TransactWriteEntry): string {
  if ("Put" in entry) return entry.Put.TableName;
  if ("Update" in entry) return entry.Update.TableName;
  if ("Delete" in entry) return entry.Delete.TableName;
  return entry.ConditionCheck.TableName;
}

function entryPk(entry: TransactWriteEntry): string | undefined {
  const pk = "Put" in entry ? (entry.Put.Item as { PK?: unknown }).PK : "Update" in entry ? entry.Update.Key.PK : "Delete" in entry ? entry.Delete.Key.PK : entry.ConditionCheck.Key.PK;
  return typeof pk === "string" ? pk : undefined;
}

const TENANT_PK_PREFIX = /^TENANT#([^#]+)#/;

function findTenantMismatch(entries: TransactWriteEntry[], tenantId: string, tableName: string): string | undefined {
  for (const entry of entries) {
    if (entryTableName(entry) !== tableName) return `TableName=${entryTableName(entry)}`;

    if ("Put" in entry) {
      const declared = (entry.Put.Item as { tenantId?: unknown }).tenantId;
      if (typeof declared === "string" && declared !== tenantId) return declared;
    } else if ("Update" in entry) {
      const declared = entry.Update.ExpressionAttributeValues?.[":tenantId"];
      if (typeof declared === "string" && declared !== tenantId) return declared;
    } else if ("Delete" in entry) {
      const declared = entry.Delete.ExpressionAttributeValues?.[":tenantId"];
      if (typeof declared === "string" && declared !== tenantId) return declared;
    }
    // ConditionCheck: no declared-tenantId convention to check (see doc above) - falls through
    // to the PK-based check below same as every other entry kind.

    const pk = entryPk(entry);
    if (pk !== undefined) {
      const match = TENANT_PK_PREFIX.exec(pk);
      if (match && match[1] !== tenantId) return `PK=${pk}`;
    }
  }
  return undefined;
}

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

  const mismatch = findTenantMismatch(input.entries, input.tenantId, input.tableName);
  if (mismatch !== undefined) {
    throw new InternalError(
      "TenantBusinessMutation entry does not match the fenced tenantId (declared tenantId, TableName, or PK diverges) — refusing to write.",
      { fencedTenantId: input.tenantId, mismatch },
    );
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
      //
      // W3-07 D-072 item 4 hardening (2026-08-29, extended after a follow-up Codex review found
      // the first pass only guarded non-array shapes, not a malformed element WITHIN an array):
      // absent, non-array, too-short, or malformed-element `CancellationReasons` all fall back to
      // the SAME conservative "treat as fence failed" classification - never a crash, and never
      // silently treated as "the fence definitely did not fail" just because the shape at the
      // fence's own index doesn't look like what real DynamoDB sends. Real AWS DynamoDB always
      // sends a full array (one entry per TransactItem, `{ Code: "None" }` for non-causing
      // entries) with a string `Code` on every element - this only matters for a hypothetical
      // broken/stripped adapter, confirmed against the SDK docs during the original design review.
      const rawReasons = (err as { CancellationReasons?: unknown }).CancellationReasons;
      const fenceIndex = input.entries.length;
      const fenceReason = Array.isArray(rawReasons) ? (rawReasons as unknown[])[fenceIndex] : undefined;
      const fenceReasonCode =
        typeof fenceReason === "object" && fenceReason !== null && typeof (fenceReason as { Code?: unknown }).Code === "string"
          ? (fenceReason as { Code: string }).Code
          : undefined;
      const fenceFailed = !Array.isArray(rawReasons) || fenceReasonCode === undefined || fenceReasonCode === "ConditionalCheckFailed";
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
