/**
 * Unit + dogfooding tests for scripts/check-dependency-freshness.ts (D-139/D-148,
 * docs/engineering/dependency-freshness-standard.md). Mirrors
 * test/architecture/check-doc-drift.test.ts's shape: pure-logic unit tests against synthetic
 * input, plus one integration-style test that runs the real checker against the real repo
 * state (dogfooding proof the policy in docs/engineering/dependency-freshness-policy.json
 * actually matches reality today).
 */
import { describe, expect, it } from "vitest";
import {
  CANONICAL_IDS,
  checkInventoryCompleteness,
  classifyLifecycleWindow,
  isReviewStale,
  loadPolicy,
  parseNodeLine,
  runChecks,
  type CriticalDependencyEntry,
  type Violation,
} from "../../scripts/check-dependency-freshness.js";

describe("parseNodeLine", () => {
  it("extracts the LTS line from common Node version notations", () => {
    expect(parseNodeLine("24")).toBe("24");
    expect(parseNodeLine("24.x")).toBe("24");
    expect(parseNodeLine("v24.7.0")).toBe("24");
    expect(parseNodeLine("24.7.0")).toBe("24");
  });

  it("returns null for a range that isn't a single pinned line", () => {
    expect(parseNodeLine(">=20")).toBeNull();
    expect(parseNodeLine("^20.14.0")).toBeNull();
  });
});

describe("classifyLifecycleWindow (standard §2's 3-window gate)", () => {
  const now = new Date("2026-09-01T00:00:00Z");

  it("classifies well beyond 12 months as ok", () => {
    expect(classifyLifecycleWindow("2029-01-01", now)).toBe("ok");
  });

  it("classifies well within 6 months as gate", () => {
    expect(classifyLifecycleWindow("2026-10-01", now)).toBe("gate");
  });

  it("classifies between 6 and 12 months as warn", () => {
    expect(classifyLifecycleWindow("2027-03-01", now)).toBe("warn");
  });

  it("boundary: exactly 6 months away is warn, not gate (< 6mo is the gate condition)", () => {
    const exactlySixMonths = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 6, now.getUTCDate()));
    expect(classifyLifecycleWindow(exactlySixMonths.toISOString().slice(0, 10), now)).toBe("warn");
  });

  it("boundary: exactly 12 months away is warn, not ok (> 12mo is the no-action condition)", () => {
    const exactlyTwelveMonths = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 12, now.getUTCDate()));
    expect(classifyLifecycleWindow(exactlyTwelveMonths.toISOString().slice(0, 10), now)).toBe("warn");
  });

  it("boundary: one day inside 6 months is gate", () => {
    const now2 = new Date("2026-09-01T00:00:00Z");
    const oneDayInside = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth() + 6, now2.getUTCDate() - 1));
    expect(classifyLifecycleWindow(oneDayInside.toISOString().slice(0, 10), now2)).toBe("gate");
  });
});

describe("isReviewStale", () => {
  const now = new Date("2026-09-01T00:00:00Z");

  it("is not stale within 6 months", () => {
    expect(isReviewStale("2026-06-01", now)).toBe(false);
  });

  it("is stale past 6 months", () => {
    expect(isReviewStale("2025-12-01", now)).toBe(true);
  });
});

describe("checkInventoryCompleteness", () => {
  function entry(id: string): CriticalDependencyEntry {
    return {
      id,
      detectedFrom: [],
      owner: "marcelo",
      officialSource: "https://example.com",
      discoveryMechanism: "manual-release-review",
      reviewedAt: "2026-09-01",
    };
  }

  it("raises no violation when the policy exactly matches the canonical id set", () => {
    const violations: Violation[] = [];
    checkInventoryCompleteness(CANONICAL_IDS.map((id) => entry(id)), violations);
    expect(violations).toHaveLength(0);
  });

  it("flags a canonical id missing from the policy", () => {
    const violations: Violation[] = [];
    const withoutNode = CANONICAL_IDS.filter((id) => id !== "node").map((id) => entry(id));
    checkInventoryCompleteness(withoutNode, violations);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.id).toBe("node");
    expect(violations[0]?.severity).toBe("fail");
  });

  it("flags an orphaned entry not in the canonical set", () => {
    const violations: Violation[] = [];
    const withOrphan = [...CANONICAL_IDS.map((id) => entry(id)), entry("some-removed-dep")];
    checkInventoryCompleteness(withOrphan, violations);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.id).toBe("some-removed-dep");
    expect(violations[0]?.message).toContain("orphaned");
  });
});

describe("runChecks — dogfooding against the real repo (D-148)", () => {
  it("passes cleanly for the real dependency-freshness-policy.json against real repo state", () => {
    const policy = loadPolicy();
    const violations = runChecks(policy, new Date());
    const fails = violations.filter((v) => v.severity === "fail");
    expect(fails, JSON.stringify(fails, null, 2)).toHaveLength(0);
  });

  it("the real policy file's ids exactly match the canonical §4 inventory", () => {
    const policy = loadPolicy();
    expect(new Set(policy.map((e) => e.id))).toEqual(new Set(CANONICAL_IDS));
  });
});
