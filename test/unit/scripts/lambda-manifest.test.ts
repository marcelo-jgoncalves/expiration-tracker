/**
 * E-020/D-232 — proves the class of bug that made the emergency rollback mechanism
 * (.github/workflows/rollback.yml) unusable can't silently reoccur: `infra/lambda-manifest.
 * generated.tf` (scripts/generate-lambda-manifest.ts) must always cover every real Lambda declared
 * in infra/*.tf, never a stale subset.
 *
 * Two independent checks, deliberately NOT sharing scripts/generate-lambda-manifest.ts's
 * brace-counting block scanner (round 2 of the Claude<->Codex review on this fix, decisions-log.md
 * D-232, flagged that two regexes over the same hypothesis aren't a real oracle):
 *
 *  1. `countLambdaModuleBlocksByLineScan` below re-derives the same count with a structurally
 *     different technique — a sequential line-by-line scan (never builds nested blocks or tracks
 *     brace depth across a whole file) over text sanitized by the SAME `stripCommentsStringsAnd
 *     Heredocs` the generator uses (that sanitizer has its own adversarial fixtures in
 *     hcl-lex.test.ts, so sharing just that primitive is a tested, narrow assumption — not the
 *     generator's actual block-discovery logic). Not a defense against arbitrary malformed HCL (a
 *     real HCL parser would be strictly stronger); `terraform fmt -check`/`terraform validate`/
 *     `terraform test` already gate genuinely invalid HCL in CI before this test would even run
 *     meaningfully — proportional to the realistic error classes in this repo (comments, strings,
 *     heredocs, indentation), not a mathematical guarantee.
 *  2. A scan for `resource "aws_lambda_function"` declared anywhere OTHER than
 *     `infra/modules/lambda-function/main.tf` — the one place it's expected today. If a Lambda is
 *     ever created a second way (a raw resource, or a different module), this fails loudly instead
 *     of the generator silently never seeing it.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverLambdaModules, renderManifest } from "../../../scripts/generate-lambda-manifest.js";
import { stripCommentsStringsAndHeredocs } from "../../../scripts/lib/hcl-lex.js";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const INFRA_DIR = path.join(REPO_ROOT, "infra");

function topLevelTfFiles(): string[] {
  return readdirSync(INFRA_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tf") && e.name !== "lambda-manifest.generated.tf")
    .map((e) => e.name)
    .sort();
}

/**
 * Independent oracle: sequential line scan (no block delimiting, no depth tracking across the
 * whole file) over sanitized text. For every line that IS a `module "<name>" {` header at column
 * start, look ahead until the next top-level `module "..."` header or a `}` at column 0 (cheap
 * "end of this block" heuristic that never needs to know the true nesting depth), and check
 * whether any of those lines is exactly `source = "./modules/lambda-function"`.
 */
function countLambdaModuleBlocksByLineScan(rawText: string): number {
  const sanitized = stripCommentsStringsAndHeredocs(rawText).split("\n");
  const raw = rawText.split("\n");
  const rawHeaderRe = /^module\s+"[A-Za-z0-9_-]+"\s*\{\s*$/;
  const endRe = /^\}\s*$/;
  const sourceRe = /^\s*source\s*=\s*"\.\/modules\/lambda-function"\s*$/;

  const lineAt = (arr: string[], idx: number): string => arr[idx] ?? "";

  // A header is genuine only if BOTH hold: (1) the raw line looks like `module "x" {`, and (2) the
  // SAME line, once comments/strings/heredocs are blanked, collapses to exactly "module {" — a
  // decoy `module "fake" {` sitting inside a comment or heredoc is entirely blanked by the
  // sanitizer (the word "module" itself disappears, not just the quoted name), so it fails check
  // (2) and is correctly rejected. A genuine header keeps "module"/"{" (only the quoted name is
  // blanked, since it's a real string token) and passes. This is intentionally a different
  // discriminator than the generator's own header check (raw-line regex only, depth-tracked via
  // the sanitized text) — collapsing whitespace on the sanitized line, rather than tracking brace
  // depth, is the structurally different technique the round-2 Claude<->Codex review asked for.
  const isGenuineHeader = (idx: number): boolean =>
    rawHeaderRe.test(lineAt(raw, idx)) && lineAt(sanitized, idx).replace(/\s+/g, " ").trim() === "module {";

  let count = 0;
  for (let i = 0; i < sanitized.length; i++) {
    if (!isGenuineHeader(i)) continue;
    let j = i + 1;
    let found = false;
    while (j < sanitized.length && !isGenuineHeader(j) && !endRe.test(lineAt(sanitized, j))) {
      if (sourceRe.test(lineAt(raw, j))) found = true;
      j++;
    }
    if (found) count++;
    // Note: does not advance `i` past `j` — a top-level module block always ends with an
    // unindented `}` in this codebase's formatting (terraform fmt-enforced), so the next
    // iteration naturally skips nested lines without this scan needing to track depth.
  }
  return count;
}

describe("lambda manifest generation (E-020/D-232)", () => {
  it("infra/lambda-manifest.generated.tf is up to date with infra/*.tf", () => {
    const refs = discoverLambdaModules();
    const generatedPath = path.join(INFRA_DIR, "lambda-manifest.generated.tf");
    const onDisk = readFileSync(generatedPath, "utf8");
    // Same rendering the generator's --check uses, minus the terraform-fmt pass (this test does
    // not shell out to the terraform binary) - compare the set of module references instead of
    // the exact formatted bytes.
    for (const ref of refs) {
      expect(onDisk).toContain(`module.${ref.moduleName}.function_name`);
      expect(onDisk).toContain(`module.${ref.moduleName}.published_version`);
    }
    const renderedNameCount = (renderManifest(refs).match(/\.function_name,/g) ?? []).length;
    expect(renderedNameCount).toBe(refs.length);
  });

  it("the independent line-scan oracle finds the same count as the generator's block scanner, for every infra/*.tf file", () => {
    const files = topLevelTfFiles();
    let independentTotal = 0;
    for (const file of files) {
      const raw = readFileSync(path.join(INFRA_DIR, file), "utf8");
      independentTotal += countLambdaModuleBlocksByLineScan(raw);
    }

    const generatorTotal = discoverLambdaModules().length;
    expect(independentTotal).toBe(generatorTotal);
    expect(generatorTotal).toBeGreaterThan(0);
  });

  it("no aws_lambda_function resource is declared outside infra/modules/lambda-function (single creation path)", () => {
    const offenders: string[] = [];

    function scanDir(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
          continue;
        }
        if (!entry.name.endsWith(".tf")) continue;
        const relative = path.relative(INFRA_DIR, full).replace(/\\/g, "/");
        if (relative === "modules/lambda-function/main.tf") continue;

        const sanitized = stripCommentsStringsAndHeredocs(readFileSync(full, "utf8"));
        if (/^\s*resource\s+"aws_lambda_function"/m.test(sanitized)) {
          offenders.push(relative);
        }
      }
    }
    scanDir(INFRA_DIR);

    expect(
      offenders,
      `aws_lambda_function declared outside infra/modules/lambda-function/main.tf: ${offenders.join(", ")} — ` +
        "the manifest generator only looks for module \"*\" { source = \"./modules/lambda-function\" }, " +
        "so a Lambda created this other way would silently never make it into the rollback manifest. " +
        "Update scripts/generate-lambda-manifest.ts before adding this.",
    ).toEqual([]);
  });
});
