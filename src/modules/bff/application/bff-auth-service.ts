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
import { getCancellationReasonCodes, isTransactionCanceled, buildAttributeOnceUpdate, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { IdentityBootstrapService } from "../../identity/application/bootstrap-identity.js";
import { GlobalUserRepository, deviceSessionKey, globalUserKey } from "../../identity/persistence/global-user-repository.js";
import { OnboardingStateResolver, type OnboardingState } from "../../organization/application/onboarding-state.js";
import { resolveActiveMembership } from "../../organization/application/resolve-active-membership.js";
import { CreateOrganizationService } from "../../organization/application/create-organization.js";
import type { OrganizationStore } from "../../organization/ports/organization-store.js";
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
  /** Wave B2B-5 (D-095): renamed from `TenantBootstrapService` — no longer creates any
   * tenant/Organization at login, just the global identity (2-item transact). Both login paths
   * still bootstrap through this single atomic service (D-087/B2B-2). */
  bootstrap: IdentityBootstrapService;
  /** Wave B2B-5 (D-095): device sessions and global-logout revocation moved here from
   * `UserRepository` (now `UserProfile`-only, per-Organization) — both are properties of the
   * tenant-independent identity (physical model §10). */
  globalUsers: GlobalUserRepository;
  organizations: OrganizationStore;
  mainTableName: string;
  createOrganization: CreateOrganizationService;
  pepper: string;
  redirectUri: string;
  authorizeUrl: string; // Cognito Hosted UI /oauth2/authorize base URL (from Terraform output/env, not hardcoded)
  clientId: string;
  now: () => string;
  newUserId: () => string;
  newDeviceId: () => string;
}

export interface SessionWithOnboarding {
  session: Session;
  activeOrganizationId?: string;
  onboardingState?: OnboardingState;
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
  private readonly onboarding: OnboardingStateResolver;

  constructor(private readonly deps: BffAuthServiceDeps) {
    this.onboarding = new OnboardingStateResolver(deps.organizations);
  }

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
      version: 1,
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
      scope: "openid email", // matches infra/modules/cognito's allowed_oauth_scopes - "email" is what populates idClaims.email below
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
    // DynamoDB TTL deletion is best-effort and can lag well past the item's TTL timestamp
    // (found in Round D re-verification) - a short-lived, single-use auth object like this
    // must never rely on that alone to enforce its own window; check the timestamp directly.
    if (epochSeconds(this.deps.now()) > attempt.purgeAfterTtl) {
      throw new AuthenticationError("Login session expired.");
    }
    // Single-use: consume immediately, before the Cognito round trip, so a duplicate/retried
    // callback (double-click, browser back button) can never replay the same code twice
    // against a still-valid LoginAttempt. Conditional on `version` (not a plain update) -
    // two concurrent callbacks could otherwise both read consumedAt=undefined and both
    // proceed before either write landed (found in review); only one wins this race.
    const consumed = await this.deps.sessionStore.updateConditional<LoginAttempt>(
      { ...attempt, consumedAt: this.deps.now(), version: attempt.version + 1 },
      { version: attempt.version },
    );
    if (!consumed) {
      throw new AuthenticationError("Login session not found or already used.");
    }

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

    // Wave B2B-5 (D-095): newUserId() only matters on first-ever login for this cognitoSub
    // (IdentityBootstrapService ignores it on repeat logins) - authentication no longer creates
    // any tenant, just the global identity (2-item transact: GlobalUser + IdentityMapping).
    const newUserId = this.deps.newUserId();
    const { mapping, user } = await this.deps.bootstrap.bootstrapUser(idClaims.subject, newUserId, (idClaims.email ?? "").toLowerCase());
    if (user.identityStatus !== "ACTIVE") {
      throw new AuthenticationError("User is not active.");
    }

    const deviceId = this.deps.newDeviceId();
    await this.deps.globalUsers.upsertDeviceSession({
      ...deviceSessionKey(mapping.userId, deviceId),
      entityType: "DeviceSession",
      userId: mapping.userId,
      deviceId,
      sessionId: randomUUID(),
      refreshFamilyId: randomUUID(),
      createdAt: this.deps.now(),
      lastSeenAt: this.deps.now(),
      expiresAt: new Date(Date.parse(this.deps.now()) + SESSION_ABSOLUTE_TTL_SECONDS * 1000).toISOString(),
      status: "ACTIVE",
    });

