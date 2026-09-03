/**
 * D-193 item 8/9 ("Sequenciamento", `estado-final-consolidado.md`) — the mandatory-order
 * activation gate for the `document-archive` OCR/extraction pipeline (D-193 slices 1-7). Two
 * independent AppConfig flags, `EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED` (STARTER) and
 * `DOCUMENT_ARCHIVE_PROMOTION_ENABLED` (PROMOTER), activate in a mandatory order — STARTER
 * strictly before PROMOTER, never the reverse — so that a `document-archive` file is never
 * promoted to the CLEAN key while nothing is listening to start extraction against it (the
 * "CLEAN sem consumidor" window the approved design named explicitly).
 *
 * A runbook note alone ("turn on STARTER first, then PROMOTER") only prevents the wrong order
 * when the operator follows it. This function closes the same window BY CONSTRUCTION instead:
 * the promoter path (`upload-finalizer-handler.ts`/`malware-result-handler.ts`'s third branch,
 * reaching `applyFileScanResult`/`confirmFileScanClean`) is gated on THIS function, not on the
 * raw `DOCUMENT_ARCHIVE_PROMOTION_ENABLED` value alone — so turning PROMOTION on while STARTER
 * is still off (the forbidden reverse order) can never activate promotion. There is then no code
 * path that produces a CLEAN `document-archive` object while its consumer (the Starter) is off.
 */
import type { FeatureFlags } from "../ports/feature-flags-reader.js";

/** STARTER alone gates whether `startExtractionRunForDocumentArchive()` may open the
 * ExtractionRun gate / call `startExecution()`. No dependency on PROMOTER — the Starter only
 * ever reacts to an ALREADY-clean object (D-193's own "never trusts the S3 event, always rereads
 * DocumentFile fresh" discipline), so it needs no cross-flag ordering guard of its own. */
export function isDocumentArchiveExtractionTriggerEnabled(flags: FeatureFlags): boolean {
  return flags.EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED === true;
}

/** PROMOTER requires BOTH flags on, STARTER included — the ordering-safety mechanism itself.
 * While this returns `false` (the default, both flags off), the physical handlers' third branch
 * must treat a `document-archive` quarantine key exactly like an unrecognized key shape: logged
 * and dropped, never retried, never partially applied. */
export function isDocumentArchivePromotionEnabled(flags: FeatureFlags): boolean {
  return flags.EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED === true && flags.DOCUMENT_ARCHIVE_PROMOTION_ENABLED === true;
}
