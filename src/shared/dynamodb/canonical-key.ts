/**
 * Canonical serialization for a DynamoDB `LastEvaluatedKey`/`ExclusiveStartKey` object - D-300
 * (`reminder-producer-implementation-plan-scoping/DECISION.md` §2): the `ReminderScanLease`
 * item's `lastEvaluatedKey` field must be "serializado canonicamente, campos em ordem fixa -
 * não `JSON.stringify` cru". A raw `JSON.stringify` on an object built by the AWS SDK does not
 * guarantee stable key order across SDK versions/runtimes, which would make the checkpoint
 * condition's `lastEvaluatedKey = :myStartKey` string-equality check (see scan-page.ts) flaky -
 * two logically-identical keys could serialize to different strings. Sorting keys
 * alphabetically before stringifying makes the serialization a pure function of the key's
 * contents, never its construction order.
 */

/** Serializes a DynamoDB key object with keys in a fixed (alphabetical) order. `undefined`
 * (page 1, no previous page) serializes to `undefined` - never the string `"undefined"` - so
 * the lease item's `lastEvaluatedKey` attribute is genuinely absent on page 1, matching the
 * `attribute_not_exists(lastEvaluatedKey)` branch of the checkpoint condition. */
export function serializeCanonicalKey(key: Record<string, unknown> | undefined): string | undefined {
  if (key === undefined) return undefined;
  return JSON.stringify(sortKeysDeep(key));
}

/** Inverse of `serializeCanonicalKey` - parses the stored string back into the plain object the
 * DynamoDB SDK's `ExclusiveStartKey` expects. `undefined` in, `undefined` out (page 1). */
export function deserializeCanonicalKey(serialized: string | undefined): Record<string, unknown> | undefined {
  if (serialized === undefined) return undefined;
  return JSON.parse(serialized) as Record<string, unknown>;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}
