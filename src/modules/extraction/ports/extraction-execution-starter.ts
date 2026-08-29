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
  /** Logging-observability-standard.md criterion "Tracing distribuído" (2026-08-29 audit
   * finding): the ONE business correlationId for this whole extraction run, established once
   * by the handler that starts this execution (extraction-starter-handler.ts) and threaded
   * unchanged through every Task state's input/output from here on — never regenerated per
   * Task (that was the bug: each of the 4 downstream task handlers used to call
   * `randomUUID()` fresh, making it impossible to join a run's logs across Step Functions
   * state boundaries from a single correlationId). */
  correlationId: string;
  cleanObject: { bucket: string; key: string; versionId: string };
  /** RunTextract's START_OCR operation (`start-ocr.ts`) requires these to classify the document
   * type before calling Textract - real bug found 2026-08-27 verifying the pipeline end-to-end
   * against `dev`: without them, `classifyDocumentType` throws on every real invocation
   * (`fileName` is not optional there), which `toAppError` turns into a generic `InternalError`
   * that the ASL's `States.ALL` Catch silently routes to the degraded (no-OCR) path - meaning
   * OCR never actually ran on any real document despite the pipeline being "code-complete". */
  fileName: string;
  contentType?: string;
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
