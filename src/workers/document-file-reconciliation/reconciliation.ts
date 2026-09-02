/** DocumentFileReconciliationWorker core logic — D-163 §6, migrated off the base-table Scan onto
 * GSI8 by D-179 slice 3 (3rd of 9 workers, `candidate-source.ts`'s doc comment has the full
 * rationale, including why this collapses to a single Query instead of the two independent
 * per-status scans D-166 ran). The actual terminal transition (and the race-closing exact
 * GSI8PK/GSI8SK condition) lives in `apply-file-scan-result.ts`'s `applyFileScanTimeout` — this
 * module only discovers candidates and calls it, unchanged division of labor from D-166. */
import { applyFileScanTimeout, type ApplyFileScanResultDeps } from "../../modules/document-archive/application/apply-file-scan-result.js";
import { documentFileGsi8Keys } from "../../modules/document-archive/domain/document-file.js";
import type { DocumentFileGsi8Candidate, DocumentFileReconciliationCandidateSource } from "./candidate-source.js";

/** Hard cap on pages drained per invocation - same rationale as the purge workers' `MAX_PAGES`:
 * bounds a single invocation against a pathological backlog, the rest picked up by the next
 * scheduled run. */
const MAX_PAGES = 25;

export interface DocumentFileReconciliationDeps extends ApplyFileScanResultDeps {
  candidates: DocumentFileReconciliationCandidateSource;
  now: () => string;
}

export interface DocumentFileReconciliationResult {
  scanned: number;
  timedOut: number;
  skippedNotDue: number;
  skippedStale: number;
  /** Age in seconds of the oldest due candidate this run's GSI8 query returned. `undefined` when
   * no candidate was returned at all - same observability shape membership-purge/invitation-purge
   * added for their own GSI8 migrations. */
  oldestCandidateAgeSeconds: number | undefined;
}

export async function reconcileTimedOutDocumentFiles(deps: DocumentFileReconciliationDeps): Promise<DocumentFileReconciliationResult> {
  const result: DocumentFileReconciliationResult = { scanned: 0, timedOut: 0, skippedNotDue: 0, skippedStale: 0, oldestCandidateAgeSeconds: undefined };
  const nowIso = deps.now();
  const nowMs = Date.parse(nowIso);

  let exclusiveStartKey: Record<string, unknown> | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const gsi8Page = await deps.candidates.queryDue({ before: nowIso, exclusiveStartKey });

    if (page === 0 && gsi8Page.items.length > 0) {
      const oldest = gsi8Page.items[0]!;
      result.oldestCandidateAgeSeconds = Math.max(0, Math.floor((nowMs - Date.parse(oldest.dueAtIso)) / 1000));
    }

    for (const candidate of gsi8Page.items) {
      await processOneCandidate(deps, candidate, nowMs, result);
    }

    if (!gsi8Page.lastEvaluatedKey) break;
    exclusiveStartKey = gsi8Page.lastEvaluatedKey;
  }

  return result;
}

async function processOneCandidate(
  deps: DocumentFileReconciliationDeps,
  candidate: DocumentFileGsi8Candidate,
  nowMs: number,
  result: DocumentFileReconciliationResult,
): Promise<void> {
  result.scanned += 1;

  if (Date.parse(candidate.dueAtIso) > nowMs) {
    // Defensive only - queryDue()'s own `GSI8SK < :before` filter means this should never be
    // reachable in practice, but eligibility is always re-derived here, never assumed (same
    // posture as invitation-purge/membership-purge's own defensive check).
    result.skippedNotDue += 1;
    return;
  }

  const observedGsi8Pointer = documentFileGsi8Keys({ dueAtIso: candidate.dueAtIso, tenantId: candidate.tenantId, fileId: candidate.fileId });
  const outcome = await applyFileScanTimeout(deps, {
    tenantId: candidate.tenantId,
    documentId: candidate.documentId,
    seq: candidate.seq,
    fileId: candidate.fileId,
    observedGsi8Pointer,
  });

  if (outcome === "TIMED_OUT") result.timedOut += 1;
  else result.skippedStale += 1; // already advanced concurrently (event, or a previous/parallel sweep) - never double-processed.
}
