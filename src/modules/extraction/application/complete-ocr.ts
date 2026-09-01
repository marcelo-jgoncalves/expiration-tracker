/**
 * `TextractTaskHandler`'s `COMPLETE_OCR` operation — triggered by the SQS queue subscribed to
 * Textract's SNS job-completion topic, NOT by Step Functions directly (`claude-reconciliation-
 * final-design.md` §1.2/§2/§3). Looks up the `TextractJob` by `jobId`, pages
 * `GetDocumentTextDetection`, persists the OCR artifact, and resolves the parked
 * `waitForTaskToken` task via `SendTaskSuccess`/`SendTaskFailure`.
 *
 * Governing invariant (design §3, closed after 3 correction rounds): this function must NEVER
 * delete the transient OCR artifact, in any outcome — only `ExtractionValidationTaskHandler`
 * (a later handler, not yet implemented) does that, at run closure. `taskTokenCiphertext` is
 * cleared only on a TERMINAL SendTask* outcome (success, or the three terminal errors); any
 * other SendTask* error is rethrown so the SQS message redelivers with the token still intact.
 */
import { textractJobKey, type TextractJob } from "../domain/textract-job.js";
import { TextractPartialFailureError } from "../../../shared/errors/app-error.js";
import type { TextractClient, TextractJobStatusResult } from "../ports/textract-client.js";
import type { TextractJobStore } from "../ports/textract-job-store.js";
import type { OcrArtifactStore, ExtractionArtifactRef } from "../ports/ocr-artifact-store.js";
import type { TaskTokenEncryptor } from "../ports/task-token-encryptor.js";
import type { TaskTokenSender } from "../ports/task-token-sender.js";

export interface CompleteOcrDeps {
  textract: TextractClient;
  jobs: TextractJobStore;
  artifacts: OcrArtifactStore;
  tokenEncryptor: TaskTokenEncryptor;
  sender: TaskTokenSender;
  now?: () => string;
}

export interface CompleteOcrInput {
  jobId: string;
}

export type CompleteOcrOutcome =
  | "SUCCEEDED"
  | "PARTIAL_SUCCEEDED"
  | "FAILED_REPORTED"
  | "ORPHAN_JOB"
  | "ALREADY_FINALIZED";

async function collectPages(textract: TextractClient, jobId: string): Promise<{ status: TextractJobStatusResult; blocks: unknown[]; warnings: string[] }> {
  const blocks: unknown[] = [];
  const warnings = new Set<string>();
  let status: TextractJobStatusResult;
  let nextToken: string | undefined;
  do {
    const page = await textract.getDocumentTextDetectionPage(jobId, nextToken);
    status = page.status;
    blocks.push(...page.blocks);
    for (const w of page.warnings ?? []) warnings.add(w);
    nextToken = page.nextToken;
  } while (nextToken);
  return { status, blocks, warnings: [...warnings] };
}

export async function completeOcr(deps: CompleteOcrDeps, input: CompleteOcrInput): Promise<CompleteOcrOutcome> {
  const job = await deps.jobs.getByJobId(input.jobId);
  if (!job) {
    // Reconciliation per design §2: confirm the job is real, discard the result, never error.
    try {
      await deps.textract.getDocumentTextDetectionPage(input.jobId);
    } catch {
      // Confirmation is best-effort only — no run is waiting on this job either way.
    }
    return "ORPHAN_JOB";
  }

  if (!job.taskTokenCiphertext) {
    // Already finalized by a previous (possibly concurrent) delivery of the same completion
    // notification — idempotent no-op, never a duplicate SendTask* call.
    return "ALREADY_FINALIZED";
  }

  const { status, blocks, warnings } = await collectPages(deps.textract, input.jobId);

  let artifact: ExtractionArtifactRef | undefined;
  let outcome: CompleteOcrOutcome;
  let sendSuccess: boolean;
  let sendPayload: unknown;
  let sendErrorCode: string | undefined;

  if (status === "SUCCEEDED" || status === "PARTIAL_SUCCESS") {
    artifact = await deps.artifacts.put(job.tenantId, job.runId, JSON.stringify(blocks));
    const effectiveWarnings = status === "PARTIAL_SUCCESS" ? [...new Set([...warnings, "PARTIAL_OCR"])] : warnings;
    sendSuccess = true;
    // Re-attaches the original execution context (item 5, D-057 pending decision) - this
    // SendTaskSuccess payload becomes the ENTIRE Step Functions `$` for every state after
    // `RunTextract` on the happy path (no ResultPath on that Task's success transition), so
    // without these fields RunDeterministicParser would have no tenantId/documentId/runId/
    // pipelineVersion to work with.
    sendPayload = {
      ocrAvailable: true,
      artifact,
      warnings: effectiveWarnings,
      tenantId: job.tenantId,
      itemId: job.itemId,
      documentId: job.documentId,
      documentVersion: job.documentVersion,
      runId: job.runId,
      pipelineVersion: job.pipelineVersion,
      correlationId: job.correlationId,
    };
    outcome = status === "PARTIAL_SUCCESS" ? "PARTIAL_SUCCEEDED" : "SUCCEEDED";
  } else {
    // FAILED (or an unexpected IN_PROGRESS on a completion notification, treated the same way -
    // this handler only runs off a completion event, so IN_PROGRESS here is itself anomalous).
    sendSuccess = false;
    sendErrorCode = new TextractPartialFailureError(`Textract job ${input.jobId} did not complete usably (status=${status}).`, { jobId: input.jobId }).code;
    outcome = "FAILED_REPORTED";
  }

  const taskToken = await deps.tokenEncryptor.decrypt(job.taskTokenCiphertext);
  const sendResult = sendSuccess
    ? await deps.sender.sendTaskSuccess(taskToken, sendPayload)
    : await deps.sender.sendTaskFailure(taskToken, sendErrorCode!, `Textract jobId=${input.jobId}`);
  // Any other SendTask* error (throttling, transient network) throws out of the calls above and
  // is NOT caught here — it propagates to the SQS consumer for redelivery, taskTokenCiphertext
  // left untouched, exactly per design §3's rodada-7 correction.

  // Every outcome reachable here (SENT, TERMINAL_QUIET, TERMINAL_WARN_INVALID_TOKEN) is terminal
  // for this token — clear it. A lost OCC race on the update means a concurrent delivery already
  // did this; treated as success, not retried.
  const now = deps.now?.() ?? new Date().toISOString();
  const updated: TextractJob = {
    ...job,
    ...textractJobKey(job.jobId),
    status: sendSuccess ? "COMPLETED" : "FAILED",
    taskTokenCiphertext: undefined,
    version: job.version + 1,
    updatedAt: now,
  };
  await deps.jobs.updateConditional(updated, { version: job.version });

  void sendResult; // outcome informs logging at the handler boundary, not branching here.
  return outcome;
}
