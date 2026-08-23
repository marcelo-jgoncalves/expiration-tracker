import { describe, expect, it } from "vitest";
import { parseCsv, mapCsvRowsToNamedFields } from "../../../src/modules/import/application/csv-parser.js";

describe("parseCsv (M11, D-042)", () => {
  it("parses a simple unquoted CSV with a header row", () => {
    const result = parseCsv("displayName,type\nACME,VENDOR\nBeta,CLIENT\n");
    expect(result.header).toEqual(["displayName", "type"]);
    expect(result.rows).toEqual([
      ["ACME", "VENDOR"],
      ["Beta", "CLIENT"],
    ]);
  });

  it("handles CRLF line endings", () => {
    const result = parseCsv("displayName,type\r\nACME,VENDOR\r\n");
    expect(result.rows).toEqual([["ACME", "VENDOR"]]);
  });

  it("handles a file with no trailing newline", () => {
    const result = parseCsv("displayName,type\nACME,VENDOR");
    expect(result.rows).toEqual([["ACME", "VENDOR"]]);
  });

  it("handles a quoted field containing a comma", () => {
    const result = parseCsv('displayName,notes\n"ACME, Inc.",hello\n');
    expect(result.rows).toEqual([["ACME, Inc.", "hello"]]);
  });

  it("handles a quoted field containing an escaped double-quote", () => {
    const result = parseCsv('displayName\n"Say ""hi"""\n');
    expect(result.rows).toEqual([['Say "hi"']]);
  });

  it("handles a quoted field containing a literal newline (RFC4180)", () => {
    const result = parseCsv('displayName,notes\nACME,"line1\nline2"\n');
    expect(result.rows).toEqual([["ACME", "line1\nline2"]]);
  });

  it("handles an empty field", () => {
    const result = parseCsv("a,b,c\n1,,3\n");
    expect(result.rows).toEqual([["1", "", "3"]]);
  });

  it("handles an empty input without throwing", () => {
    const result = parseCsv("");
    expect(result.header).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("handles a header-only file (no data rows)", () => {
    const result = parseCsv("displayName,type\n");
    expect(result.header).toEqual(["displayName", "type"]);
    expect(result.rows).toEqual([]);
  });
});

describe("mapCsvRowsToNamedFields", () => {
  it("maps positional rows to named fields using a case-insensitive, trimmed header", () => {
    const result = mapCsvRowsToNamedFields([" DisplayName ", "Type"], [["ACME", "VENDOR"]]);
    expect(result).toEqual([{ displayname: "ACME", type: "VENDOR" }]);
  });

  it("defaults a missing trailing column to an empty string rather than undefined", () => {
    const result = mapCsvRowsToNamedFields(["displayName", "type", "notes"], [["ACME", "VENDOR"]]);
    expect(result).toEqual([{ displayname: "ACME", type: "VENDOR", notes: "" }]);
  });
});
