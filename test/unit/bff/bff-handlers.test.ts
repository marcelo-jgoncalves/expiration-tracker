/**
 * HTTP-boundary tests for bff-handlers.ts - the layer that assembles cookies, enforces CSRF,
 * and decides how each internal outcome (AuthenticationError vs. something else) becomes an
 * HTTP response. Uses a real BffAuthService + real ProxyService (same fakes as
 * bff-auth-service.test.ts/proxy-service.test.ts) rather than a hand-rolled double, so these
 * tests exercise the actual integration, not a mock of it (gap found in review: this boundary
 * previously had no direct test at all, only its constituent services did).
 */
import { describe, expect, it } from "vitest";
import {
  handleLogin,
  handleCallback,
  handleLoginPassword,
  handleSignUp,
  handleConfirmSignUp,
  handleResendConfirmationCode,
  handleForgotPassword,
  handleConfirmForgotPassword,
  handleGetSession,
  handleLogout,
  handleProxy,
  handleCreateOrganization,
  type BffHttpDeps,
} from "../../../src/modules/bff/http/bff-handlers.js";
import type { BffHttpRequest } from "../../../src/modules/bff/http/http-types.js";
import { BffAuthService } from "../../../src/modules/bff/application/bff-auth-service.js";
import { ProxyService, type BackendFetcher } from "../../../src/modules/bff/application/proxy-service.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";
import { FakeCognitoOidcClient, FakeCognitoAuthClient, FakeIdTokenVerifier, FakeTokenEncryptor } from "./fakes.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { InMemoryOrganizationStore } from "../organization/in-memory-store.js";
import { IdentityBootstrapService } from "../../../src/modules/identity/application/bootstrap-identity.js";
import { GlobalUserRepository } from "../../../src/modules/identity/persistence/global-user-repository.js";
import { CreateOrganizationService } from "../../../src/modules/organization/application/create-organization.js";
import { AcceptInvitationService } from "../../../src/modules/organization/application/accept-invitation.js";
import { CSRF_COOKIE_NAME, LOGIN_COOKIE_NAME, SESSION_COOKIE_NAME } from "../../../src/modules/bff/domain/cookies.js";

const TABLE = "MainTable";

function buildDeps(backend: BackendFetcher = { fetch: async () => ({ statusCode: 200, headers: {}, body: "{}" }) }) {
  const sessionStore = new InMemorySessionStore();
  const identityStore = new InMemoryIdentityStore();
  const organizations = new InMemoryOrganizationStore();
  const bootstrap = new IdentityBootstrapService(identityStore, TABLE);
  const globalUsers = new GlobalUserRepository(identityStore);
  const createOrganization = new CreateOrganizationService(organizations, TABLE, { newOrganizationId: () => "org-1", newMembershipId: () => "membership-1", newInvitationId: () => "invitation-1", newAuditEventId: () => "audit-1" });
  const acceptInvitation = new AcceptInvitationService(organizations, TABLE, { newOrganizationId: () => "org-1", newMembershipId: () => "membership-1", newInvitationId: () => "invitation-1", newAuditEventId: () => "audit-1" }, "test-pepper");
  const cognitoClient = new FakeCognitoOidcClient();
  const cognitoAuthClient = new FakeCognitoAuthClient();
  const idTokenVerifier = new FakeIdTokenVerifier();
  const tokenEncryptor = new FakeTokenEncryptor();
  let userCounter = 0;
  let deviceCounter = 0;
  let clock = "2026-08-24T12:00:00.000Z";

  const auth = new BffAuthService({
    sessionStore,
    cognitoClient,
    cognitoAuthClient,
    idTokenVerifier,
    tokenEncryptor,
    bootstrap,
    globalUsers,
    organizations,
    mainTableName: TABLE,
    createOrganization,
    acceptInvitation,
    pepper: "test-pepper",
    redirectUri: "https://app.example.com/bff/callback",
    authorizeUrl: "https://auth.example.com/oauth2/authorize",
    clientId: "client-1",
    now: () => clock,
    newUserId: () => `user-${++userCounter}`,
    newDeviceId: () => `device-${++deviceCounter}`,
  });
  const proxy = new ProxyService(backend, "https://api.example.com");
  const deps: BffHttpDeps = { auth, proxy, appOrigin: "https://app.example.com" };
  return { deps, cognitoClient, cognitoAuthClient, idTokenVerifier, setClock: (iso: string) => { clock = iso; } };
}

