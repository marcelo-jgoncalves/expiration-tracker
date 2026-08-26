import { describe, expect, it } from "vitest";
import { compareExtractors } from "../../../src/modules/extraction/domain/compare-extractors.js";

describe("compareExtractors", () => {
  it("returns SINGLE_SOURCE with no candidateValue when zero usable candidates exist", () => {
    const result = compareExtractors([]);
    expect(result).toEqual({ agreement: "SINGLE_SOURCE", sources: [] });
  });

  it("returns SINGLE_SOURCE with no candidateValue when the only candidate failed schema validation", () => {
    const result = compareExtractors([{ source: "DETERMINISTIC_PARSER", value: "not-a-date", confidence: 0.9, valid: false }]);
    expect(result).toEqual({ agreement: "SINGLE_SOURCE", sources: [] });
  });

  it("returns SINGLE_SOURCE with the candidate when only one extractor produced a usable value", () => {
    const result = compareExtractors([{ source: "DETERMINISTIC_PARSER", value: "2027-03-31", confidence: 0.9, valid: true }]);
    expect(result).toEqual({ agreement: "SINGLE_SOURCE", sources: ["DETERMINISTIC_PARSER"], candidateValue: "2027-03-31", confidence: 0.9 });
  });

  it("returns MATCH when two sources agree on the same value", () => {
    const result = compareExtractors([
      { source: "DETERMINISTIC_PARSER", value: "2027-03-31", confidence: 0.6, valid: true },
      { source: "BEDROCK", value: "2027-03-31", confidence: 0.95, valid: true },
    ]);
    expect(result.agreement).toBe("MATCH");
    expect(result.sources).toEqual(["DETERMINISTIC_PARSER", "BEDROCK"]);
    expect(result.candidateValue).toBe("2027-03-31");
    expect(result.confidence).toBe(0.95); // highest-confidence of the agreeing pair
  });

  it("returns MISMATCH when two sources disagree, never auto-picking a winner as the agreement", () => {
    const result = compareExtractors([
      { source: "DETERMINISTIC_PARSER", value: "2027-03-31", confidence: 0.6, valid: true },
      { source: "BEDROCK", value: "2028-01-01", confidence: 0.95, valid: true },
    ]);
    expect(result.agreement).toBe("MISMATCH");
    expect(result.sources).toEqual(["DETERMINISTIC_PARSER", "BEDROCK"]);
    // candidateValue is still populated (highest confidence) for display, but agreement is what
    // routes this to PENDING_CONFIRMATION - decide-field-outcome.test.ts covers that.
    expect(result.candidateValue).toBe("2028-01-01");
  });

  it("ignores an invalid candidate alongside a valid one, degrading to SINGLE_SOURCE", () => {
    const result = compareExtractors([
      { source: "DETERMINISTIC_PARSER", value: "not-a-date", confidence: 0.9, valid: false },
      { source: "BEDROCK", value: "2027-03-31", confidence: 0.8, valid: true },
    ]);
    expect(result).toEqual({ agreement: "SINGLE_SOURCE", sources: ["BEDROCK"], candidateValue: "2027-03-31", confidence: 0.8 });
  });
});
