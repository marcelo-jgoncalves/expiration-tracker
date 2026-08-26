/** DynamoDB surface for `TextractJob` — narrow, matching the ExtractionRunStore/DocumentReader
 * pattern already established in this module (AGENTS.md §7). */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { TextractJob } from "../domain/textract-job.js";

export interface TextractJobStore {
  /** Creates a brand-new TextractJob record. Called only AFTER StartDocumentTextDetection has
   * already succeeded (design §2) — a failure here (even after the caller's own local retry)
   * must surface as `TextractJobPersistenceFailedError`, never be swallowed. */
  create(job: TextractJob): Promise<void>;

  /** Lookup by `jobId` alone — the only correlation `COMPLETE_OCR` has available from the SNS
   * notification. `null` when no matching job exists (the orphan-job case, design §2). */
  getByJobId(jobId: string): Promise<TextractJob | null>;

  /** Conditional update used by `COMPLETE_OCR` to record the terminal outcome and clear
   * `taskTokenCiphertext` (design §3) — `expectedVersion` guards against concurrent SQS
   * redelivery of the same completion message racing itself. Returns false (not throw) on a
   * lost OCC race, matching `ExtractionRunStore`/`TenantQuotaService`'s own convention, so the
   * caller can decide idempotently (a lost race here means another delivery already finished
   * the same work — safe to treat as success, never as a hard failure).
   */
  updateConditional(job: TextractJob, expected: { version: number }): Promise<boolean>;

  key(jobId: string): EntityKey;
}
