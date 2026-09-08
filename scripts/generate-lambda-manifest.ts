/**
 * Lambda manifest generator — E-020/D-232. Real gap found by full-audit-round2/Operações-SRE: the
 * two Terraform outputs the deploy manifest / emergency rollback (`.github/workflows/rollback.yml`)
 * depend on (`lambda_function_names`, `lambda_published_versions`) were hand-maintained lists in
 * `infra/outputs.tf` that stopped growing with `infra/main.tf` (61 real `module "*_handler"`
 * declarations today, only 33-34 ever made it into the manifest — 44% silently uncovered, and
 * rollback.yml also hardcoded a stale "exactly 13 functions" check on top of that).
 *
 * This script is now the ONLY place that list is written: it scans every `module "<name>" { ... }`
 * block across `infra/*.tf` (top-level stack files, not `infra/modules/**`), finds every one whose
 * `source = "./modules/lambda-function"`, and (re)generates `infra/lambda-manifest.generated.tf`
 * with both outputs built from that discovery. `infra/outputs.tf` no longer defines either output
 * by hand — see the pointer comment there.
 *
 * Terraform has no way to enumerate modules dynamically by string name (unlike `for_each` module
 * instances), so the generated file still lists each `module.<name>.function_name` /
 * `.published_version` reference explicitly — but never typed by a human/agent again: `npm run
 * check:lambda-manifest` (wired into CI, same tier as `check-docs`) fails the instant this file
 * drifts from `infra/*.tf`, and `test/scripts/lambda-manifest.test.ts` independently proves the
 * generated list's size matches a from-scratch count of lambda-function module blocks.
 *
 * Usage: `tsx scripts/generate-lambda-manifest.ts` (write) or `--check` (verify, never writes).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripCommentsStringsAndHeredocs } from "./lib/hcl-lex.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const INFRA_DIR = path.join(REPO_ROOT, "infra");
const GENERATED_PATH = path.join(INFRA_DIR, "lambda-manifest.generated.tf");
const LAMBDA_MODULE_SOURCE = "./modules/lambda-function";

export interface LambdaModuleRef {
  moduleName: string;
  file: string;
}

/**
 * Scans one file's sanitized text for top-level `module "<name>" { ... }` blocks via brace-depth
 * tracking, and returns the ones whose body contains `source = "./modules/lambda-function"`.
 * Throws on a duplicate module name or an unterminated block (unbalanced braces) — never silently
 * skips an ambiguous block.
 */
