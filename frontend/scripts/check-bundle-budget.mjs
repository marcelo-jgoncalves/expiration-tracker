#!/usr/bin/env node
// PERF-14 (regression gate, slice 1/2) — bundle budget CI check.
//
// Guards only the ENTRY chunk (the JS+CSS every visitor downloads before any route
// renders), not the aggregate of all lazy route chunks — those legitimately grow as the
// app grows post-PERF-09 code splitting (docs/engineering/performance/results/
// PERF-03-bundle-baseline.md, "depois do code splitting"). Budgeting the aggregate would
// punish adding features, not regressions in what's actually shipped up front.
//
// Baseline (PERF-09, post code-splitting): entry chunk ~280.8 KB raw / ~86.7 KB gzip
// (index-*.js + index-*.css in dist/assets/). Budget below = baseline + ~17% headroom,
// rounded to clean numbers — enough slack for normal incremental growth of the app shell
// (auth/router/providers) without masking a real regression (e.g. an accidental heavy
// import landing in the shell instead of a lazy route).
//
// Run after `npm run build` (frontend/): `node scripts/check-bundle-budget.mjs`

import { readdirSync, statSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const DIST_ASSETS = join(process.cwd(), "dist", "assets");
const ENTRY_PATTERN = /^index-.*\.(js|css)$/;

const RAW_BUDGET_BYTES = 330 * 1024; // ~330 KB, vs. baseline ~280.8 KB (+17.5%)
const GZIP_BUDGET_BYTES = 100 * 1024; // ~100 KB, vs. baseline ~86.7 KB (+15.3%)

function main() {
  let entries;
  try {
    entries = readdirSync(DIST_ASSETS);
  } catch (err) {
    console.error(
      `[bundle-budget] Could not read ${DIST_ASSETS} — did you run "npm run build" first? (${err.message})`,
    );
    process.exit(1);
  }

  const entryFiles = entries.filter((f) => ENTRY_PATTERN.test(f));
  if (entryFiles.length === 0) {
    console.error(
      `[bundle-budget] No files matching ${ENTRY_PATTERN} found in ${DIST_ASSETS} — ` +
        "the entry chunk naming convention may have changed; update ENTRY_PATTERN.",
    );
    process.exit(1);
  }

  let rawTotal = 0;
  let gzipTotal = 0;
  const rows = [];

  for (const file of entryFiles) {
    const filePath = join(DIST_ASSETS, file);
    const raw = statSync(filePath).size;
    const gzip = gzipSync(readFileSync(filePath)).length;
    rawTotal += raw;
    gzipTotal += gzip;
    rows.push({ file, raw, gzip });
  }

  console.log("[bundle-budget] Entry chunk files:");
  for (const { file, raw, gzip } of rows) {
    console.log(
      `  ${file}: raw=${(raw / 1024).toFixed(1)}KB gzip=${(gzip / 1024).toFixed(1)}KB`,
    );
  }
  console.log(
    `[bundle-budget] Total: raw=${(rawTotal / 1024).toFixed(1)}KB ` +
      `(budget ${(RAW_BUDGET_BYTES / 1024).toFixed(0)}KB), ` +
      `gzip=${(gzipTotal / 1024).toFixed(1)}KB ` +
      `(budget ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)}KB)`,
  );

  let failed = false;
  if (rawTotal > RAW_BUDGET_BYTES) {
    console.error(
      `[bundle-budget] FAIL: entry chunk raw size ${(rawTotal / 1024).toFixed(1)}KB exceeds budget ${(RAW_BUDGET_BYTES / 1024).toFixed(0)}KB`,
    );
    failed = true;
  }
  if (gzipTotal > GZIP_BUDGET_BYTES) {
    console.error(
      `[bundle-budget] FAIL: entry chunk gzip size ${(gzipTotal / 1024).toFixed(1)}KB exceeds budget ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)}KB`,
    );
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }

  console.log("[bundle-budget] OK — entry chunk within budget.");
}

main();
