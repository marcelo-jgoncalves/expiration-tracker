/**
 * `purgeTenant` — W3-07 (this session): the single composable entry point that runs every
 * sub-purge (main-table DynamoDB, bff-session-table, and every tenant-owned S3 prefix) for one
 * tenant. Structured so a future orchestrator (Step Functions state, or a Lambda it invokes) can
 * call this directly to actually drive the `PURGING` stage of
 * `ACTIVE -> DELETING -> QUIESCING -> PURGING -> VERIFIED -> DELETED` — that orchestrator/trigger
 * wiring is NOT built this session (see `NEXT_SESSION_PROMPT.md`); this function is real, callable,
 * working code today, not a stub.
 *
 * Result semantics (never silently swallow a partial failure as success, per this session's
 * explicit requirement): `status` is
 *  - `"SUCCESS"` iff every sub-purge fully converged (S3: zero `unresolvedErrors` and the
 *    version-listing phase reached `versionsDone`; DynamoDB/session-table: zero safety-condition
 *    rejections) AND an unconditional final re-scan/re-list of every store (dynamo, session
 *    table, every S3 target — see `verifyTenant*Empty` calls below, added for review finding B2)
 *    finds nothing remaining — a caller may safely advance the tenant lifecycle past `PURGING`.
 *  - `"PARTIAL"` iff every sub-purge ran without throwing, but at least one did not fully
 *    converge (an S3 prefix still has `unresolvedErrors`, or its version phase never finished
 *    convergence). The returned `checkpoint` lets the SAME call be retried/resumed later.
 *  - `"FAILED"` iff a sub-purge threw an exception this function did not expect and could not
 *    recover from (a bug or an unrecoverable infra failure, distinct from an ordinary S3
 *    `Errors[]` partial failure, which is `PARTIAL` not `FAILED`). The already-completed
 *    checkpoint fields are still returned so a retry can skip finished work.
 *
 * Idempotent as a whole: every sub-purge module documents its own idempotency (see their file
 * headers) — re-running `purgeTenant` for the same tenant, with or without a checkpoint, never
 * errors on already-purged state; it converges to the same terminal result.
 */
import { purgeTenantDynamoItems, verifyTenantDynamoPurgeEmpty, type DynamoTenantPurgeDeps, type DynamoTenantPurgeResult } from "./dynamo-tenant-purge.js";
import { purgeTenantSessions, verifyTenantSessionsEmpty, type SessionTableTenantPurgeDeps, type SessionTableTenantPurgeResult } from "./session-table-tenant-purge.js";
import { purgeS3TenantPrefix, verifyS3TenantPrefixEmpty, type S3TenantPurgeDeps, type S3TenantPurgeResult, type S3TenantPurgeCheckpoint } from "./s3-tenant-purge.js";

export interface TenantS3Target {
  bucket: string;
  /** Tenant-owned key prefix within `bucket` — MUST start with one of `TENANT_PREFIX_ROOTS`
   * below followed by this exact tenantId (enforced by `prefixBelongsToTenant`, see B6): either
   * `clean/${tenantId}/` (clean-key.ts), `tenant/${tenantId}/` (quarantine-key.ts,
   * import-raw-key.ts, and submission-quarantine-key.ts all share this root), or
   * `ocr/${tenantId}/` (s3-ocr-artifact-store.ts). Caller supplies the already-built prefix so
   * this module stays agnostic of any one module's exact key layout beyond this shared root.
   *
   * KNOWN LIMIT (Codex round 5 finding, non-blocking, 2026-08-29): `prefixBelongsToTenant` checks
   * the prefix shape against the tenant, but NOT that a given root is the one actually used by
   * `bucket` (e.g. `{ bucket: "clean", prefix: "tenant/t1/" }` — a quarantine-shaped prefix — still
   * passes today, even though no real key builder ever writes that combination). This does not
   * reopen cross-tenant deletion (the prefix still must belong to the SAME tenant being purged),
   * but a future real composition root/orchestrator should build each bucket's target from a
   * closed per-bucket table (bucket -> its one real root), not accept an arbitrary
   * `{bucket, prefix}` pairing — not fixed here because no such composition root exists yet (see
   * `NEXT_SESSION_PROMPT.md`). */
  prefix: string;
  /**
   * The tenant this target is claimed to belong to — MUST equal `purgeTenant`'s
   * `input.tenantId` for every target (checked in `purgeTenant`, see B6). W3-07 review finding
   * (Codex round on the purge pipeline, B6, 2026-08-29): the previous shape let
   * `purgeTenant()` accept `{bucket, prefix}` targets with no binding to the tenant actually
   * being purged at all — a caller/composition-root bug (wrong tenant's prefix passed in) would
   * physically delete the WRONG tenant's S3 objects with no structural check catching it. This
   * field, plus the assertion in `purgeTenant`, makes that class of bug fail loudly instead of
   * silently.
   */
  tenantId: string;
}

