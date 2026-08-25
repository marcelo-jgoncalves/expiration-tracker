/**
 * RefreshOutcome — the 5 formal states D-054 specifies for token refresh, replacing the
 * original design's local rotation counter (found fragile under normal SPA concurrency).
 * Cognito's native RefreshTokenRotation is the source of truth; the BFF-side lease
 * (Session.refreshState/refreshLeaseId/refreshLeaseUntil) is a latency optimization only -
 * it never decides replay safety by itself, Cognito's own rotation does that.
 */
export type RefreshOutcome =
  | { kind: "SUCCESS"; accessToken: string; accessTokenExpiresAt: string; encryptedRefreshToken: string }
  /** invalid_grant outside Cognito's rotation grace period - the only outcome that kills the
   * session. Everything else preserves it. */
  | { kind: "DEFINITIVE_AUTH_FAILURE"; reason: string }
  /** Timeout/5xx from Cognito - session stays intact, caller should surface a retryable
   * DependencyUnavailableError, never treat this as logout. */
  | { kind: "TRANSIENT_TRANSPORT_FAILURE"; cause: unknown }
  /** Another request already holds the refresh lease - caller should back off 50-100ms and
   * re-read the session rather than racing a second call to Cognito. */
  | { kind: "CONCURRENT_REFRESH" }
  /** The response to Cognito's token endpoint was lost after Cognito itself processed the
   * rotation (network cut mid-response) - mirrors UNKNOWN_OUTCOME elsewhere in this codebase:
   * never collapsed into DEFINITIVE_AUTH_FAILURE, never silently retried more than once. */
  | { kind: "UNKNOWN_OUTCOME" };
