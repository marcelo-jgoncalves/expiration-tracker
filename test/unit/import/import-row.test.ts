import { describe, expect, it } from "vitest";
import { validateImportRow, validateItemImportRow, normalizeCsvDateTime, buildItemDedupKey, type RawImportRow, type RawItemImportRow } from "../../../src/modules/import/domain/import-row.js";

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

// D-3xx (2026-09-21, PENDING_PROTOCOL_REVIEW) — Item row shape.

function itemRaw(overrides: Partial<RawItemImportRow> = {}): RawItemImportRow {
  return { rowNumber: 1, name: "Alvará de Funcionamento", category: "Licença", dueDate: "2026-12-31", ...overrides };
}

describe("normalizeCsvDateTime (D-3xx)", () => {
  // Would fail if the plain-date branch stopped normalizing to midnight UTC.
  it("normalizes a bare YYYY-MM-DD to midnight UTC ISO date-time", () => {
    expect(normalizeCsvDateTime("2026-12-31")).toBe("2026-12-31T00:00:00.000Z");
  });

  // Would fail if a full ISO date-time were mangled instead of passed through unchanged.
  it("accepts an already-full ISO-8601 date-time unchanged", () => {
    expect(normalizeCsvDateTime("2026-12-31T14:30:00.000Z")).toBe("2026-12-31T14:30:00.000Z");
  });

  // Would fail if the calendar-validity check were dropped (e.g. treating "30" as a valid day
  // for every month via naive Date rollover instead of rejecting it).
  it("rejects a calendar-invalid date (2026-02-30)", () => {
    expect(normalizeCsvDateTime("2026-02-30")).toBeUndefined();
  });

  // Would fail if an obviously non-date string were coerced via a lenient Date.parse fallback.
  it("rejects a non-date string", () => {
    expect(normalizeCsvDateTime("not-a-date")).toBeUndefined();
  });
});

describe("validateItemImportRow (D-3xx)", () => {
  // Would fail if the required-field guard for name were removed.
  it("accepts a well-formed row", () => {
    const result = validateItemImportRow(itemRaw({ description: "nota", tags: "a;b", priority: "HIGH" }));
    expect("row" in result).toBe(true);
    if ("row" in result) {
      expect(result.row.name).toBe("Alvará de Funcionamento");
      expect(result.row.category).toBe("Licença");
      expect(result.row.dueDate).toBe("2026-12-31T00:00:00.000Z");
      expect(result.row.tags).toEqual(["a", "b"]);
      expect(result.row.warnings).toEqual([]);
    }
  });

  // Would fail if the MISSING_NAME guard were dropped (name has no fallback/default).
  it("rejects a missing name", () => {
    const result = validateItemImportRow(itemRaw({ name: "  " }));
    expect(result).toEqual({ rejection: { reason: "MISSING_NAME", field: "name" } });
  });

  // Would fail if the MISSING_CATEGORY guard were dropped.
  it("rejects a missing category", () => {
    const result = validateItemImportRow(itemRaw({ category: undefined }));
    expect(result).toEqual({ rejection: { reason: "MISSING_CATEGORY", field: "category" } });
  });

  // Would fail if the MISSING_DUE_DATE guard were dropped.
  it("rejects a missing dueDate", () => {
    const result = validateItemImportRow(itemRaw({ dueDate: undefined }));
    expect(result).toEqual({ rejection: { reason: "MISSING_DUE_DATE", field: "dueDate" } });
  });

  // Would fail if normalizeCsvDateTime's rejection path were ignored/swallowed here.
  it("rejects an unparseable dueDate", () => {
    const result = validateItemImportRow(itemRaw({ dueDate: "31/12/2026" }));
    expect(result).toEqual({ rejection: { reason: "INVALID_DUE_DATE", field: "dueDate" } });
  });

  // Would fail if issueDate's own normalization/rejection branch were skipped.
  it("rejects an unparseable issueDate", () => {
    const result = validateItemImportRow(itemRaw({ issueDate: "not-a-date" }));
    expect(result).toEqual({ rejection: { reason: "INVALID_ISSUE_DATE", field: "issueDate" } });
  });

  // Would fail if the name length cap (200, mirrors create-item-request.v1.json) were removed.
  it("rejects a name over the length limit", () => {
    const result = validateItemImportRow(itemRaw({ name: "a".repeat(201) }));
    expect(result).toEqual({ rejection: { reason: "NAME_TOO_LONG", field: "name" } });
  });

  // Would fail if the category length cap (100) were removed.
  it("rejects a category over the length limit", () => {
    const result = validateItemImportRow(itemRaw({ category: "a".repeat(101) }));
    expect(result).toEqual({ rejection: { reason: "CATEGORY_TOO_LONG", field: "category" } });
  });

  // Would fail if control-character rejection were dropped for a non-required field (description).
  it("rejects a control character (NUL) embedded in description", () => {
    const result = validateItemImportRow(itemRaw({ description: "nota\x00suja" }));
    expect(result).toEqual({ rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "description" } });
  });

  // Would fail if the tag-limit reuse from TrackedSubject's constants were broken.
  it("rejects more than 20 tags, same limit as TrackedSubject", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`).join(";");
    const result = validateItemImportRow(itemRaw({ tags }));
    expect(result).toEqual({ rejection: { reason: "TOO_MANY_TAGS", field: "tags" } });
  });

  // Would fail if optional fields (description/issueDate/periodicity/issuer/number/priority)
  // stopped being treated as genuinely optional.
  it("accepts a row with only the 3 required fields", () => {
    const result = validateItemImportRow(itemRaw());
    expect("row" in result).toBe(true);
    if ("row" in result) {
      expect(result.row.description).toBeUndefined();
      expect(result.row.issueDate).toBeUndefined();
      expect(result.row.periodicity).toBeUndefined();
      expect(result.row.issuer).toBeUndefined();
      expect(result.row.number).toBeUndefined();
      expect(result.row.priority).toBeUndefined();
    }
  });
});

describe("buildItemDedupKey (D-3xx decision 3)", () => {
  // Would fail if normalization (diacritics/case/whitespace) were dropped from either component.
  it("normalizes category and name (diacritics, case, whitespace) into the same key", () => {
    const a = buildItemDedupKey("Licença", "Alvará  de Funcionamento", "2026-12-31T00:00:00.000Z");
    const b = buildItemDedupKey("licenca", "alvara de funcionamento", "2026-12-31T00:00:00.000Z");
    expect(a).toBe(b);
  });

  // Would fail if dueDate were dropped from the key, wrongly conflating a legitimately recurring
  // item (same name/category, different due date) with a genuine duplicate.
  it("treats the same name/category with a DIFFERENT dueDate as a different key", () => {
    const a = buildItemDedupKey("Licença", "Alvará", "2026-12-31T00:00:00.000Z");
    const b = buildItemDedupKey("Licença", "Alvará", "2027-12-31T00:00:00.000Z");
    expect(a).not.toBe(b);
  });
});
