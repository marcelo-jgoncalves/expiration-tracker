/**
 * W3-07 purge orchestrator (D-124, implementing D-121's approved design — Rodada 2 Fix 5 plus
 * the durable-repair half of Fix 1).
 *
 * ONE recurring worker with TWO deliberately-unrelated responsibilities, folded together rather
 * than given a mechanism each — the approved design's explicit reasoning was that a third
 * recurring mechanism should not be invented when the sweeper already had to exist:
 *
 *  1. REPAIR (Fix 1's durable half). `CloseOrganizationService` calls `StartExecution`
 *     unconditionally on every invocation, which repairs the orphan case whenever the caller (or
 *     a retry of the same HTTP request) runs again — but nothing repairs the case where NO retry
 *     ever happens (browser closed, Lambda crashed outright). Any lifecycle record sitting in
 *     DELETING/QUIESCING/PURGING/VERIFIED whose `updatedAt` is older than one hour gets the same
 *     idempotent `StartExecution({name: tenantId})` again. One hour is comfortably past the
 *     already-approved 1800s quiescence bound (D-066), so this never fires against a healthy
 *     in-flight execution; when it does fire against one anyway, Step Functions' own name
 *     uniqueness makes it a no-op, which is why the starter port swallows `ExecutionAlreadyExists`.
 *
 *  2. POST-`DELETED` RESIDUAL VERIFICATION (D-066 Rodada H, 90-day window per `privacy-lgpd.md`).
 *     Re-runs the ALREADY-EXISTING `verifyTenant*Empty()` functions in isolation against tenants
 *     that already reached DELETED — no new verification logic is invented here, and nothing is
 *     deleted: this reports residue, it never re-opens a lifecycle record (DELETED is terminal,
 *     `tenant-lifecycle-record.ts`).
 *
 * Discovery for both halves is one `Scan` filtered to `SK = "LIFECYCLE"`. Explicit, accepted cost
 * tradeoff (not hidden): DynamoDB bills a Scan for every item read BEFORE the filter applies, so
 * this costs proportionally to total table size, not to the much smaller number of lifecycle
 * records. Accepted at this project's scale on the same proportionality argument `purgeTenant`'s
 * own Scan already makes; a sparse GSI keyed by lifecycle status is the named upgrade path and is
 * itself a separate level-5 decision, deliberately not smuggled in here.
 */
import type { TenantPurgeExecutionStarter } from "../../shared/tenant-lifecycle/tenant-purge-execution-starter.js";
import type { TenantLifecycleRecord, TenantLifecycleStatus } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { verifyTenantDynamoPurgeEmpty, type DynamoTenantPurgeDeps } from "./dynamo-tenant-purge.js";
import { verifyTenantSessionsEmpty, type SessionTableTenantPurgeDeps } from "./session-table-tenant-purge.js";
import { verifyS3TenantPrefixEmpty, type S3TenantPurgeDeps } from "./s3-tenant-purge.js";
import type { TenantS3Target } from "./purge-tenant.js";

/** Statuses that mean "this tenant should have a live purge execution driving it". BLOCKED/HELD
 * are deliberately absent: those are stuck states awaiting a human operator, and re-launching an
 * execution for them would fight the remediation rather than help it. */
const IN_FLIGHT_STATUSES: ReadonlySet<TenantLifecycleStatus> = new Set(["DELETING", "QUIESCING", "PURGING", "VERIFIED"]);

/** Comfortably past D-066's already-approved 1800s quiescence cutoff — see file header. */
export const ORPHAN_REPAIR_THRESHOLD_MS = 60 * 60 * 1000;

/** `privacy-lgpd.md` / D-066 Rodada H — residual verification is bounded to the 90 days after a
 * tenant reached DELETED; past that the tombstone stays but nothing is re-verified. */
