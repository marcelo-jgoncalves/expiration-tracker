/**
 * Real handler behind the RunPurge Task (W3-07/D-124). A deliberately thin wrapper around the
 * already-existing `purgeTenant()` — it adds exactly two things and no business logic of its own:
 *
 *  1. The composition root's real dependencies, including the closed per-bucket `TenantS3Target[]`
 *     table (see `composition/tenant-purge.ts`).
 *  2. The compact envelope projection (D-121 Rodada 3 Fix 6). The FULL `TenantPurgeResult` is
 *     logged here in its entirety via SecureLogger, and only the bounded envelope is returned to
 *     Step Functions — `s3[].unresolvedErrors[]` is unbounded and would otherwise breach the
 *     256 KiB task-output quota on a large tenant, failing the execution opaquely instead of
 *     converging or surfacing as BLOCKED.
 */
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildTenantPurgeWorkerDeps, createS3PurgeClient } from "../composition/tenant-purge.js";
import { purgeTenant, type TenantPurgeCheckpoint } from "../../../workers/tenant-purge/purge-tenant.js";
import { toTenantPurgeEnvelope, type TenantPurgeEnvelope } from "../../../workers/tenant-purge/purge-result-envelope.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const s3Client = createS3PurgeClient();
const tableNameEnv = process.env["TABLE_NAME"];
const sessionTableNameEnv = process.env["BFF_SESSION_TABLE_NAME"];
const cleanBucket = process.env["CLEAN_BUCKET_NAME"];
const quarantineBucket = process.env["QUARANTINE_BUCKET_NAME"];
const importBucket = process.env["IMPORT_RAW_BUCKET_NAME"];
const extractionTransientBucket = process.env["EXTRACTION_TRANSIENT_BUCKET_NAME"];

if (!tableNameEnv) throw new Error("TABLE_NAME env var is required.");
if (!sessionTableNameEnv) throw new Error("BFF_SESSION_TABLE_NAME env var is required.");
// Fail closed at cold start, never at the first real purge: a missing bucket name would silently
// shrink the set of purged targets and let purgeTenant() report SUCCESS for a tenant whose objects
// were never even looked at - the exact "silently swallow a partial failure as success" outcome
// purge-tenant.ts's contract forbids.
if (!cleanBucket || !quarantineBucket || !importBucket || !extractionTransientBucket) {
  throw new Error("CLEAN_BUCKET_NAME, QUARANTINE_BUCKET_NAME, IMPORT_RAW_BUCKET_NAME and EXTRACTION_TRANSIENT_BUCKET_NAME env vars are all required.");
}

const buckets = { cleanBucket, quarantineBucket, importBucket, extractionTransientBucket };
const { dynamo, sessionTable, s3Source, s3TargetsFor } = buildTenantPurgeWorkerDeps(client, s3Client, tableNameEnv, sessionTableNameEnv, buckets);
const logger = new SecureLogger({ baseContext: { service: "tenant-purge-worker" } });

export interface TenantPurgeWorkerEvent {
  tenantId: string;
  /** Null on the first iteration (the ASL's InitPurgeLoop seeds it explicitly); the previous
   * iteration's checkpoint on every retry. */
  checkpoint: TenantPurgeCheckpoint | null;
}

export async function handler(event: TenantPurgeWorkerEvent): Promise<TenantPurgeEnvelope> {
  return runWithContext({ correlationId: randomUUID() }, async () => {
    const result = await purgeTenant(
      { dynamo, sessionTable, s3Source, s3Targets: s3TargetsFor(event.tenantId) },
      { tenantId: event.tenantId, ...(event.checkpoint ? { startFrom: event.checkpoint } : {}) },
    );

    // The full result, unresolvedErrors included - this log is the ONLY place the unbounded
    // diagnostic detail survives, which is the whole point of the envelope below.
    logger.info("tenant purge attempt complete", { ...result });

    return toTenantPurgeEnvelope(result);
  });
}
