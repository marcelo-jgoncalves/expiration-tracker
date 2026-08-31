import { describe, expect, it } from "vitest";
import { serializeCsvField, serializeCsvRow } from "../../../src/shared/csv/csv-export-writer.js";

describe("csv-export-writer", () => {
  describe("serializeCsvField — RFC4180 quoting", () => {
    it("leaves a plain field unquoted", () => {
      expect(serializeCsvField("Alvará")).toBe("Alvará");
    });

    it("quotes a field containing a comma", () => {
      expect(serializeCsvField("Rio de Janeiro, RJ")).toBe('"Rio de Janeiro, RJ"');
    });

    it("quotes a field containing a double quote and doubles the internal quote", () => {
      expect(serializeCsvField('Say "hi"')).toBe('"Say ""hi"""');
    });

    it("quotes a field containing an embedded newline", () => {
      expect(serializeCsvField("line1\nline2")).toBe('"line1\nline2"');
    });

    it("quotes a field containing an embedded carriage return", () => {
      expect(serializeCsvField("line1\rline2")).toBe('"line1\rline2"');
    });

    it("does not quote a field with none of comma/quote/newline", () => {
      expect(serializeCsvField("plain-value_123")).toBe("plain-value_123");
    });
  });

  describe("serializeCsvField — formula-injection mitigation (roadmap-evolution/09, apostrophe-prefix precedent)", () => {
    for (const trigger of ["=", "+", "-", "@"]) {
      it(`prefixes a leading apostrophe for a value starting with "${trigger}"`, () => {
        expect(serializeCsvField(`${trigger}cmd|'/bin/calc'!A1`)).toBe(`'${trigger}cmd|'/bin/calc'!A1`);
      });
    }

    it("does not mitigate a value where the trigger character appears mid-string, not leading", () => {
      expect(serializeCsvField("total-2026")).toBe("total-2026");
    });

    it("does not mitigate an empty string", () => {
      expect(serializeCsvField("")).toBe("");
    });
  });

  describe("serializeCsvField — both mechanisms apply together in one pass, never two separate ones", () => {
    it("mitigates a formula-triggering value that ALSO needs RFC4180 quoting (embedded comma) — mitigation happens first, then the mitigated (apostrophe-prefixed) value is what gets quoted", () => {
      // Real DEFEATING mutation checked: swapping the order (quote first, then prefix the
      // apostrophe outside the quotes) would produce `'"=1+1,2"` — a syntactically broken CSV
      // field (leading char outside the quoted region). The correct single-pass output quotes
      // the ALREADY-mitigated string.
      expect(serializeCsvField("=1+1,2")).toBe('"\'=1+1,2"');
    });

    it("mitigates a formula-triggering value that also contains an internal double quote", () => {
      expect(serializeCsvField('=cmd|" /C calc"!A1')).toBe('"\'=cmd|"" /C calc""!A1"');
    });
  });

  describe("serializeCsvRow", () => {
    it("joins fields with commas and terminates with CRLF", () => {
      expect(serializeCsvRow(["a", "b", "c"])).toBe("a,b,c\r\n");
    });

    it("applies per-field serialization to every field in the row", () => {
      expect(serializeCsvRow(["=1+1", "plain", "a,b"])).toBe("'=1+1,plain,\"a,b\"\r\n");
    });
  });
});
