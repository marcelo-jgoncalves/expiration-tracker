/**
 * Formula-injection mitigation, extracted out of `csv-export-writer.ts` (D-123/D-126) so a
 * second writer (D-205 fatia 2's XLSX dossier builder, decision 7 - "reusa + estende o
 * precedente de csv-export-writer.ts") shares the exact same trigger-character set instead of
 * duplicating it. A value starting with `=`, `+`, `-`, or `@` is prefixed with a leading
 * apostrophe so Excel/Sheets/LibreOffice read it as literal text, never as a formula.
 */
const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@"]);

export function sanitizeFormulaInjection(value: string): string {
  return FORMULA_TRIGGER_CHARS.has(value.charAt(0)) ? `'${value}` : value;
}
