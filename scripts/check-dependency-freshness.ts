/**
 * Deterministic dependency-freshness checker — D-139 (design)/D-148 (this implementation),
 * docs/engineering/dependency-freshness-standard.md. Same shape as scripts/check-doc-drift.ts:
 * a violations array, real matchers against files on disk (never a textual heuristic, never a
 * re-typed version number), console output, non-zero exit on failure. Run via
 * `npm run check-dependency-freshness`; wired into CI (.github/workflows/ci.yml `guardrails`).
 *
 * Central rule (standard's own "Nunca duplica versão pinada"): every DETECTED value below is
 * read fresh from the real manifest/lockfile/tfvars/workflow file named in each entry's
 * `detectedFrom` (docs/engineering/dependency-freshness-policy.json) — the policy file itself
 * never stores a version, only the SUPPORTED line/governance metadata for entries where that
 * distinction matters (lifecycle.supportedLine).
 *
 * Checks implemented (standard §3):
 *  1. Detected line doesn't match a lifecycle entry's `supportedLine` -> fail.
 *  2. `lifecycle.supportEndsAt` inside the 3-window gate (§2): <6mo -> fail; 6-12mo -> warn,
 *     requires a tracked item (the entry id must appear in decisions-log.md or
 *     exceptions.md); >12mo -> no action.
 *  3. Any entry's `reviewedAt` (and `lifecycle.verifiedAt` when present) older than 6 months
 *     -> fail (proves periodic governance review, not a one-time entry that rotted).
 *  4. Policy inventory must exactly match the canonical id set from the standard's §4 table
 *     (CANONICAL_IDS below) — catches both a critical item discovered with no matching entry
 *     and an orphaned entry left behind after removal.
 *  5. Cross-source consistency for entries with more than one `detectedFrom` reader (node:
 *     .nvmrc vs package.json#engines.node vs package-lock.json root block; hashicorp-aws:
 *     provider constraint vs each module's constraint vs each lockfile's resolved version;
 *     terraform-cli: ci.yml vs cd.yml — the exact drift D-148 fixed for real).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const POLICY_PATH = path.join(REPO_ROOT, "docs/engineering/dependency-freshness-policy.json");

// Mirrors the 9 rows of dependency-freshness-standard.md §4 exactly. A policy file with a
// missing or extra id relative to this set is exactly the "critical item without entry" /
// "orphaned entry" drift named in §3 — this standard's inventory is curated and closed-list
// by design (§4: "populado na implementação"), not auto-discovered from repo content.
export const CANONICAL_IDS = [
  "node",
  "lambda-runtime",
  "hashicorp-aws",
  "terraform-cli",
  "adot-layer",
  "github-actions",
  "aws-sdk-v3",
  "ajv",
  "esbuild",
] as const;

export interface CriticalDependencyEntry {
  id: string;
  detectedFrom: string[];
  owner: string;
  officialSource: string;
  discoveryMechanism: "dependabot-version-updates" | "curated-lifecycle-review" | "manual-release-review";
  reviewedAt: string;
  lifecycle?: {
    supportedLine: string;
    supportEndsAt: string;
    verifiedAt: string;
  };
}

export interface Violation {
  id: string;
  severity: "fail" | "warn";
  message: string;
}

export function loadPolicy(policyPath: string = POLICY_PATH): CriticalDependencyEntry[] {
  const raw = JSON.parse(readFileSync(policyPath, "utf-8")) as { entries: CriticalDependencyEntry[] };
  return raw.entries;
}

// ---------------------------------------------------------------------------------------
// Pure logic (unit-tested directly against synthetic input, no filesystem/clock coupling)
// ---------------------------------------------------------------------------------------

// UTC-based deliberately: mixing local-timezone getters (getMonth/getDate) with UTC-parsed
// ISO date strings ("2026-09-01" parses as UTC midnight) shifts the boundary by up to a day
// in any timezone behind UTC - exactly the kind of off-by-one the G-V3 boundary tests below
// are meant to catch, so the arithmetic itself must not introduce one.
function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

/**
 * §2's 3-window gate. Boundaries are exclusive on the "<" side per the standard's own table
 * wording ("< 6 meses" / "6-12 meses" / "> 12 meses") — exactly-6-months-away is the 6-12
 * window (warn), not yet the <6 gate; exactly-12-months-away is still the warn window, not
 * yet "no action". G-V3 mutation target: flipping either `<` below to `<=` (or vice versa)
 * moves an exact-boundary date into the wrong band — covered by the boundary tests below.
 */
