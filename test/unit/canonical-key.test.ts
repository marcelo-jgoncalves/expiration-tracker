import { describe, expect, it } from "vitest";
import { serializeCanonicalKey, deserializeCanonicalKey } from "../../src/shared/dynamodb/canonical-key.js";

describe("serializeCanonicalKey / deserializeCanonicalKey (D-300 §2: ReminderScanLease.lastEvaluatedKey)", () => {
  it("serializes with keys in fixed alphabetical order regardless of insertion order", () => {
    const a = serializeCanonicalKey({ GSI3SK: "x", GSI3PK: "y", PK: "p", SK: "s" });
    const b = serializeCanonicalKey({ SK: "s", PK: "p", GSI3PK: "y", GSI3SK: "x" });
    expect(a).toBe(b);
    expect(a).toBe('{"GSI3PK":"y","GSI3SK":"x","PK":"p","SK":"s"}');
  });

  it("returns undefined for undefined input - page 1 has no lastEvaluatedKey attribute at all", () => {
    expect(serializeCanonicalKey(undefined)).toBeUndefined();
    expect(deserializeCanonicalKey(undefined)).toBeUndefined();
  });

  it("round-trips back to an equivalent plain object", () => {
    const key = { PK: "SCAN#v1#shard-3#2026-09-14T12:00:00.000Z", SK: "LEASE", GSI3PK: "DUE#2026-09-14T12:00", GSI3SK: "OCCURRENCE#t_01#occ_01" };
    const serialized = serializeCanonicalKey(key);
    expect(deserializeCanonicalKey(serialized)).toEqual(key);
  });

  it("sorts nested object keys too, not just the top level", () => {
    const a = serializeCanonicalKey({ outer: { b: 1, a: 2 } });
    const b = serializeCanonicalKey({ outer: { a: 2, b: 1 } });
    expect(a).toBe(b);
  });
});
