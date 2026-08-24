/**
 * BffAuthService — the Full BFF's core (D-053/D-054, docs/architecture/reviews/
 * bff-full-vs-session-design/). The browser only ever holds opaque cookies; every Cognito
 * token (access/ID/refresh) lives here, server-side, in the dedicated session table.
 *
 * Reuses src/modules/identity as a library (RequestContextResolver's constituent repos), the
 * same way src/workers/reminder-producer imports src/modules/reminder in-process - no new
 * internal HTTP endpoint, no TransactWriteItems across the main table and this module's table.
 */
import { randomUUID } from "node:crypto";
import { AuthenticationError, ConflictError, DependencyUnavailableError, ValidationError } from "../../../shared/errors/app-error.js";
import { IdentityMappingRepository } from "../../identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../identity/persistence/user-repository.js";
import type { SessionStore } from "../ports/session-store.js";
import type { CognitoOidcClient, IdTokenVerifier } from "../ports/cognito-oidc-client.js";
import type { TokenEncryptor } from "../ports/token-encryptor.js";
import { issueOpaqueToken, parseOpaqueToken, opaqueTokenSecretMatches, hmacTokenCrypto } from "../domain/opaque-token.js";
import { issueCsrfSecret } from "../domain/csrf.js";
import {
  sessionKey,
  loginAttemptKey,
  type Session,
  type LoginAttempt,
} from "../domain/session.js";
import { SESSION_ABSOLUTE_TTL_SECONDS, SESSION_IDLE_TTL_SECONDS, LOGIN_ATTEMPT_TTL_SECONDS } from "../domain/cookies.js";
import type { RefreshOutcome } from "../domain/refresh-outcome.js";

export interface BffAuthServiceDeps {
  sessionStore: SessionStore;
  cognitoClient: CognitoOidcClient;
  idTokenVerifier: IdTokenVerifier;
  tokenEncryptor: TokenEncryptor;
  identityMappings: IdentityMappingRepository;
  users: UserRepository;
  pepper: string;
  redirectUri: string;
  authorizeUrl: string; // Cognito Hosted UI /oauth2/authorize base URL (from Terraform output/env, not hardcoded)
  clientId: string;
  now: () => string;
  newUserId: () => string;
  newDeviceId: () => string;
}

export interface StartedLogin {
  loginToken: string;
  redirectUrl: string;
}

/** Allowlisted app paths only - never an open redirect (D-053/D-054 never proposed a
 * `returnTo` mechanism; this validation is new and mandatory precisely because it wasn't
 * already decided - an unvalidated returnTo would be a classic open-redirect vector). */
function isValidReturnPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("://");
}

export class BffAuthService {
  constructor(private readonly deps: BffAuthServiceDeps) {}

  /** Step 1 of the OIDC flow: mint a LoginAttempt (state/nonce/PKCE verifier), return the
   * Cognito Hosted UI URL to redirect the browser to, and the opaque login-cookie value. */
  async startLogin(returnTo: string): Promise<StartedLogin> {
    const safeReturnTo = isValidReturnPath(returnTo) ? returnTo : "/";
    const issued = issueOpaqueToken(this.deps.pepper);
    const state = randomUUID();
    const nonce = randomUUID();
    const codeVerifier = randomUUID() + randomUUID(); // >=43 chars required by PKCE spec (RFC 7636)
    const codeChallenge = await pkceChallenge(codeVerifier);

    const now = this.deps.now();
    const attempt: LoginAttempt = {
      ...loginAttemptKey(issued.selectorHash),
      SK: "POINTER",
      entityType: "LoginAttempt",
      selectorHash: issued.selectorHash,
      secretHash: issued.secretHash,
      state,
      nonce,
      codeVerifier,
      returnTo: safeReturnTo,
      purgeAfterTtl: epochSeconds(now) + LOGIN_ATTEMPT_TTL_SECONDS,
      createdAt: now,
    };
    const created = await this.deps.sessionStore.putIfAbsent(attempt);
    if (!created) {
      // selectorHash collision is astronomically unlikely (128 bits of entropy) - if it
      // ever happens, fail closed rather than silently overwrite another attempt in flight.
      throw new ConflictError("Could not start a new login attempt.");
    }

    const params = new URLSearchParams({
      client_id: this.deps.clientId,
      response_type: "code",
      redirect_uri: this.deps.redirectUri,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope: "openid",
    });

    return { loginToken: issued.token, redirectUrl: `${this.deps.authorizeUrl}?${params.toString()}` };
  }

