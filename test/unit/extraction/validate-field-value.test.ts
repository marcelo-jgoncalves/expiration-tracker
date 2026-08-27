import { describe, expect, it } from "vitest";
import { isValidFieldValue } from "../../../src/modules/extraction/domain/validate-field-value.js";

describe("isValidFieldValue", () => {
  it("accepts a well-formed ISO date", () => {
    expect(isValidFieldValue("DATE", "2027-03-31")).toBe(true);
  });

  it("rejects a non-ISO date format", () => {
    expect(isValidFieldValue("DATE", "31/03/2027")).toBe(false);
  });

  it("rejects an ISO-shaped but calendar-invalid date", () => {
    expect(isValidFieldValue("DATE", "2027-13-40")).toBe(false);
  });

  it("accepts a finite number string", () => {
    expect(isValidFieldValue("NUMBER", "42")).toBe(true);
  });

  it("rejects a non-numeric NUMBER value", () => {
    expect(isValidFieldValue("NUMBER", "abc")).toBe(false);
  });

  it("rejects an empty NUMBER value", () => {
    expect(isValidFieldValue("NUMBER", "  ")).toBe(false);
  });

  it("accepts any non-empty STRING value", () => {
    expect(isValidFieldValue("STRING", "anything")).toBe(true);
  });

  it("rejects an empty/whitespace-only STRING value", () => {
    expect(isValidFieldValue("STRING", "   ")).toBe(false);
  });
});
