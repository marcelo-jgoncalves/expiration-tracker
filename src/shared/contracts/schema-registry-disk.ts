/**
 * Disk-backed schema discovery - deliberately kept OUT of schema-validator.ts (full-audit
 * round1/qualidade, 2026-08-19 residual fix). Reason: even when unused at runtime, code that
 * references `import.meta.url` still gets bundled and still trips esbuild's
 * "'import.meta' is not available with the 'cjs' output format" warning on every Lambda that
 * imports anything from the same module (infra/lib/scoped-lambda-function.ts's bundleEntry
 * uses format "cjs") - cosmetic once `defaultSchemaRegistry` stopped depending on it, but
 * still misleading noise in CDK synth output that could hide a real future warning. Splitting
 * this into its own module `defaultSchemaRegistry`'s file never imports means esbuild never
 * even sees this file when bundling a handler, and the warning disappears for real.
 *
 * Only used by `npm run validate-schemas` (scripts/validate-schemas.ts) and
 * test/contract/schemas.test.ts - both run as real Node ESM (tsx / Vitest), never through the
 * esbuild-cjs Lambda bundle, so `import.meta.url` is safe here.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SchemaRegistry } from "./schema-validator.js";

function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../");
}

export function schemasDir(): string {
  return path.join(repoRoot(), "schemas");
}

function walkJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkJsonFiles(full));
    } else if (entry.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

/** Loads every schema JSON file under `schemas/` (or `dir`, for tests) from disk. */
export function loadSchemasFromDisk(dir: string = schemasDir()): object[] {
  return walkJsonFiles(dir).map((file) => JSON.parse(readFileSync(file, "utf-8")));
}

/** Builds a `SchemaRegistry` from every schema under `schemas/` (dynamic directory walk) -
 * "validate every schema under schemas/" semantics for the CLI/tests, including schemas not
 * yet wired into `defaultSchemaRegistry`'s static import list. */
export function loadAllSchemasFromDisk(dir?: string): SchemaRegistry {
  return new SchemaRegistry(loadSchemasFromDisk(dir));
}
