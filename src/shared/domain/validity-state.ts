/**
 * UnifiedValidityState — D-194 (`docs/architecture/reviews/search-and-filters-scoping/
 * estado-final-consolidado.md`), fatia 1. Fixed 5-value vocabulary the roadmap's search/filter
 * feature presents across `Requirement`/`ExpirationItem`/`DocumentVersion`, replacing the 4-5
 * different enums each entity used to expose on its own. Generic utility only — never imports
 * from `src/modules/**`; each module owns its own adapter that maps its entity's real fields to
 * this vocabulary (some entity states have no correspondence here and the adapter returns
 * `undefined` rather than force-fitting a value that would mislead the caller).
 */

export type UnifiedValidityState = "PERMANENTE" | "VALIDO" | "VENCENDO" | "VENCIDO" | "AGUARDANDO_REVISAO";

/** Same "vence em breve" window as `document-archive/requirement.ts`'s
 * `EXPIRING_SOON_THRESHOLD_DAYS`/`frontend/src/api/presentation.ts`'s `SOON_THRESHOLD_DAYS` —
 * kept as an independent constant per entity module's existing precedent, not re-exported from
 * here, but MUST move together if the underlying product decision ever changes. */
const EXPIRING_SOON_THRESHOLD_DAYS = 7;

/**
 * Date-driven core shared by every adapter that has a single expiry-like date to compare against
 * `now`: absent date -> `PERMANENTE` (never expires); past -> `VENCIDO`; within the soon window
 * (`>= 0` and `<= 7` days, inclusive of today) -> `VENCENDO`; further out -> `VALIDO`.
 * `AGUARDANDO_REVISAO` is never returned here — it has no date to compare against, only entity
 * states that are mid-flow (e.g. a `DocumentVersion` still `RECEIVED`/`UNDER_REVIEW`) map to it,
 * decided by each adapter before it ever calls this function.
 */
export function deriveValidityStateFromExpiry(expiresAt: string | undefined, now: Date): "PERMANENTE" | "VALIDO" | "VENCENDO" | "VENCIDO" {
  if (!expiresAt) return "PERMANENTE";
  const daysUntil = Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil < 0) return "VENCIDO";
  return daysUntil <= EXPIRING_SOON_THRESHOLD_DAYS ? "VENCENDO" : "VALIDO";
}
