import { describe, expect, it } from "vitest";
import { needsBedrock, type BedrockDecisionInput, type FieldExtractionAssessment } from "../../../src/modules/extraction/domain/decide-bedrock.js";
import { THRESHOLD_VERSION_V1 } from "../../../src/modules/extraction/domain/field-schema.js";

function requiredField(overrides: Partial<FieldExtractionAssessment> = {}): FieldExtractionAssessment {
  return {
    fieldName: "expirationDate",
    required: true,
    deterministicCandidate: { value: "2027-03-31", valueType: "DATE", confidence: 0.95 },
    ocrCandidates: [],
    ...overrides,
  };
}

function decision(fields: FieldExtractionAssessment[], ocrAvailable = true): BedrockDecisionInput {
  return { fields, ocrAvailable, thresholdVersion: THRESHOLD_VERSION_V1 };
}

describe("needsBedrock", () => {
  it("returns false when every required field has a confident deterministic candidate and no OCR ambiguity", () => {
    expect(needsBedrock(decision([requiredField()]))).toBe(false);
  });

  it("returns true when a required field has no deterministic candidate at all", () => {
    expect(needsBedrock(decision([requiredField({ deterministicCandidate: undefined })]))).toBe(true);
  });

  it("returns true when a required field's deterministic candidate is below the confidence threshold", () => {
    expect(needsBedrock(decision([requiredField({ deterministicCandidate: { value: "2027-03-31", valueType: "DATE", confidence: 0.74 } })]))).toBe(true);
  });

  it("returns false when confidence is exactly at the threshold (boundary is exclusive below, not at)", () => {
    expect(needsBedrock(decision([requiredField({ deterministicCandidate: { value: "2027-03-31", valueType: "DATE", confidence: 0.75 } })]))).toBe(false);
  });

  it("returns true when OCR is available and produced 2+ ambiguous candidates for a required field", () => {
    const field = requiredField({
      ocrCandidates: [
        { value: "2027-03-31", valueType: "DATE", confidence: 0.9 },
        { value: "2027-04-30", valueType: "DATE", confidence: 0.9 },
      ],
    });
    expect(needsBedrock(decision([field]))).toBe(true);
  });

  it("never escalates on OCR ambiguity alone when OCR is unavailable (kill switch / Textract job failed)", () => {
    const field = requiredField({
      ocrCandidates: [
        { value: "2027-03-31", valueType: "DATE", confidence: 0.9 },
        { value: "2027-04-30", valueType: "DATE", confidence: 0.9 },
      ],
    });
    expect(needsBedrock(decision([field], false))).toBe(false);
  });

  it("never escalates on a single OCR candidate, even when OCR is available", () => {
    const field = requiredField({ ocrCandidates: [{ value: "2027-03-31", valueType: "DATE", confidence: 0.9 }] });
    expect(needsBedrock(decision([field]))).toBe(false);
  });

  it("ignores a non-required field entirely, regardless of how bad its candidate is", () => {
    const optionalField = requiredField({ fieldName: "documentNumber", required: false, deterministicCandidate: undefined });
    expect(needsBedrock(decision([optionalField]))).toBe(false);
  });

  it("returns true if ANY required field needs escalation, even when others are fine", () => {
    const goodField = requiredField();
    const badField = requiredField({ fieldName: "otherField", deterministicCandidate: undefined });
    expect(needsBedrock(decision([goodField, badField]))).toBe(true);
  });
});
