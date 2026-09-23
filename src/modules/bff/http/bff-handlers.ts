/**
 * HTTP-shape handlers for /bff/* routes. These routes ARE the authentication boundary - no
 * JWT authorizer runs before them (unlike src/modules/expiration/http/item-handlers.ts),
 * so every handler here is responsible for its own cookie/CSRF verification.
 */
import { AppError, AuthenticationError, toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { logger } from "../../../shared/observability/logger.js";
import { emitMetric } from "../../../shared/observability/metrics.js";
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

// PERF-02: same per-service EMF namespace convention as the other handler files (e.g.
// "ExpirationTracker/ReminderDispatch" in reminder-dispatch-handler.ts, D-290).
const METRICS_NAMESPACE = "ExpirationTracker/BFF";

/** Low-cardinality status class ("2xx"/"4xx"/"5xx"/...) - never the raw status code as a metric
 * dimension (metrics.ts's own dimension-discipline rule). */
function statusClass(statusCode: number): string {
  return `${Math.floor(statusCode / 100)}xx`;
}

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

/** D-3xx: `POST /bff/login` - direct-auth entry point replacing the Hosted UI redirect
 * (`handleLogin`/`handleCallback` above stay in place, dormant fallback - see decisions-log.md
 * D-3xx). No CSRF check: there is no session cookie yet to protect at this point, the exact
 * same trust boundary `handleLogin` above already had (an unauthenticated GET redirect also
 * carries no CSRF token) - login-CSRF (an attacker silently logging a victim into the
 * attacker's OWN account) is a known, low-severity residual risk accepted here, never a gap
 * introduced by this endpoint that the redirect-based flow didn't already have. */
export async function handleLoginPassword(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const body = (req.body ? JSON.parse(req.body) : {}) as Record<string, unknown>;
    const email = typeof body["email"] === "string" ? body["email"] : undefined;
    const password = typeof body["password"] === "string" ? body["password"] : undefined;
    if (!email || !password) throw new ValidationError("email and password are required.");

    const { sessionToken, csrfToken } = await deps.auth.loginWithPassword({ email, password });
    return {
      statusCode: 200,
      body: {},
      cookies: [
        buildSetCookieHeader(SESSION_COOKIE_NAME, sessionToken, SESSION_COOKIE_ATTRIBUTES),
        buildSetCookieHeader(CSRF_COOKIE_NAME, csrfToken, CSRF_COOKIE_ATTRIBUTES),
      ],
    };
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** D-3xx: `POST /bff/signup` - self-service registration (parity with the Hosted UI's own
 * "Sign up" link, which was live by default - see BffAuthService.signUp's doc comment). */
export async function handleSignUp(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const body = (req.body ? JSON.parse(req.body) : {}) as Record<string, unknown>;
    const email = typeof body["email"] === "string" ? body["email"] : undefined;
    const password = typeof body["password"] === "string" ? body["password"] : undefined;
    const name = typeof body["name"] === "string" ? body["name"] : undefined;
    if (!email || !password || !name) throw new ValidationError("email, password and name are required.");

    const result = await deps.auth.signUp({ email, password, name });
    return { statusCode: 202, body: result };
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** D-3xx: `POST /bff/signup/confirm` - the e-mail verification step. */
export async function handleConfirmSignUp(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const body = (req.body ? JSON.parse(req.body) : {}) as Record<string, unknown>;
    const email = typeof body["email"] === "string" ? body["email"] : undefined;
    const confirmationCode = typeof body["confirmationCode"] === "string" ? body["confirmationCode"] : undefined;
    if (!email || !confirmationCode) throw new ValidationError("email and confirmationCode are required.");

    await deps.auth.confirmSignUp({ email, confirmationCode });
    return { statusCode: 204, body: {} };
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** D-3xx: `POST /bff/signup/resend` - reissues the confirmation code. */
export async function handleResendConfirmationCode(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const body = (req.body ? JSON.parse(req.body) : {}) as Record<string, unknown>;
    const email = typeof body["email"] === "string" ? body["email"] : undefined;
    if (!email) throw new ValidationError("email is required.");

    await deps.auth.resendConfirmationCode({ email });
    return { statusCode: 204, body: {} };
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** D-3xx: `POST /bff/forgot-password` - always 202, anti-enumeration (decision 3): the caller
 * can never tell from this response alone whether the e-mail is actually registered. */
export async function handleForgotPassword(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const body = (req.body ? JSON.parse(req.body) : {}) as Record<string, unknown>;
    const email = typeof body["email"] === "string" ? body["email"] : undefined;
    if (!email) throw new ValidationError("email is required.");

    await deps.auth.startForgotPassword({ email });
    return { statusCode: 202, body: {} };
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** D-3xx: `POST /bff/forgot-password/confirm` - code + new password. */
export async function handleConfirmForgotPassword(deps: BffHttpDeps, req: BffHttpRequest): Promise<BffHttpResponse> {
  try {
    const body = (req.body ? JSON.parse(req.body) : {}) as Record<string, unknown>;
    const email = typeof body["email"] === "string" ? body["email"] : undefined;
    const confirmationCode = typeof body["confirmationCode"] === "string" ? body["confirmationCode"] : undefined;
    const newPassword = typeof body["newPassword"] === "string" ? body["newPassword"] : undefined;
    if (!email || !confirmationCode || !newPassword) throw new ValidationError("email, confirmationCode and newPassword are required.");

    await deps.auth.confirmForgotPassword({ email, confirmationCode, newPassword });
    return { statusCode: 204, body: {} };
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
    const { activeOrganizationId, onboardingState, organizationSelectionRequired, displayName, email } = await deps.auth.resolveSessionWithOnboarding(
      cookiesOf(req)[SESSION_COOKIE_NAME],
    );
    return { statusCode: 200, body: { authenticated: true, activeOrganizationId, onboardingState, organizationSelectionRequired, displayName, email } };
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

    const sessionResolveStart = Date.now();
    const session = await deps.auth.resolveSession(cookies[SESSION_COOKIE_NAME]);
    const sessionResolveMs = Date.now() - sessionResolveStart;

    if (!checkCsrf({
      method: req.method,
      secFetchSite: req.headers["sec-fetch-site"],
      headerToken: req.headers["x-csrf-token"],
      cookieToken: cookies[CSRF_COOKIE_NAME],
      sessionCsrfSecret: session.csrfSecret,
    })) {
      return { statusCode: 403, body: { code: "CSRF_CHECK_FAILED", category: "AUTHORIZATION", message: "CSRF check failed.", retryable: false } };
    }

    const proxyStart = Date.now();
    const result = await deps.proxy.forward(session, { method: req.method, path: backendPath, queryString, headers: req.headers, body: req.body });
    const proxyMs = Date.now() - proxyStart;

    // PERF-02: BFF-side timing for the two steps handleProxy actually performs, plus the
    // backend's response status class. Emitted right here (rather than only in
    // src/runtime/aws/handlers/*.ts, metrics.ts's usual convention) because handleProxy IS the
    // HTTP boundary for /bff/api/* - there is no intervening service layer to push this into.
    logger.info("bff proxy timing", { sessionResolveMs, proxyMs, backendStatus: result.statusCode });
    emitMetric(METRICS_NAMESPACE, { name: "bff.session_resolve_ms", value: sessionResolveMs, unit: "Milliseconds" });
    emitMetric(METRICS_NAMESPACE, { name: "bff.proxy_ms", value: proxyMs, unit: "Milliseconds" });
    emitMetric(METRICS_NAMESPACE, { name: "bff.backend_status", value: 1, unit: "Count", dimensions: { StatusClass: statusClass(result.statusCode) } });

    // G3 follow-up: not every proxied route returns JSON (the 7 CSV report routes return
    // text/csv - see proxy-allowlist.ts's own comment on those entries). JSON.parse()ing every
    // response unconditionally corrupted/500'd those - only parse when the backend actually
    // says it sent JSON; otherwise pass the body through untouched (isRawBody: true tells the
    // API Gateway adapter to skip JSON.stringify() on the way back out).
    const contentType = result.headers["content-type"];
    const isJson = contentType === undefined || contentType.startsWith("application/json");
    if (!result.body) {
      return { statusCode: result.statusCode, headers: result.headers, body: {} };
    }
    if (isJson) {
      return { statusCode: result.statusCode, headers: result.headers, body: JSON.parse(result.body) };
    }
    return { statusCode: result.statusCode, headers: result.headers, body: result.body, isRawBody: true };
  } catch (err) {
    return toErrorResponse(err);
  }
}
