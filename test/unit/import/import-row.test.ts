import { describe, expect, it } from "vitest";
import { validateImportRow, type RawImportRow } from "../../../src/modules/import/domain/import-row.js";

function raw(overrides: Partial<RawImportRow> = {}): RawImportRow {
  return { rowNumber: 1, displayName: "ACME Ltda", type: "VENDOR", ...overrides };
}

describe("validateImportRow (M11, D-042)", () => {
  it("accepts a well-formed row", () => {
    const result = validateImportRow(raw({ externalId: "ext-1", notes: "nota", tags: "a;b;c" }));
    expect(result).toHaveProperty("row");
    if ("row" in result) {
      expect(result.row.displayName).toBe("ACME Ltda");
      expect(result.row.type).toBe("VENDOR");
      expect(result.row.tags).toEqual(["a", "b", "c"]);
      expect(result.row.warnings).toEqual([]);
    }
  });

  it("rejects a missing displayName", () => {
    const result = validateImportRow(raw({ displayName: "  " }));
    expect(result).toEqual({ rejection: { reason: "MISSING_DISPLAY_NAME", field: "displayName" } });
  });

  it("rejects a missing type", () => {
    const result = validateImportRow(raw({ type: undefined }));
    expect(result).toEqual({ rejection: { reason: "MISSING_TYPE", field: "type" } });
  });

  it("rejects an invalid type (never guesses/coerces)", () => {
    const result = validateImportRow(raw({ type: "NOT_A_REAL_TYPE" }));
    expect(result).toEqual({ rejection: { reason: "INVALID_TYPE", field: "type" } });
  });

  it("accepts type case-insensitively (vendor -> VENDOR)", () => {
    const result = validateImportRow(raw({ type: "vendor" }));
    expect("row" in result && result.row.type).toBe("VENDOR");
  });

  it("rejects a displayName over the length limit", () => {
    const result = validateImportRow(raw({ displayName: "a".repeat(161) }));
    expect(result).toEqual({ rejection: { reason: "DISPLAY_NAME_TOO_LONG", field: "displayName" } });
  });

  it("rejects a control character (NUL) embedded in a field - never silently strips it", () => {
    const result = validateImportRow(raw({ displayName: "ACME\x00Ltda" }));
    expect(result).toEqual({ rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "displayName" } });
  });

  it("rejects a CR/LF embedded in notes (row-splitting/log-injection defense)", () => {
    const result = validateImportRow(raw({ notes: "linha1\r\nlinha2" }));
    expect(result).toEqual({ rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "notes" } });
  });

  it("rejects more than 20 tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`).join(";");
    const result = validateImportRow(raw({ tags }));
    expect(result).toEqual({ rejection: { reason: "TOO_MANY_TAGS", field: "tags" } });
  });

  it("rejects a tag over the length limit", () => {
    const result = validateImportRow(raw({ tags: "a".repeat(41) }));
    expect(result).toEqual({ rejection: { reason: "TAG_TOO_LONG", field: "tags" } });
  });

  it("ignores empty tag entries (trailing separator, double separator)", () => {
    const result = validateImportRow(raw({ tags: "a;;b;" }));
    expect("row" in result && result.row.tags).toEqual(["a", "b"]);
  });

  it("ACCEPTS a formula-like value (=, +, -, @) with a warning - never rejects it (D-042 rodada 2: defense belongs at the export boundary, not import)", () => {
    const result = validateImportRow(raw({ displayName: "=SUM(A1:A2)" }));
    expect("row" in result && result.row.warnings).toEqual(["FORMULA_LIKE_VALUE"]);
    // A legitimate value that merely starts with one of those characters must not be rejected.
    const negativeName = validateImportRow(raw({ displayName: "-45 Holdings" }));
    expect("row" in negativeName).toBe(true);
  });

  it("externalId is optional - absence is never a rejection", () => {
    const result = validateImportRow(raw({ externalId: undefined }));
    expect("row" in result && result.row.externalId).toBeUndefined();
  });
});
