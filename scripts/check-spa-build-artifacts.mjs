/**
 * SPA build artifact policy checker — ADR-0011 (docs/architecture/adr/
 * ADR-0011-cloudfront-bff-coexistence.md), Correção 1 da v6.
 *
 * The CloudFront Function that provides client-side SPA routing fallback
 * (infra/modules/spa-hosting/spa-routing.js) rewrites any GET/HEAD request whose last path
 * segment has no extension to /index.html - EXCEPT for a versioned denylist of reserved
 * prefixes (/bff, /.well-known/). That heuristic is only safe if the build never publishes a
 * real static asset without an extension outside index.html itself: such a file would be
 * silently served as index.html instead of its real content.
 *
 * This script enforces the other half of that contract at build time: `frontend/dist/` (the
 * output of `npm run build`, run from `frontend/`) must not contain any file, other than the
 * top-level `index.html`, whose name has no extension. Run from BOTH `ci.yml` (guardrails,
 * every PR) and `cd.yml` (deploy, before syncing to S3) via a single shared script - never two
 * divergent checkers (ADR-0011 Correção 5 da v6: this was flagged as an operational
 * contradiction when the check was only described as running at deploy time).
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const DIST_DIR = process.argv[2] ?? path.resolve(import.meta.dirname, "..", "frontend", "dist");

function walk(dir, root) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full, root));
    } else {
      out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return out;
}

function main() {
  let stat;
  try {
    stat = statSync(DIST_DIR);
  } catch {
    console.error(`SPA build artifact check: ${DIST_DIR} does not exist - run \`npm run build\` in frontend/ first.`);
    process.exit(1);
  }
  if (!stat.isDirectory()) {
    console.error(`SPA build artifact check: ${DIST_DIR} is not a directory.`);
    process.exit(1);
  }

  const files = walk(DIST_DIR, DIST_DIR);
  const violations = files.filter((relativePath) => relativePath !== "index.html" && !path.basename(relativePath).includes("."));

  if (violations.length > 0) {
    console.error("SPA build artifact check: found file(s) without an extension outside index.html.");
    console.error("The CloudFront SPA-routing function (infra/modules/spa-hosting/spa-routing.js) would silently");
    console.error("serve these as index.html instead of their real content - see ADR-0011.");
    for (const violation of violations) console.error(`  - ${violation}`);
    console.error("Fix: publish this file with an extension, or add its prefix to RESERVED_PREFIXES in spa-routing.js");
    console.error("and to this script's expectations if it is a deliberately reserved static namespace.");
    process.exit(1);
  }

  console.log(`SPA build artifact check: ${files.length} file(s) scanned in ${DIST_DIR}, no extension-less file found outside index.html.`);
}

main();