export function classifyLifecycleWindow(supportEndsAt: string, now: Date): "gate" | "warn" | "ok" {
  const end = new Date(supportEndsAt);
  const gateThreshold = addMonths(now, 6);
  const warnThreshold = addMonths(now, 12);
  if (end < gateThreshold) return "gate"; // "< 6 meses" - strictly inside 6 months
  if (end <= warnThreshold) return "warn"; // "6-12 meses" - inclusive of the 12-month mark itself
  return "ok"; // "> 12 meses" - strictly beyond 12 months
}

/** §3: reviewedAt/verifiedAt prove periodic governance review — stale past 6 months. */
export function isReviewStale(reviewedAt: string, now: Date, maxMonths = 6): boolean {
  const reviewed = new Date(reviewedAt);
  return reviewed < addMonths(now, -maxMonths);
}

/**
 * Normalizes a Node version source to its LTS *line* ("24.x", "v24.1.0", "24" all -> "24").
 * Returns null when the source is not a simple line pin (e.g. a semver range like ">=20"),
 * since those aren't a single detected line to compare.
 */
export function parseNodeLine(raw: string): string | null {
  const trimmed = raw.trim();
  const match = /^v?(\d+)(?:\.x)?(?:\.\d+(?:\.\d+)?)?$/.exec(trimmed);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------------------
// Filesystem matchers — one per CriticalDependencyEntry.id, reading real detectedFrom sources
// ---------------------------------------------------------------------------------------

function pushFail(violations: Violation[], id: string, message: string): void {
  violations.push({ id, severity: "fail", message });
}

function readFile(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf-8");
}

function checkLifecycleAndReview(entry: CriticalDependencyEntry, now: Date, violations: Violation[]): void {
  if (isReviewStale(entry.reviewedAt, now)) {
    pushFail(violations, entry.id, `reviewedAt (${entry.reviewedAt}) is more than 6 months old — needs a fresh governance review.`);
  }
  if (!entry.lifecycle) return;
  if (isReviewStale(entry.lifecycle.verifiedAt, now)) {
    pushFail(violations, entry.id, `lifecycle.verifiedAt (${entry.lifecycle.verifiedAt}) is more than 6 months old — re-verify against ${entry.officialSource}.`);
  }
  const window = classifyLifecycleWindow(entry.lifecycle.supportEndsAt, now);
  if (window === "gate") {
    pushFail(violations, entry.id, `less than 6 months to EOL/deprecation (${entry.lifecycle.supportEndsAt}) — gate per standard §2, must be resolved before merge.`);
  } else if (window === "warn") {
    const decisionsLog = readFile("docs/architecture/decisions-log.md");
    const exceptions = tryReadFile("docs/engineering/exceptions.md");
    const tracked = decisionsLog.includes(entry.id) || (exceptions?.includes(entry.id) ?? false);
    if (!tracked) {
      violations.push({
        id: entry.id,
        severity: "warn",
        message: `6-12 months to EOL/deprecation (${entry.lifecycle.supportEndsAt}) with no tracked item mentioning "${entry.id}" in decisions-log.md or exceptions.md — standard §2 requires one.`,
      });
    }
  }
}

function tryReadFile(relPath: string): string | undefined {
  try {
    return readFile(relPath);
  } catch {
    return undefined;
  }
}

function checkNode(entry: CriticalDependencyEntry, violations: Violation[]): void {
  const nvmrc = parseNodeLine(readFile(".nvmrc"));
  const pkg = JSON.parse(readFile("package.json")) as { engines?: { node?: string } };
  const pkgLine = pkg.engines?.node ? parseNodeLine(pkg.engines.node) : null;
  const lock = JSON.parse(readFile("package-lock.json")) as { packages?: Record<string, { engines?: { node?: string } }> };
  const lockRaw = lock.packages?.[""]?.engines?.node;
  const lockLine = lockRaw ? parseNodeLine(lockRaw) : null;

  const sources: Array<[string, string | null]> = [
    [".nvmrc", nvmrc],
    ["package.json#engines.node", pkgLine],
    ['package-lock.json#packages[""].engines.node', lockLine],
  ];
  for (const [label, line] of sources) {
    if (line === null) {
      pushFail(violations, entry.id, `could not parse a Node line from ${label}.`);
    }
  }
  const lines = sources.map(([, line]) => line).filter((l): l is string => l !== null);
  const distinct = new Set(lines);
  if (distinct.size > 1) {
    pushFail(violations, entry.id, `Node line disagreement across sources: ${sources.map(([l, v]) => `${l}=${v ?? "?"}`).join(", ")}.`);
  }
  const detected = lines[0];
  if (detected !== undefined && entry.lifecycle && detected !== entry.lifecycle.supportedLine) {
    pushFail(violations, entry.id, `detected Node line "${detected}" does not match policy supportedLine "${entry.lifecycle.supportedLine}".`);
  }
}

function checkLambdaRuntime(entry: CriticalDependencyEntry, violations: Violation[]): void {
  const tf = readFile("infra/modules/lambda-function/variables.tf");
  const match = /variable\s+"runtime"[\s\S]*?default\s*=\s*"([^"]+)"/.exec(tf);
  const detected = match?.[1];
  if (!detected) {
    pushFail(violations, entry.id, "could not find variable \"runtime\" default in infra/modules/lambda-function/variables.tf.");
    return;
  }
  if (entry.lifecycle && detected !== entry.lifecycle.supportedLine) {
    pushFail(violations, entry.id, `detected Lambda runtime "${detected}" does not match policy supportedLine "${entry.lifecycle.supportedLine}".`);
  }
}

