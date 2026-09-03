import { describe, expect, it } from "vitest";
import { encodeSearchCursor, decodeSearchCursor } from "../../../src/shared/domain/search-cursor.js";
import { ValidationError } from "../../../src/shared/errors/app-error.js";

describe("search-cursor (D-194 Fatia 3)", () => {
  const signature = { mode: "SUBJECT", status: "ACTIVE", type: "VENDOR" };
  const key = { PK: "TENANT#t1#SUBJECT#s1", SK: "META" };

  it("round-trips the raw key when decoded with the SAME signature it was minted under", () => {
    const cursor = encodeSearchCursor(signature, key);
    expect(decodeSearchCursor(cursor, signature)).toEqual(key);
  });

  it("is order-independent - the same logical signature built with keys in a different order still round-trips", () => {
    const cursor = encodeSearchCursor(signature, key);
    const reordered = { type: "VENDOR", status: "ACTIVE", mode: "SUBJECT" };
    expect(decodeSearchCursor(cursor, reordered)).toEqual(key);
  });

  it("rejects with ValidationError (400 at the HTTP edge) when a filter changed since the cursor was minted", () => {
    const cursor = encodeSearchCursor(signature, key);
    expect(() => decodeSearchCursor(cursor, { ...signature, status: "ARCHIVED" })).toThrow(ValidationError);
  });

  it("rejects an extra filter added since the cursor was minted", () => {
    const cursor = encodeSearchCursor(signature, key);
    expect(() => decodeSearchCursor(cursor, { ...signature, tag: "urgent" })).toThrow(ValidationError);
  });

  it("rejects a malformed/tampered cursor string", () => {
    expect(() => decodeSearchCursor("not-valid-base64url-json", signature)).toThrow(ValidationError);
  });

  it("rejects a well-formed base64url payload missing the expected shape", () => {
    const bogus = Buffer.from(JSON.stringify({ foo: "bar" }), "utf-8").toString("base64url");
    expect(() => decodeSearchCursor(bogus, signature)).toThrow(ValidationError);
  });
});
