/**
 * Read port for the `infra/modules/feature-flags` AppConfig kill switches (AI_EXTRACTION/OCR/
 * WHATSAPP). `TextractTaskHandler` is the first real consumer (D-035 §1.5 — "aplicação
 * compartilhada entre qualquer feature que precisar de kill switch operacional").
 *
 * Fail-closed is mandatory and enforced by the CALLER, not the adapter: any read error
 * (network, malformed config, AppConfig unavailable) must be treated as `false` for every
 * flag, never as "flag unknown, proceed anyway" — an adapter that throws is exactly as safe
 * as one that returns `false`, as long as callers never catch-and-default-to-true.
 */
export interface FeatureFlags {
  AI_EXTRACTION: boolean;
  OCR: boolean;
  WHATSAPP: boolean;
  /** D-193 item 8/9 ("Sequenciamento", `estado-final-consolidado.md`) — the STARTER flag of the
   * two-flag mandatory-order activation for the `document-archive` OCR/extraction pipeline
   * (D-193 slices 1-7). Gates whether `startExtractionRunForDocumentArchive()` is allowed to
   * actually open the ExtractionRun gate/`startExecution()` for a `document-archive`-sourced
   * `DocumentVersion` — the STARTER half of D-193's own name for it
   * (`EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED`). Must be turned ON strictly BEFORE
   * `DOCUMENT_ARCHIVE_PROMOTION_ENABLED` (never the reverse) — see that flag's own doc comment
   * for why the order matters. */
  EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: boolean;
  /** D-193 item 8/9 — the PROMOTER flag. Gates whether `upload-finalizer-handler.ts`/
   * `malware-result-handler.ts`'s third (`document-archive`) branch is allowed to reach
   * `applyFileScanResult`/`confirmFileScanClean` at all (D-193 slice 1's physical-ingestion
   * promotion logic) — while OFF, a `document-archive` quarantine key is treated exactly like an
   * unrecognized key shape (logged and dropped, never retried), i.e. byte-identical to this
   * repo's behavior before D-193 slice 1 shipped.
   *
   * By construction, `isDocumentArchivePromotionEnabled()` (`extraction/application/
   * document-archive-activation.ts`) treats this flag as meaningless unless
   * `EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED` is ALSO on — turning PROMOTION on alone (the
   * design's forbidden reverse order) can never promote a file to the CLEAN key, so it can never
   * open the "CLEAN with no consumer" window the design worried about: there is no code path
   * that reaches a CLEAN `document-archive` object while the Starter that would consume it is
   * still off. */
  DOCUMENT_ARCHIVE_PROMOTION_ENABLED: boolean;
}

export interface FeatureFlagsReader {
  /** Never resolves to a value implying "unknown, assume enabled" — throws on any read/parse
   * failure so the caller's own fail-closed handling stays a single explicit decision. */
  getFlags(): Promise<FeatureFlags>;
}
