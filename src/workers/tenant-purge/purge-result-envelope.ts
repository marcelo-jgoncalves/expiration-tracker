/**
 * W3-07 purge orchestrator (D-124, implementing D-121's approved design — Rodada 3 Fix 6).
 *
 * Why this projection exists at all: `TenantPurgeResult.s3` is `S3TenantPurgeResult[]`, and each
 * entry's `unresolvedErrors: S3DeleteError[]` is genuinely unbounded (one entry per failed
 * `DeleteObjects` call, `{key, versionId, code, message}` each). Step Functions caps a task's
 * input/output at 256 KiB, so returning the raw result from the `RunPurge` Task would make a
 * large tenant's purge fail as an opaque `States.DataLimitExceeded` instead of converging or
 * surfacing as BLOCKED. `TenantPurgeCheckpoint` itself is NOT the risk (it only carries pagination
 * markers, bounded regardless of tenant size), so it crosses the boundary unchanged.
 *
 * Nothing is lost: the FULL `TenantPurgeResult`, every `unresolvedErrors` entry included, is still
 * emitted through `SecureLogger` by the handler that calls this (`AGENTS.md` §7) — it just never
 * round-trips through Step Functions state, which was never meant to carry unbounded diagnostic
 * detail.
 */
import type { TenantPurgeCheckpoint, TenantPurgeResult, TenantPurgeStatus } from "./purge-tenant.js";

export interface TenantPurgeEnvelope {
  status: TenantPurgeStatus;
  /** Unchanged from the raw result — already bounded (pagination markers only). Explicitly `null`
   * rather than absent when there is none: the ASL's RunPurge ResultSelector reads this by
   * JSONPath, and a reference to a MISSING path is a hard States.Runtime failure, not a null. Same
   * reason `failure` below is never simply omitted. */
  checkpoint: TenantPurgeCheckpoint | null;
  /** Aggregated counts, never the underlying unbounded arrays. Present even on SUCCESS (all
   * zeroes) so the ASL never has to distinguish "absent" from "zero". */
  counters: {
    s3UnresolvedCount: number;
    dynamoRejectedCount: number;
    sessionRejectedCount: number;
  };
  /** Already small by construction (one stage discriminator + one message string). */
  failure: NonNullable<TenantPurgeResult["failure"]> | null;
}

export function toTenantPurgeEnvelope(result: TenantPurgeResult): TenantPurgeEnvelope {
  const s3UnresolvedCount = result.s3.reduce((sum, target) => sum + target.unresolvedErrors.length, 0);
  return {
    status: result.status,
    checkpoint: result.checkpoint ?? null,
    counters: {
      s3UnresolvedCount,
      dynamoRejectedCount: result.dynamo?.itemsRejectedBySafetyCondition ?? 0,
      sessionRejectedCount: result.sessionTable?.sessionsRejectedBySafetyCondition ?? 0,
    },
    failure: result.failure ?? null,
  };
}
