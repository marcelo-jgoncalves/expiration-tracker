import { describe, expect, it } from "vitest";
import { deriveValidityStateFromExpiry } from "../../../src/shared/domain/validity-state.js";

const NOW = new Date("2026-09-03T00:00:00.000Z");

describe("deriveValidityStateFromExpiry (D-194 fatia 1)", () => {
  it("PERMANENTE when no expiry date is given", () => {
    expect(deriveValidityStateFromExpiry(undefined, NOW)).toBe("PERMANENTE");
  });

  it("VENCIDO when the date is in the past", () => {
    expect(deriveValidityStateFromExpiry("2026-09-02T00:00:00.000Z", NOW)).toBe("VENCIDO");
  });

  it("VENCENDO when the date is today (0 days out, inclusive)", () => {
    expect(deriveValidityStateFromExpiry("2026-09-03T00:00:00.000Z", NOW)).toBe("VENCENDO");
  });

  it("VENCENDO at exactly the 7-day boundary", () => {
    expect(deriveValidityStateFromExpiry("2026-09-10T00:00:00.000Z", NOW)).toBe("VENCENDO");
  });

  it("VALIDO just past the 7-day boundary", () => {
    expect(deriveValidityStateFromExpiry("2026-09-11T00:00:00.000Z", NOW)).toBe("VALIDO");
  });

  it("VALIDO far in the future", () => {
    expect(deriveValidityStateFromExpiry("2027-01-01T00:00:00.000Z", NOW)).toBe("VALIDO");
  });
});
