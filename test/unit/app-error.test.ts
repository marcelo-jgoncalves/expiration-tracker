import { describe, expect, it } from "vitest";
import {
  AppError,
  ConflictError,
  DependencyUnavailableError,
  InternalError,
  isRetryable,
  toAppError,
  ValidationError,
} from "../../src/shared/errors/app-error.js";

describe("AppError taxonomy", () => {
  it("marks DependencyUnavailableError as retryable", () => {
    const err = new DependencyUnavailableError("provider timeout");
    expect(err.retryable).toBe(true);
    expect(err.category).toBe("DEPENDENCY_UNAVAILABLE");
  });

  it("marks ValidationError and ConflictError as terminal (not retryable)", () => {
    expect(new ValidationError("bad input").retryable).toBe(false);
    expect(new ConflictError("version mismatch").retryable).toBe(false);
  });

  it("toAppError wraps a plain Error as InternalError, non-retryable by default", () => {
    const wrapped = toAppError(new Error("boom"));
    expect(wrapped).toBeInstanceOf(InternalError);
    expect(wrapped.retryable).toBe(false);
  });

  it("toAppError passes through an existing AppError unchanged", () => {
    const original = new ConflictError("dup");
    expect(toAppError(original)).toBe(original);
  });

  it("isRetryable reflects the classification used by SQS consumers to route to DLQ", () => {
    expect(isRetryable(new DependencyUnavailableError("x"))).toBe(true);
    expect(isRetryable(new ValidationError("x"))).toBe(false);
    expect(isRetryable(new Error("unclassified"))).toBe(false);
  });

  it("toJSON exposes a normalized, loggable shape (still needs Redactor for `details`)", () => {
    const err = new ValidationError("bad field", { field: "email" });
    const json = err.toJSON();
    expect(json).toMatchObject({ code: "VALIDATION_FAILED", category: "VALIDATION", retryable: false });
  });

  it("AppError instances are real Error instances (stack traces work)", () => {
    const err = new AppError({ code: "X", category: "INTERNAL", message: "m", retryable: false });
    expect(err).toBeInstanceOf(Error);
    expect(err.stack).toBeDefined();
  });
});
