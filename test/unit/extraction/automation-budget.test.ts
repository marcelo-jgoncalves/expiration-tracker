import { describe, expect, it } from "vitest";
import { automationBudgetWindow, resolveBedrockCostCentsPerCall } from "../../../src/modules/extraction/domain/automation-budget.js";

describe("resolveBedrockCostCentsPerCall", () => {
  it("returns undefined when unset or blank - the fail-closed default", () => {
    expect(resolveBedrockCostCentsPerCall(undefined)).toBeUndefined();
    expect(resolveBedrockCostCentsPerCall("")).toBeUndefined();
    expect(resolveBedrockCostCentsPerCall("   ")).toBeUndefined();
  });

  it("returns the parsed value for a positive integer string", () => {
    expect(resolveBedrockCostCentsPerCall("36")).toBe(36);
    expect(resolveBedrockCostCentsPerCall("1")).toBe(1);
  });

  /** Codex R4 finding (MÉDIO): this resolver used to accept fractional values (`Number.isFinite`
   * only) that `TenantQuotaService`'s own `validatedAmount()` (quota.ts) rejects (requires
   * `Number.isInteger`) - a mismatch that let a misconfigured env var reserve AI_CALL and then
   * throw a raw, uncaught Error mid-run instead of degrading gracefully. Must match quota.ts's
   * contract exactly: positive integer only. */
  it("rejects fractional, zero, negative, and non-numeric values - never lets an invalid config slip past into quota.consume()'s stricter check", () => {
    expect(resolveBedrockCostCentsPerCall("35.5")).toBeUndefined();
    expect(resolveBedrockCostCentsPerCall("0.5")).toBeUndefined();
    expect(resolveBedrockCostCentsPerCall("0")).toBeUndefined();
    expect(resolveBedrockCostCentsPerCall("-8")).toBeUndefined();
    expect(resolveBedrockCostCentsPerCall("not-a-number")).toBeUndefined();
    expect(resolveBedrockCostCentsPerCall("NaN")).toBeUndefined();
    expect(resolveBedrockCostCentsPerCall("Infinity")).toBeUndefined();
  });
});

describe("automationBudgetWindow", () => {
  it("derives a calendar-month key from an ISO timestamp", () => {
    expect(automationBudgetWindow("2026-09-27T23:59:59.999Z")).toBe("CYCLE#2026-09");
    expect(automationBudgetWindow("2026-10-01T00:00:00.000Z")).toBe("CYCLE#2026-10");
  });
});
