/**
 * Composition root for the W3-07 tenant purge orchestrator (D-124, implementing D-121). This is
 * the "no such composition root exists yet" that `purge-tenant.ts`'s own doc comment names — until
 * now `purgeTenant()` was real, working, fully tested code with no real caller anywhere.
 *
 * The load-bearing piece is `TENANT_BUCKET_PREFIX_ROOTS` below. `purge-tenant.ts` records a KNOWN
 * LIMIT (Codex round 5, non-blocking): `prefixBelongsToTenant` validates that a prefix has SOME
 * tenant-owned root shape for the right tenant, but NOT that the root is the one that bucket
 * actually uses — `{bucket: clean, prefix: "tenant/t1/"}` passes even though no key builder ever
 * writes that combination. Its stated fix was "a future real composition root should build each
 * bucket's target from a closed per-bucket table (bucket -> its one real root), not accept an
 * arbitrary {bucket, prefix} pairing". That table is exactly what this file is, so the pairing is
 * never constructed freely anywhere in production code.
 *
 * Each root was verified by reading the real key builder, not inferred:
 *   clean bucket       -> `clean/<tenantId>/`  (document/application/advance-after-evidence.ts,
 *                                               subject/application/advance-after-submission-evidence.ts)
 *   quarantine bucket  -> `tenant/<tenantId>/` (document/application/document-service.ts,
 *                                               subject/application/guest-submission-service.ts)
 *   import bucket      -> `tenant/<tenantId>/` (import/application/import-{parse-,}service.ts — raw
 *                                               and plan objects share one bucket and one root)
 *   extraction bucket  -> `ocr/<tenantId>/`    (extraction/persistence/s3-ocr-artifact-store.ts)
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SFNClient } from "@aws-sdk/client-sfn";
import {
  DynamoDbTenantPurgeCandidateSource,
  DynamoDbSessionTablePurgeSource,
  DynamoDbTenantLifecycleReader,
  DynamoDbTenantLifecycleScanSource,
  DynamoDbSystemMutationStore,
} from "../../../shared/dynamodb/tenant-purge-scan.js";
import { S3TenantPurgeAdapter } from "../../../shared/s3/tenant-purge-s3-adapter.js";
import { SfnTenantPurgeExecutionStarter } from "../../../shared/tenant-lifecycle/sfn-tenant-purge-execution-starter.js";
import type { TenantS3Target } from "../../../workers/tenant-purge/purge-tenant.js";

export interface TenantPurgeBuckets {
  cleanBucket: string;
  quarantineBucket: string;
  importBucket: string;
  extractionTransientBucket: string;
}

/** Closed bucket -> root table. A new bucket needs an explicit entry here (a small, greppable,
 * reviewable diff), never an ad-hoc `{bucket, prefix}` built at a call site — same philosophy as
 * `system-mutation.ts`'s closed `SystemMutationOperation` union and `purge-tenant.ts`'s own
 * `TENANT_PREFIX_ROOTS`. */
function tenantBucketPrefixRoots(buckets: TenantPurgeBuckets): ReadonlyArray<{ bucket: string; root: string }> {
  return [
    { bucket: buckets.cleanBucket, root: "clean/" },
    { bucket: buckets.quarantineBucket, root: "tenant/" },
    { bucket: buckets.importBucket, root: "tenant/" },
    { bucket: buckets.extractionTransientBucket, root: "ocr/" },
  ];
}

/** Builds the S3 targets for ONE tenant. `tenantId` is stamped on each target as well as embedded
 * in the prefix because `purgeTenant()` checks BOTH independently (its B6 fix) — neither the label
 * nor the prefix alone is trusted. */
export function buildTenantS3Targets(buckets: TenantPurgeBuckets, tenantId: string): TenantS3Target[] {
  return tenantBucketPrefixRoots(buckets).map(({ bucket, root }) => ({ bucket, prefix: `${root}${tenantId}/`, tenantId }));
}

export function createS3PurgeClient(): S3Client {
  return new S3Client({});
}

export function createSfnPurgeClient(): SFNClient {
  return new SFNClient({});
}

/** Deps for the `RunPurge` Task's handler. */
export function buildTenantPurgeWorkerDeps(client: DynamoDBDocumentClient, s3Client: S3Client, tableName: string, sessionTableName: string, buckets: TenantPurgeBuckets) {
  return {
    dynamo: { store: new DynamoDbSystemMutationStore(client), candidates: new DynamoDbTenantPurgeCandidateSource(client, tableName), tableName },
    sessionTable: { source: new DynamoDbSessionTablePurgeSource(client, sessionTableName) },
    s3Source: new S3TenantPurgeAdapter(s3Client),
    s3TargetsFor: (tenantId: string) => buildTenantS3Targets(buckets, tenantId),
  };
}

/** Deps for the transition handler behind every forward and MarkBlocked Task. */
export function buildTenantLifecycleTransitionDeps(client: DynamoDBDocumentClient, tableName: string) {
  return { store: new DynamoDbSystemMutationStore(client), reader: new DynamoDbTenantLifecycleReader(client, tableName), tableName };
}

/** Deps for the recurring sweeper (repair + post-DELETED residual verification). */
export function buildTenantPurgeSweepDeps(
  client: DynamoDBDocumentClient,
  s3Client: S3Client,
  sfnClient: SFNClient,
  tableName: string,
  sessionTableName: string,
  stateMachineArn: string,
  buckets: TenantPurgeBuckets,
) {
  return {
    lifecycle: new DynamoDbTenantLifecycleScanSource(client, tableName),
    executions: new SfnTenantPurgeExecutionStarter(sfnClient, stateMachineArn),
    ...buildTenantPurgeWorkerDeps(client, s3Client, tableName, sessionTableName, buckets),
  };
}

export function buildTenantPurgeExecutionStarter(sfnClient: SFNClient, stateMachineArn: string): SfnTenantPurgeExecutionStarter {
  return new SfnTenantPurgeExecutionStarter(sfnClient, stateMachineArn);
}
