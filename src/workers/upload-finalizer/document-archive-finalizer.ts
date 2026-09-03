/**
 * DocumentFile-flavored UploadFinalizerWorker core logic (D-193 "Ingestão física", slice 1).
 * Sibling to `finalizer.ts`'s `finalizeUpload()` (M6/`Document`) and
 * `submission-finalizer/finalizer.ts`'s `finalizeSubmissionUpload()` (M10/`DocumentSubmission`) —
 * same "head the observed object, validate against what was declared at reservation, hand off to
 * the shared advance-after-evidence step" shape, applied to `document-archive`'s `DocumentFile`.
 */
import { validateObservedUpload } from "../../modules/document/application/upload-validation.js";
import {
  advanceDocumentArchiveFileAfterEvidence,
  type AdvanceDocumentArchiveFileDeps,
} from "../../modules/document-archive/application/advance-file-after-evidence.js";
import { documentFileKey, type DocumentFile } from "../../modules/document-archive/domain/document-file.js";
import { isDocumentArchivePromotionEnabled } from "../../modules/extraction/application/document-archive-activation.js";
import type { FeatureFlagsReader } from "../../modules/extraction/ports/feature-flags-reader.js";

export interface FinalizeDocumentArchiveUploadInput {
  tenantId: string;
  documentId: string;
  seq: number;
  fileId: string;
  object: { bucket: string; key: string; versionId: string };
}

export type FinalizeDocumentArchiveUploadDeps = AdvanceDocumentArchiveFileDeps & {
  /** D-193 item 8/9 (PROMOTER gate). Checked FIRST, before any DynamoDB/S3 access - while
   * disabled (the default, requires BOTH `EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED` AND
   * `DOCUMENT_ARCHIVE_PROMOTION_ENABLED`, see `isDocumentArchivePromotionEnabled()`'s own doc
   * comment), this worker is completely inert for `document-archive` uploads - byte-identical
   * to how an unrecognized key shape is handled (logged and dropped upstream in
   * `upload-finalizer-handler.ts`, never retried, never partially applied). */
  featureFlags: FeatureFlagsReader;
};

export type FinalizeDocumentArchiveOutcome =
  | "CONFIRMED"
  | "REJECTED_INVALID"
  | "IGNORED_UNKNOWN_FILE"
  | "AWAITING"
  | "IGNORED_STALE"
  | "IGNORED_WRONG_VERSION"
  | "IGNORED_TENANT_NOT_ACTIVE"
  | "IGNORED_PROMOTION_DISABLED";

/**
 * Fail-closed at every branch, same posture `finalizeUpload()`'s doc comment establishes for M6:
 * an event whose bucket/key doesn't match this file's own `quarantineObject` is never applied.
 */
export async function finalizeDocumentArchiveUpload(deps: FinalizeDocumentArchiveUploadDeps, input: FinalizeDocumentArchiveUploadInput): Promise<FinalizeDocumentArchiveOutcome> {
  // D-193 item 8/9 (PROMOTER gate) - checked before any store/object access, same fail-closed
  // posture start-ocr.ts's OcrDisabledError already established (a flags-read error is treated
  // identically to the flag being off).
  let flags;
  try {
    flags = await deps.featureFlags.getFlags();
  } catch {
    return "IGNORED_PROMOTION_DISABLED";
  }
  if (!isDocumentArchivePromotionEnabled(flags)) return "IGNORED_PROMOTION_DISABLED";

  const now = deps.now ?? (() => new Date().toISOString());
  const file = await deps.store.get<DocumentFile>(documentFileKey(input.tenantId, input.documentId, input.seq, input.fileId));
  if (!file) return "IGNORED_UNKNOWN_FILE";
  if (file.quarantineObject.key !== input.object.key || file.quarantineObject.bucket !== input.object.bucket) return "IGNORED_UNKNOWN_FILE";

  const observed = await deps.objects.headObject(input.object);
  if (!observed) return "REJECTED_INVALID";

  const validation = validateObservedUpload({ mediaType: file.mediaType, contentLength: file.contentLength, checksumSha256: file.checksumSha256 }, observed);
  const uploadEvidence = {
    object: input.object,
    contentLength: observed.contentLength,
    mediaType: observed.mediaType,
    checksumSha256: observed.checksumSha256 ?? file.checksumSha256,
    valid: validation === "VALID",
    observedAt: now(),
  };

  const outcome = await advanceDocumentArchiveFileAfterEvidence(deps, {
    tenantId: input.tenantId,
    documentId: input.documentId,
    seq: input.seq,
    fileId: input.fileId,
    observedObject: input.object,
    uploadEvidence,
  });

  switch (outcome) {
    case "PROMOTED":
      return "CONFIRMED";
    case "REJECTED":
      return "REJECTED_INVALID";
    default:
      return outcome;
  }
}
