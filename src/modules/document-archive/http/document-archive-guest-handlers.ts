/**
 * HTTP handlers for /document-archive/guest/document-requests/{token}* — D-143 Decision 4.
 * SECOND public (no-JWT) route family in this codebase (after `subject/http/guest-handlers.ts`),
 * same posture: never touches `RequestContextResolver`/`authorize()`, only
 * `GuestDocumentAccessService`'s token-based validation. Every failure returns the SAME generic
 * response (`GuestAccessInvalidError`).
 *
 * Mandatory response hardening (Decision 4): `Referrer-Policy: no-referrer` on every response
 * from this handler set — a guest link/session token must never leak into a `Referer` header of
 * a subsequent cross-origin navigation. CSRF is enforced via a double-submit cookie
 * (`__Host-et_docarchive_csrf`, set when a `GuestSession` is minted) — the cookie itself is NOT
 * HttpOnly (the caller must be able to read it to echo it back as a header, same reasoning as
 * the BFF's own `CSRF_COOKIE_ATTRIBUTES`), but the session cookie carrying the raw session token
 * IS HttpOnly.
 */
import { AppError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import { GuestAccessInvalidError, type GuestDocumentAccessService, type SubmitEvidenceInput } from "../application/guest-document-access-service.js";

const GUEST_SESSION_COOKIE_NAME = "__Host-et_docarchive_guest_session";
const GUEST_CSRF_COOKIE_NAME = "__Host-et_docarchive_guest_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";

interface CookieAttributes {
  httpOnly: boolean;
  maxAgeSeconds: number;
}

function buildSetCookieHeader(name: string, value: string, attrs: CookieAttributes): string {
  const parts = [`${name}=${value}`, "Path=/", `Max-Age=${attrs.maxAgeSeconds}`, "SameSite=Strict", "Secure"];
  if (attrs.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) throw new ValidationError("Request body failed schema validation.", { errors });
}

const SUBMIT_EVIDENCE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-guest-submit-evidence-request.v1.json";

export interface GuestArchiveHttpRequest<TBody = unknown> {
  pathParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  sourceIp: string;
  body?: TBody;
}

export interface GuestArchiveHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: Record<string, unknown>;
}

export interface GuestArchiveHttpDeps {
  guestAccess: GuestDocumentAccessService;
}

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

/** Every response from this handler set carries `Referrer-Policy: no-referrer` — Decision 4. */
function baseHeaders(): Record<string, string> {
  return { "content-type": "application/json", "referrer-policy": "no-referrer" };
}

function toResponse(appError: AppError): GuestArchiveHttpResponse {
  const status = STATUS_BY_CATEGORY[appError.category] ?? 500;
  return { statusCode: status, headers: baseHeaders(), body: appError.toJSON() };
}

async function withErrorMapping(fn: () => Promise<GuestArchiveHttpResponse>): Promise<GuestArchiveHttpResponse> {
  try {
    return await fn();
  } catch (err) {
    return toResponse(err instanceof AppError ? err : toAppError(err));
  }
}

function requireToken(req: GuestArchiveHttpRequest): string {
  const token = req.pathParameters?.["token"];
  if (!token) throw new ValidationError("Missing token path parameter.");
  return token;
}

function cookiesOf(req: GuestArchiveHttpRequest): Record<string, string> {
  return parseCookieHeader(req.headers?.["cookie"] ?? req.headers?.["Cookie"]);
}

/** GET /document-archive/guest/document-requests/{token} — resolves the credential (layer 1)
 * only. Never mints a session (Decision 4). */
export async function handleGetGuestRequest(deps: GuestArchiveHttpDeps, req: GuestArchiveHttpRequest): Promise<GuestArchiveHttpResponse> {
  return withErrorMapping(async () => {
    const token = requireToken(req);
    const resolved = await deps.guestAccess.resolveCredential(token, { ip: req.sourceIp });
    return {
      statusCode: 200,
      headers: baseHeaders(),
      body: {
        request: {
          requirementId: resolved.request.requirementId,
          status: resolved.request.status,
          deadline: resolved.request.deadline,
        },
      },
    };
  });
}

/** POST /document-archive/guest/document-requests/{token}/session — the explicit human
 * interstitial action that mints a GuestSession (layer 2). Sets the HttpOnly session cookie and
 * the readable CSRF cookie. */
export async function handleStartGuestSession(deps: GuestArchiveHttpDeps, req: GuestArchiveHttpRequest): Promise<GuestArchiveHttpResponse> {
  return withErrorMapping(async () => {
    const token = requireToken(req);
    const result = await deps.guestAccess.startGuestSession(token, { ip: req.sourceIp });
    return {
      statusCode: 201,
      headers: baseHeaders(),
      cookies: [
        buildSetCookieHeader(GUEST_SESSION_COOKIE_NAME, result.session.token, { httpOnly: true, maxAgeSeconds: 30 * 60 }),
        buildSetCookieHeader(GUEST_CSRF_COOKIE_NAME, result.session.csrfToken, { httpOnly: false, maxAgeSeconds: 30 * 60 }),
      ],
      body: { expiresAt: result.expiresAt },
    };
  });
}

/** POST /document-archive/guest/document-requests/{token}/uploads — layer 3, idempotent
 * evidence submission. Reads the session token from the HttpOnly cookie (never from the request
 * body/path — the guest never re-types it), CSRF from the cookie+header double-submit pair. */
export async function handleSubmitEvidence(deps: GuestArchiveHttpDeps, req: GuestArchiveHttpRequest<SubmitEvidenceInput>): Promise<GuestArchiveHttpResponse> {
  return withErrorMapping(async () => {
    requireToken(req); // Presence-checked for route symmetry/observability; resolution is by session cookie, not the path token.
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(SUBMIT_EVIDENCE_SCHEMA_ID, req.body);

    const cookies = cookiesOf(req);
    const sessionToken = cookies[GUEST_SESSION_COOKIE_NAME];
    // A missing session cookie is itself a guest-auth failure mode (no session to resolve) —
    // collapses into the same generic error as a malformed/expired/wrong-secret token, never a
    // differentiated 400 that would tell a caller "you're just missing a cookie" (an oracle).
    if (!sessionToken) throw new GuestAccessInvalidError();
    const csrfHeaderValue = req.headers?.[CSRF_HEADER_NAME] ?? req.headers?.["X-CSRF-Token"];

    const result = await deps.guestAccess.submitEvidence(
      sessionToken,
      { ip: req.sourceIp, csrfCookieValue: cookies[GUEST_CSRF_COOKIE_NAME], csrfHeaderValue },
      req.body,
    );
    return { statusCode: 201, headers: baseHeaders(), body: result as unknown as Record<string, unknown> };
  });
}
