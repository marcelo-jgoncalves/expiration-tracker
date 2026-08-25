import { describe, expect, it } from "vitest";
import { ApiError, isAuthError, isConflict, isUnknownOutcome } from "../../src/api/errors.js";

describe("ApiError", () => {
  it("fromResponseBody parses a well-formed backend error shape", () => {
    const err = ApiError.fromResponseBody({ code: "CONFLICT", category: "CONFLICT", message: "stale version", retryable: false }, 409);
    expect(err.category).toBe("CONFLICT");
    expect(err.status).toBe(409);
    expect(isConflict(err)).toBe(true);
  });

  it("fromResponseBody never throws on a malformed/unrecognized body - falls back to INTERNAL", () => {
    const err = ApiError.fromResponseBody({ unexpected: "shape" }, 500);
    expect(err.category).toBe("INTERNAL");
    expect(err.code).toBe("UNRECOGNIZED_ERROR_SHAPE");
  });

  it("fromResponseBody never throws on a non-object body (string, null, array)", () => {
    expect(ApiError.fromResponseBody("plain text error", 500).category).toBe("INTERNAL");
    expect(ApiError.fromResponseBody(null, 500).category).toBe("INTERNAL");
    expect(ApiError.fromResponseBody([1, 2, 3], 500).category).toBe("INTERNAL");
  });

  it("network() never carries a real HTTP status - the request never reached the backend", () => {
    const err = ApiError.network(new Error("fetch failed"));
    expect(err.category).toBe("NETWORK");
    expect(err.status).toBeUndefined();
    expect(err.retryable).toBe(true);
  });

  it("unknownOutcome() is deliberately non-retryable at this generic level - a caller must decide per operation", () => {
    const err = ApiError.unknownOutcome(new Error("timeout"));
    expect(err.category).toBe("UNKNOWN_OUTCOME");
    expect(err.retryable).toBe(false);
    expect(isUnknownOutcome(err)).toBe(true);
  });

  it("processing() marks a response-shape mismatch distinctly from a domain error", () => {
    const err = ApiError.processing(new SyntaxError("Unexpected token"));
    expect(err.category).toBe("PROCESSING");
  });

  it("isAuthError recognizes both AUTH and AUTHORIZATION categories, never anything else", () => {
    expect(isAuthError(ApiError.fromResponseBody({ code: "x", category: "AUTH", message: "m", retryable: false }, 401))).toBe(true);
    expect(isAuthError(ApiError.fromResponseBody({ code: "x", category: "AUTHORIZATION", message: "m", retryable: false }, 403))).toBe(true);
    expect(isAuthError(ApiError.fromResponseBody({ code: "x", category: "NOT_FOUND", message: "m", retryable: false }, 404))).toBe(false);
  });

  it("isConflict/isUnknownOutcome/isAuthError are false for a non-ApiError value (never throw on an unexpected caught value)", () => {
    expect(isConflict(new Error("plain"))).toBe(false);
    expect(isUnknownOutcome("a string")).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });
});
