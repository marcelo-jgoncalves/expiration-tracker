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
}

export interface FeatureFlagsReader {
  /** Never resolves to a value implying "unknown, assume enabled" — throws on any read/parse
   * failure so the caller's own fail-closed handling stays a single explicit decision. */
  getFlags(): Promise<FeatureFlags>;
}
