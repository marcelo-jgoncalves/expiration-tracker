/**
 * Opaque composite cursor for GET /activity (D-149 decisão 4) — base64(JSON) of one
 * {PK,SK} per partition, same "opaque to the client, real DynamoDB key inside" convention
 * as every other paginated list view in this codebase (D-136/D-E). Never includes a
 * partition key that didn't actually advance (see merge.ts's `consumedLast` contract) —
 * this module only encodes/decodes, callers own how a field is merged forward.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuditPartition } from "./merge.js";
import { ValidationError } from "../../../shared/errors/app-error.js";

export type CompositeCursor = Partial<Record<AuditPartition, EntityKey>>;

export function encodeActivityCursor(cursor: CompositeCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

/** Throws ValidationError (not a generic parse error) on a malformed/tampered cursor — same
 * fail-closed-at-the-HTTP-edge convention as every other schema-validated input field. */
export function decodeActivityCursor(raw: string): CompositeCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
  } catch {
    throw new ValidationError("Invalid activity cursor.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError("Invalid activity cursor.");
  }
  const result: CompositeCursor = {};
  for (const [partition, key] of Object.entries(parsed as Record<string, unknown>)) {
    if (!["expiration", "organization", "subject", "tenant"].includes(partition)) {
      throw new ValidationError("Invalid activity cursor.");
    }
    if (typeof key !== "object" || key === null || typeof (key as Record<string, unknown>)["PK"] !== "string" || typeof (key as Record<string, unknown>)["SK"] !== "string") {
      throw new ValidationError("Invalid activity cursor.");
    }
    result[partition as AuditPartition] = key as unknown as EntityKey;
  }
  return result;
}