function extractAwsProviderConstraint(tfSource: string): string | null {
  const match = /aws\s*=\s*\{[^}]*?source\s*=\s*"hashicorp\/aws"[^}]*?version\s*=\s*"([^"]+)"/s.exec(tfSource)
    ?? /aws\s*=\s*\{[^}]*?version\s*=\s*"([^"]+)"[^}]*?source\s*=\s*"hashicorp\/aws"/s.exec(tfSource);
  return match?.[1] ?? null;
}

function extractLockedAwsProvider(lockSource: string): { version: string; constraints: string } | null {
  const block = /provider\s+"registry\.terraform\.io\/hashicorp\/aws"\s*\{([\s\S]*?)\n\}/.exec(lockSource);
  if (!block) return null;
  const version = /version\s*=\s*"([^"]+)"/.exec(block[1] ?? "")?.[1];
  const constraints = /constraints\s*=\s*"([^"]+)"/.exec(block[1] ?? "")?.[1];
  if (!version || !constraints) return null;
  return { version, constraints };
}

function checkHashicorpAws(entry: CriticalDependencyEntry, violations: Violation[]): void {
  const rootConstraint = extractAwsProviderConstraint(readFile("infra/providers.tf"));
  if (!rootConstraint) {
    pushFail(violations, entry.id, "could not find hashicorp/aws version constraint in infra/providers.tf.");
    return;
  }
  const modulesDir = path.join(REPO_ROOT, "infra/modules");
  const moduleNames = readdirSync(modulesDir).filter((name) => statSync(path.join(modulesDir, name)).isDirectory());

  const dirs = [{ label: "infra", dir: "infra" }, ...moduleNames.map((name) => ({ label: `infra/modules/${name}`, dir: `infra/modules/${name}` }))];

  // Consistency target here is the RESOLVED locked version, not constraint-string equality:
  // modules legitimately spell equivalent floors differently (e.g. document-malware-protection
  // pins ">= 6.19, < 7.0" instead of root's "~> 6.19" for its own documented reason - see that
  // module's versions.tf comment) as long as every module's .terraform.lock.hcl resolves to
  // the SAME actual provider build. A genuine drift (two modules locked to different aws
  // provider versions) is what this must catch - not stylistic constraint-syntax variance.
  const resolvedVersions = new Map<string, string[]>(); // version -> labels
  for (const { label, dir } of dirs) {
    const lockSource = tryReadFile(path.join(dir, ".terraform.lock.hcl"));
    if (!lockSource) continue;
    const locked = extractLockedAwsProvider(lockSource);
    if (!locked) continue;
    const labels = resolvedVersions.get(locked.version) ?? [];
    labels.push(label);
    resolvedVersions.set(locked.version, labels);
  }

  if (resolvedVersions.size > 1) {
    const summary = [...resolvedVersions.entries()].map(([v, labels]) => `${v} (${labels.join(", ")})`).join(" vs. ");
    pushFail(violations, entry.id, `hashicorp/aws resolves to inconsistent versions across infra/.terraform.lock.hcl and infra/modules/*/.terraform.lock.hcl: ${summary}.`);
  }
}

function checkTerraformCli(entry: CriticalDependencyEntry, violations: Violation[]): void {
  const ci = readFile(".github/workflows/ci.yml");
  const cd = readFile(".github/workflows/cd.yml");
  const ciVersion = /TERRAFORM_VERSION:\s*"([^"]+)"/.exec(ci)?.[1];
  const cdVersion = /TERRAFORM_VERSION:\s*"([^"]+)"/.exec(cd)?.[1];
  if (!ciVersion || !cdVersion) {
    pushFail(violations, entry.id, "could not find TERRAFORM_VERSION in ci.yml and/or cd.yml.");
    return;
  }
  if (ciVersion !== cdVersion) {
    pushFail(violations, entry.id, `ci.yml TERRAFORM_VERSION ("${ciVersion}") != cd.yml TERRAFORM_VERSION ("${cdVersion}") — the exact drift D-148 fixed; re-sync both.`);
  }
}