export interface TenantPurgeCheckpoint {
  dynamoStartAfter?: Record<string, unknown>;
  dynamoDone?: boolean;
  sessionTableStartAfter?: Record<string, unknown>;
  sessionTableDone?: boolean;
  /** Keyed by `${bucket}#${prefix}` (matches `TenantS3Target` order — see `s3TargetKey`). */
  s3?: Record<string, S3TenantPurgeCheckpoint>;
}

export interface TenantPurgeDeps {
  dynamo: Omit<DynamoTenantPurgeDeps, "onCheckpoint">;
  sessionTable: Omit<SessionTableTenantPurgeDeps, "onCheckpoint">;
  s3Source: S3TenantPurgeDeps["source"];
  s3Targets: TenantS3Target[];
  onCheckpoint?: (checkpoint: TenantPurgeCheckpoint) => Promise<void>;
}

export type TenantPurgeStatus = "SUCCESS" | "PARTIAL" | "FAILED";

export interface TenantPurgeResult {
  status: TenantPurgeStatus;
  tenantId: string;
  dynamo?: DynamoTenantPurgeResult;
  sessionTable?: SessionTableTenantPurgeResult;
  s3: S3TenantPurgeResult[];
  /** Populated only when `status !== "SUCCESS"` — everything needed to resume. */
  checkpoint?: TenantPurgeCheckpoint;
  /** Set when `status === "FAILED"` — the error that stopped this run before every sub-purge
   * could even be attempted (an S3 partial failure alone never sets this; that is `PARTIAL`). */
  failure?: { stage: "DYNAMO" | "SESSION_TABLE" | "S3"; message: string };
}

function s3TargetKey(target: TenantS3Target): string {
  return `${target.bucket}#${target.prefix}`;
}

/**
 * W3-07 review finding (Codex round 2 on the purge pipeline, B6 residual, 2026-08-29): the
 * original B6 fix only compared `target.tenantId` against `purgeTenant`'s own `input.tenantId` —
 * both are caller-supplied labels, so a composition-root bug that mislabels a WRONG tenant's
 * prefix with the RIGHT tenantId (e.g. `{ prefix: "tenant-b/", tenantId: "tenant-a" }` while
 * purging `"tenant-a"`) sailed straight through and would physically delete tenant B's objects.
 * Unlike the DynamoDB/session-table paths (whose safety condition checks the ACTUAL stored
 * `tenantId` attribute on the item, not a caller claim), S3 objects carry no such attribute to
 * check against — the key-prefix convention itself (`${tenantId}/` or `ocr/${tenantId}/`, see
 * `TenantS3Target.prefix`'s doc comment) is the only signal available. This asserts the tenantId
 * being purged actually appears as a full path segment inside `prefix` (not just a substring —
 * `escapeForPathSegmentRegExp` deliberately rejects e.g. tenantId `"12"` being satisfied by a real
 * prefix for tenant `"123"`), independent of whatever `target.tenantId` claims.
 *
 * W3-07 review finding (Codex round 3, 2026-08-29): the first version of this function accepted
 * the tenantId segment at the very END of `prefix` too (`(/|$)`), reasoning about `prefix` as a
 * path string — but S3 `ListObjectVersions`/`DeleteObjects` match by RAW BYTE PREFIX, not path
 * segment. A prefix like `"tenant/tenant-a"` (no trailing `/`) would pass the old check for
 * tenantId `"tenant-a"`, yet S3 would also purge `tenant/tenant-a2/...` and `tenant/tenant-a-b/...`
 * — a different tenant's objects, deleted because their key merely starts with the same bytes.
 *
 * W3-07 review finding (Codex round 4, 2026-08-29): requiring a trailing `/` after the segment
 * was still not enough — "tenantId appears as a `/`-delimited segment ANYWHERE in `prefix`" also
 * accepted a prefix genuinely ROOTED under a DIFFERENT tenant's namespace, e.g.
 * `"tenant/tenant-b/item/tenant-a/"` for tenantId `"tenant-a"` (purging tenant-a would then
 * physically delete tenant-b's objects). The property actually needed is stronger: the tenantId
 * must anchor the START of `prefix`, at one of the specific tenant-owned root shapes this
 * codebase's key builders actually produce — verified by reading every one directly:
 * `clean-key.ts` (`clean/<tenantId>/...`), `quarantine-key.ts`/`import-raw-key.ts`/
 * `submission-quarantine-key.ts` (all three: `tenant/<tenantId>/...` — same root across the
 * quarantine, import, and subject-submission-quarantine buckets), and `s3-ocr-artifact-store.ts`
 * (`ocr/<tenantId>/...`). `TENANT_PREFIX_ROOTS` is a closed list, same philosophy as
 * `system-mutation.ts`'s `SystemMutationOperation` union: a future bucket/key convention needs a
 * new root added here explicitly, a small reviewable diff, not an open-ended pattern a caller bug
 * could route around. An empty `tenantId` is rejected outright before any pattern is built.
 */
function escapeForPathSegmentRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TENANT_PREFIX_ROOTS = ["clean/", "tenant/", "ocr/"] as const;

function prefixBelongsToTenant(prefix: string, tenantId: string): boolean {
  if (tenantId.length === 0) return false;
  const escapedTenantId = escapeForPathSegmentRegExp(tenantId);
  return TENANT_PREFIX_ROOTS.some((root) => new RegExp(`^${root}${escapedTenantId}/`).test(prefix));
}

/** Thrown when a caller hands `purgeTenant` an S3 target claiming a different tenant than the
 * one being purged (B6) — fails loudly before any deletion happens, rather than silently
 * purging the wrong tenant's objects. */
export class TenantPurgeTargetMismatchError extends Error {
  constructor(target: TenantS3Target, tenantId: string) {
    super(
      `purgeTenant("${tenantId}") was given an S3 target claiming tenantId "${target.tenantId}" (bucket "${target.bucket}", prefix "${target.prefix}") — refusing to purge a target not bound to the tenant being purged.`,
    );
    this.name = "TenantPurgeTargetMismatchError";
  }
}

export async function purgeTenant(deps: TenantPurgeDeps, input: { tenantId: string; startFrom?: TenantPurgeCheckpoint }): Promise<TenantPurgeResult> {
  // B6: verify every S3 target is actually bound to the tenant being purged BEFORE any
  // sub-purge runs — a caller/composition-root bug here must never result in a different
  // tenant's data being deleted. Two independent checks, neither sufficient alone (see
  // `prefixBelongsToTenant`'s doc comment for why the label alone was not enough): the
  // caller-supplied label must match, AND the tenantId must actually appear as a path segment
  // in the prefix itself.
  for (const target of deps.s3Targets) {
    if (target.tenantId !== input.tenantId || !prefixBelongsToTenant(target.prefix, input.tenantId)) {
      throw new TenantPurgeTargetMismatchError(target, input.tenantId);
    }
  }

  const checkpoint: TenantPurgeCheckpoint = { ...input.startFrom, s3: { ...input.startFrom?.s3 } };
  const s3Results: S3TenantPurgeResult[] = [];

  let dynamoResult: DynamoTenantPurgeResult | undefined;
  if (!checkpoint.dynamoDone) {
    try {
      dynamoResult = await purgeTenantDynamoItems(
        {
          ...deps.dynamo,
          onCheckpoint: async (lastEvaluatedKey) => {
            checkpoint.dynamoStartAfter = lastEvaluatedKey;
            if (deps.onCheckpoint) await deps.onCheckpoint({ ...checkpoint });
          },
        },
        { tenantId: input.tenantId, startAfter: checkpoint.dynamoStartAfter },
      );
      checkpoint.dynamoDone = true;
      checkpoint.dynamoStartAfter = undefined;
    } catch (err) {
      return { status: "FAILED", tenantId: input.tenantId, s3: s3Results, checkpoint, failure: { stage: "DYNAMO", message: err instanceof Error ? err.message : String(err) } };
    }
  }

  let sessionResult: SessionTableTenantPurgeResult | undefined;
  if (!checkpoint.sessionTableDone) {
    try {
      sessionResult = await purgeTenantSessions(
        {
          ...deps.sessionTable,
          onCheckpoint: async (lastEvaluatedKey) => {
            checkpoint.sessionTableStartAfter = lastEvaluatedKey;
            if (deps.onCheckpoint) await deps.onCheckpoint({ ...checkpoint });
          },
        },
        { tenantId: input.tenantId, startAfter: checkpoint.sessionTableStartAfter },
      );
      checkpoint.sessionTableDone = true;
      checkpoint.sessionTableStartAfter = undefined;
    } catch (err) {
      return { status: "FAILED", tenantId: input.tenantId, dynamo: dynamoResult, s3: s3Results, checkpoint, failure: { stage: "SESSION_TABLE", message: err instanceof Error ? err.message : String(err) } };
    }
  }

  let anyS3Unresolved = false;
  for (const target of deps.s3Targets) {
    const key = s3TargetKey(target);
    const startFrom = checkpoint.s3?.[key];
    try {
      const result: S3TenantPurgeResult = await purgeS3TenantPrefix(
        {
          source: deps.s3Source,
          onCheckpoint: async (cp) => {
            checkpoint.s3 = { ...checkpoint.s3, [key]: cp };
            if (deps.onCheckpoint) await deps.onCheckpoint({ ...checkpoint });
          },
        },
        { bucket: target.bucket, prefix: target.prefix, startFrom },
      );
      s3Results.push(result);
      checkpoint.s3 = { ...checkpoint.s3, [key]: result.checkpoint };
      if (result.unresolvedErrors.length > 0 || !result.checkpoint.versionsDone) anyS3Unresolved = true;
    } catch (err) {
      return {
        status: "FAILED",
        tenantId: input.tenantId,
        dynamo: dynamoResult,
        sessionTable: sessionResult,
        s3: s3Results,
        checkpoint,
        failure: { stage: "S3", message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  // W3-07 review finding (Codex round on the purge pipeline, B4, 2026-08-29): a nonzero
  // `itemsRejectedBySafetyCondition` means at least one candidate row failed PURGE_DELETE's
  // safety ConditionExpression (a scan/filter bug, a foreign row, or — since B3's fix — an
  // attempted delete of the lifecycle tombstone). That disproves convergence just as surely as
  // an unresolved S3 error; this function used to ignore the counter entirely and could return
  // SUCCESS with tenant-owned (or protected) rows still physically present.
  const dynamoUnresolved = (dynamoResult?.itemsRejectedBySafetyCondition ?? 0) > 0;
  const sessionUnresolved = (sessionResult?.sessionsRejectedBySafetyCondition ?? 0) > 0;

  // W3-07 review finding (Codex round on the purge pipeline, B2, 2026-08-29): the approved
  // design requires convergence be proven by an empty re-scan, not just "the purge loop's own
  // pages ran out" — the latter is especially unsafe on a RESUMED run, where a persisted
  // `dynamoDone`/`sessionTableDone`/`versionsDone` from an earlier pass used to make this
  // function skip straight to SUCCESS without ever looking again. Run all three verification
  // passes UNCONDITIONALLY here (whether the phase above ran fresh this call or was skipped via
  // checkpoint) — they are cheap (should return empty pages immediately in the success case) and
  // are the only thing that actually proves the tenant's namespace converged to zero, per design
  // §K ("re-scan vazio após a última deleção, não uma única varredura").
  const dynamoVerify = await verifyTenantDynamoPurgeEmpty(deps.dynamo, input.tenantId);
  const sessionVerify = await verifyTenantSessionsEmpty(deps.sessionTable, input.tenantId);
  const s3Verify = await Promise.all(
    deps.s3Targets.map((target) => verifyS3TenantPrefixEmpty({ source: deps.s3Source }, { bucket: target.bucket, prefix: target.prefix })),
  );
  const verificationFoundRemainder =
    dynamoVerify.remainingItems > 0 ||
    sessionVerify.remainingSessions > 0 ||
    s3Verify.some((v) => v.remainingVersions > 0 || v.remainingMultipartUploads > 0);

  if (anyS3Unresolved || dynamoUnresolved || sessionUnresolved || verificationFoundRemainder) {
    return { status: "PARTIAL", tenantId: input.tenantId, dynamo: dynamoResult, sessionTable: sessionResult, s3: s3Results, checkpoint };
  }

  return { status: "SUCCESS", tenantId: input.tenantId, dynamo: dynamoResult, sessionTable: sessionResult, s3: s3Results };
}
