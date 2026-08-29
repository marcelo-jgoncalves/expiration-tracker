/**
 * Unit tests for the two guardrails added to scripts/check-doc-drift.ts during the
 * 2026-08-29/30 context-engineering reconciliation (root allowlist + size guardrail).
 * The existing link/AGENTS.md-section checks in that script are exercised implicitly by
 * every `npm run check-docs` run against the real repo; these two are new policy, not
 * derived from repo content, so they get direct unit coverage against synthetic input.
 */
import { describe, expect, it } from "vitest";
import { checkRootAllowlist, checkSizeGuardrail, ROOT_MD_ALLOWLIST } from "../../scripts/check-doc-drift.js";

describe("checkRootAllowlist", () => {
  it("raises no violation for every file in the real allowlist", () => {
    const violations: { file: string; line: number; message: string }[] = [];
    checkRootAllowlist([...ROOT_MD_ALLOWLIST], ROOT_MD_ALLOWLIST, violations);
    expect(violations).toHaveLength(0);
  });

  it("raises a violation for a stray root .md file not in the allowlist", () => {
    const violations: { file: string; line: number; message: string }[] = [];
    checkRootAllowlist(["AGENTS.md", "some-handoff-prompt.md"], ROOT_MD_ALLOWLIST, violations);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("some-handoff-prompt.md");
  });

  it("ignores non-.md files entirely (e.g. LICENSE, .nvmrc)", () => {
    const violations: { file: string; line: number; message: string }[] = [];
    checkRootAllowlist(["LICENSE", ".nvmrc", "package.json"], ROOT_MD_ALLOWLIST, violations);
    expect(violations).toHaveLength(0);
  });
});

describe("checkSizeGuardrail", () => {
  it("raises no violation when at or under the limit", () => {
    const violations: { file: string; line: number; message: string }[] = [];
    checkSizeGuardrail("AGENTS.md", 100, 100, violations);
    checkSizeGuardrail("AGENTS.md", 73, 100, violations);
    expect(violations).toHaveLength(0);
  });

  it("raises a violation when over the limit", () => {
    const violations: { file: string; line: number; message: string }[] = [];
    checkSizeGuardrail("NEXT_SESSION_PROMPT.md", 1067, 300, violations);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("300-line guardrail");
  });
});
