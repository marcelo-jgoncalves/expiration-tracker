/**
 * E-020/D-232 — adversarial fixtures for the shared HCL sanitizer used by both
 * scripts/generate-lambda-manifest.ts and this same test suite's independent oracle (see
 * lambda-manifest.test.ts). Each case is a fragment that would corrupt a naive brace-count or
 * `module "x" {` line-scan if left unsanitized.
 */
import { describe, expect, it } from "vitest";
import { stripCommentsStringsAndHeredocs } from "../../../scripts/lib/hcl-lex.js";

function fakeModuleHeaderCount(text: string): number {
  return (stripCommentsStringsAndHeredocs(text).match(/^\s*module\s+"fake"\s*\{/gm) ?? []).length;
}

describe("stripCommentsStringsAndHeredocs", () => {
  it("blanks a line comment (#) without eating the newline", () => {
    const out = stripCommentsStringsAndHeredocs('# module "fake" {\nreal_line');
    expect(fakeModuleHeaderCount('# module "fake" {\nreal_line')).toBe(0);
    expect(out.split("\n")).toHaveLength(2);
  });

  it("blanks a line comment (//) without eating the newline", () => {
    expect(fakeModuleHeaderCount('// module "fake" {\nreal_line')).toBe(0);
  });

  it("blanks a block comment spanning multiple lines", () => {
    const text = '/*\nmodule "fake" {\n*/\nreal_line';
    expect(fakeModuleHeaderCount(text)).toBe(0);
    expect(stripCommentsStringsAndHeredocs(text).split("\n")).toHaveLength(4);
  });

  it('does not let a brace inside a string affect structure (e.g. description = "foo { bar")', () => {
    const text = 'description = "module \\"fake\\" { unbalanced"\nreal_line';
    const sanitized = stripCommentsStringsAndHeredocs(text);
    // The string's content is blanked; braces inside it must not remain.
    expect(sanitized).not.toContain("{");
  });

  it("blanks a heredoc body, including a fake module header inside it", () => {
    const text = 'policy = <<-EOT\nmodule "fake" {\nEOT\nreal_line';
    expect(fakeModuleHeaderCount(text)).toBe(0);
    expect(stripCommentsStringsAndHeredocs(text).split("\n")).toHaveLength(4);
  });

  it("handles an unindented heredoc terminator", () => {
    const text = 'policy = <<EOT\nmodule "fake" {\nEOT\nreal_line';
    expect(fakeModuleHeaderCount(text)).toBe(0);
  });

  it("leaves real structural code untouched", () => {
    const text = 'module "real" {\n  source = "./modules/lambda-function"\n}\n';
    expect(stripCommentsStringsAndHeredocs(text)).toBe(text.replace(/"[^"]*"/g, (m) => " ".repeat(m.length)));
  });
});
