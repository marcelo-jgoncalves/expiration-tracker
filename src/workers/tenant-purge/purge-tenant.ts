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
 *    version-listing phase reached `versionsDone`; DynamoDB/session-table: no thrown error) — a
 *    caller may safely advance the tenant lifecycle past `PURGING`.
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
import { purgeTenantDynamoItems, type DynamoTenantPurgeDeps, type DynamoTenantPurgeResult } from "./dynamo-tenant-purge.js";
import { purgeTenantSessions, type SessionTableTenantPurgeDeps, type SessionTableTenantPurgeResult } from "./session-table-tenant-purge.js";
import { purgeS3TenantPrefix, type S3TenantPurgeDeps, type S3TenantPurgeResult, type S3TenantPurgeCheckpoint } from "./s3-tenant-purge.js";

export interface TenantS3Target {
  bucket: string;
  /** Tenant-owned key prefix within `bucket` — e.g. `${tenantId}/` for quarantine/clean/import,
   * `ocr/${tenantId}/` for the extraction bucket (see `s3-ocr-artifact-store.ts`'s key
   * convention). Caller supplies the already-built prefix so this module stays agnostic of any
   * one module's exact key layout. */
  prefix: string;
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

export async function purgeTenant(deps: TenantPurgeDeps, input: { tenantId: string; startFrom?: TenantPurgeCheckpoint }): Promise<TenantPurgeResult> {
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

  if (anyS3Unresolved) {
    return { status: "PARTIAL", tenantId: input.tenantId, dynamo: dynamoResult, sessionTable: sessionResult, s3: s3Results, checkpoint };
  }

  return { status: "SUCCESS", tenantId: input.tenantId, dynamo: dynamoResult, sessionTable: sessionResult, s3: s3Results };
}