    // Sessão sempre criada aqui, nunca falha por falta de Organization (D-095 mudança E) -
    // activeOrganizationId fica ausente se este usuário ainda não tem Membership utilizável;
    // GET /bff/session reporta onboardingState nesse caso (resolveSessionWithOnboarding).
    const activeOrganizationId = await this.deriveActiveOrganizationId(mapping.userId);

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
      activeOrganizationId,
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
    // Idle timeout (`purgeAfterTtl`) checked explicitly too, same reasoning as the
    // LoginAttempt TTL fix above (found in Round D re-verification): DynamoDB's own TTL
    // deletion is best-effort and can lag well past this timestamp, so an idle-expired
    // session that is still physically present must never be resolved as authenticated -
    // this method's own doc comment already promised that, this closes the gap between the
    // promise and the code.
    if (this.isPastIdleTimeout(session)) {
      throw new AuthenticationError("Session expired (idle timeout).");
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
        // silently treated as a definitive failure, but also never marked retryable - Cognito
        // may have already rotated the refresh token, so a blind automatic retry could race
        // an already-consumed credential. `retryable: false` here matches the frontend's own
        // ApiError.unknownOutcome() convention (frontend/src/api/errors.ts).
        throw new DependencyUnavailableError("Refresh outcome unknown - do not retry automatically.", undefined, undefined, false);
      }
      if (outcome.kind === "CONCURRENT_REFRESH") {
        // Another request is refreshing right now; briefly back off and re-read rather than
        // racing a second call to Cognito for the same session.
        await sleep(75);
        const reread = await this.deps.sessionStore.get<Session>(sessionKey(selectorHash));
        // Checks revokedAt again, not just existence (found in Round D re-verification): a
        // concurrent logout landing during this backoff window would otherwise let an
        // already-revoked session be returned as authenticated - it never resurrects the
        // DB record itself, but it would let a request cross the BFF's auth boundary right
        // after the user logged out.
        if (!reread || reread.revokedAt) throw new AuthenticationError("Session not found.");
        // Also re-checks absolute AND idle expiry against a fresh `now` (the initial checks
        // above used the `now` from before this backoff/refresh round trip) - narrow window,
        // but free to close.
        if (this.deps.now() >= reread.absoluteExpiresAt) throw new AuthenticationError("Session expired (absolute lifetime).");
        if (this.isPastIdleTimeout(reread)) throw new AuthenticationError("Session expired (idle timeout).");
        session = reread;
      } else if (outcome.kind === "SUCCESS") {
        const refreshed = await this.deps.sessionStore.get<Session>(sessionKey(selectorHash));
        if (!refreshed || refreshed.revokedAt) throw new AuthenticationError("Session not found.");
        if (this.deps.now() >= refreshed.absoluteExpiresAt) throw new AuthenticationError("Session expired (absolute lifetime).");
        if (this.isPastIdleTimeout(refreshed)) throw new AuthenticationError("Session expired (idle timeout).");
        session = refreshed;
      }
    }

    // Bumps idle TTL on every successful resolution, capped at the absolute expiry - activity
    // extends idle timeout, never the absolute session lifetime (D-054). Conditional on
    // `version` (not a plain update) - the same residual variant of the Item 11 bug found in
    // review: an unconditional write here using this function's own (possibly slightly stale)
    // `session` snapshot could silently overwrite a `revokedAt` a concurrent logout had just
    // written, resurrecting a session the user explicitly logged out of.
    const nextPurge = Math.min(epochSeconds(now) + SESSION_IDLE_TTL_SECONDS, epochSeconds(session.absoluteExpiresAt));
    if (nextPurge !== session.purgeAfterTtl) {
      const bumped = await this.deps.sessionStore.updateConditional<Session>(
        { ...session, purgeAfterTtl: nextPurge, updatedAt: now, version: session.version + 1 },
        { version: session.version },
      );
      if (!bumped) {
        // Something else modified this session concurrently - re-read rather than returning
        // a snapshot that might now be stale or revoked. If someone else's write superseded
        // ours for an unrelated benign reason (e.g. another resolveSession call's own idle
        // bump), that's fine; only a genuine revocation should fail this call.
        const current = await this.deps.sessionStore.get<Session>(sessionKey(selectorHash));
        if (!current || current.revokedAt) {
          throw new AuthenticationError("Session revoked concurrently.");
        }
        if (this.deps.now() >= current.absoluteExpiresAt) {
          throw new AuthenticationError("Session expired (absolute lifetime).");
        }
        if (this.isPastIdleTimeout(current)) {
          throw new AuthenticationError("Session expired (idle timeout).");
        }
        return current;
      }
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
    // Conditional on the lease's own version (session.version + 1, set when the lease was
    // acquired above) - a plain unconditional overwrite here (the bug found in review) could
    // silently resurrect a session that was revoked (e.g. a concurrent logout) between lease
    // acquisition and this commit, since it would blindly spread the pre-lease `session`
    // snapshot back over whatever the revocation had written.
    const committed = await this.deps.sessionStore.updateConditional<Session>(
      {
        ...session,
        accessToken: response.accessToken,
        accessTokenExpiresAt: new Date(Date.parse(refreshedAt) + response.expiresInSeconds * 1000).toISOString(),
        encryptedRefreshToken: await this.deps.tokenEncryptor.encrypt(response.refreshToken),
        refreshState: "IDLE",
        refreshLeaseId: undefined,
        refreshLeaseUntil: undefined,
        updatedAt: refreshedAt,
        version: session.version + 2,
      },
      { version: session.version + 1 },
    );
    if (!committed) {
      // Something else modified the session between lease acquisition and this commit. Cognito
      // already rotated the refresh token at this point - re-read to find out what actually
      // happened rather than guessing.
      const current = await this.deps.sessionStore.get<Session>(sessionKey(session.selectorHash));
      if (!current || current.revokedAt) {
        return { kind: "DEFINITIVE_AUTH_FAILURE", reason: "session_revoked_during_refresh" };
      }
      return { kind: "UNKNOWN_OUTCOME" };
    }
    return { kind: "SUCCESS", accessToken: response.accessToken, accessTokenExpiresAt: refreshedAt, encryptedRefreshToken: session.encryptedRefreshToken };
  }

  /** Existence is checked by the caller (via a truthy `session`) before this runs - this only
   * covers the three remaining validity properties every use of a Session must check: not
   * revoked, not past its absolute lifetime, not past its idle timeout. Token-secret
   * verification is a fourth, separate concern callers must do themselves (not every caller
   * has parsed a token to check against - resolveSession()'s internal re-reads, for instance,
   * already know they hold a token-matched selectorHash from the top of the call). */
  private sessionIsCurrentlyValid(session: Session): boolean {
    return !session.revokedAt && this.deps.now() < session.absoluteExpiresAt && !this.isPastIdleTimeout(session);
  }

  /** `purgeAfterTtl` (the idle timeout) is a DynamoDB TTL attribute - TTL deletion there is
   * best-effort and can lag well past this timestamp (AWS's own documented behavior), so it
   * must never be the only enforcement of the idle window. Same reasoning as LoginAttempt's
   * `purgeAfterTtl` check in handleCallback() (found in Round D re-verification, then found to
   * be missing here too on the very next pass). */
  private isPastIdleTimeout(session: Session): boolean {
    return epochSeconds(this.deps.now()) >= session.purgeAfterTtl;
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
    // Verifies the secret half of the token too, same as resolveSession() (found in Round D
    // re-verification: without this, knowing only a session's selector - e.g. leaked via a
    // log line or timing side-channel, never meant to be treated as sufficient on its own -
    // was enough to force-revoke or globally log out an account this cookie never proved
    // possession of).
    if (!opaqueTokenSecretMatches(this.deps.pepper, parsed.secret, session.secretHash)) return;
    // An already-revoked or already-expired session must never be treated as valid enough to
    // authorize anything, even a no-op-shaped re-revocation (found in Round D re-verification,
    // applied symmetrically to logout() even though its own blast radius is smaller than
    // logoutAll()'s - consistency, not just this one call site).
    if (!this.sessionIsCurrentlyValid(session)) return;

    const now = this.deps.now();
    // Bumps version even though this write itself is unconditional (revocation always wins,
    // no concurrent-writer safety issue at logout itself) - a later conditional writer
    // elsewhere (refresh()'s final commit) depends on `version` actually changing on every
    // Session mutation to detect that the row moved out from under it (found in review: a
    // concurrent logout mid-refresh could otherwise be silently overwritten back to "alive").
    await this.deps.sessionStore.update<Session>({ ...session, revokedAt: now, updatedAt: now, version: session.version + 1 });
    await this.deps.globalUsers.logoutDevice(session.userId, session.deviceId);

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
    // Same secret verification as logout() - a selector alone must never be sufficient to
    // trigger a global logout of someone else's account.
    if (!opaqueTokenSecretMatches(this.deps.pepper, parsed.secret, session.secretHash)) return;
    // An already-revoked or already-expired session must never authorize a cross-device
    // action (found in Round D re-verification: this is exactly the blast-radius case Codex
    // called out - a stale cookie forcing every OTHER active session/device to log out).
    if (!this.sessionIsCurrentlyValid(session)) return;

    await this.deps.globalUsers.logoutAll(session.userId);
    await this.logout(sessionCookie);
  }

  /** `GET /bff/session` needs enriched state (`onboardingState`) that every other
   * `resolveSession()` caller (proxy, CSRF check, plain logout) does not - kept separate so
   * those hot paths never pay for an extra `OnboardingStateResolver` query. Self-heals a stale
   * `activeOrganizationId` (D-095 mudança 3: main table is the only source of truth, the session
   * field is a cache/hint) - if absent but a real `ACTIVE` Membership now exists (e.g. a
   * concurrent `POST /bff/organizations` updated the org but lost the race to write the session
   * back, or a second device/session logging in after the org already existed), derives it and
   * returns it immediately, then tries to write it back best-effort (never blocks the
   * response, never fails the request if the write loses a race - next read just re-derives). */
  async resolveSessionWithOnboarding(sessionCookie: string | undefined): Promise<SessionWithOnboarding> {
    const session = await this.resolveSession(sessionCookie);
    if (session.activeOrganizationId) {
      return { session, activeOrganizationId: session.activeOrganizationId };
    }

    const onboardingState = await this.onboarding.resolve(session.userId);
    if (onboardingState !== "HAS_USABLE_MEMBERSHIP") {
      return { session, onboardingState };
    }

    const derived = await this.deriveActiveOrganizationId(session.userId);
    if (!derived) {
      // OnboardingStateResolver said HAS_USABLE_MEMBERSHIP but resolveActiveMembership couldn't
      // derive exactly one (0 or >1 - the latter unreachable today, B2B-6's job once possible).
      // Benign for this read path: report the raw state rather than asserting like the
      // resource-side resolver does.
      return { session, onboardingState };
    }

    await this.deps.sessionStore.updateConditional<Session>(
      { ...session, activeOrganizationId: derived, updatedAt: this.deps.now(), version: session.version + 1 },
      { version: session.version },
    );
    return { session, activeOrganizationId: derived };
  }

  /** `POST /bff/organizations` (D-095 achado 2.3/mudança C): the first real consumer of
   * `CreateOrganizationService` (B2B-3/D-091) - without this, `bootstrapUser()`'s 2-item
   * transact would strand every fresh login in `NO_TENANT_NO_MEMBERSHIP` with no way out.
   *
   * Cap is TRANSACTIONAL, not check-then-act (Codex Rodada 3 achado): `GlobalUser.
   * hasCreatedOrganization` is set via a `Update` (`buildAttributeOnceUpdate`, tenantless -
   * `GlobalUser` has no `tenantId` for `buildVersionedUpdate`'s reserved condition to check)
   * inside the SAME `TransactWriteItems` as the 4 `Put`s `CreateOrganizationService.
   * buildCreateEntries()` builds - 5 items, not 4, committed atomically. The cap entry is index
   * 0 - only ITS `ConditionalCheckFailed` means "already created an organization"; any other
   * index failing (e.g. an astronomically unlikely organizationId ULID collision) propagates as
   * a genuine unexpected error instead of being misreported as the cap (Codex Rodada 3 achado).
   *
   * Takes an already-resolved `Session` (same pattern as `ProxyService.forward(session, ...)`)
   * instead of a cookie - the handler already resolves the session once to run its own CSRF
   * check before calling this, resolving twice would be a wasted read (and a second implicit
   * idle-TTL bump) for no benefit. */
  async createOrganization(session: Session, input: { displayName: string; timezone: string }): Promise<{ organizationId: string }> {
    const { entries, organization } = this.deps.createOrganization.buildCreateEntries({
      creatorUserId: session.userId,
      displayName: input.displayName,
      timezone: input.timezone,
    });
    const capEntry: TransactWriteEntry = {
      Update: buildAttributeOnceUpdate({
        tableName: this.deps.mainTableName,
        key: globalUserKey(session.userId),
        attribute: "hasCreatedOrganization",
        value: true,
      }),
    };

    try {
      await this.deps.organizations.transactWrite([capEntry, ...entries]);
    } catch (err) {
      if (isTransactionCanceled(err) && getCancellationReasonCodes(err)?.[0] === "ConditionalCheckFailed") {
        throw new ConflictError("You have already created an organization.", { userId: session.userId });
      }
      throw err;
    }

    // Best-effort, tabela de sessão é separada da tabela principal (não há TransactWriteItems
    // cruzando as duas) - a organização já existe de verdade independente deste passo; falha
    // aqui é inofensiva por construção, fechada pelo self-heal de resolveSessionWithOnboarding.
    await this.deps.sessionStore.updateConditional<Session>(
      { ...session, activeOrganizationId: organization.organizationId, updatedAt: this.deps.now(), version: session.version + 1 },
      { version: session.version },
    );

    return { organizationId: organization.organizationId };
  }

  /** Shared by `handleCallback` and `resolveSessionWithOnboarding` - derives the (today,
   * invariantly unique) `ACTIVE` `Membership`'s organizationId, or `undefined` if zero or more
   * than one (benign here, unlike the resource-side resolver's own assertion - a BFF session
   * hint that stays unset just means the frontend still sees `onboardingState` instead). */
  private async deriveActiveOrganizationId(userId: string): Promise<string | undefined> {
    const active = await resolveActiveMembership(this.deps.organizations, userId);
    if (active.length !== 1) return undefined;
    return active[0]?.organizationId;
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
