/**
 * normalizeDisplayName — promoted from `subject/domain/tracked-subject.ts` (D-173,
 * `docs/architecture/reviews/document-type-scoping/estado-final-consolidado.md` §2) so
 * `document-archive`'s DocumentType dedupe pointer can reuse it without importing across the
 * `document-archive` -> `subject` module boundary (`.dependency-cruiser.cjs` forbids it —
 * `shared/text/` is the only common ground both modules may import from). Behavior unchanged
 * from the original: NFD, strip diacritics, trim, lowercase, collapse internal whitespace.
 */
const DIACRITICS_PATTERN = new RegExp(`[\\u0300-\\u036f]`, "g");

export function normalizeDisplayName(name: string): string {
  return name
    .normalize("NFD")
    .replace(DIACRITICS_PATTERN, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
