import { describe, expect, it } from "vitest";
import { deriveExpirationItemValidityState } from "../../../src/modules/expiration/domain/expiration-item.js";

const NOW = new Date("2026-09-03T00:00:00.000Z");

describe("deriveExpirationItemValidityState (D-194 fatia 1)", () => {
  it.each(["ARCHIVED", "RENEWED", "DELETED"] as const)("excludes status %s (undefined)", (status) => {
    expect(deriveExpirationItemValidityState({ status, dueDate: "2026-09-05T00:00:00.000Z" }, NOW)).toBeUndefined();
  });

  it("ACTIVE with a future dueDate beyond the soon window -> VALIDO", () => {
    expect(deriveExpirationItemValidityState({ status: "ACTIVE", dueDate: "2027-01-01T00:00:00.000Z" }, NOW)).toBe("VALIDO");
  });

  it("ACTIVE within the soon window -> VENCENDO", () => {
    expect(deriveExpirationItemValidityState({ status: "ACTIVE", dueDate: "2026-09-05T00:00:00.000Z" }, NOW)).toBe("VENCENDO");
  });

  it("ACTIVE with a past dueDate -> VENCIDO", () => {
    expect(deriveExpirationItemValidityState({ status: "ACTIVE", dueDate: "2026-01-01T00:00:00.000Z" }, NOW)).toBe("VENCIDO");
  });
});
