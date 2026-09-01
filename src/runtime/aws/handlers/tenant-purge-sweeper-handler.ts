/** Real handler for the tenant-purge sweeper (EventBridge Scheduler, W3-07/D-124). Two
 * responsibilities in one recurring worker — orphaned-execution repair and post-DELETED residual
 * verification; see `workers/tenant-purge/tenant-purge-sweep.ts` for why they share a mechanism
 * rather than getting one each. */
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildTenantPurgeSweepDeps, createS3PurgeClient, createSfnPurgeClient } from "../composition/tenant-purge.js";
import { runTenantPurgeSweep } from "../../../workers/tenant-purge/tenant-purge-sweep.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const s3Client = createS3PurgeClient();
const sfnClient = createSfnPurgeClient();
const tableNameEnv = process.env["TABLE_NAME"];
const sessionTableNameEnv = process.env["BFF_SESSION_TABLE_NAME"];
const stateMachineArn = process.env["TENANT_PURGE_STATE_MACHINE_ARN"];
const cleanBucket = process.env["CLEAN_BUCKET_NAME"];
const quarantineBucket = process.env["QUARANTINE_BUCKET_NAME"];
const importBucket = process.env["IMPORT_RAW_BUCKET_NAME"];
const extractionTransientBucket = process.env["EXTRACTION_TRANSIENT_BUCKET_NAME"];

if (!tableNameEnv) throw new Error("TABLE_NAME env var is required.");
if (!sessionTableNameEnv) throw new Error("BFF_SESSION_TABLE_NAME env var is required.");
if (!stateMachineArn) throw new Error("TENANT_PURGE_STATE_MACHINE_ARN env var is required.");
if (!cleanBucket || !quarantineBucket || !importBucket || !extractionTransientBucket) {
  throw new Error("CLEAN_BUCKET_NAME, QUARANTINE_BUCKET_NAME, IMPORT_RAW_BUCKET_NAME and EXTRACTION_TRANSIENT_BUCKET_NAME env vars are all required.");
}

const deps = buildTenantPurgeSweepDeps(client, s3Client, sfnClient, tableNameEnv, sessionTableNameEnv, stateMachineArn, {
  cleanBucket,
  quarantineBucket,
  importBucket,
  extractionTransientBucket,
});
const logger = new SecureLogger({ baseContext: { service: "tenant-purge-sweeper" } });

export async function handler(): Promise<void> {
  await runWithContext({ correlationId: randomUUID() }, async () => {
    const result = await runTenantPurgeSweep(deps);
    logger.info("tenant purge sweep complete", { ...result });
    if (result.tenantsWithResidue.length > 0) {
      // A DELETED tenant with residue means the purge reported convergence but something is still
      // physically present - an LGPD-relevant state that must be visible, never buried inside the
      // summary line above.
      logger.error("tenant purge sweep found residue after DELETED", { tenantsWithResidue: result.tenantsWithResidue });
    }
    if (result.tenantsAmbiguous.length > 0) {
      // D-127: HELD_FOR_RECOVERY execution/record state disagreement outside the one safe-to-repair
      // shape - same "operator-visible error log" idiom as tenantsWithResidue above, never
      // auto-restored.
      logger.error("tenant purge sweep found ambiguous HELD_FOR_RECOVERY state - never auto-restored", { tenantsAmbiguous: result.tenantsAmbiguous });
    }
    if (result.cancellationsRepaired.length > 0) {
      logger.info("tenant purge sweep completed stalled cancellation(s)", { cancellationsRepaired: result.cancellationsRepaired });
    }
  });
}
