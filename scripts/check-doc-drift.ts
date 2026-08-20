/**
 * Deterministic doc-drift checker — full-audit round1, eixo Engenharia de Contexto,
 * critério "Auditabilidade & Enforcement do Sistema de Contexto". Two checks, both real
 * bugs found by hand across axes 1-3 of that audit (10+ broken `AGENTS.md §N` references
 * after AGENTS.md was restructured, without every citing document being updated):
 *
 *  1. Every relative markdown link (`[text](path/to/file.md)`) in every tracked `.md` file
 *     resolves to a file that actually exists on disk.
 *  2. Every `AGENTS.md §N` citation refers to a section that actually exists as a `## N.`
 *     heading in AGENTS.md right now (not the section number that existed when the citing
 *     doc was written).
 *
 * AGENTS.md §6 conditions this kind of automation on "CI real existe" OR "reincidência de
 * link quebrado/drift documental" - both conditions are now true (CI has existed since M0;
 * this is the second audit in a row, out of three run so far, to find the same class of
 * drift that manual review missed). Run via `npm run check-docs`; wired into CI as a
 * blocking `guardrails` step (same tier as typecheck/lint/check-boundaries).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

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

function main(): void {
  const files = walkMarkdownFiles(REPO_ROOT);
  const validSections = loadAgentsMdSections();
  const violations: Violation[] = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf-8").split("\n");
    checkLinks(file, lines, violations);
    checkAgentsSectionRefs(file, lines, validSections, violations);
  }

  if (violations.length > 0) {
    // eslint-disable-next-line no-console -- CLI script, not a Lambda handler.
    console.error(`Doc drift check found ${violations.length} issue(s):\n`);
    for (const v of violations) {
      // eslint-disable-next-line no-console -- CLI script.
      console.error(`  ${v.file}:${v.line} — ${v.message}`);
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console -- CLI script.
  console.log(`Doc drift check: ${files.length} markdown files scanned, no broken links or stale AGENTS.md §N references found.`);
}

main();
