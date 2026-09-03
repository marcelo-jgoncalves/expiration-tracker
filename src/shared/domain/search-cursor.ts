/**
 * Opaque, signature-fingerprinted cursor for D-194 Fatia 3 (search/filters,
 * `docs/architecture/reviews/search-and-filters-scoping/estado-final-consolidado.md`) —
 * `searchSubjects`/`searchRequirements`/`searchExpirationItems` each mint one of these. Same
 * "opaque to the client, real DynamoDB key inside" convention as `activity/domain/cursor.ts`, but
 * this one ALSO embeds a fingerprint of the entire search signature (mode/status/filters) so a
 * cursor minted for one filter combination is rejected (never silently reinterpreted) if
 * re-presented against a different one — the exact guard `item-handlers.ts`'s
 * `decodeDashboardCursor` gives a single field (`GSI1PK`) for, generalized here to an arbitrary
 * filter object because Fatia 3's signature has several independent fields. Generic, no import
 * from `src/modules/**` (same posture as `validity-state.ts`) — each module's HTTP handler owns
 * its own concrete signature shape and calls these two functions.
 */
import { createHash } from "node:crypto";
import { ValidationError } from "../errors/app-error.js";

interface EncodedCursor {
  /** sha256 hex of the canonical (stable-key-order) JSON of the search signature this cursor was minted under. */
  sig: string;
  /** Raw DynamoDB LastEvaluatedKey to resume from. */
  key: Record<string, unknown>;
}

/** Stable stringify — sorts object keys recursively so the same logical signature always hashes
 * identically regardless of the property insertion order the caller happened to build it in. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(signature: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(signature)).digest("hex");
}

export function encodeSearchCursor(signature: Record<string, unknown>, lastEvaluatedKey: Record<string, unknown>): string {
  const payload: EncodedCursor = { sig: fingerprint(signature), key: lastEvaluatedKey };
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
}

/** Throws ValidationError (never a generic parse error, fail-closed at the HTTP edge, same
 * convention as `decodeActivityCursor`) both on a malformed/tampered cursor AND on a well-formed
 * cursor whose embedded fingerprint doesn't match `signature` recomputed from the CURRENT call's
 * filters — the latter is the "cursor rejected with 400 if filters changed" contract Fatia 3's
 * design requires. */
export function decodeSearchCursor(raw: string, signature: Record<string, unknown>): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
  } catch {
    throw new ValidationError("Invalid search cursor.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)["sig"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["key"] !== "object" ||
    (parsed as Record<string, unknown>)["key"] === null
  ) {
    throw new ValidationError("Invalid search cursor.");
  }
  const candidate = parsed as unknown as EncodedCursor;
  if (candidate.sig !== fingerprint(signature)) {
    throw new ValidationError("Search cursor does not match the current filters.");
  }
  return candidate.key;
}