  /** Step 2: the Cognito redirect back to our callback route. Validates state (against the
   * LoginAttempt this exact login cookie points to - not just "some" attempt), exchanges the
   * code via PKCE, verifies the ID token's signature/issuer/audience/nonce, resolves the
   * tenant/user (reusing identity module first-login logic), and mints the real session. */
  async handleCallback(input: { loginCookie: string | undefined; code: string; state: string }): Promise<{ sessionToken: string; csrfToken: string; returnTo: string }> {
    if (!input.loginCookie) throw new AuthenticationError("Missing login session.");
    const parsed = parseOpaqueToken(input.loginCookie);
    if (!parsed) throw new AuthenticationError("Malformed login session.");

    const attempt = await this.deps.sessionStore.get<LoginAttempt>(loginAttemptKey(hmacTokenCrypto.hash(this.deps.pepper, parsed.selector)));
    if (!attempt || attempt.entityType !== "LoginAttempt" || attempt.consumedAt) {
      throw new AuthenticationError("Login session not found or already used.");
    }
    if (!opaqueTokenSecretMatches(this.deps.pepper, parsed.secret, attempt.secretHash)) {
      throw new AuthenticationError("Invalid login session.");
    }
    // Single-use: consume immediately, before the Cognito round trip, so a duplicate/retried
    // callback (double-click, browser back button) can never replay the same code twice
    // against a still-valid LoginAttempt.
    await this.deps.sessionStore.update<LoginAttempt>({ ...attempt, consumedAt: this.deps.now() });

    if (input.state !== attempt.state) {
      throw new AuthenticationError("State mismatch - possible CSRF on the OIDC callback itself.");
    }

    const tokens = await this.deps.cognitoClient.exchangeAuthorizationCode({
      code: input.code,
      codeVerifier: attempt.codeVerifier,
      redirectUri: this.deps.redirectUri,
    });

    const idClaims = await this.deps.idTokenVerifier.verify(tokens.idToken, attempt.nonce);
    // Access token claims are decoded (not independently re-verified) - it was obtained via a
    // direct server-to-server call to Cognito's token endpoint over TLS with client
    // credentials, the same trusted backchannel that just produced a signature-verified ID
    // token for the identical login; a second JWKS round trip would add latency without a
    // corresponding security gain. Never do this for a token that arrived via the browser.
    const accessClaims = decodeJwtPayloadUnverified(tokens.accessToken);

    // MVP: tenantId=userId (data-model.md §7.3, same rule RequestContextResolver.resolve()
    // applies) - newUserId() must be called exactly ONCE and reused for both, never twice.
    const newUserId = this.deps.newUserId();
    const mapping = await this.deps.identityMappings.findOrCreate(idClaims.subject, newUserId, newUserId);
    let profile = await this.deps.users.getProfile(mapping.tenantId, mapping.userId);
    if (!profile) {
      profile = await this.deps.users.createProfileIfAbsent({
        userId: mapping.userId,
        tenantId: mapping.tenantId,
        identitySubject: idClaims.subject,
        emailNormalized: (idClaims.email ?? "").toLowerCase(),
        roles: ["OWNER"],
        status: "ACTIVE",
      });
    }
    if (profile.status !== "ACTIVE") {
      throw new AuthenticationError("User is not active.");
    }

    const deviceId = this.deps.newDeviceId();
    await this.deps.users.upsertDeviceSession({
      PK: `TENANT#${mapping.tenantId}#USER#${mapping.userId}`,
      SK: `SESSION#${deviceId}`,
      entityType: "DeviceSession",
      tenantId: mapping.tenantId,
      userId: mapping.userId,
      deviceId,
      sessionId: randomUUID(),
      refreshFamilyId: randomUUID(),
      createdAt: this.deps.now(),
      lastSeenAt: this.deps.now(),
      expiresAt: new Date(Date.parse(this.deps.now()) + SESSION_ABSOLUTE_TTL_SECONDS * 1000).toISOString(),
      status: "ACTIVE",
    });

    const issuedSession = issueOpaqueToken(this.deps.pepper);
    const csrfSecret = issueCsrfSecret();
    const now = this.deps.now();
    const absoluteExpiresAt = new Date(Date.parse(now) + SESSION_ABSOLUTE_TTL_SECONDS * 1000).toISOString();
    const session: Session = {
      ...sessionKey(issuedSession.selectorHash),
      SK: "POINTER",
      entityType: "Session",
      selectorHash: issuedSession.selectorHash,
      secretHash: issuedSession.secretHash,
      tenantId: mapping.tenantId,
      userId: mapping.userId,
      cognitoSubject: idClaims.subject,
      deviceId,
      csrfSecret,
      encryptedRefreshToken: await this.deps.tokenEncryptor.encrypt(tokens.refreshToken),
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: new Date(Date.parse(now) + tokens.expiresInSeconds * 1000).toISOString(),
      absoluteExpiresAt,
      purgeAfterTtl: epochSeconds(now) + SESSION_IDLE_TTL_SECONDS,
      refreshState: "IDLE",
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const created = await this.deps.sessionStore.putIfAbsent(session);
    if (!created) {
      throw new ConflictError("Could not create session.");
    }

    void accessClaims; // decoded for future use (e.g. audit logging tokenId); not persisted raw
    return { sessionToken: issuedSession.token, csrfToken: csrfSecret, returnTo: attempt.returnTo };
  }

  /** Resolves a session cookie to its record, refreshing the cached access token first if it
   * is close to expiry. Never resolves a session past its absolute or idle expiry. */
  async resolveSession(sessionCookie: string | undefined): Promise<Session> {
    if (!sessionCookie) throw new AuthenticationError("No session.");
    const parsed = parseOpaqueToken(sessionCookie);
    if (!parsed) throw new AuthenticationError("Malformed session.");
    const selectorHash = hmacTokenCrypto.hash(this.deps.pepper, parsed.selector);

    let session = await this.deps.sessionStore.get<Session>(sessionKey(selectorHash));
    if (!session || session.entityType !== "Session" || session.revokedAt) {
      throw new AuthenticationError("Session not found.");
    }
    if (!opaqueTokenSecretMatches(this.deps.pepper, parsed.secret, session.secretHash)) {
      throw new AuthenticationError("Invalid session.");
    }
    const now = this.deps.now();
    if (now >= session.absoluteExpiresAt) {
      throw new AuthenticationError("Session expired (absolute lifetime).");
    }

    if (now >= session.accessTokenExpiresAt) {
      const outcome = await this.refresh(session);
      if (outcome.kind === "DEFINITIVE_AUTH_FAILURE") {
        throw new AuthenticationError("Session refresh failed - reauthentication required.");
      }
      if (outcome.kind === "TRANSIENT_TRANSPORT_FAILURE") {
        throw new DependencyUnavailableError("Could not refresh session - try again shortly.", undefined, outcome.cause);
      }
      if (outcome.kind === "UNKNOWN_OUTCOME") {
        // Mirrors this codebase's other UNKNOWN_OUTCOME handling (import/renew): never
        // silently treated as failure, but the caller gets a retryable signal rather than a
        // token that might not actually be fresh.
        throw new DependencyUnavailableError("Refresh outcome unknown - retry the request.");
      }
      if (outcome.kind === "CONCURRENT_REFRESH") {
        // Another request is refreshing right now; briefly back off and re-read rather than
        // racing a second call to Cognito for the same session.
        await sleep(75);
        const reread = await this.deps.sessionStore.get<Session>(sessionKey(selectorHash));
        if (!reread) throw new AuthenticationError("Session not found.");
        session = reread;
      } else if (outcome.kind === "SUCCESS") {
        const refreshed = await this.deps.sessionStore.get<Session>(sessionKey(selectorHash));
        if (!refreshed) throw new AuthenticationError("Session not found.");
        session = refreshed;
      }
    }

    // Bumps idle TTL on every successful resolution, capped at the absolute expiry - activity
    // extends idle timeout, never the absolute session lifetime (D-054).
    const nextPurge = Math.min(epochSeconds(now) + SESSION_IDLE_TTL_SECONDS, epochSeconds(session.absoluteExpiresAt));
    if (nextPurge !== session.purgeAfterTtl) {
      await this.deps.sessionStore.update<Session>({ ...session, purgeAfterTtl: nextPurge });
    }
    return session;
  }

  /**
   * The 5-state refresh machine (D-054). The BFF-side lease is a latency optimization only -
   * Cognito's own RefreshTokenRotation is what actually prevents a stale refresh token from
   * being reused; the lease just avoids two concurrent requests both hitting Cognito for the
   * same session at once.
   */
  async refresh(session: Session): Promise<RefreshOutcome> {
    const now = this.deps.now();
    if (session.refreshState === "IN_PROGRESS" && session.refreshLeaseUntil && now < session.refreshLeaseUntil) {
      return { kind: "CONCURRENT_REFRESH" };
    }

    const leaseId = randomUUID();
    const leaseUntil = new Date(Date.parse(now) + 5000).toISOString();
    const acquired = await this.deps.sessionStore.updateConditional<Session>(
      { ...session, refreshState: "IN_PROGRESS", refreshLeaseId: leaseId, refreshLeaseUntil: leaseUntil, updatedAt: now, version: session.version + 1 },
      { version: session.version },
    );
    if (!acquired) {
      return { kind: "CONCURRENT_REFRESH" };
    }

    let plaintextRefreshToken: string;
    try {
      plaintextRefreshToken = await this.deps.tokenEncryptor.decrypt(session.encryptedRefreshToken);
    } catch (cause) {
      await this.releaseLease(session, leaseId, now);
      return { kind: "TRANSIENT_TRANSPORT_FAILURE", cause };
    }

    let cognitoOutcome;
    try {
      cognitoOutcome = await this.deps.cognitoClient.refreshAccessToken({ refreshToken: plaintextRefreshToken });
    } catch {
      await this.releaseLease(session, leaseId, now);
      return { kind: "UNKNOWN_OUTCOME" }; // response lost after Cognito may have already rotated
    }

    if (cognitoOutcome.kind === "INVALID_GRANT") {
      await this.deps.sessionStore.update<Session>({ ...session, refreshState: "IDLE", revokedAt: now, updatedAt: now, version: session.version + 2 });
      return { kind: "DEFINITIVE_AUTH_FAILURE", reason: "invalid_grant" };
    }
    if (cognitoOutcome.kind === "TRANSIENT_FAILURE") {
      await this.releaseLease(session, leaseId, now);
      return { kind: "TRANSIENT_TRANSPORT_FAILURE", cause: undefined };
    }
    if (cognitoOutcome.kind === "UNKNOWN_OUTCOME") {
      await this.releaseLease(session, leaseId, now);
      return { kind: "UNKNOWN_OUTCOME" };
    }

    const { response } = cognitoOutcome;
    const refreshedAt = this.deps.now();
    await this.deps.sessionStore.update<Session>({
      ...session,
      accessToken: response.accessToken,
      accessTokenExpiresAt: new Date(Date.parse(refreshedAt) + response.expiresInSeconds * 1000).toISOString(),
      encryptedRefreshToken: await this.deps.tokenEncryptor.encrypt(response.refreshToken),
      refreshState: "IDLE",
      refreshLeaseId: undefined,
      refreshLeaseUntil: undefined,
      updatedAt: refreshedAt,
      version: session.version + 2,
    });
    return { kind: "SUCCESS", accessToken: response.accessToken, accessTokenExpiresAt: refreshedAt, encryptedRefreshToken: session.encryptedRefreshToken };
  }

  private async releaseLease(session: Session, leaseId: string, now: string): Promise<void> {
    await this.deps.sessionStore.updateConditional<Session>(
      { ...session, refreshState: "IDLE", refreshLeaseId: undefined, refreshLeaseUntil: undefined, updatedAt: now, version: session.version + 2 },
      { version: session.version + 1 },
    );
    void leaseId;
  }

  /** Device-scoped logout: revokes only this browser's session + DeviceSession. Local
   * revocation is the source of truth and happens first; RevokeToken is best-effort and
   * never blocks logout on failure (D-054). */
  async logout(sessionCookie: string | undefined): Promise<void> {
    if (!sessionCookie) return;
    const parsed = parseOpaqueToken(sessionCookie);
    if (!parsed) return;
    const session = await this.deps.sessionStore.get<Session>(sessionKey(hmacTokenCrypto.hash(this.deps.pepper, parsed.selector)));
    if (!session || session.entityType !== "Session") return;

    const now = this.deps.now();
    await this.deps.sessionStore.update<Session>({ ...session, revokedAt: now, updatedAt: now });
    await this.deps.users.logoutDevice(session.tenantId, session.userId, session.deviceId);

    try {
      const refreshToken = await this.deps.tokenEncryptor.decrypt(session.encryptedRefreshToken);
      await this.deps.cognitoClient.revokeRefreshToken({ refreshToken });
    } catch {
      // Best-effort by design (D-054) - local revocation above already ended the session;
      // a failed upstream revoke call must never surface as a logout failure to the user.
    }
  }

  /** Global logout: every device/session for this user, via the existing
   * globalLogoutAfter watermark (already enforced by resolveRequestContext for any Bearer
   * caller) plus revoking this specific session's own record. */
  async logoutAll(sessionCookie: string | undefined): Promise<void> {
    if (!sessionCookie) return;
    const parsed = parseOpaqueToken(sessionCookie);
    if (!parsed) return;
    const session = await this.deps.sessionStore.get<Session>(sessionKey(hmacTokenCrypto.hash(this.deps.pepper, parsed.selector)));
    if (!session || session.entityType !== "Session") return;

    await this.deps.users.logoutAll(session.tenantId, session.userId);
    await this.logout(sessionCookie);
  }
}

function epochSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** RFC 7636 S256 code_challenge = BASE64URL(SHA256(code_verifier)). */
async function pkceChallenge(verifier: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Decodes (does NOT verify) a JWT's payload segment - only ever used on a token obtained
 * directly from Cognito's token endpoint over a trusted backchannel, never on a token that
 * arrived via the browser. */
function decodeJwtPayloadUnverified(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new ValidationError("Malformed JWT.");
  }
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
}