function extractCookieValue(setCookieHeaders: string[] | undefined, name: string): string | undefined {
  const raw = setCookieHeaders?.find((c) => c.startsWith(`${name}=`));
  return raw?.split(";")[0]?.slice(name.length + 1);
}

/** Drives a full login through the HTTP handlers (not the service directly), returning the
 * real cookies a browser would end up holding. */
async function loginViaHttp(deps: BffHttpDeps) {
  const loginResponse = await handleLogin(deps, { method: "GET", path: "/bff/login", headers: {}, queryStringParameters: { returnTo: "/items/42" } });
  const loginCookie = extractCookieValue(loginResponse.cookies, LOGIN_COOKIE_NAME)!;
  const url = new URL(loginResponse.headers!["location"]!);
  const state = url.searchParams.get("state")!;

  const callbackResponse = await handleCallback(deps, {
    method: "GET",
    path: "/bff/callback",
    headers: { cookie: `${LOGIN_COOKIE_NAME}=${loginCookie}` },
    queryStringParameters: { code: "auth-code-1", state },
  });
  const sessionCookie = extractCookieValue(callbackResponse.cookies, SESSION_COOKIE_NAME)!;
  const csrfCookie = extractCookieValue(callbackResponse.cookies, CSRF_COOKIE_NAME)!;
  return { loginResponse, callbackResponse, sessionCookie, csrfCookie };
}

function authenticatedRequest(overrides: Partial<BffHttpRequest> & { sessionCookie: string; csrfCookie?: string }): BffHttpRequest {
  const { headers: overrideHeaders, sessionCookie, csrfCookie, ...rest } = overrides;
  const cookieParts = [`${SESSION_COOKIE_NAME}=${sessionCookie}`];
  if (csrfCookie) cookieParts.push(`${CSRF_COOKIE_NAME}=${csrfCookie}`);
  return {
    method: "GET",
    path: "/bff/session",
    ...rest,
    headers: { cookie: cookieParts.join("; "), ...overrideHeaders },
  };
}

describe("handleLogin", () => {
  it("redirects (302) to the Cognito authorize URL and sets an HttpOnly login cookie", async () => {
    const { deps } = buildDeps();
    const res = await handleLogin(deps, { method: "GET", path: "/bff/login", headers: {}, queryStringParameters: { returnTo: "/items/42" } });
    expect(res.statusCode).toBe(302);
    expect(res.headers?.["location"]).toContain("https://auth.example.com/oauth2/authorize");
    expect(extractCookieValue(res.cookies, LOGIN_COOKIE_NAME)).toBeTruthy();
  });
});

describe("handleCallback", () => {
  it("happy path: sets session + csrf cookies, clears the login cookie, redirects to appOrigin+returnTo", async () => {
    const { deps } = buildDeps();
    const { callbackResponse } = await loginViaHttp(deps);
    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers?.["location"]).toBe("https://app.example.com/items/42");
    expect(extractCookieValue(callbackResponse.cookies, SESSION_COOKIE_NAME)).toBeTruthy();
    expect(extractCookieValue(callbackResponse.cookies, CSRF_COOKIE_NAME)).toBeTruthy();
    expect(callbackResponse.cookies?.some((c) => c.startsWith(`${LOGIN_COOKIE_NAME}=;`))).toBe(true);
  });
});

