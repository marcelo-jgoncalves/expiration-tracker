/**
 * needsBedrock() — decides whether a run must call Bedrock, given only the candidates already
 * produced by the deterministic parser and a lightweight OCR-text scan (never a second Bedrock
 * call, never a second read of the raw OCR artifact by this function itself).
 *
 * Contract fixed by `claude-reconciliation-final-design.md` §1.10 (rodada 4 — the rodada 3
 * contract didn't actually carry the data needed to apply rule (c)): true when at least one
 * REQUIRED field has (a) no deterministic candidate, (b) a deterministic candidate below
 * `DETERMINISTIC_CONFIDENCE_THRESHOLD`, or (c) real OCR ambiguity for THAT field (2+ distinct
 * OCR candidates) while OCR is actually available. (c) is deliberately never based on Textract
 * confidence in isolation — that score is about character recognition, not semantic
 * correctness, so it can never by itself justify escalating to an LLM.
 */
import type { ExtractedFieldValueType } from "./extracted-field.js";
import { DETERMINISTIC_CONFIDENCE_THRESHOLD } from "./field-schema.js";

export interface ExtractionCandidateField {
  readonly value: string;
  readonly valueType: ExtractedFieldValueType;
  readonly confidence: number;
}

export interface FieldExtractionAssessment {
  readonly fieldName: string;
  readonly required: boolean;
  readonly deterministicCandidate?: ExtractionCandidateField;
  /** Candidates derived from the OCR text by a lightweight scan (regex/heuristic over the
   * Textract artifact, NEVER a second Bedrock call) - 0 means OCR suggested nothing for this
   * field; 1 means no ambiguity; 2+ means real ambiguity (e.g. two candidate dates in the
   * text). */
  readonly ocrCandidates: readonly ExtractionCandidateField[];
}

export interface BedrockDecisionInput {
  /** One entry per field in the schema, required or not. */
  readonly fields: readonly FieldExtractionAssessment[];
  /** false when OCR_SKIPPED_KILL_SWITCH or the Textract job ended FAILED. */
  readonly ocrAvailable: boolean;
  readonly thresholdVersion: string;
}

function fieldNeedsBedrock(field: FieldExtractionAssessment, ocrAvailable: boolean): boolean {
  if (!field.required) return false;
  if (!field.deterministicCandidate) return true;
  if (field.deterministicCandidate.confidence < DETERMINISTIC_CONFIDENCE_THRESHOLD) return true;
  if (ocrAvailable && field.ocrCandidates.length > 1) return true;
  return false;
}

export function needsBedrock(input: BedrockDecisionInput): boolean {
  return input.fields.some((field) => fieldNeedsBedrock(field, input.ocrAvailable));
}