export function findLambdaModulesInFile(fileName: string, rawText: string): LambdaModuleRef[] {
  // Sanitized text is used ONLY for structural discovery (brace depth, module headers) so that a
  // `{`/`}`/`module "x" {`-looking fragment inside a comment/string/heredoc can never be mistaken
  // for real HCL structure. It must NOT be used to read the `source = "..."` value itself — the
  // sanitizer blanks quoted-string content on that very line, which would erase the value we need
  // to compare. The original (unsanitized) lines are index-aligned with the sanitized ones
  // (newlines are always preserved by the sanitizer), so `source = "..."` is read from `rawLines`.
  const sanitizedLines = stripCommentsStringsAndHeredocs(rawText).split("\n");
  const rawLines = rawText.split("\n");
  const refs: LambdaModuleRef[] = [];
  const seen = new Set<string>();

  const moduleHeaderRe = /^\s*module\s+"([A-Za-z0-9_-]+)"\s*\{/;
  const sourceRe = new RegExp(`^\\s*source\\s*=\\s*"${LAMBDA_MODULE_SOURCE.replace(/[./]/g, "\\$&")}"\\s*$`);
  const lineAt = (arr: string[], idx: number): string => arr[idx] ?? "";

  for (let i = 0; i < rawLines.length; i++) {
    // Module name itself is read from the raw line (a quoted module name never contains braces,
    // so there is no structural-safety reason to read it from the sanitized line — and the
    // sanitizer blanks quoted-string content, which would erase the name).
    const header = moduleHeaderRe.exec(lineAt(rawLines, i));
    if (!header || !header[1]) continue;

    const moduleName = header[1];
    let depth =
      (lineAt(sanitizedLines, i).match(/\{/g) ?? []).length -
      (lineAt(sanitizedLines, i).match(/\}/g) ?? []).length;
    const bodyLineIndexes: number[] = [];
    let j = i + 1;
    while (j < sanitizedLines.length && depth > 0) {
      bodyLineIndexes.push(j);
      depth +=
        (lineAt(sanitizedLines, j).match(/\{/g) ?? []).length -
        (lineAt(sanitizedLines, j).match(/\}/g) ?? []).length;
      j++;
    }
    if (depth !== 0) {
      throw new Error(
        `${fileName}: module "${moduleName}" block starting at line ${i + 1} never closes (unbalanced braces) — cannot generate lambda manifest.`,
      );
    }

    const hasLambdaSource = bodyLineIndexes.some((idx) => sourceRe.test(lineAt(rawLines, idx)));
    if (hasLambdaSource) {
      if (seen.has(moduleName)) {
        throw new Error(`${fileName}: duplicate module name "${moduleName}" using the lambda-function source.`);
      }
      seen.add(moduleName);
      refs.push({ moduleName, file: fileName });
    }
    i = j - 1;
  }

  return refs;
}

export function discoverLambdaModules(): LambdaModuleRef[] {
  const files = readdirSync(INFRA_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tf") && e.name !== path.basename(GENERATED_PATH))
    .map((e) => e.name)
    .sort();

  const seenGlobal = new Set<string>();
  const all: LambdaModuleRef[] = [];
  for (const file of files) {
    const raw = readFileSync(path.join(INFRA_DIR, file), "utf8");
    for (const ref of findLambdaModulesInFile(file, raw)) {
      if (seenGlobal.has(ref.moduleName)) {
        throw new Error(`Duplicate module name "${ref.moduleName}" across infra/*.tf (last seen in ${ref.file}).`);
      }
      seenGlobal.add(ref.moduleName);
      all.push(ref);
    }
  }

  if (all.length === 0) {
    throw new Error("No lambda-function modules discovered across infra/*.tf — refusing to generate an empty manifest.");
  }

  return all;
}

export function renderManifest(refs: LambdaModuleRef[]): string {
  const names = refs.map((r) => `    module.${r.moduleName}.function_name,`).join("\n");
  const versions = refs
    .map((r) => `    (module.${r.moduleName}.function_name) = module.${r.moduleName}.published_version`)
    .join("\n");

  return `# GENERATED FILE — DO NOT EDIT BY HAND.
#
# Produced by \`npm run generate:lambda-manifest\` (scripts/generate-lambda-manifest.ts) from every
# \`module "<name>" { source = "${LAMBDA_MODULE_SOURCE}" ... }\` block across infra/*.tf. This is the
# single source of truth for which Lambdas the deploy manifest / emergency rollback mechanism
# (.github/workflows/cd.yml, .github/workflows/rollback.yml) cover — see decisions-log.md D-232
# (E-020) for the bug this closes: these two outputs used to be hand-maintained in outputs.tf and
# silently fell behind infra/main.tf.
#
# \`npm run check:lambda-manifest\` (CI-blocking, .github/workflows/ci.yml) fails the build the
# moment this file drifts from infra/*.tf — regenerate with \`npm run generate:lambda-manifest\`
# instead of editing this file.

output "lambda_function_names" {
  value = [
${names}
  ]
}

output "lambda_published_versions" {
  value = {
${versions}
  }
}
`;
}

function formatWithTerraform(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lambda-manifest-fmt-"));
  const tmpFile = path.join(dir, "lambda-manifest.generated.tf");
  try {
    writeFileSync(tmpFile, content, "utf8");
    execFileSync("terraform", ["fmt", tmpFile], { stdio: "pipe" });
    return readFileSync(tmpFile, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  const check = process.argv.includes("--check");
  const refs = discoverLambdaModules();
  const rendered = formatWithTerraform(renderManifest(refs));

  if (check) {
    let onDisk: string;
    try {
      onDisk = readFileSync(GENERATED_PATH, "utf8");
    } catch {
      console.error(`${GENERATED_PATH} does not exist. Run: npm run generate:lambda-manifest`);
      process.exit(1);
      return;
    }
    if (onDisk !== rendered) {
      console.error(
        `infra/lambda-manifest.generated.tf is out of date with infra/*.tf (${refs.length} lambda-function modules discovered). Run: npm run generate:lambda-manifest`,
      );
      process.exit(1);
      return;
    }
    console.log(`OK: infra/lambda-manifest.generated.tf is up to date (${refs.length} Lambda functions).`);
    return;
  }

  writeFileSync(GENERATED_PATH, rendered, "utf8");
  console.log(`Wrote ${GENERATED_PATH} (${refs.length} Lambda functions).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
