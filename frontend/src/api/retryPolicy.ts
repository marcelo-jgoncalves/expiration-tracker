/**
 * Retry rules by operation class (mission §41) - never a single generic "retry on failure"
 * policy. TanStack Query's own `retry` option is wired per-call-site to one of these, never
 * left at its cache-wide default.
 */
import { ApiError } from "./errors.js";

export type OperationClass = "safe-read" | "idempotent-mutation" | "non-idempotent-mutation";

/** safe-read: transient network/dependency failures are worth retrying a few times - a GET
 * has no side effect to duplicate. idempotent-mutation: retry is safe ONLY when the same
 * idempotency key is reused (useIdempotentMutation guarantees this) - a small retry count
 * for transient failures is fine because the backend itself de-duplicates.
 * non-idempotent-mutation: NEVER blind-retry - the caller must surface the failure and let
 * the user decide (mission §41's "no retry with unknown contract"). */
export function retryPolicyFor(operation: OperationClass): (failureCount: number, error: unknown) => boolean {
  return (failureCount, error) => {
    if (operation === "non-idempotent-mutation") return false;
    if (!(error instanceof ApiError)) return false;
    if (!error.retryable) return false;
    const maxAttempts = operation === "safe-read" ? 3 : 2;
    return failureCount < maxAttempts;
  };
}
