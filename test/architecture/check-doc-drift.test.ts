/**
 * Unit tests for the guardrails added to scripts/check-doc-drift.ts: root allowlist + line-count
 * size guardrail (2026-08-29/30 context-engineering reconciliation), and the byte/word density
 * guardrail (2026-09-08, E-022/D-236 - the line-count guardrail alone missed a real regression
 * where NEXT_SESSION_PROMPT.md reaccumulated ~134 KB/~15,600 words while staying under the
 * 300-line ceiling, because each entry had become one giant compacted paragraph per line).
 * The existing link/AGENTS.md-section checks in that script are exercised implicitly by
 * every `npm run check-docs` run against the real repo; these are new policy, not derived
 * from repo content, so they get direct unit coverage against synthetic input.
 */
import { describe, expect, it } from "vitest";
import { checkDensityGuardrail, checkRootAllowlist, checkSizeGuardrail, ROOT_MD_ALLOWLIST } from "../../scripts/check-doc-drift.js";

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

describe("checkDensityGuardrail", () => {
  it("raises no violation for a genuinely small file", () => {
    const violations: { file: string; line: number; message: string }[] = [];
    checkDensityGuardrail("NEXT_SESSION_PROMPT.md", "a few short lines\nof real content\n", 30_000, 4_000, violations);
    expect(violations).toHaveLength(0);
  });

  it("raises a byte-size violation for a small line count but huge content (the E-022/D-236 regression shape)", () => {
    // Simulates the actual regression: very few lines, each one an enormous compacted
    // paragraph - a line-count guardrail alone would see this as "clean".
    const hugeLine = "x".repeat(40_000);
    const content = `${hugeLine}\n${hugeLine}\n`; // 2 lines, well under any line-count ceiling
    const violations: { file: string; line: number; message: string }[] = [];
    checkDensityGuardrail("NEXT_SESSION_PROMPT.md", content, 30_000, 4_000, violations);
    expect(violations.some((v) => v.message.includes("bytes, over the"))).toBe(true);
  });

  it("raises a word-count violation for content under the byte cap but dense with short words", () => {
    const manyWords = Array.from({ length: 5_000 }, () => "w").join(" ");
    const violations: { file: string; line: number; message: string }[] = [];
    checkDensityGuardrail("NEXT_SESSION_PROMPT.md", manyWords, 30_000, 4_000, violations);
    expect(violations.some((v) => v.message.includes("words, over the"))).toBe(true);
  });
});
