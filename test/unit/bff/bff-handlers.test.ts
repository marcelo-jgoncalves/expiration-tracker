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
  handleGetSession,
  handleLogout,
  handleProxy,
  type BffHttpDeps,
} from "../../../src/modules/bff/http/bff-handlers.js";
import type { BffHttpRequest } from "../../../src/modules/bff/http/http-types.js";
import { BffAuthService } from "../../../src/modules/bff/application/bff-auth-service.js";
import { ProxyService, type BackendFetcher } from "../../../src/modules/bff/application/proxy-service.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";
import { FakeCognitoOidcClient, FakeIdTokenVerifier, FakeTokenEncryptor } from "./fakes.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { IdentityMappingRepository } from "../../../src/modules/identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { CSRF_COOKIE_NAME, LOGIN_COOKIE_NAME, SESSION_COOKIE_NAME } from "../../../src/modules/bff/domain/cookies.js";

function buildDeps(backend: BackendFetcher = { fetch: async () => ({ statusCode: 200, headers: {}, body: "{}" }) }) {
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

  const auth = new BffAuthService({
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
    now: () => clock,
    newUserId: () => `user-${++userCounter}`,
    newDeviceId: () => `device-${++deviceCounter}`,
  });
  const proxy = new ProxyService(backend, "https://api.example.com");
  const deps: BffHttpDeps = { auth, proxy, appOrigin: "https://app.example.com" };
  return { deps, cognitoClient, setClock: (iso: string) => { clock = iso; } };
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
  it("returns 200 {authenticated:true} for a real session", async () => {
    const { deps } = buildDeps();
    const { sessionCookie } = await loginViaHttp(deps);
    const res = await handleGetSession(deps, authenticatedRequest({ sessionCookie }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ authenticated: true, tenantId: "user-1", userId: "user-1" });
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
});
