import { describe, expect, it } from "vitest";
import {
  deriveRequirementStatus,
  deriveRequirementValidityState,
  isRequirementExpiringSoon,
  requirementKey,
  requirementGsi1Keys,
  requirementGsi9Keys,
  requirementGsi9PartitionKey,
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

describe("GSI_EVIDENCE (GSI9, D-193 slice 5) key builders", () => {
  it("requirementGsi9Keys builds a partition keyed by DocumentVersion, sorted by Requirement", () => {
    expect(requirementGsi9Keys({ tenantId: "t1", evidenceVersionId: "v1", requirementId: "r1" })).toEqual({
      GSI9PK: "TENANT#t1#DOCVERSION#v1",
      GSI9SK: "REQUIREMENT#r1",
    });
  });

  it("requirementGsi9PartitionKey matches the PK half of requirementGsi9Keys exactly (query/write stay in lockstep)", () => {
    const full = requirementGsi9Keys({ tenantId: "t1", evidenceVersionId: "v1", requirementId: "r1" });
    expect(requirementGsi9PartitionKey("t1", "v1")).toBe(full.GSI9PK);
  });

  it("two different Requirements referencing the same evidence DocumentVersion share GSI9PK but get distinct GSI9SK", () => {
    const a = requirementGsi9Keys({ tenantId: "t1", evidenceVersionId: "v1", requirementId: "r1" });
    const b = requirementGsi9Keys({ tenantId: "t1", evidenceVersionId: "v1", requirementId: "r2" });
    expect(a.GSI9PK).toBe(b.GSI9PK);
    expect(a.GSI9SK).not.toBe(b.GSI9SK);
  });
});

describe("deriveRequirementValidityState (D-194 fatia 1, 8-line table)", () => {
  it("NOT_APPLICABLE -> undefined", () => {
    expect(deriveRequirementValidityState({ status: "NOT_APPLICABLE", evidenceState: undefined, evidenceValidUntil: undefined }, NOW)).toBeUndefined();
  });

  it("MISSING -> undefined", () => {
    expect(deriveRequirementValidityState({ status: "MISSING", evidenceState: undefined, evidenceValidUntil: undefined }, NOW)).toBeUndefined();
  });

  it.each(["REJECTED", "WITHDRAWN", "SUPERSEDED"] as const)("PENDING with terminal-but-not-accepted evidence (%s) -> undefined", (evidenceState) => {
    expect(deriveRequirementValidityState({ status: "PENDING", evidenceState, evidenceValidUntil: undefined }, NOW)).toBeUndefined();
  });

  it.each(["DRAFT", "RECEIVED", "UNDER_REVIEW"] as const)("PENDING with in-flow evidence (%s) -> AGUARDANDO_REVISAO", (evidenceState) => {
    expect(deriveRequirementValidityState({ status: "PENDING", evidenceState, evidenceValidUntil: undefined }, NOW)).toBe("AGUARDANDO_REVISAO");
  });

  it("SATISFIED with no evidenceValidUntil -> PERMANENTE", () => {
    expect(deriveRequirementValidityState({ status: "SATISFIED", evidenceState: "ACCEPTED", evidenceValidUntil: undefined }, NOW)).toBe("PERMANENTE");
  });

  it("SATISFIED with evidenceValidUntil far in the future -> VALIDO", () => {
    expect(deriveRequirementValidityState({ status: "SATISFIED", evidenceState: "ACCEPTED", evidenceValidUntil: "2026-12-31T00:00:00.000Z" }, NOW)).toBe(
      "VALIDO",
    );
  });

  it("SATISFIED with evidenceValidUntil within the soon window -> VENCENDO", () => {
    expect(deriveRequirementValidityState({ status: "SATISFIED", evidenceState: "ACCEPTED", evidenceValidUntil: "2026-09-05T00:00:00.000Z" }, NOW)).toBe(
      "VENCENDO",
    );
  });

  it("NOT_SATISFIED -> VENCIDO", () => {
    expect(deriveRequirementValidityState({ status: "NOT_SATISFIED", evidenceState: "ACCEPTED", evidenceValidUntil: "2020-01-01" }, NOW)).toBe("VENCIDO");
  });
});
