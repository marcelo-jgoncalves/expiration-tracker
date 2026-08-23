/** SubmissionFinalizerWorker core logic — agregado-irmão de
 * src/workers/upload-finalizer/finalizer.ts, operando sobre `DocumentSubmission` (M10 guest
 * upload). Mesma lógica de validação/fail-closed, reaproveitando `validateObservedUpload`
 * (genérica, sem acoplamento a `Document`). */
import { buildVersionedUpdate, isTransactionCanceled } from "../../shared/dynamodb/occ.js";
import { validateObservedUpload } from "../../modules/document/application/upload-validation.js";
import { advanceAfterSubmissionEvidence } from "../../modules/subject/application/advance-after-submission-evidence.js";
import { documentSubmissionKey, type DocumentSubmission } from "../../modules/subject/domain/document-submission.js";
import type { SubjectStore } from "../../modules/subject/ports/subject-store.js";
import type { DocumentObjectStore } from "../../modules/document/ports/document-object-store.js";
import type { PdfParser } from "../../modules/document/ports/pdf-parser.js";

export interface FinalizeSubmissionInput {
  tenantId: string;
  subjectId: string;
  assignmentId: string;
  submissionId: string;
  object: { bucket: string; key: string; versionId: string };
}

export interface FinalizeSubmissionDeps {
  store: SubjectStore;
  objects: DocumentObjectStore;
  parser: PdfParser;
  tableName: string;
  cleanBucket: string;
  now?: () => string;
}

export type FinalizeSubmissionOutcome = "CONFIRMED" | "REJECTED_INVALID" | "IGNORED_UNKNOWN_SLOT" | "IGNORED_STALE";

const MAX_OCC_RETRIES = 10;

export async function finalizeSubmissionUpload(deps: FinalizeSubmissionDeps, input: FinalizeSubmissionInput): Promise<FinalizeSubmissionOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const key = documentSubmissionKey(input.tenantId, input.subjectId, input.assignmentId, input.submissionId);

  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const submission = await deps.store.get<DocumentSubmission>(key);
    if (!submission) return "IGNORED_UNKNOWN_SLOT";
    if (submission.quarantineObject.key !== input.object.key || submission.quarantineObject.bucket !== input.object.bucket) return "IGNORED_UNKNOWN_SLOT";
    if (submission.status !== "PENDING_UPLOAD" && submission.status !== "SCANNING") return "IGNORED_STALE";

    const observed = await deps.objects.headObject(input.object);
    if (!observed) return "REJECTED_INVALID";

    const validation = validateObservedUpload({ mediaType: submission.mediaType, contentLength: submission.contentLength, checksumSha256: submission.checksumSha256 }, observed);

    let uploadValid = validation === "VALID";
    if (uploadValid && submission.mediaType === "application/pdf") {
      const parseResult = await deps.parser.parse(input.object);
      uploadValid = parseResult.outcome === "VALID";
    }

    const uploadEvidence = {
      object: input.object,
      contentLength: observed.contentLength,
      mediaType: observed.mediaType,
      checksumSha256: observed.checksumSha256 ?? submission.checksumSha256,
      valid: uploadValid,
      observedAt: now(),
    };

    try {
      await deps.store.transactWrite([
        { Update: buildVersionedUpdate({ tableName: deps.tableName, key, tenantId: input.tenantId, expectedVersion: submission.version, set: { status: "SCANNING", uploadEvidence } }) },
      ]);
    } catch (err) {
      if (isTransactionCanceled(err)) continue;
      throw err;
    }

    const outcome = await advanceAfterSubmissionEvidence(
      { store: deps.store, objects: deps.objects, tableName: deps.tableName, cleanBucket: deps.cleanBucket },
      { tenantId: input.tenantId, subjectId: input.subjectId, assignmentId: input.assignmentId, submissionId: input.submissionId, expectedObject: input.object },
    );
    return outcome === "REJECTED" ? "REJECTED_INVALID" : "CONFIRMED";
  }

  throw new Error(`finalizeSubmissionUpload exhausted retries for submission ${input.submissionId} under contention.`);
}
