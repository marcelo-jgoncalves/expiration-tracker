/**
 * Field schema for the extraction pipeline (M7) — the set of fields a run tries to extract,
 * versioned together with `pipelineVersion`/`thresholdVersion` so changing the threshold or
 * the field list is always a new pipeline version, never a silent hotfix
 * (`claude-reconciliation-final-design.md` §1.10).
 *
 * v1 only extracts `expirationDate` (`implementation-blueprint.md` §12.5's own example
 * payload is the only field name the approved design ever names concretely) - deliberately
 * narrow rather than inventing additional product fields no design document specified.
 */
import type { ExtractedFieldValueType } from "./extracted-field.js";

export interface FieldDefinition {
  readonly fieldName: string;
  readonly required: boolean;
  readonly valueType: ExtractedFieldValueType;
}

export const PIPELINE_VERSION_V1 = "2026-08-01";
export const THRESHOLD_VERSION_V1 = "2026-08-01";

/** `claude-reconciliation-final-design.md` §1.10: confidence threshold below which a
 * deterministic candidate alone is not trusted enough - Textract confidence is about
 * character RECOGNITION, never about semantic correctness of the field, so this only ever
 * gates the deterministic parser's own candidate.confidence, never a raw OCR score. */
export const DETERMINISTIC_CONFIDENCE_THRESHOLD = 0.75;

export const FIELD_SCHEMA_V1: readonly FieldDefinition[] = [{ fieldName: "expirationDate", required: true, valueType: "DATE" }];

export function getFieldSchema(pipelineVersion: string): readonly FieldDefinition[] {
  if (pipelineVersion === PIPELINE_VERSION_V1) return FIELD_SCHEMA_V1;
  throw new Error(`Unknown pipelineVersion: ${pipelineVersion}`);
}
