/**
 * HTTP-shape handlers for /bff/* routes. These routes ARE the authentication boundary - no
 * JWT authorizer runs before them (unlike src/modules/expiration/http/item-handlers.ts),
 * so every handler here is responsible for its own cookie/CSRF verification.
 */
import { AppError, AuthenticationError, toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { BffAuthService } from "../application/bff-auth-service.js";
import { ProxyService } from "../application/proxy-service.js";
import { checkCsrf } from "../domain/csrf.js";
import {
  SESSION_COOKIE_NAME,
  LOGIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  LOGIN_COOKIE_ATTRIBUTES,
  SESSION_COOKIE_ATTRIBUTES,
  CSRF_COOKIE_ATTRIBUTES,
  buildSetCookieHeader,
  buildClearCookieHeader,
  parseCookieHeader,
} from "../domain/cookies.js";
import type { BffHttpRequest, BffHttpResponse } from "./http-types.js";

const STATUS_BY_CATEGORY: Record<string, number> = {
  VALIDATION: 400,
  AUTH: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
};

function toErrorResponse(err: unknown): BffHttpResponse {
  const appError = err instanceof AppError ? err : toAppError(err);
  return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
}

function cookiesOf(req: BffHttpRequest): Record<string, string> {
  return parseCookieHeader(req.headers["cookie"] ?? req.headers["Cookie"]);
}

export interface BffHttpDeps {
  auth: BffAuthService;
  proxy: ProxyService;
  appOrigin: string; // for building same-origin redirect targets
}

export async function handleLogin(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const returnTo = req.queryStringParameters?.["returnTo"] ?? "/";
    const { loginToken, redirectUrl } = await deps.auth.startLogin(returnTo);
    return {
      statusCode: 302,
      headers: { location: redirectUrl },
      cookies: [buildSetCookieHeader(LOGIN_COOKIE_NAME, loginToken, LOGIN_COOKIE_ATTRIBUTES)],
      body: {},
    };
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function handleCallback(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const code = req.queryStringParameters?.["code"];
    const state = req.queryStringParameters?.["state"];
    if (!code || !state) throw new ValidationError("Missing code or state on OIDC callback.");

    const loginCookie = cookiesOf(req)[LOGIN_COOKIE_NAME];
    const { sessionToken, csrfToken, returnTo } = await deps.auth.handleCallback({ loginCookie, code, state });

    return {
      statusCode: 302,
      headers: { location: `${deps.appOrigin}${returnTo}` },
      cookies: [
        buildSetCookieHeader(SESSION_COOKIE_NAME, sessionToken, SESSION_COOKIE_ATTRIBUTES),
        buildSetCookieHeader(CSRF_COOKIE_NAME, csrfToken, CSRF_COOKIE_ATTRIBUTES),
        buildClearCookieHeader(LOGIN_COOKIE_NAME, LOGIN_COOKIE_ATTRIBUTES),
      ],
      body: {},
    };
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** GET /bff/session - lets the frontend learn its own auth state on boot without needing to
 * probe a proxied resource route first (AUTHENTICATED/SESSION_MISSING/SESSION_EXPIRED per the
 * Frontend Production Foundation mission's required auth-state contract).
 *
 * Wave B2B-5 (D-095): `tenantId` leaves the response - `activeOrganizationId`/`onboardingState`
 * take its place (`resolveSessionWithOnboarding`, self-heals a stale/missing
 * `activeOrganizationId` against the real Membership data before responding). Exactly one of
 * the two is present: an established organization, or the reason there isn't one yet. */
export async function handleGetSession(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const { activeOrganizationId, onboardingState, organizationSelectionRequired } = await deps.auth.resolveSessionWithOnboarding(cookiesOf(req)[SESSION_COOKIE_NAME]);
    return { statusCode: 200, body: { authenticated: true, activeOrganizationId, onboardingState, organizationSelectionRequired } };
  } catch (err) {
    if (err instanceof AuthenticationError) {
      // Definitive: no session, or one that is genuinely gone (expired/revoked/malformed) -
      // never leak WHICH of those to the browser, they all look identical from here.
      return { statusCode: 200, body: { authenticated: false } };
    }
    // Anything else (e.g. a DependencyUnavailableError from a transient/unknown refresh
    // outcome) means resolution genuinely could not be completed - collapsing this into
    // "authenticated: false" would tell the frontend a stronger claim than we can support
    // (AuthContext's SESSION_MISSING vs. REFRESH_FAILED distinction exists precisely so this
    // case surfaces as "we don't know", not "definitely logged out" - found in review).
    return toErrorResponse(err);
  }
}

async function checkCsrfForSession(deps: BffHttpDeps, req: BffHttpRequest, sessionCookie: string | undefined): Promise<boolean> {
  const cookies = cookiesOf(req);
  let session;
  try {
    session = await deps.auth.resolveSession(sessionCookie);
  } catch (err) {
    if (err instanceof AuthenticationError) {
      // No resolvable session at all (missing/malformed/expired/revoked) - nothing to
      // protect against forging, logout of a nonexistent session is a harmless no-op either
      // way (see logout()'s own early-return on a missing/invalid cookie).
      return true;
    }
    // Any other failure (e.g. a transient dependency issue while resolving) means we cannot
    // rule out that a real, valid session exists to protect - fail closed rather than assume
    // there is nothing there (found in review: the previous blanket catch treated every
    // failure the same as "definitely no session").
    return false;
  }
  return checkCsrf({
    method: req.method,
    secFetchSite: req.headers["sec-fetch-site"],
    headerToken: req.headers["x-csrf-token"],
    cookieToken: cookies[CSRF_COOKIE_NAME],
    sessionCsrfSecret: session.csrfSecret,
  });
}

export async function handleLogout(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  const cookies = cookiesOf(req);
  if (!(await checkCsrfForSession(deps, req, cookies[SESSION_COOKIE_NAME]))) {
    return { statusCode: 403, body: { code: "CSRF_CHECK_FAILED", category: "AUTHORIZATION", message: "CSRF check failed.", retryable: false } };
  }
  await deps.auth.logout(cookies[SESSION_COOKIE_NAME]);
  return {
    statusCode: 204,
    cookies: [
      buildClearCookieHeader(SESSION_COOKIE_NAME, SESSION_COOKIE_ATTRIBUTES),
      buildClearCookieHeader(CSRF_COOKIE_NAME, CSRF_COOKIE_ATTRIBUTES),
    ],
    body: {},
  };
}

export async function handleLogoutAll(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  const cookies = cookiesOf(req);
  if (!(await checkCsrfForSession(deps, req, cookies[SESSION_COOKIE_NAME]))) {
    return { statusCode: 403, body: { code: "CSRF_CHECK_FAILED", category: "AUTHORIZATION", message: "CSRF check failed.", retryable: false } };
  }
  await deps.auth.logoutAll(cookies[SESSION_COOKIE_NAME]);
  return {
    statusCode: 204,
    cookies: [
      buildClearCookieHeader(SESSION_COOKIE_NAME, SESSION_COOKIE_ATTRIBUTES),
      buildClearCookieHeader(CSRF_COOKIE_NAME, CSRF_COOKIE_ATTRIBUTES),
    ],
    body: {},
  };
}

/** POST /bff/organizations (Wave B2B-5, D-095, achado 2.3): the first real HTTP consumer of
 * `CreateOrganizationService` (B2B-3/D-091) - without it, `bootstrapUser()`'s 2-item transact
 * would strand every fresh login in `NO_TENANT_NO_MEMBERSHIP` with no way out. Authorized by
 * identity alone (a valid session), never by `authorize()`'s tenant-scoped matrix - there is no
 * Organization to be a member of yet at the moment this call is made, by definition. */
export async function handleCreateOrganization(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const cookies = cookiesOf(req);
    const session = await deps.auth.resolveSession(cookies[SESSION_COOKIE_NAME]);

    if (
      !checkCsrf({
        method: req.method,
        secFetchSite: req.headers["sec-fetch-site"],
        headerToken: req.headers["x-csrf-token"],
        cookieToken: cookies[CSRF_COOKIE_NAME],
        sessionCsrfSecret: session.csrfSecret,
      })
    ) {
      return { statusCode: 403, body: { code: "CSRF_CHECK_FAILED", category: "AUTHORIZATION", message: "CSRF check failed.", retryable: false } };
    }

    const body = (req.body ? JSON.parse(req.body) : {}) as Record<string, unknown>;
    // D-129 (GTR-01 supersession): trimmed here too (defense in depth at the HTTP boundary,
    // consistent with other BFF handlers) - CreateOrganizationService.buildCreateEntries() is
    // still the real authority and independently rejects blank input.
    const displayName = typeof body["displayName"] === "string" ? body["displayName"].trim() : undefined;
    const timezone = typeof body["timezone"] === "string" ? body["timezone"] : undefined;
    if (!displayName || !timezone) {
      throw new ValidationError("displayName and timezone are required.");
    }

    const { organizationId } = await deps.auth.createOrganization(session, { displayName, timezone });
    return { statusCode: 201, body: { organizationId } };
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** GET /bff/organizations (Wave B2B-6, D-101) - lists only effectively usable organizations
 * (Membership ACTIVE + TenantLifecycleRecord ACTIVE). Read-only, no CSRF needed (same posture as
 * `handleGetSession`). */
export async function handleListOrganizations(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const session = await deps.auth.resolveSession(cookiesOf(req)[SESSION_COOKIE_NAME]);
    const organizations = await deps.auth.listOrganizations(session.userId);
    return { statusCode: 200, body: { organizations } };
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /bff/organization/select (Wave B2B-6, D-101) - same CSRF/mutation discipline as
 * `handleCreateOrganization` above. Validates via `resolveWorkingOrganization()` (never trusts
 * the client-supplied `organizationId` without a real Membership + lifecycle check). */
export async function handleSelectOrganization(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const cookies = cookiesOf(req);
    const session = await deps.auth.resolveSession(cookies[SESSION_COOKIE_NAME]);

    if (
      !checkCsrf({
        method: req.method,
        secFetchSite: req.headers["sec-fetch-site"],
        headerToken: req.headers["x-csrf-token"],
        cookieToken: cookies[CSRF_COOKIE_NAME],
        sessionCsrfSecret: session.csrfSecret,
      })
    ) {
      return { statusCode: 403, body: { code: "CSRF_CHECK_FAILED", category: "AUTHORIZATION", message: "CSRF check failed.", retryable: false } };
    }

    const body = (req.body ? JSON.parse(req.body) : {}) as Record<string, unknown>;
    const organizationId = typeof body["organizationId"] === "string" ? body["organizationId"] : undefined;
    if (!organizationId) {
      throw new ValidationError("organizationId is required.");
    }

    const result = await deps.auth.selectOrganization(session, organizationId);
    if (!result.ok) {
      return { statusCode: 403, body: { code: "ORGANIZATION_UNAVAILABLE", category: "AUTHORIZATION", message: "This organization is not available in your current context.", retryable: false } };
    }
    return { statusCode: 204, body: {} };
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /bff/invitations/accept (Wave B2B-8, D-099) - identity-only, same class as
 * `handleCreateOrganization` above (no Organization to be a member of yet, by definition, when
 * the caller has no prior Membership anywhere). */
export async function handleAcceptInvitation(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const cookies = cookiesOf(req);
    const session = await deps.auth.resolveSession(cookies[SESSION_COOKIE_NAME]);

    if (
      !checkCsrf({
        method: req.method,
        secFetchSite: req.headers["sec-fetch-site"],
        headerToken: req.headers["x-csrf-token"],
        cookieToken: cookies[CSRF_COOKIE_NAME],
        sessionCsrfSecret: session.csrfSecret,
      })
    ) {
      return { statusCode: 403, body: { code: "CSRF_CHECK_FAILED", category: "AUTHORIZATION", message: "CSRF check failed.", retryable: false } };
    }

    const body = (req.body ? JSON.parse(req.body) : {}) as Record<string, unknown>;
    const token = typeof body["token"] === "string" ? body["token"] : undefined;
    if (!token) {
      throw new ValidationError("token is required.");
    }

    const { organizationId } = await deps.auth.acceptInvitation(session, { token });
    return { statusCode: 200, body: { organizationId } };
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST/PUT/PATCH/DELETE/GET /bff/api/{proxy+} - the allowlisted forward to the real API. */
export async function handleProxy(deps: BffHttpDeps, req: BffHttpRequest, backendPath: string, queryString: string | undefined): Promise<BffHttpResponse> {
  try {
    const cookies = cookiesOf(req);
    const session = await deps.auth.resolveSession(cookies[SESSION_COOKIE_NAME]);

    if (!checkCsrf({
      method: req.method,
      secFetchSite: req.headers["sec-fetch-site"],
      headerToken: req.headers["x-csrf-token"],
      cookieToken: cookies[CSRF_COOKIE_NAME],
      sessionCsrfSecret: session.csrfSecret,
    })) {
      return { statusCode: 403, body: { code: "CSRF_CHECK_FAILED", category: "AUTHORIZATION", message: "CSRF check failed.", retryable: false } };
    }

    const result = await deps.proxy.forward(session, { method: req.method, path: backendPath, queryString, headers: req.headers, body: req.body });
    return { statusCode: result.statusCode, headers: result.headers, body: result.body ? JSON.parse(result.body) : {} };
  } catch (err) {
    return toErrorResponse(err);
  }
}
