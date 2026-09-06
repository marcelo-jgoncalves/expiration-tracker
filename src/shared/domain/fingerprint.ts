/**
 * Generic canonical-JSON SHA-256 fingerprint — extracted out of `search-cursor.ts` (D-194 Fatia
 * 3, the first caller) so a second caller (D-205's `scopeHash`, `dossier-export-run.ts`) reuses
 * the exact same stable-key-order canonicalization instead of duplicating it. Generic, no import
 * from `src/modules/**` (same posture as `validity-state.ts`/`search-cursor.ts`).
 */
import { createHash } from "node:crypto";

/** Stable stringify — sorts object keys recursively so the same logical value always hashes
 * identically regardless of the property insertion order the caller happened to build it in. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