export const RESIDUAL_VERIFICATION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface TenantLifecycleScanPage {
  items: TenantLifecycleRecord[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface TenantLifecycleScanSource {
  /** `Scan` with `FilterExpression: SK = "LIFECYCLE"` — see file header for the cost tradeoff. */
  scanLifecycleRecords(exclusiveStartKey?: Record<string, unknown>): Promise<TenantLifecycleScanPage>;
}

export interface TenantPurgeSweepDeps {
  lifecycle: TenantLifecycleScanSource;
  executions: TenantPurgeExecutionStarter;
  dynamo: Omit<DynamoTenantPurgeDeps, "onCheckpoint">;
  sessionTable: Omit<SessionTableTenantPurgeDeps, "onCheckpoint">;
  s3Source: S3TenantPurgeDeps["source"];
  /** Builds the same closed per-bucket target list `purgeTenant()` was given for this tenant —
   * supplied by the composition root so this worker stays agnostic of real bucket names. */
  s3TargetsFor: (tenantId: string) => TenantS3Target[];
  now?: () => Date;
}

export interface TenantPurgeSweepResult {
  lifecycleRecordsScanned: number;
  /** Tenants for which a repair `StartExecution` was issued (already-running ones included — the
   * starter swallows `ExecutionAlreadyExists`, so this counts attempts, not fresh launches). */
  executionsRepaired: number;
  /** Tenants inside the 90-day window whose residual verification ran. */
  tenantsVerified: number;
  /** Tenants whose residual verification found something still physically present — an
   * operator-visible signal, never auto-remediated here. */
  tenantsWithResidue: Array<{ tenantId: string; remainingDynamoItems: number; remainingSessions: number; remainingS3Objects: number }>;
}

export async function runTenantPurgeSweep(deps: TenantPurgeSweepDeps): Promise<TenantPurgeSweepResult> {
  const now = deps.now?.() ?? new Date();
  const result: TenantPurgeSweepResult = { lifecycleRecordsScanned: 0, executionsRepaired: 0, tenantsVerified: 0, tenantsWithResidue: [] };

  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page: TenantLifecycleScanPage = await deps.lifecycle.scanLifecycleRecords(exclusiveStartKey);
    for (const record of page.items) {
      result.lifecycleRecordsScanned += 1;
      const ageMs = now.getTime() - Date.parse(record.updatedAt);

      if (IN_FLIGHT_STATUSES.has(record.status)) {
        if (ageMs > ORPHAN_REPAIR_THRESHOLD_MS) {
          await deps.executions.startExecution({ name: record.tenantId, input: { tenantId: record.tenantId } });
          result.executionsRepaired += 1;
        }
        continue;
      }

      if (record.status === "DELETED" && ageMs <= RESIDUAL_VERIFICATION_WINDOW_MS) {
        result.tenantsVerified += 1;
        const targets = deps.s3TargetsFor(record.tenantId);
        const [dynamoVerify, sessionVerify, s3Verify] = await Promise.all([
          verifyTenantDynamoPurgeEmpty(deps.dynamo, record.tenantId),
          verifyTenantSessionsEmpty(deps.sessionTable, record.tenantId),
          Promise.all(targets.map((target) => verifyS3TenantPrefixEmpty({ source: deps.s3Source }, { bucket: target.bucket, prefix: target.prefix }))),
        ]);
        const remainingS3Objects = s3Verify.reduce((sum, v) => sum + v.remainingVersions + v.remainingMultipartUploads, 0);
        if (dynamoVerify.remainingItems > 0 || sessionVerify.remainingSessions > 0 || remainingS3Objects > 0) {
          result.tenantsWithResidue.push({
            tenantId: record.tenantId,
            remainingDynamoItems: dynamoVerify.remainingItems,
            remainingSessions: sessionVerify.remainingSessions,
            remainingS3Objects,
          });
        }
      }
    }
    exclusiveStartKey = page.lastEvaluatedKey;
  } while (exclusiveStartKey);

  return result;
}
