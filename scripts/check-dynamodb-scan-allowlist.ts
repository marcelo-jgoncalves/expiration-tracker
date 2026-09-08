/**
 * `dynamodb:Scan` allowlist checker — D-234 (E-018, full-audit-round2 Seguranca criterio 2,
 * protocolo Claude<->Codex, 4 rodadas, ambos 9.2/10). The IAM side of that finding removed
 * `dynamodb:Scan` from the two general tenant-facing policies (`infra/modules/dynamo-table/
 * main.tf`) and granted it only to the 4 Lambdas whose real call graph needs it
 * (`infra/tests/stack.tftest.hcl`'s `cross_tenant_scan_exception_scoped_to_exactly_four_named_
 * lambdas` proves THAT half — which Lambdas hold the capability). This script proves the other
 * half: WHERE in the codebase `ScanCommand` may be imported from `@aws-sdk/lib-dynamodb` at all,
 * so a future adapter cannot reintroduce a table-wide Scan without an explicit, reviewed
 * allowlist entry (the exact regression this finding closed).
 *
 * Scope is `src/**` only — deliberately NOT `scripts/**`. Operational tooling (dev-data reset,
 * GSI8 backfills) legitimately Scans and is never packaged into a deployed Lambda
 * (`npm run build:lambdas` only bundles `src/runtime/aws/handlers/**`), so it is a different risk
 * class and out of scope for this guard (Codex Rodada 2 finding — do not fold it in silently).
 *
 * Deliberately a plain regex/line scan, not a TypeScript-Compiler-API/AST parse: the codebase's
 * own import style is consistent enough (`import { ..., ScanCommand, ... } from
 * "@aws-sdk/lib-dynamodb"`, single-line, never re-exported or aliased) that a regex catches every
 * real case with no false negatives observed across the current tree, and is far cheaper than
 * spinning up a full TS program just for this. If a future import style (re-export, dynamic
 * import, `import * as`) defeats this regex, that is a real gap to close then, not a hypothetical
 * to build AST tooling against now.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SRC_ROOT = path.join(REPO_ROOT, "src");

// The ONLY files allowed to import `ScanCommand` from `@aws-sdk/lib-dynamodb`. Each entry is the
// exact, documented reason a table-wide Scan is legitimate there — see the file's own doc comment
// for the call graph. Adding an entry here is a Type 1 decision (AGENTS.md §4): it expands the
// blast radius this finding just closed, so it should go through the same rigor, not be a
// one-line drive-by fix.
const SCAN_IMPORT_ALLOWLIST = new Set<string>([
  // scanActiveSeries()/scanRequirementsWithEvidence() - both consumed exclusively by background
  // workers (document-request-recurrence, requirement-evidence-daily-sweep), never an HTTP route.
  "src/modules/document-archive/persistence/dynamodb-document-archive-store.ts",
  // scanTenantItems()/scanTenantSessions()/scanLifecycleRecords() - the W3-07 tenant-purge
  // pipeline's deliberate, documented Scan-based candidate discovery (no GSI keyed purely by
  // tenantId exists on either table - see the file's own header).
  "src/shared/dynamodb/tenant-purge-scan.ts",
]);

const SCAN_IMPORT_PATTERN = /import\s*\{[^}]*\bScanCommand\b[^}]*\}\s*from\s*["']@aws-sdk\/lib-dynamodb["']/;

interface Violation {
  file: string;
  message: string;
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkTsFiles(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function main(): void {
  const files = walkTsFiles(SRC_ROOT);
  const violations: Violation[] = [];
  const seenAllowlisted = new Set<string>();

  for (const file of files) {
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    const content = readFileSync(file, "utf-8");
    if (!SCAN_IMPORT_PATTERN.test(content)) continue;

    if (SCAN_IMPORT_ALLOWLIST.has(relative)) {
      seenAllowlisted.add(relative);
    } else {
      violations.push({
        file: relative,
        message:
          "imports ScanCommand from @aws-sdk/lib-dynamodb but is not in SCAN_IMPORT_ALLOWLIST " +
          "(scripts/check-dynamodb-scan-allowlist.ts) - a table-wide Scan is a Type 1 IAM decision " +
          "(D-234/E-018), not a drive-by addition. Add a reviewed allowlist entry with the same " +
          "rigor as the existing two, or use QueryCommand instead.",
      });
    }
  }

  // Stale allowlist entries (file no longer imports ScanCommand, or was deleted/renamed) are a
  // drift signal worth surfacing too — same discipline as check-doc-drift.ts's root allowlist.
  for (const entry of SCAN_IMPORT_ALLOWLIST) {
    if (!seenAllowlisted.has(entry)) {
      violations.push({
        file: entry,
        message: "is in SCAN_IMPORT_ALLOWLIST but no longer imports ScanCommand from @aws-sdk/lib-dynamodb - remove the stale entry",
      });
    }
  }

  if (violations.length > 0) {
    console.error(`dynamodb:Scan allowlist check found ${violations.length} issue(s):\n`);
    for (const v of violations) {
      console.error(`  ${v.file} — ${v.message}`);
    }
    process.exit(1);
  }

  console.log(`dynamodb:Scan allowlist check: ${files.length} src/ files scanned, exactly ${SCAN_IMPORT_ALLOWLIST.size} allowlisted Scan importer(s) found, no unreviewed Scan usage.`);
}

// Same direct-run guard as check-doc-drift.ts - importing this module for a future unit test must
// not trigger a full scan/exit against the real repo.
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