describe("handleGetSession", () => {
  // Wave B2B-5 (D-095): tenantId leaves the response - activeOrganizationId/onboardingState
  // take its place. A fresh login has no Organization yet, so onboardingState is reported.
  it("returns 200 {authenticated:true, onboardingState:NO_TENANT_NO_MEMBERSHIP} for a fresh session with no Organization yet", async () => {
    const { deps } = buildDeps();
    const { sessionCookie } = await loginViaHttp(deps);
    const res = await handleGetSession(deps, authenticatedRequest({ sessionCookie }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ authenticated: true, onboardingState: "NO_TENANT_NO_MEMBERSHIP" });
    expect((res.body as Record<string, unknown>)["activeOrganizationId"]).toBeUndefined();
  });

  // #15/sidebar identity card (2026-09-21) - displayName/email resolved from GlobalUser, never
  // session.userId itself (excluded by design, D-095/D-096).
  it("includes displayName/email resolved from the GlobalUser row created at login", async () => {
    const { deps, idTokenVerifier } = buildDeps();
    idTokenVerifier.nextResult = { subject: "cognito-sub-1", email: "ana@example.com", name: "Ana Exemplo" };
    const { sessionCookie } = await loginViaHttp(deps);
    const res = await handleGetSession(deps, authenticatedRequest({ sessionCookie }));
    expect(res.body).toMatchObject({ displayName: "Ana Exemplo", email: "ana@example.com" });
    expect((res.body as Record<string, unknown>)["userId"]).toBeUndefined();
  });

  it("returns 200 {authenticated:false} when there is definitively no session (missing cookie)", async () => {
    const { deps } = buildDeps();
    const res = await handleGetSession(deps, { method: "GET", path: "/bff/session", headers: {} });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it("does NOT collapse a genuinely uncertain failure into authenticated:false - a transient dependency failure surfaces as its real error, not a stronger 'logged out' claim (found in review: this used to catch every resolveSession failure the same way)", async () => {
    const { deps, cognitoClient, setClock } = buildDeps();
    const { sessionCookie } = await loginViaHttp(deps);

    // Force the access token to look expired and Cognito's refresh call to fail transiently -
    // this is a "we don't know" outcome, not "definitely not authenticated".
    setClock("2026-08-24T12:20:00.000Z");
    cognitoClient.refreshShouldThrow = true;

    const res = await handleGetSession(deps, authenticatedRequest({ sessionCookie }));
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toEqual({ authenticated: false });
  });
});

describe("handleLogout CSRF enforcement", () => {
  it("rejects (403) a same-origin request with a missing/mismatched CSRF header even with a valid session cookie", async () => {
    const { deps } = buildDeps();
    const { sessionCookie, csrfCookie } = await loginViaHttp(deps);
    const res = await handleLogout(
      deps,
      authenticatedRequest({ sessionCookie, csrfCookie, method: "POST", path: "/bff/session/logout", headers: { "sec-fetch-site": "same-origin" } }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("rejects (403) a cross-site request even with a correct CSRF header/cookie pair (Sec-Fetch-Site layer)", async () => {
    const { deps } = buildDeps();
    const { sessionCookie, csrfCookie } = await loginViaHttp(deps);
    const res = await handleLogout(
      deps,
      authenticatedRequest({
        sessionCookie,
        csrfCookie,
        method: "POST",
        path: "/bff/session/logout",
        headers: { "sec-fetch-site": "cross-site", "x-csrf-token": csrfCookie },
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("succeeds (204) and clears cookies when Sec-Fetch-Site, header, and cookie all agree", async () => {
    const { deps } = buildDeps();
    const { sessionCookie, csrfCookie } = await loginViaHttp(deps);
    const res = await handleLogout(
      deps,
      authenticatedRequest({
        sessionCookie,
        csrfCookie,
        method: "POST",
        path: "/bff/session/logout",
        headers: { "sec-fetch-site": "same-origin", "x-csrf-token": csrfCookie },
      }),
    );
    expect(res.statusCode).toBe(204);
    expect(res.cookies?.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=;`))).toBe(true);

    const after = await handleGetSession(deps, authenticatedRequest({ sessionCookie }));
    expect(after.body).toEqual({ authenticated: false });
  });

  it("is a harmless no-op (204) for a request with no session cookie at all - nothing to protect, matches logout()'s own no-op", async () => {
    const { deps } = buildDeps();
    const res = await handleLogout(deps, { method: "POST", path: "/bff/session/logout", headers: {} });
    expect(res.statusCode).toBe(204);
  });
});

describe("handleProxy", () => {
  it("rejects (403) a proxied mutation missing CSRF, even to an allowlisted route", async () => {
    const { deps } = buildDeps();
    const { sessionCookie } = await loginViaHttp(deps);
    const res = await handleProxy(deps, authenticatedRequest({ sessionCookie, method: "POST", path: "/bff/api/items", headers: { "sec-fetch-site": "same-origin" } }), "/items", undefined);
    expect(res.statusCode).toBe(403);
  });

  it("forwards an allowlisted GET (safe method, no CSRF required) and returns the backend's response", async () => {
    const backend: BackendFetcher = { fetch: async () => ({ statusCode: 200, headers: { "content-type": "application/json" }, body: '{"items":[]}' }) };
    const { deps } = buildDeps(backend);
    const { sessionCookie } = await loginViaHttp(deps);
    const res = await handleProxy(deps, authenticatedRequest({ sessionCookie, method: "GET", path: "/bff/api/items/dashboard" }), "/items/dashboard", undefined);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  // G3 follow-up bug: the 7 CSV report routes (reports-handler.ts) return text/csv, not JSON -
  // handleProxy used to JSON.parse() every backend body unconditionally, 500ing on any real CSV
  // response ("Unexpected token 'i', \"itemId,nam\"... is not valid JSON"). Confirms the fix:
  // a non-JSON content-type is passed through untouched, never parsed, with isRawBody set so
  // the API Gateway adapter also skips JSON.stringify() on the way back out.
  it("passes a CSV backend response through untouched instead of JSON.parse()ing it", async () => {
    const csvBody = 'itemId,name\n"item-1","Contract A"\n';
    const backend: BackendFetcher = {
      fetch: async () => ({
        statusCode: 200,
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="report.csv"' },
        body: csvBody,
      }),
    };
    const { deps } = buildDeps(backend);
    const { sessionCookie } = await loginViaHttp(deps);
    const res = await handleProxy(deps, authenticatedRequest({ sessionCookie, method: "GET", path: "/bff/api/reports/expiring-soon-items" }), "/reports/expiring-soon-items", undefined);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(csvBody);
    expect(res.isRawBody).toBe(true);
    expect(res.headers?.["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers?.["content-disposition"]).toBe('attachment; filename="report.csv"');
  });
});

describe("handleCreateOrganization", () => {
  // D-129 (GTR-01 supersession): Organization.displayName is now the ONLY guest-facing
  // requester identity, so a whitespace-only name must never reach CreateOrganizationService.
  // Mutação: remover o `.trim()` de `displayName` no handler (ou a checagem `!displayName`
  // após ele) faria isto passar em vez de rejeitar com 400.
  it("D-129: rejects (400) a whitespace-only displayName", async () => {
    const { deps } = buildDeps();
    const { sessionCookie, csrfCookie } = await loginViaHttp(deps);
    const res = await handleCreateOrganization(
      deps,
      authenticatedRequest({
        sessionCookie,
        csrfCookie,
        method: "POST",
        path: "/bff/organizations",
        headers: { "sec-fetch-site": "same-origin", "x-csrf-token": csrfCookie },
        body: JSON.stringify({ displayName: "   ", timezone: "UTC" }),
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("D-129: trims a padded valid displayName before creating the Organization", async () => {
    const { deps } = buildDeps();
    const { sessionCookie, csrfCookie } = await loginViaHttp(deps);
    const res = await handleCreateOrganization(
      deps,
      authenticatedRequest({
        sessionCookie,
        csrfCookie,
        method: "POST",
        path: "/bff/organizations",
        headers: { "sec-fetch-site": "same-origin", "x-csrf-token": csrfCookie },
        body: JSON.stringify({ displayName: "  Empresa Alfa  ", timezone: "UTC" }),
      }),
    );
    expect(res.statusCode).toBe(201);
  });
});

// Round-1 Codex finding (d321-direct-auth-adversarial-review): all 6 D-3xx routes below now
// require Fetch Metadata (`Sec-Fetch-Site: same-origin` or `none`) before anything else runs -
// `same-origin` is the real browser value these routes see in production; every other test in
// this section uses it so it never has to think about the guard while testing its own concern.
const SAME_ORIGIN_HEADERS = { "sec-fetch-site": "same-origin" };

// D-3xx (reversal of D-320): the app's own login/signup/reset-password screens now call these
// directly instead of redirecting to the Cognito Hosted UI - handleLogin/handleCallback above
// stay covered by their own existing tests (dormant fallback, never removed).
describe("handleLoginPassword", () => {
  // The guard runs BEFORE body parsing/validation - proven here with a body that is missing
  // `password` (which would otherwise 400) AND malformed JSON (which would otherwise also 400):
  // both still come back 403, showing requireSameSiteFetch() short-circuits first, not just that
  // a well-formed cross-site request happens to also be rejected.
  it("403s a cross-site request before ever validating or parsing the body (login-CSRF guard)", async () => {
    const { deps } = buildDeps();
    const missingPassword = await handleLoginPassword(deps, {
      method: "POST",
      path: "/bff/login",
      headers: { "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ email: "user@example.com" }),
    });
    expect(missingPassword.statusCode).toBe(403);

    const malformedJson = await handleLoginPassword(deps, {
      method: "POST",
      path: "/bff/login",
      headers: { "sec-fetch-site": "cross-site" },
      body: "not-json",
    });
    expect(malformedJson.statusCode).toBe(403);
  });

  it("403s when Sec-Fetch-Site is absent - never fail-open for an older browser or unlabeled request", async () => {
    const { deps } = buildDeps();
    const res = await handleLoginPassword(deps, { method: "POST", path: "/bff/login", headers: {}, body: JSON.stringify({ email: "user@example.com", password: "correct-horse" }) });
    expect(res.statusCode).toBe(403);
  });

  it("400s when email or password is missing", async () => {
    const { deps } = buildDeps();
    const res = await handleLoginPassword(deps, { method: "POST", path: "/bff/login", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "user@example.com" }) });
    expect(res.statusCode).toBe(400);
  });

  it("400s on a malformed (non-JSON-object) body instead of a raw 500", async () => {
    const { deps } = buildDeps();
    const notJson = await handleLoginPassword(deps, { method: "POST", path: "/bff/login", headers: SAME_ORIGIN_HEADERS, body: "not-json" });
    expect(notJson.statusCode).toBe(400);
    // "null" and "[]" are both VALID JSON that would previously reach `body["email"]` unchecked
    // (`null["email"]` throws a TypeError -> uncaught 500; `[]["email"]` is merely undefined,
    // which the existing required-field check alone would already 400 on - "null" is the
    // discriminating case that proves parseJsonObjectBody() itself rejects non-objects, not just
    // the pre-existing field validation).
    const nullBody = await handleLoginPassword(deps, { method: "POST", path: "/bff/login", headers: SAME_ORIGIN_HEADERS, body: "null" });
    expect(nullBody.statusCode).toBe(400);
    const arrayBody = await handleLoginPassword(deps, { method: "POST", path: "/bff/login", headers: SAME_ORIGIN_HEADERS, body: "[]" });
    expect(arrayBody.statusCode).toBe(400);
  });

  it("sets session and CSRF cookies on a successful password login", async () => {
    const { deps, cognitoAuthClient } = buildDeps();
    cognitoAuthClient.nextAuthenticateOutcome = {
      kind: "SUCCESS",
      tokens: { accessToken: "header." + Buffer.from(JSON.stringify({ sub: "s1" })).toString("base64url") + ".sig", idToken: "id-1", refreshToken: "refresh-1", expiresInSeconds: 900 },
    };
    const res = await handleLoginPassword(deps, { method: "POST", path: "/bff/login", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "user@example.com", password: "correct-horse" }) });
    expect(res.statusCode).toBe(200);
    expect(extractCookieValue(res.cookies, SESSION_COOKIE_NAME)).toBeTruthy();
    expect(extractCookieValue(res.cookies, CSRF_COOKIE_NAME)).toBeTruthy();
  });

  it("returns a generic 401 for invalid credentials - never distinguishes 'no such user' from 'wrong password' (anti-enumeration, D-3xx decision 3)", async () => {
    const { deps, cognitoAuthClient } = buildDeps();
    cognitoAuthClient.nextAuthenticateOutcome = { kind: "INVALID_CREDENTIALS" };
    const res = await handleLoginPassword(deps, { method: "POST", path: "/bff/login", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "nobody@example.com", password: "wrong" }) });
    expect(res.statusCode).toBe(401);
  });

  it("returns the same generic 401 for USER_NOT_CONFIRMED as for invalid credentials", async () => {
    const { deps, cognitoAuthClient } = buildDeps();
    cognitoAuthClient.nextAuthenticateOutcome = { kind: "USER_NOT_CONFIRMED" };
    const res = await handleLoginPassword(deps, { method: "POST", path: "/bff/login", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "user@example.com", password: "x" }) });
    expect(res.statusCode).toBe(401);
  });

  // Round-1 Codex finding: TRANSIENT_FAILURE/UNKNOWN_OUTCOME used to fold into the SAME 401
  // "invalid credentials" as a real wrong password - a genuine Cognito outage/throttling told
  // the user they mistyped their password. Both now map to 503, never a false claim about the
  // credential itself.
  it("returns 503 (never 401) when authentication genuinely could not be completed", async () => {
    const { deps, cognitoAuthClient } = buildDeps();
    cognitoAuthClient.nextAuthenticateOutcome = { kind: "TRANSIENT_FAILURE", cause: new Error("boom") };
    const transient = await handleLoginPassword(deps, { method: "POST", path: "/bff/login", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "user@example.com", password: "x" }) });
    expect(transient.statusCode).toBe(503);

    cognitoAuthClient.nextAuthenticateOutcome = { kind: "UNKNOWN_OUTCOME" };
    const unknown = await handleLoginPassword(deps, { method: "POST", path: "/bff/login", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "user@example.com", password: "x" }) });
    expect(unknown.statusCode).toBe(503);
  });
});

describe("handleSignUp", () => {
  it("403s a cross-site request", async () => {
    const { deps } = buildDeps();
    const res = await handleSignUp(deps, {
      method: "POST",
      path: "/bff/signup",
      headers: { "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ email: "user@example.com", password: "x", name: "Ana" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("400s when email, password or name is missing", async () => {
    const { deps } = buildDeps();
    const res = await handleSignUp(deps, { method: "POST", path: "/bff/signup", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "user@example.com", password: "x" }) });
    expect(res.statusCode).toBe(400);
  });

  it("202s with CONFIRMATION_REQUIRED on a fresh signup", async () => {
    const { deps } = buildDeps();
    const res = await handleSignUp(deps, {
      method: "POST",
      path: "/bff/signup",
      headers: SAME_ORIGIN_HEADERS,
      body: JSON.stringify({ email: "new@example.com", password: "correct-horse-battery-1", name: "Ana Exemplo" }),
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ status: "CONFIRMATION_REQUIRED" });
  });

  it("409s when the e-mail is already registered", async () => {
    const { deps, cognitoAuthClient } = buildDeps();
    cognitoAuthClient.nextSignUpOutcome = { kind: "EMAIL_ALREADY_REGISTERED" };
    const res = await handleSignUp(deps, {
      method: "POST",
      path: "/bff/signup",
      headers: SAME_ORIGIN_HEADERS,
      body: JSON.stringify({ email: "taken@example.com", password: "x", name: "Ana Exemplo" }),
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("handleConfirmSignUp", () => {
  it("400s when email or confirmationCode is missing", async () => {
    const { deps } = buildDeps();
    const res = await handleConfirmSignUp(deps, { method: "POST", path: "/bff/signup/confirm", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "user@example.com" }) });
    expect(res.statusCode).toBe(400);
  });

  it("204s on a valid confirmation code", async () => {
    const { deps } = buildDeps();
    const res = await handleConfirmSignUp(deps, { method: "POST", path: "/bff/signup/confirm", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "user@example.com", confirmationCode: "123456" }) });
    expect(res.statusCode).toBe(204);
  });

  it("400s on an invalid/expired code", async () => {
    const { deps, cognitoAuthClient } = buildDeps();
    cognitoAuthClient.nextConfirmSignUpOutcome = { kind: "INVALID_CODE_OR_EXPIRED" };
    const res = await handleConfirmSignUp(deps, { method: "POST", path: "/bff/signup/confirm", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "user@example.com", confirmationCode: "000000" }) });
    expect(res.statusCode).toBe(400);
  });

  // Round-1 Codex finding: ConfirmSignUp's NotAuthorizedException used to be treated as
  // ALREADY_CONFIRMED unconditionally - ANY authorization failure (not just "already confirmed")
  // silently became a 204 success. Only the documented "already confirmed" message now does.
  it("does not report success for a NotAuthorizedException that isn't the documented 'already confirmed' case", async () => {
    const { deps, cognitoAuthClient } = buildDeps();
    cognitoAuthClient.nextConfirmSignUpOutcome = { kind: "UNKNOWN_OUTCOME" };
    const res = await handleConfirmSignUp(deps, { method: "POST", path: "/bff/signup/confirm", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "user@example.com", confirmationCode: "123456" }) });
    expect(res.statusCode).toBe(503);
  });
});

describe("handleResendConfirmationCode", () => {
  it("204s regardless of whether the e-mail is registered (anti-enumeration)", async () => {
    const { deps } = buildDeps();
    const res = await handleResendConfirmationCode(deps, { method: "POST", path: "/bff/signup/resend", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "anyone@example.com" }) });
    expect(res.statusCode).toBe(204);
  });
});

describe("handleForgotPassword", () => {
  it("202s regardless of whether the e-mail is registered (anti-enumeration, D-3xx decision 3)", async () => {
    const { deps } = buildDeps();
    const res = await handleForgotPassword(deps, { method: "POST", path: "/bff/forgot-password", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({ email: "anyone@example.com" }) });
    expect(res.statusCode).toBe(202);
  });

  it("400s when email is missing", async () => {
    const { deps } = buildDeps();
    const res = await handleForgotPassword(deps, { method: "POST", path: "/bff/forgot-password", headers: SAME_ORIGIN_HEADERS, body: JSON.stringify({}) });
    expect(res.statusCode).toBe(400);
  });
});

describe("handleConfirmForgotPassword", () => {
  it("204s on a valid code + new password", async () => {
    const { deps } = buildDeps();
    const res = await handleConfirmForgotPassword(deps, {
      method: "POST",
      path: "/bff/forgot-password/confirm",
      headers: SAME_ORIGIN_HEADERS,
      body: JSON.stringify({ email: "user@example.com", confirmationCode: "123456", newPassword: "Correct-Horse-1" }),
    });
    expect(res.statusCode).toBe(204);
  });

  it("400s on an invalid/expired code", async () => {
    const { deps, cognitoAuthClient } = buildDeps();
    cognitoAuthClient.nextConfirmForgotPasswordOutcome = { kind: "INVALID_CODE_OR_EXPIRED" };
    const res = await handleConfirmForgotPassword(deps, {
      method: "POST",
      path: "/bff/forgot-password/confirm",
      headers: SAME_ORIGIN_HEADERS,
      body: JSON.stringify({ email: "user@example.com", confirmationCode: "000000", newPassword: "x" }),
    });
    expect(res.statusCode).toBe(400);
  });
});
