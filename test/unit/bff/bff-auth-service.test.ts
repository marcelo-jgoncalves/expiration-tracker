import { describe, expect, it } from "vitest";
import { BffAuthService } from "../../../src/modules/bff/application/bff-auth-service.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";
import { FakeCognitoOidcClient, FakeIdTokenVerifier, FakeTokenEncryptor, fakeAccessToken } from "./fakes.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { IdentityMappingRepository } from "../../../src/modules/identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { AuthenticationError, DependencyUnavailableError } from "../../../src/shared/errors/app-error.js";

function buildService(overrides: Partial<{ now: () => string }> = {}) {
  const sessionStore = new InMemorySessionStore();
  const identityStore = new InMemoryIdentityStore();
  const identityMappings = new IdentityMappingRepository(identityStore);
  const users = new UserRepository(identityStore);
  const cognitoClient = new FakeCognitoOidcClient();
  const idTokenVerifier = new FakeIdTokenVerifier();
  const tokenEncryptor = new FakeTokenEncryptor();
  let userCounter = 0;
  let deviceCounter = 0;
  let clock = "2026-08-24T12:00:00.000Z";

  const service = new BffAuthService({
    sessionStore,
    cognitoClient,
    idTokenVerifier,
    tokenEncryptor,
    identityMappings,
    users,
    pepper: "test-pepper",
    redirectUri: "https://app.example.com/bff/callback",
    authorizeUrl: "https://auth.example.com/oauth2/authorize",
    clientId: "client-1",
    now: overrides.now ?? (() => clock),
    newUserId: () => `user-${++userCounter}`,
    newDeviceId: () => `device-${++deviceCounter}`,
  });

  return {
    service,
    sessionStore,
    cognitoClient,
    idTokenVerifier,
    tokenEncryptor,
    users,
    setClock: (iso: string) => {
      clock = iso;
    },
  };
}

/** Drives a full happy-path login: startLogin -> parse redirect for state -> handleCallback. */
async function loginOnce(ctx: ReturnType<typeof buildService>) {
  const started = await ctx.service.startLogin("/items/42");
  const url = new URL(started.redirectUrl);
  const state = url.searchParams.get("state")!;
  const result = await ctx.service.handleCallback({ loginCookie: started.loginToken, code: "auth-code-1", state });
  return { started, result };
}

describe("BffAuthService.startLogin", () => {
  it("creates a LoginAttempt and returns a Cognito authorize URL with PKCE/state/nonce", async () => {
    const ctx = buildService();
    const started = await ctx.service.startLogin("/items/42");
    const url = new URL(started.redirectUrl);
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(started.loginToken).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{64}$/);
  });

  it("rejects an open-redirect returnTo (protocol-relative or absolute URL) and falls back to /", async () => {
    const ctx = buildService();
    const started = await ctx.service.startLogin("https://evil.example.com/steal");
    const url = new URL(started.redirectUrl);
    const state = url.searchParams.get("state")!;
    const { result } = await (async () => {
      const r = await ctx.service.handleCallback({ loginCookie: started.loginToken, code: "c", state });
      return { result: r };
    })();
    expect(result.returnTo).toBe("/");
  });

  it("rejects a protocol-relative returnTo (//evil.com)", async () => {
    const ctx = buildService();
    const started = await ctx.service.startLogin("//evil.example.com/steal");
    const url = new URL(started.redirectUrl);
    const state = url.searchParams.get("state")!;
    const result = await ctx.service.handleCallback({ loginCookie: started.loginToken, code: "c", state });
    expect(result.returnTo).toBe("/");
  });

  it("preserves a valid same-origin returnTo path", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    expect(result.returnTo).toBe("/items/42");
  });
});

