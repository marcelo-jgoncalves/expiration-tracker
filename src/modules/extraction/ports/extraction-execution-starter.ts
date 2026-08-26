/** Starts the M7 extraction Step Functions Standard execution (D-035 §2, `implementation-
 * blueprint.md` §12.5's `LoadMetadata` state — this worker already loaded the metadata, so it
 * starts the execution WITH that input rather than a separate first Task state). Kept as its
 * own narrow port (not a generic "AWS SDK wrapper") so `startExtractionRun` stays testable
 * with a fake, same pattern as every other AWS-facing port in this codebase. */

export interface ExtractionExecutionInput {
  tenantId: string;
  itemId: string;
  documentId: string;
  documentVersion: number;
  runId: string;
  pipelineVersion: string;
  cleanObject: { bucket: string; key: string; versionId: string };
}

export interface ExtractionExecutionStarter {
  /**
   * `name` MUST be the deterministic `runId` — Step Functions treats execution names as
   * unique per state machine for 90 days, so starting with the same name+same input for a
   * duplicate event is itself idempotent at the AWS API level (a second real safety net on
   * top of the `ExtractionRun.putIfAbsent` check `startExtractionRun` already does first).
   */
  startExecution(input: { name: string; input: ExtractionExecutionInput }): Promise<void>;
}
