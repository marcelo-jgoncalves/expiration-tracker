import { describe, expect, it } from "vitest";
import { retryPolicyFor } from "../../src/api/retryPolicy.js";
import { ApiError } from "../../src/api/errors.js";

describe("retryPolicyFor", () => {
  it("non-idempotent-mutation never retries, even for a retryable error, even on the first failure", () => {
    const policy = retryPolicyFor("non-idempotent-mutation");
    expect(policy(0, ApiError.network(new Error("boom")))).toBe(false);
  });

  it("never retries a non-ApiError (an unexpected thrown value never counts as safely retryable)", () => {
    expect(retryPolicyFor("safe-read")(0, new Error("plain"))).toBe(false);
    expect(retryPolicyFor("idempotent-mutation")(0, "a string")).toBe(false);
  });

  it("never retries an ApiError marked non-retryable, regardless of operation class", () => {
    const nonRetryable = ApiError.unknownOutcome(new Error("timeout"));
    expect(retryPolicyFor("safe-read")(0, nonRetryable)).toBe(false);
    expect(retryPolicyFor("idempotent-mutation")(0, nonRetryable)).toBe(false);
  });

  it("safe-read retries a retryable error up to 3 attempts, then stops", () => {
    const policy = retryPolicyFor("safe-read");
    const err = ApiError.network(new Error("boom"));
    expect(policy(0, err)).toBe(true);
    expect(policy(1, err)).toBe(true);
    expect(policy(2, err)).toBe(true);
    expect(policy(3, err)).toBe(false);
  });

  it("idempotent-mutation retries a retryable error up to only 2 attempts - smaller budget than a safe read", () => {
    const policy = retryPolicyFor("idempotent-mutation");
    const err = ApiError.network(new Error("boom"));
    expect(policy(0, err)).toBe(true);
    expect(policy(1, err)).toBe(true);
    expect(policy(2, err)).toBe(false);
  });
});
