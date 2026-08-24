/**
 * Session — the new dedicated table D-054 requires (never the single-table main aggregate:
 * its `tenant_facing_read_write` policy already grants GetItem/Query to ~20+ resource roles,
 * exactly the over-broad exposure D-054 flagged). Distinct from
 * src/modules/identity/domain/request-context.ts's `sessionId`/`DeviceSession` - those are the
 * JWT-authorizer-side revocation watermark (M1), this is the BFF-side browser session that
 * *produces* the bearer token DeviceSession later revokes. Never reuse the same name for both.
 *
 * PK/SK: `SESSION#<selectorHash>` / `POINTER` - single dedicated table, no tenant prefix
 * needed (unlike GuestTokenPointer's tenantless-exception note, this table has no other
 * tenant-scoped data to isolate from; the whole table is BFF-only, per D-054).
 */
export interface Session {
  PK: string;
  SK: "POINTER";
  entityType: "Session";
  selectorHash: string;
  secretHash: string;
  tenantId: string;
  userId: string;
  cognitoSubject: string;
  deviceId: string;
  csrfSecret: string;
  /** Encrypted at rest via the dedicated CMK (D-054) - never plaintext in this record. */
  encryptedRefreshToken: string;
  /** Cached access token, short-lived (<=15 min per D-054) - avoids a Cognito round trip on
   * every proxied request; refreshed proactively, never trusted past its own expiry. */
  accessToken: string;
  accessTokenExpiresAt: string;
  /** Fixed at creation, never extended by refresh (D-054: absolute session lifetime ceiling
   * independent of activity). */
  absoluteExpiresAt: string;
  /** DynamoDB TTL attribute (epoch seconds) - physical deletion, same convention as
   * GuestTokenPointer.purgeAfterTtl. Recomputed on every activity as `now + idle TTL`, capped
   * at `absoluteExpiresAt`. */
  purgeAfterTtl: number;
  refreshState: "IDLE" | "IN_PROGRESS";
  refreshLeaseId?: string;
  refreshLeaseUntil?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function sessionKey(selectorHash: string): { PK: string; SK: "POINTER" } {
  return { PK: `SESSION#${selectorHash}`, SK: "POINTER" };
}

/**
 * LoginAttempt — ephemeral, single-use (D-054). PK/SK: `LOGINATTEMPT#<selectorHash>` /
 * `POINTER`, same dedicated table (co-located, not a second table - it exists only to bridge
 * the redirect to Cognito and back, nothing else needs it).
 */
export interface LoginAttempt {
  PK: string;
  SK: "POINTER";
  entityType: "LoginAttempt";
  selectorHash: string;
  secretHash: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Where to return the user after a successful login (§23 of the Validation Readiness
   * mission's "return context" concept, carried into real auth) - validated against an
   * allowlist of same-origin app paths before ever being used, never an open redirect. */
  returnTo: string;
  purgeAfterTtl: number;
  consumedAt?: string;
  createdAt: string;
  /** Guards single-use consumption via SessionStore.updateConditional - without this, two
   * concurrent callbacks (double-click, browser back+resubmit) racing on the same LoginAttempt
   * could both read it as not-yet-consumed before either write lands (found in review). */
  version: number;
}

export function loginAttemptKey(selectorHash: string): { PK: string; SK: "POINTER" } {
  return { PK: `LOGINATTEMPT#${selectorHash}`, SK: "POINTER" };
}
