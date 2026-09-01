import { describe, expect, it } from "vitest";
import {
  deriveRequirementStatus,
  isRequirementExpiringSoon,
  requirementKey,
  requirementGsi1Keys,
  REQUIREMENT_SK_PREFIX,
} from "../../../src/modules/document-archive/domain/requirement.js";

const NOW = new Date("2026-09-01T00:00:00.000Z");

describe("deriveRequirementStatus (D-143 Decision 5)", () => {
  it("NOT_APPLICABLE always wins, regardless of evidence", () => {
    expect(deriveRequirementStatus("NOT_APPLICABLE", undefined, NOW)).toBe("NOT_APPLICABLE");
    expect(deriveRequirementStatus("NOT_APPLICABLE", { state: "ACCEPTED" }, NOW)).toBe("NOT_APPLICABLE");
    expect(deriveRequirementStatus("NOT_APPLICABLE", { state: "ACCEPTED", validUntil: "2020-01-01" }, NOW)).toBe("NOT_APPLICABLE");
  });

  it("MISSING when applicable with no evidence linked", () => {
    expect(deriveRequirementStatus("APPLICABLE", undefined, NOW)).toBe("MISSING");
  });

  it.each(["DRAFT", "RECEIVED", "UNDER_REVIEW", "REJECTED", "SUPERSEDED", "WITHDRAWN"] as const)(
    "PENDING when evidence is linked but its state is %s (not yet ACCEPTED)",
    (state) => {
      expect(deriveRequirementStatus("APPLICABLE", { state }, NOW)).toBe("PENDING");
    },
  );

  it("SATISFIED when evidence is ACCEPTED with no validUntil", () => {
    expect(deriveRequirementStatus("APPLICABLE", { state: "ACCEPTED" }, NOW)).toBe("SATISFIED");
  });

  it("SATISFIED when evidence is ACCEPTED and validUntil is in the future", () => {
    expect(deriveRequirementStatus("APPLICABLE", { state: "ACCEPTED", validUntil: "2026-12-31" }, NOW)).toBe("SATISFIED");
  });

  it("SATISFIED when validUntil is exactly now (>=, not >)", () => {
    expect(deriveRequirementStatus("APPLICABLE", { state: "ACCEPTED", validUntil: NOW.toISOString() }, NOW)).toBe("SATISFIED");
  });

  it("NOT_SATISFIED when evidence is ACCEPTED but validUntil is in the past", () => {
    expect(deriveRequirementStatus("APPLICABLE", { state: "ACCEPTED", validUntil: "2020-01-01" }, NOW)).toBe("NOT_SATISFIED");
  });
});

describe("isRequirementExpiringSoon (D9: read-time subdivision of SATISFIED, never persisted)", () => {
  it("false for any non-SATISFIED status", () => {
    expect(isRequirementExpiringSoon("MISSING", "2026-09-05", NOW)).toBe(false);
    expect(isRequirementExpiringSoon("PENDING", "2026-09-05", NOW)).toBe(false);
    expect(isRequirementExpiringSoon("NOT_SATISFIED", "2026-08-01", NOW)).toBe(false);
    expect(isRequirementExpiringSoon("NOT_APPLICABLE", "2026-09-05", NOW)).toBe(false);
  });

  it("false for SATISFIED with no validUntil (never expires)", () => {
    expect(isRequirementExpiringSoon("SATISFIED", undefined, NOW)).toBe(false);
  });

  it("true for SATISFIED within the 7-day window (mirrors presentation.ts SOON_THRESHOLD_DAYS)", () => {
    expect(isRequirementExpiringSoon("SATISFIED", "2026-09-07", NOW)).toBe(true); // +6 days
    expect(isRequirementExpiringSoon("SATISFIED", "2026-09-08", NOW)).toBe(true); // +7 days, boundary
    expect(isRequirementExpiringSoon("SATISFIED", "2026-09-01", NOW)).toBe(true); // due today
  });

  it("false for SATISFIED beyond the 7-day window", () => {
    expect(isRequirementExpiringSoon("SATISFIED", "2026-09-09", NOW)).toBe(false); // +8 days
    expect(isRequirementExpiringSoon("SATISFIED", "2026-12-31", NOW)).toBe(false);
  });
});

describe("key builders", () => {
  it("requirementKey co-locates under the Subject partition", () => {
    expect(requirementKey("t1", "s1", "r1")).toEqual({ PK: "TENANT#t1#SUBJECT#s1", SK: "REQUIREMENT#r1" });
    expect("REQUIREMENT#r1".startsWith(REQUIREMENT_SK_PREFIX)).toBe(true);
  });

  it("requirementGsi1Keys namespaces REQSTATUS on the shared GSI1 index", () => {
    expect(requirementGsi1Keys("t1", "SATISFIED", "2026-09-01T00:00:00.000Z", "r1")).toEqual({
      GSI1PK: "TENANT#t1#REQSTATUS#SATISFIED",
      GSI1SK: "UPDATED#2026-09-01T00:00:00.000Z#REQUIREMENT#r1",
    });
  });
});
