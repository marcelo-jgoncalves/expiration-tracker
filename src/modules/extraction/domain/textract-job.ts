/**
 * TextractJob — transient correlation record between a Step Functions `waitForTaskToken`
 * invocation (`START_OCR`) and the eventual SNS->SQS completion notification (`COMPLETE_OCR`),
 * per `claude-reconciliation-final-design.md` §1.2/§2/§3 (D-035, M7 runtime design, GATE 9,2/9,3).
 *
 * Keyed by `jobId` alone (not tenant-scoped PK/SK like every other entity in this codebase) —
 * `COMPLETE_OCR` is triggered by a Textract SNS notification that only carries `JobId`/`JobTag`,
 * with no tenant/document context available before this record is read. A tenant-scoped key
 * would require a GSI just to look up "the job with this jobId", for a record whose entire
 * purpose IS that lookup — a dedicated self-keyed item is simpler and correct for this one
 * narrow case. `data-model.md` documents this entity alongside ExtractionRun/ExtractedField.
 *
 * `taskTokenCiphertext` is the single most sensitive field in this record (a live Step
 * Functions callback credential) — encrypted at rest via the same envelope-encryption pattern
 * as `src/modules/bff/ports/token-encryptor.ts` (see `ports/task-token-encryptor.ts`), never
 * logged, never included in a DLQ redrive payload. §3 requires it be cleared (not the whole
 * record) on any terminal SendTaskSuccess/Failure outcome, and preserved on a transient
 * SendTask* error so a later delivery attempt can still resolve the callback.
 */
import { createHash } from "node:crypto";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type TextractJobStatus = "STARTED" | "COMPLETED" | "FAILED";

export interface TextractJob extends EntityKey {
  entityType: "TextractJob";
  jobId: string;
  tenantId: string;
  itemId: string;
  documentId: string;
  documentVersion: number;
  runId: string;
  clientRequestToken: string;
  status: TextractJobStatus;
  /** Present only while a callback might still need to resolve the Step Functions task.
   * Cleared (not the record) on any terminal COMPLETE_OCR outcome, per design §3. */
  taskTokenCiphertext?: string;
  /** Epoch seconds — short TTL, diagnóstico/reconciliação only (design §2/§3), never relied on
   * for correctness (the S3 24h lifecycle is the real safety net for the OCR artifact itself). */
  ttl: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function textractJobKey(jobId: string): EntityKey {
  return { PK: `TEXTRACTJOB#${jobId}`, SK: `TEXTRACTJOB#${jobId}` };
}

/** `ClientRequestToken` for `StartDocumentTextDetection` — deterministic so a retried
 * `START_OCR` invocation (Lambda retry, at-least-once Step Functions redelivery) resolves to
 * the SAME Textract job instead of starting a second paid OCR pass, per design §1.2/§2. */
export function deriveTextractClientRequestToken(
  tenantId: string,
  documentId: string,
  documentVersion: number,
  pipelineVersion: string,
  runId: string,
): string {
  return createHash("sha256").update(`${tenantId}|${documentId}|${documentVersion}|${pipelineVersion}|${runId}`).digest("hex");
}

/** Short TTL per design §2/§3 — 24h matches the EXTRACTION_TRANSIENT S3 safety net lifecycle,
 * so the correlation record and the artifact it points at expire on the same horizon. */
export const TEXTRACT_JOB_TTL_SECONDS = 24 * 60 * 60;

export function computeTextractJobTtl(nowIso: string): number {
  return Math.floor(Date.parse(nowIso) / 1000) + TEXTRACT_JOB_TTL_SECONDS;
}