describe("BffAuthService.handleCallback", () => {
  it("happy path: creates a session, provisions the user on first login, returns session+csrf tokens", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    expect(result.sessionToken).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{64}$/);
    expect(result.csrfToken).toBeTruthy();

    const session = await ctx.service.resolveSession(result.sessionToken);
    expect(session.userId).toBe("user-1");
    expect(session.tenantId).toBe("user-1"); // MVP tenantId=userId, same rule as RequestContextResolver
  });

  it("passes the LoginAttempt's nonce to the ID token verifier (nonce binding)", async () => {
    const ctx = buildService();
    const started = await ctx.service.startLogin("/");
    const url = new URL(started.redirectUrl);
    const nonce = url.searchParams.get("nonce")!;
    const state = url.searchParams.get("state")!;
    await ctx.service.handleCallback({ loginCookie: started.loginToken, code: "c", state });
    expect(ctx.idTokenVerifier.lastCall?.expectedNonce).toBe(nonce);
  });

  it("rejects a callback with no login cookie", async () => {
    const ctx = buildService();
    await expect(ctx.service.handleCallback({ loginCookie: undefined, code: "c", state: "s" })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a callback whose login cookie does not resolve to any LoginAttempt (expired/garbage)", async () => {
    const ctx = buildService();
    await expect(ctx.service.handleCallback({ loginCookie: "a".repeat(32) + "." + "b".repeat(64), code: "c", state: "s" })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects state mismatch (possible CSRF on the OIDC callback itself)", async () => {
    const ctx = buildService();
    const started = await ctx.service.startLogin("/");
    await expect(ctx.service.handleCallback({ loginCookie: started.loginToken, code: "c", state: "wrong-state" })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects replay of an already-consumed LoginAttempt (single-use, D-054)", async () => {
    const ctx = buildService();
    const started = await ctx.service.startLogin("/");
    const url = new URL(started.redirectUrl);
    const state = url.searchParams.get("state")!;
    await ctx.service.handleCallback({ loginCookie: started.loginToken, code: "c", state });
    await expect(ctx.service.handleCallback({ loginCookie: started.loginToken, code: "c", state })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects when ID token verification fails (bad signature/issuer/audience/nonce)", async () => {
    const ctx = buildService();
    ctx.idTokenVerifier.shouldThrow = true;
    const started = await ctx.service.startLogin("/");
    const url = new URL(started.redirectUrl);
    const state = url.searchParams.get("state")!;
    await expect(ctx.service.handleCallback({ loginCookie: started.loginToken, code: "c", state })).rejects.toThrow();
  });

  it("second login for the same Cognito subject reuses the same tenant/user (no duplicate provisioning)", async () => {
    const ctx = buildService();
    const first = await loginOnce(ctx);
    const second = await loginOnce(ctx);
    const s1 = await ctx.service.resolveSession(first.result.sessionToken);
    const s2 = await ctx.service.resolveSession(second.result.sessionToken);
    expect(s2.userId).toBe(s1.userId);
    expect(s2.tenantId).toBe(s1.tenantId);
  });

  it("encrypts the refresh token before persisting it - never stored in plaintext", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    const session = await ctx.service.resolveSession(result.sessionToken);
    expect(session.encryptedRefreshToken).not.toBe("refresh-1");
    expect(session.encryptedRefreshToken).toContain(".enc");
  });
});

describe("BffAuthService.resolveSession", () => {
  it("rejects when there is no session cookie", async () => {
    const ctx = buildService();
    await expect(ctx.service.resolveSession(undefined)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a malformed session cookie", async () => {
    const ctx = buildService();
    await expect(ctx.service.resolveSession("garbage")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a session cookie with a tampered secret", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    const [selector] = result.sessionToken.split(".");
    const tampered = `${selector}.${"f".repeat(64)}`;
    await expect(ctx.service.resolveSession(tampered)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a session past its absolute expiry", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    ctx.setClock("2026-10-24T12:00:00.000Z"); // 30+ days later
    await expect(ctx.service.resolveSession(result.sessionToken)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a revoked session", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    await ctx.service.logout(result.sessionToken);
    await expect(ctx.service.resolveSession(result.sessionToken)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("transparently refreshes an expired access token and returns the refreshed session", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    ctx.setClock("2026-08-24T12:20:00.000Z"); // access token (900s TTL) has expired, session hasn't
    const session = await ctx.service.resolveSession(result.sessionToken);
    expect(session.accessToken).toBe(fakeAccessToken({ jti: "jti-2" })); // FakeCognitoOidcClient's default refresh response
    expect(ctx.cognitoClient.refreshCalls).toHaveLength(1);
  });

  it("DEFINITIVE_AUTH_FAILURE on refresh revokes the session and requires reauthentication", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    ctx.cognitoClient.nextRefreshOutcome = { kind: "INVALID_GRANT" };
    ctx.setClock("2026-08-24T12:20:00.000Z");
    await expect(ctx.service.resolveSession(result.sessionToken)).rejects.toBeInstanceOf(AuthenticationError);
    // The session is now revoked - even after "fixing" Cognito, this cookie never works again.
    ctx.cognitoClient.nextRefreshOutcome = { kind: "SUCCESS", response: { accessToken: "a", idToken: "i", refreshToken: "r", expiresInSeconds: 900 } };
    await expect(ctx.service.resolveSession(result.sessionToken)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("TRANSIENT_TRANSPORT_FAILURE on refresh surfaces as DependencyUnavailableError and preserves the session for a later retry", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    ctx.cognitoClient.refreshShouldThrow = true;
    ctx.setClock("2026-08-24T12:20:00.000Z");
    await expect(ctx.service.resolveSession(result.sessionToken)).rejects.toBeInstanceOf(DependencyUnavailableError);

    // Session must still exist and be resolvable once Cognito recovers - never revoked by a transient failure.
    ctx.cognitoClient.refreshShouldThrow = false;
    const session = await ctx.service.resolveSession(result.sessionToken);
    expect(session).toBeDefined();
  });

  it("UNKNOWN_OUTCOME on refresh (response lost after Cognito rotated) surfaces as a retryable error, never silently treated as failure", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    ctx.cognitoClient.nextRefreshOutcome = { kind: "UNKNOWN_OUTCOME" };
    ctx.setClock("2026-08-24T12:20:00.000Z");
    await expect(ctx.service.resolveSession(result.sessionToken)).rejects.toBeInstanceOf(DependencyUnavailableError);

    // The session must still be resolvable afterward (UNKNOWN_OUTCOME never revokes).
    ctx.cognitoClient.nextRefreshOutcome = { kind: "SUCCESS", response: { accessToken: "a2", idToken: "i2", refreshToken: "r2", expiresInSeconds: 900 } };
    const session = await ctx.service.resolveSession(result.sessionToken);
    expect(session.accessToken).toBe("a2");
  });

  it("a concurrent refresh (lease already held) backs off and re-reads instead of racing a second Cognito call", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    const [selector] = result.sessionToken.split(".");
    // Simulate another in-flight refresh by directly marking the stored session IN_PROGRESS
    // with a lease that hasn't expired yet.
    const stored = await ctx.sessionStore.get<import("../../../src/modules/bff/domain/session.js").Session>({ PK: `SESSION#${await hashSelector(ctx, selector!)}`, SK: "POINTER" });
    expect(stored).toBeDefined();
    await ctx.sessionStore.update<import("../../../src/modules/bff/domain/session.js").Session>({ ...stored!, refreshState: "IN_PROGRESS", refreshLeaseId: "someone-elses-lease", refreshLeaseUntil: "2026-08-24T12:20:10.000Z" });

    ctx.setClock("2026-08-24T12:20:00.000Z"); // access token expired, triggers a refresh attempt
    const session = await ctx.service.resolveSession(result.sessionToken);
    // Our own call must not have hit Cognito a second time while the lease was held.
    expect(ctx.cognitoClient.refreshCalls).toHaveLength(0);
    expect(session).toBeDefined();
  });
});

describe("BffAuthService.logout / logoutAll", () => {
  it("logout revokes the session locally even when Cognito's RevokeToken call fails (best-effort, D-054)", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    const originalRevoke = ctx.cognitoClient.revokeRefreshToken.bind(ctx.cognitoClient);
    ctx.cognitoClient.revokeRefreshToken = async () => {
      throw new Error("Cognito is down");
    };
    await expect(ctx.service.logout(result.sessionToken)).resolves.toBeUndefined(); // never throws
    await expect(ctx.service.resolveSession(result.sessionToken)).rejects.toBeInstanceOf(AuthenticationError);
    void originalRevoke;
  });

  it("logout calls RevokeToken after local revocation succeeds", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    await ctx.service.logout(result.sessionToken);
    expect(ctx.cognitoClient.revokeCalls).toHaveLength(1);
  });

  it("logout on an already-missing session is a harmless no-op", async () => {
    const ctx = buildService();
    await expect(ctx.service.logout(undefined)).resolves.toBeUndefined();
    await expect(ctx.service.logout("a".repeat(32) + "." + "b".repeat(64))).resolves.toBeUndefined();
  });

  it("logoutAll revokes the current session AND sets the global logout watermark used by every Bearer-authenticated request", async () => {
    const ctx = buildService();
    const { result } = await loginOnce(ctx);
    const session = await ctx.service.resolveSession(result.sessionToken);
    await ctx.service.logoutAll(result.sessionToken);
    const profile = await ctx.users.getProfile(session.tenantId, session.userId);
    expect(profile?.globalLogoutAfter).toBeTruthy();
    await expect(ctx.service.resolveSession(result.sessionToken)).rejects.toBeInstanceOf(AuthenticationError);
  });
});

// Test-only helper: recomputes a selector's hash using the same pepper the service uses, so
// tests can look up a Session/LoginAttempt record directly by its real storage key without
// the service exposing that internal mapping itself.
async function hashSelector(_ctx: ReturnType<typeof buildService>, selector: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", "test-pepper").update(selector).digest("hex");
}
