import { describe, expect, it } from "vitest";
import { isValidE164 } from "../../../src/shared/text/phone-e164.js";

describe("isValidE164", () => {
  it("accepts well-formed E.164 numbers", () => {
    expect(isValidE164("+15551234567")).toBe(true);
    expect(isValidE164("+5511987654321")).toBe(true);
    expect(isValidE164("+447911123456")).toBe(true);
  });

  it("rejects a missing leading +", () => {
    expect(isValidE164("15551234567")).toBe(false);
  });

  it("rejects a leading zero right after the +", () => {
    expect(isValidE164("+05551234567")).toBe(false);
  });

  it("rejects non-digit characters (spaces, dashes, parentheses)", () => {
    expect(isValidE164("+1 555 123 4567")).toBe(false);
    expect(isValidE164("+1-555-123-4567")).toBe(false);
    expect(isValidE164("+1(555)1234567")).toBe(false);
  });

  it("rejects a number exceeding the 15-digit E.164 cap", () => {
    expect(isValidE164("+1234567890123456")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidE164("")).toBe(false);
  });
});
