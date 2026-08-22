/**
 * Pure state-machine decision logic — M6 design §2.3 ("Evidências independentes e corrida de
 * eventos"). `UploadFinalizerWorker` and `MalwareResultWorker` each persist their own evidence
 * without assuming which arrives first; this function is the single place that decides what a
 * document's status should become once new evidence lands, called identically by both workers
 * after they persist their half.
 *
 * Deliberately returns an ACTION, not a final status: only "PROMOTE" requires the caller (the
 * malware-result worker, which owns the copy-to-clean step) to actually perform an S3 copy and
 * verify it before persisting `status: "CLEAN"` - this function never claims CLEAN on behalf of
 * a copy that hasn't happened yet.
 */
import type { DocumentStatus, UploadEvidence } from "./document.js";
import type { MalwareEvidence } from "./malware-scan-result.js";

export type EvidenceDecision =
  | { action: "REJECT"; status: "REJECTED" | "UNSUPPORTED" }
  | { action: "AWAIT_MORE_EVIDENCE" }
  | { action: "PROMOTE" }
  | { action: "IGNORE_STALE_EVENT" };

const TERMINAL_STATUSES: ReadonlySet<DocumentStatus> = new Set(["CLEAN", "REJECTED", "UNSUPPORTED", "TIMEOUT", "DELETED"]);

export interface AdvanceAfterEvidenceInput {
  currentStatus: DocumentStatus;
  /** True once the finalizer confirmed the object's size/checksum/mediaType AND the PDF
   * sandbox parser (when applicable) validated its structure. Undefined = no upload evidence
   * yet at all. */
  uploadValid?: boolean;
  uploadEvidence?: UploadEvidence;
  malwareEvidence?: MalwareEvidence;
}

/**
 * Rule order matches M6 design §2.3 exactly:
 * 1. Malware threat -> REJECTED, regardless of arrival order or upload validity.
 * 2. Upload known invalid (checksum/size/mediaType mismatch, or parser rejected it) -> REJECTED/UNSUPPORTED.
 * 3. Upload valid, no malware result yet -> await.
 * 4. Malware clean, no upload evidence yet -> await (never promote on malware evidence alone).
 * 5. Upload valid + malware NO_THREATS_FOUND -> PROMOTE (caller performs the copy, then confirms CLEAN).
 * 6. Already terminal (CLEAN/REJECTED/UNSUPPORTED/TIMEOUT/DELETED) -> any further evidence is a
 *    stale/duplicate/late event, ignored (never re-opens a terminal document).
 */
export function decideNextAction(input: AdvanceAfterEvidenceInput): EvidenceDecision {
  if (TERMINAL_STATUSES.has(input.currentStatus)) {
    return { action: "IGNORE_STALE_EVENT" };
  }

  if (input.malwareEvidence?.status === "THREATS_FOUND") {
    return { action: "REJECT", status: "REJECTED" };
  }

  if (input.malwareEvidence?.status === "UNSUPPORTED") {
    return { action: "REJECT", status: "UNSUPPORTED" };
  }

  if (input.uploadValid === false) {
    return { action: "REJECT", status: "REJECTED" };
  }

  const malwareClean = input.malwareEvidence?.status === "NO_THREATS_FOUND";
  const uploadConfirmedValid = input.uploadValid === true;

  if (uploadConfirmedValid && malwareClean) {
    return { action: "PROMOTE" };
  }

  // ACCESS_DENIED/FAILED are transient-shaped - never rejected by this function; the adapter's
  // own retry/DLQ policy handles them, and UploadSlotReconciliationWorker eventually times out
  // a document that never reaches a definitive result.
  return { action: "AWAIT_MORE_EVIDENCE" };
}