function checkAdotLayer(entry: CriticalDependencyEntry, violations: Violation[]): void {
  const envDir = path.join(REPO_ROOT, "infra/env");
  const tfvarsFiles = readdirSync(envDir).filter((f) => f.endsWith(".tfvars"));
  if (tfvarsFiles.length === 0) {
    pushFail(violations, entry.id, "no infra/env/*.tfvars files found.");
    return;
  }
  for (const file of tfvarsFiles) {
    const content = readFile(path.join("infra/env", file));
    const match = /adot_layer_arn\s*=\s*"([^"]+)"/.exec(content);
    if (!match) {
      pushFail(violations, entry.id, `infra/env/${file} has no adot_layer_arn set.`);
    }
  }
}

function checkGithubActionsPinning(entry: CriticalDependencyEntry, violations: Violation[]): void {
  const workflowsDir = path.join(REPO_ROOT, ".github/workflows");
  const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const usesLine = /^\s*uses:\s*([^\s#]+)/;
  for (const file of files) {
    const lines = readFile(path.join(".github/workflows", file)).split("\n");
    lines.forEach((line, idx) => {
      const match = usesLine.exec(line);
      if (!match?.[1]) return;
      const ref = match[1];
      const [, sha] = ref.split("@");
      if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
        pushFail(violations, entry.id, `.github/workflows/${file}:${idx + 1} uses "${ref}", not pinned by a 40-char commit SHA.`);
      }
    });
  }
}

function checkPackageDependency(entry: CriticalDependencyEntry, matcher: (deps: Record<string, string>) => boolean, label: string, violations: Violation[]): void {
  const pkg = JSON.parse(readFile("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!matcher(allDeps)) {
    pushFail(violations, entry.id, `no dependency matching "${label}" found in package.json.`);
  }
}

const MATCHERS: Record<string, (entry: CriticalDependencyEntry, violations: Violation[]) => void> = {
  node: checkNode,
  "lambda-runtime": checkLambdaRuntime,
  "hashicorp-aws": checkHashicorpAws,
  "terraform-cli": checkTerraformCli,
  "adot-layer": checkAdotLayer,
  "github-actions": checkGithubActionsPinning,
  "aws-sdk-v3": (entry, violations) => checkPackageDependency(entry, (deps) => Object.keys(deps).some((k) => k.startsWith("@aws-sdk/")), "@aws-sdk/*", violations),
  ajv: (entry, violations) => checkPackageDependency(entry, (deps) => "ajv" in deps, "ajv", violations),
  esbuild: (entry, violations) => checkPackageDependency(entry, (deps) => "esbuild" in deps, "esbuild", violations),
};

export function checkInventoryCompleteness(policy: CriticalDependencyEntry[], violations: Violation[]): void {
  const policyIds = new Set(policy.map((e) => e.id));
  const canonical = new Set<string>(CANONICAL_IDS);
  for (const id of canonical) {
    if (!policyIds.has(id)) {
      pushFail(violations, id, `critical dependency "${id}" (standard §4) has no CriticalDependencyEntry in dependency-freshness-policy.json.`);
    }
  }
  for (const id of policyIds) {
    if (!canonical.has(id)) {
      pushFail(violations, id, `orphaned CriticalDependencyEntry "${id}" — not in the standard §4 canonical inventory; remove it or update the standard.`);
    }
  }
}

export function runChecks(policy: CriticalDependencyEntry[], now: Date): Violation[] {
  const violations: Violation[] = [];
  checkInventoryCompleteness(policy, violations);
  for (const entry of policy) {
    checkLifecycleAndReview(entry, now, violations);
    const matcher = MATCHERS[entry.id];
    if (matcher) {
      matcher(entry, violations);
    }
  }
  return violations;
}

function main(): void {
  const policy = loadPolicy();
  const violations = runChecks(policy, new Date());
  const fails = violations.filter((v) => v.severity === "fail");
  const warns = violations.filter((v) => v.severity === "warn");

  for (const w of warns) {
    console.warn(`WARN [${w.id}] ${w.message}`);
  }
  if (fails.length > 0) {
    console.error(`Dependency freshness check found ${fails.length} failure(s) (${warns.length} warning(s)):\n`);
    for (const f of fails) {
      console.error(`  [${f.id}] ${f.message}`);
    }
    process.exit(1);
  }

  console.log(`Dependency freshness check: ${policy.length} critical dependencies checked, no failures${warns.length > 0 ? ` (${warns.length} warning(s), see above)` : ""}.`);
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
