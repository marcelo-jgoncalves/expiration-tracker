/**
 * Extractor comparison (M7 item 7, `ExtractionValidationTaskHandler`'s `CompareExtractors` ASL
 * state, D-035 §2). Pure - combines the (already schema-validated) candidates each extractor
 * produced for ONE field into a single `ExtractionAgreement` outcome, per `extracted-field.ts`'s
 * own contract: SINGLE_SOURCE when only one extractor produced a usable candidate (including
 * zero candidates at all, a degenerate case the type doesn't otherwise represent - see
 * NEXT_SESSION_PROMPT.md for why SINGLE_SOURCE-with-no-value was chosen over widening
 * `ExtractionAgreement`), MATCH when 2+ agree, MISMATCH when 2+ disagree (never auto-resolved
 * by picking a "winning" source - `decide-field-outcome.ts` always routes MISMATCH to
 * PENDING_CONFIRMATION regardless of confidence).
 */
import type { ExtractionAgreement, ExtractionSource } from "./extracted-field.js";

export interface SourceCandidate {
  readonly source: ExtractionSource;
  readonly value?: string;
  readonly confidence?: number;
  /** Result of `isValidFieldValue()` against the field's schema type - an invalid candidate is
   * excluded from comparison entirely (treated as "this source produced nothing usable"). */
  readonly valid: boolean;
}

export interface ComparisonResult {
  readonly agreement: ExtractionAgreement;
  readonly sources: readonly ExtractionSource[];
  /** The value to carry on the `ExtractedField` row - for MISMATCH this is only the
   * highest-confidence candidate for display purposes, never a resolved "winner" (the row's
   * `agreement` field is what actually signals a human must decide). */
  readonly candidateValue?: string;
  readonly confidence?: number;
}

function best(candidates: readonly SourceCandidate[]): SourceCandidate {
  return candidates.reduce((a, b) => ((b.confidence ?? 0) > (a.confidence ?? 0) ? b : a));
}

export function compareExtractors(candidates: readonly SourceCandidate[]): ComparisonResult {
  const usable = candidates.filter((c) => c.valid && c.value !== undefined);

  if (usable.length === 0) {
    return { agreement: "SINGLE_SOURCE", sources: [] };
  }

  if (usable.length === 1) {
    const only = usable[0]!;
    return { agreement: "SINGLE_SOURCE", sources: [only.source], candidateValue: only.value, confidence: only.confidence };
  }

  const sources = usable.map((c) => c.source);
  const distinctValues = new Set(usable.map((c) => c.value));
  const winner = best(usable);

  if (distinctValues.size === 1) {
    return { agreement: "MATCH", sources, candidateValue: winner.value, confidence: winner.confidence };
  }

  return { agreement: "MISMATCH", sources, candidateValue: winner.value, confidence: winner.confidence };
}
