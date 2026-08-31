/**
 * CSV export serialization — D-123/D-126 (docs/architecture/reviews/data-export-scoping/
 * round-3-claude-proposal.md). Single function does BOTH RFC4180 quoting AND
 * formula-injection mitigation (the already-`APPROVED` apostrophe-prefix precedent from
 * `roadmap-evolution/09-domain-model-csv-import.md`, extended here to export) in one pass —
 * never two separate mechanisms, so a field that needs both never gets mangled by ordering.
 */

const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@"]);

/**
 * Serializes one CSV field: prefixes a leading apostrophe when the raw value starts with a
 * formula-trigger character (so a spreadsheet reads it as literal text, not a formula), then
 * applies RFC4180 quoting (wrap in double quotes when the value contains a comma, double
 * quote, or newline; double any internal double quote) to the RESULT of that prefixing step.
 * Order matters: mitigating first means the mitigation's own `'` character is what a
 * downstream quoting pass sees, not a value that already has quotes needing separate escaping.
 */
export function serializeCsvField(value: string): string {
  const mitigated = FORMULA_TRIGGER_CHARS.has(value.charAt(0)) ? `'${value}` : value;
  const needsQuoting = mitigated.includes(",") || mitigated.includes('"') || mitigated.includes("\n") || mitigated.includes("\r");
  if (!needsQuoting) return mitigated;
  return `"${mitigated.replace(/"/g, '""')}"`;
}

/** Joins already-serialized fields into one CSV row terminated by CRLF (RFC4180 line ending). */
export function serializeCsvRow(fields: string[]): string {
  return fields.map(serializeCsvField).join(",") + "\r\n";
}
