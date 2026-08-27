/**
 * Field-level state decision (M7 item 7, D-035 §2). Pure - given a `ComparisonResult`
 * (`compare-extractors.ts`), decides whether the field can be auto-accepted (`CONFIRMED`,
 * `confirmedValue` set to the agreed/only candidate) or requires a human
 * (`PENDING_CONFIRMATION`, per NEXT_SESSION_PROMPT.md's item-7 handoff on why the fixed
 * `ExtractedFieldState` enum - PENDING_CONFIRMATION/CONFIRMED/REJECTED, no separate "needs
 * review" run-level state - means individual fields carry review status, not the run itself).
 *
 * Never returns REJECTED - that state is only ever reached via the human reject HTTP route
 * (D-035 §1.7), never produced by this pipeline stage.
 */
import { DETERMINISTIC_CONFIDENCE_THRESHOLD } from "./field-schema.js";
import type { ExtractedFieldState } from "./extracted-field.js";
import type { ComparisonResult } from "./compare-extractors.js";

export function decideFieldOutcome(comparison: ComparisonResult): { state: ExtractedFieldState; confirmedValue?: string } {
  // No usable candidate from any source - always needs a human (zero-candidate case, design
  // §1.10 rule (a) territory carried through to the field-outcome decision).
  if (comparison.candidateValue === undefined) {
    return { state: "PENDING_CONFIRMATION" };
  }

  // 2+ sources disagreeing is never auto-resolved by confidence - always a human decision.
  if (comparison.agreement === "MISMATCH") {
    return { state: "PENDING_CONFIRMATION" };
  }

  // A single source's own candidate must clear the same confidence bar the deterministic
  // parser alone would have needed to clear to skip Bedrock in the first place (field-schema.ts
  // DETERMINISTIC_CONFIDENCE_THRESHOLD) - undefined confidence (e.g. a source that never
  // reports one) is treated conservatively as "not confident enough".
  if (comparison.agreement === "SINGLE_SOURCE") {
    if (comparison.confidence === undefined || comparison.confidence < DETERMINISTIC_CONFIDENCE_THRESHOLD) {
      return { state: "PENDING_CONFIRMATION" };
    }
  }

  // MATCH (2+ sources agreeing), or a single confident-enough source: auto-accept.
  return { state: "CONFIRMED", confirmedValue: comparison.candidateValue };
}
