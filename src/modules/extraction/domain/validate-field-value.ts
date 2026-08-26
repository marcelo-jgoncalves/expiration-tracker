/**
 * Schema validation for a candidate value (M7 item 7, `ExtractionValidationTaskHandler`'s
 * `ValidateSchema` ASL state, D-035 §2). Pure - never touches the OCR artifact itself, only
 * the already-produced candidate string. A candidate that fails this check is treated as if
 * that source produced no usable value at all (`compare-extractors.ts` filters on `valid`),
 * never silently coerced or truncated into something that merely parses.
 */
import type { ExtractedFieldValueType } from "./extracted-field.js";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidFieldValue(valueType: ExtractedFieldValueType, value: string): boolean {
  switch (valueType) {
    case "DATE": {
      if (!ISO_DATE_PATTERN.test(value)) return false;
      const parsed = Date.parse(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed);
    }
    case "NUMBER":
      return value.trim() !== "" && Number.isFinite(Number(value));
    case "STRING":
    default:
      return value.trim().length > 0;
  }
}
