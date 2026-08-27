import { describe, expect, it } from "vitest";
import { decideFieldOutcome } from "../../../src/modules/extraction/domain/decide-field-outcome.js";
import { DETERMINISTIC_CONFIDENCE_THRESHOLD } from "../../../src/modules/extraction/domain/field-schema.js";

describe("decideFieldOutcome", () => {
  it("PENDING_CONFIRMATION when there is no candidate value at all", () => {
    expect(decideFieldOutcome({ agreement: "SINGLE_SOURCE", sources: [] })).toEqual({ state: "PENDING_CONFIRMATION" });
  });

  it("PENDING_CONFIRMATION on MISMATCH regardless of confidence", () => {
    const result = decideFieldOutcome({ agreement: "MISMATCH", sources: ["DETERMINISTIC_PARSER", "BEDROCK"], candidateValue: "2027-03-31", confidence: 0.99 });
    expect(result).toEqual({ state: "PENDING_CONFIRMATION" });
  });

  it("PENDING_CONFIRMATION for a SINGLE_SOURCE candidate below the confidence threshold", () => {
    const result = decideFieldOutcome({
      agreement: "SINGLE_SOURCE",
      sources: ["DETERMINISTIC_PARSER"],
      candidateValue: "2027-03-31",
      confidence: DETERMINISTIC_CONFIDENCE_THRESHOLD - 0.01,
    });
    expect(result).toEqual({ state: "PENDING_CONFIRMATION" });
  });

  it("PENDING_CONFIRMATION for a SINGLE_SOURCE candidate with undefined confidence (conservative default)", () => {
    const result = decideFieldOutcome({ agreement: "SINGLE_SOURCE", sources: ["BEDROCK"], candidateValue: "2027-03-31" });
    expect(result).toEqual({ state: "PENDING_CONFIRMATION" });
  });

  it("CONFIRMED for a SINGLE_SOURCE candidate at/above the confidence threshold", () => {
    const result = decideFieldOutcome({
      agreement: "SINGLE_SOURCE",
      sources: ["DETERMINISTIC_PARSER"],
      candidateValue: "2027-03-31",
      confidence: DETERMINISTIC_CONFIDENCE_THRESHOLD,
    });
    expect(result).toEqual({ state: "CONFIRMED", confirmedValue: "2027-03-31" });
  });

  it("CONFIRMED for a MATCH regardless of the winning candidate's own confidence value", () => {
    const result = decideFieldOutcome({ agreement: "MATCH", sources: ["DETERMINISTIC_PARSER", "BEDROCK"], candidateValue: "2027-03-31", confidence: 0.4 });
    expect(result).toEqual({ state: "CONFIRMED", confirmedValue: "2027-03-31" });
  });

  it("never returns REJECTED - that state is only reachable via the human reject HTTP route", () => {
    const cases = [
      { agreement: "SINGLE_SOURCE" as const, sources: [] },
      { agreement: "MISMATCH" as const, sources: ["DETERMINISTIC_PARSER" as const], candidateValue: "x", confidence: 0.9 },
      { agreement: "MATCH" as const, sources: ["DETERMINISTIC_PARSER" as const, "BEDROCK" as const], candidateValue: "x", confidence: 0.9 },
    ];
    for (const c of cases) {
      expect(decideFieldOutcome(c).state).not.toBe("REJECTED");
    }
  });
});
