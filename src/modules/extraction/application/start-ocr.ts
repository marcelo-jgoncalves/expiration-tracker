/**
 * `TextractTaskHandler`'s `START_OCR` operation — the single `RunTextract` invocation the ASL
 * calls via `arn:aws:states:::lambda:invoke.waitForTaskToken` (`claude-reconciliation-final-
 * design.md` §1.2/§2). Pure orchestration over ports, same testing convention as
 * `startExtractionRun` (hand-written fakes, no `vi.mock`). Deliberately never calls
 * `SendTaskSuccess` — on a clean return the Step Functions execution stays parked on the task
 * token until `completeOcr` (a LATER, separate SQS-triggered invocation) resolves it.
 */
import { classifyDocumentType } from "../domain/document-format-classifier.js";
import {
  deriveTextractClientRequestToken,
  computeTextractJobTtl,
  textractJobKey,
  type TextractJob,
} from "../domain/textract-job.js";
import {
  OcrDisabledError,
  QuotaExceededError,
  TextractJobPersistenceFailedError,
  TextractUnsupportedDocumentError,
  UnsupportedDocumentTypeError,
} from "../../../shared/errors/app-error.js";
import type { FeatureFlagsReader } from "../ports/feature-flags-reader.js";
import type { TextractClient } from "../ports/textract-client.js";
import type { TextractJobStore } from "../ports/textract-job-store.js";
import type { TaskTokenEncryptor } from "../ports/task-token-encryptor.js";
import { TenantQuotaService } from "../../identity/application/quota.js";

export interface StartOcrDeps {
  featureFlags: FeatureFlagsReader;
  quota: TenantQuotaService;
  textract: TextractClient;
  jobs: TextractJobStore;
  tokenEncryptor: TaskTokenEncryptor;
  snsTopicArn: string;
  snsRoleArn: string;
  /** Bounded local retry before propagating `TextractJobPersistenceFailedError`, per design §2
   * ("Recuperação do intervalo StartDocumentTextDetection -> persistência"). */
  jobPersistAttempts?: number;
  now?: () => string;
}

export interface StartOcrInput {
  taskToken: string;
  tenantId: string;
  itemId: string;
  documentId: string;
  documentVersion: number;
  runId: string;
  pipelineVersion: string;
  /** The run's one business correlationId (ExtractionExecutionInput's doc comment) — persisted
   * on the `TextractJob` so `completeOcr()` (a LATER, separately-triggered SQS invocation with
   * no direct access to this input) can re-attach it when resuming the Step Functions
   * execution via SendTaskSuccess. */
  correlationId: string;
  cleanObject: { bucket: string; key: string; versionId: string };
  fileName: string;
  contentType?: string;
  magicBytes?: Uint8Array;
}

/** Quota reservation window covers this run's TEXTRACT call only — `limit: 1` over a
 * long-lived window turns `TenantQuotaService.consume` into an idempotency lock keyed by
 * `runId|TEXTRACT` (design §1.8's exact idempotency key) rather than a real rate cap: a retried
 * `START_OCR` invocation for the SAME run hits `QuotaExceededError` against its OWN prior
 * reservation, which this function treats as "already reserved, proceed" rather than a real
 * quota failure — see the catch block below. */
const AI_CALL_RESERVATION_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export async function startOcr(deps: StartOcrDeps, input: StartOcrInput): Promise<void> {
  const documentType = classifyDocumentType({ fileName: input.fileName, contentType: input.contentType, magicBytes: input.magicBytes });
  if (!documentType) {
    throw new UnsupportedDocumentTypeError(`Cannot classify document ${input.documentId} for OCR.`, { documentId: input.documentId, fileName: input.fileName });
  }

  let flags;
  try {
    flags = await deps.featureFlags.getFlags();
  } catch {
    // Fail-closed (mandatory, per feature-flags-reader.js's own contract): any read error is
    // treated identically to OCR=false, never as "unknown, proceed".
    throw new OcrDisabledError("Feature flags could not be read; failing closed.", { documentId: input.documentId });
  }
  if (!flags.OCR) {
    throw new OcrDisabledError("OCR kill switch is off.", { documentId: input.documentId });
  }

  const quotaWindow = `${input.runId}|TEXTRACT`;
  try {
    await deps.quota.consume({ tenantId: input.tenantId, quotaType: "AI_CALL", window: quotaWindow, limit: 1, windowSeconds: AI_CALL_RESERVATION_WINDOW_SECONDS });
  } catch (err) {
    if (!(err instanceof QuotaExceededError)) throw err;
    // Same run already reserved AI_CALL/TEXTRACT on a prior attempt — idempotent, not a real
    // quota exhaustion (a genuine cap would use a per-tenant/per-period window, not per-run).
  }

  const clientRequestToken = deriveTextractClientRequestToken(input.tenantId, input.documentId, input.documentVersion, input.pipelineVersion, input.runId);

  let jobId: string;
  try {
    const started = await deps.textract.startDocumentTextDetection({
      bucket: input.cleanObject.bucket,
      key: input.cleanObject.key,
      clientRequestToken,
      jobTag: input.runId,
      snsTopicArn: deps.snsTopicArn,
      snsRoleArn: deps.snsRoleArn,
    });
    jobId = started.jobId;
  } catch (err) {
    // Reservation was never consumed by Textract (the call itself failed) — compensate per
    // design §1.8 before propagating.
    await deps.quota.release({ tenantId: input.tenantId, quotaType: "AI_CALL", window: quotaWindow, windowSeconds: AI_CALL_RESERVATION_WINDOW_SECONDS });
    throw new TextractUnsupportedDocumentError(`StartDocumentTextDetection failed for document ${input.documentId}.`, { documentId: input.documentId, cause: err instanceof Error ? err.message : String(err) });
  }

  const now = deps.now?.() ?? new Date().toISOString();
  const taskTokenCiphertext = await deps.tokenEncryptor.encrypt(input.taskToken);
  const job: TextractJob = {
    ...textractJobKey(jobId),
    entityType: "TextractJob",
    jobId,
    tenantId: input.tenantId,
    itemId: input.itemId,
    documentId: input.documentId,
    documentVersion: input.documentVersion,
    runId: input.runId,
    pipelineVersion: input.pipelineVersion,
    correlationId: input.correlationId,
    clientRequestToken,
    status: "STARTED",
    taskTokenCiphertext,
    ttl: computeTextractJobTtl(now),
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  const attempts = Math.max(1, deps.jobPersistAttempts ?? 2);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await deps.jobs.create(job);
      return; // deliberately no SendTaskSuccess here — see module doc comment.
    } catch (err) {
      lastErr = err;
    }
  }
  throw new TextractJobPersistenceFailedError(`Failed to persist TextractJob ${jobId} after ${attempts} attempt(s).`, {
    jobId,
    runId: input.runId,
    cause: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
}
