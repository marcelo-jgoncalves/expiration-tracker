/**
 * Deterministic doc-drift checker — full-audit round1, eixo Engenharia de Contexto,
 * critério "Auditabilidade & Enforcement do Sistema de Contexto". Four checks:
 *
 *  1. Every inline-style relative markdown link (`[text](path/to/file.md)`) in every `.md`
 *     file on disk (not just git-tracked ones, so it also catches a doc you're about to
 *     commit) resolves to a file that actually exists. Scope note, found in round3 of the
 *     same audit that produced this script: reference-style links (`[text][ref]` +
 *     `[ref]: path`) are NOT checked - none exist in this repo today, but a new one would
 *     silently bypass this check.
 *  2. Every `AGENTS.md §N` citation refers to a section that actually exists as a `## N.`
 *     heading in AGENTS.md right now (not the section number that existed when the citing
 *     doc was written). This only proves the section number exists, not that the citation
 *     is topically correct - that still needs a human/reviewer.
 *  3. Root allowlist (added 2026-08-29, context-engineering reconciliation): every `.md`
 *     file directly in the repo root must be in `ROOT_MD_ALLOWLIST` - prevents the exact
 *     regression this reconciliation fixed (21 stray handoff/mission-brief/prompt files
 *     accumulated in root over several sessions, none of them indexed anywhere).
 *  4. Size guardrail (same reconciliation): `AGENTS.md` must stay within the line-count goal
 *     it declares for itself (§8); `NEXT_SESSION_PROMPT.md` gets a generous ceiling (not a
 *     tight one - it's allowed to grow with real session detail) specifically to catch
 *     unbounded reaccumulation of already-duplicated history before it reaches the ~1067
 *     lines this reconciliation found, not to enforce a tight target.
 *
 * Built because AGENTS.md §6's checklist previously conditioned this kind of automation on
 * "CI real existe" OR "reincidência de drift documental" - both were true (CI has existed
 * since M0; this was the second audit in a row, out of three run so far, to find the same
 * class of drift that manual review missed), so the condition was acted on instead of left
 * open-ended. AGENTS.md §6 now documents what this script covers directly (not the old
 * conditional) - see it there, not here, for the current wording. Run via `npm run
 * check-docs`; wired into CI as a blocking `guardrails` step (same tier as
 * typecheck/lint/check-boundaries).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Every .md file allowed directly in the repo root - anything else is a stray handoff/
// prompt/mission-brief that belongs in docs/ somewhere (see docs/architecture/README.md's
// precedence table for where). Update this set deliberately, not by exception-creep.
export const ROOT_MD_ALLOWLIST = new Set(["AGENTS.md", "ARCHITECTURE.md", "CLAUDE.md", "ENGINEERING.md", "NEXT_SESSION_PROMPT.md", "README.md"]);

export const AGENTS_MD_MAX_LINES = 100; // matches AGENTS.md §8's own declared goal (60-100).
export const NEXT_SESSION_PROMPT_MAX_LINES = 300; // generous ceiling, see file doc comment above.

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "cdk.out", "coverage"]);

function walkMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkMarkdownFiles(full));
    } else if (entry.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  message: string;
}

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const AGENTS_SECTION_REF = /AGENTS\.md[`'"]?\s*§\s*(\d+)/g;

function isExternalOrAnchorOnly(target: string): boolean {
  return (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:") ||
    target.startsWith("#")
  );
}

function checkLinks(file: string, lines: string[], violations: Violation[]): void {
  lines.forEach((line, idx) => {
    for (const match of line.matchAll(MARKDOWN_LINK)) {
      const target = match[1]?.trim();
      if (!target || isExternalOrAnchorOnly(target)) continue;
      const [pathPart] = target.split("#");
      if (!pathPart) continue;
      const resolved = path.resolve(path.dirname(file), pathPart);
      try {
        statSync(resolved);
      } catch {
        violations.push({
          file: path.relative(REPO_ROOT, file),
          line: idx + 1,
          message: `broken relative link -> ${pathPart}`,
        });
      }
    }
  });
}

function loadAgentsMdSections(): Set<number> {
  const raw = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf-8");
  const sections = new Set<number>();
  for (const match of raw.matchAll(/^## (\d+)\./gm)) {
    sections.add(Number(match[1]));
  }
  return sections;
}

function checkAgentsSectionRefs(
  file: string,
  lines: string[],
  validSections: Set<number>,
  violations: Violation[],
): void {
  const isAgentsMdItself = path.resolve(file) === path.resolve(REPO_ROOT, "AGENTS.md");
  if (isAgentsMdItself) return;
  lines.forEach((line, idx) => {
    for (const match of line.matchAll(AGENTS_SECTION_REF)) {
      const section = Number(match[1]);
      if (!validSections.has(section)) {
        violations.push({
          file: path.relative(REPO_ROOT, file),
          line: idx + 1,
          message: `references AGENTS.md §${section}, which does not exist as a "## ${section}." heading in the current AGENTS.md`,
        });
      }
    }
  });
}

export function checkRootAllowlist(entries: string[], allowlist: Set<string>, violations: Violation[]): void {
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    if (allowlist.has(entry)) continue;
    violations.push({
      file: entry,
      line: 1,
      message: `stray .md file in repo root, not in the allowlist (scripts/check-doc-drift.ts's ROOT_MD_ALLOWLIST) - move it under docs/ (see docs/architecture/README.md's precedence table for where) instead of leaving it in root`,
    });
  }
}

export function checkSizeGuardrail(fileBasename: string, lineCount: number, maxLines: number, violations: Violation[]): void {
  if (lineCount > maxLines) {
    violations.push({
      file: fileBasename,
      line: lineCount,
      message: `${lineCount} lines, over the ${maxLines}-line guardrail - if this file's own declared goal changed, update the constant in scripts/check-doc-drift.ts; otherwise compact it (move historical detail to session-log.md/decisions-log.md, keep only current state + next action)`,
    });
  }
}

function main(): void {
  const files = walkMarkdownFiles(REPO_ROOT);
  const validSections = loadAgentsMdSections();
  const violations: Violation[] = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf-8").split("\n");
    checkLinks(file, lines, violations);
    checkAgentsSectionRefs(file, lines, validSections, violations);
  }

  const rootEntries = readdirSync(REPO_ROOT).filter((entry) => statSync(path.join(REPO_ROOT, entry)).isFile());
  checkRootAllowlist(rootEntries, ROOT_MD_ALLOWLIST, violations);

  const agentsMdLines = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf-8").split("\n").length;
  checkSizeGuardrail("AGENTS.md", agentsMdLines, AGENTS_MD_MAX_LINES, violations);
  const nextSessionPromptLines = readFileSync(path.join(REPO_ROOT, "NEXT_SESSION_PROMPT.md"), "utf-8").split("\n").length;
  checkSizeGuardrail("NEXT_SESSION_PROMPT.md", nextSessionPromptLines, NEXT_SESSION_PROMPT_MAX_LINES, violations);

  if (violations.length > 0) {
    console.error(`Doc drift check found ${violations.length} issue(s):\n`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} — ${v.message}`);
    }
    process.exit(1);
  }

  console.log(`Doc drift check: ${files.length} markdown files scanned, root allowlist and size guardrails clean, no broken links or stale AGENTS.md §N references found.`);
}

// Only run as a side effect when executed directly (`npm run check-docs`) - importing this
// module for unit tests (test/architecture/check-doc-drift.test.ts) must not trigger a full
// scan/exit against the real repo. Uses pathToFileURL (not a raw `file://` template) so this
// still matches with a relative argv[1], spaces, or other characters needing URL-encoding.
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
