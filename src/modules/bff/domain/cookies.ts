/**
 * Cookie names and attributes - fixed exactly by D-053 (Full BFF) and D-054 (adversarial
 * hardening amendment). Never redesigned here; this module only encodes the already-approved
 * shape so no call site has to remember three different attribute sets by hand.
 *
 * `__Host-` prefix (browser-enforced): requires Secure, no Domain attribute, Path=/ - the
 * browser itself refuses to set the cookie otherwise, which is exactly the guarantee D-053
 * wanted (no cross-subdomain leakage, no accidental non-HTTPS transmission).
 */
export const SESSION_COOKIE_NAME = "__Host-et_session";
export const LOGIN_COOKIE_NAME = "__Host-et_login";
export const CSRF_COOKIE_NAME = "__Host-et_csrf";

export const LOGIN_ATTEMPT_TTL_SECONDS = 10 * 60; // D-054: LoginAttempt is short-lived, single-use.
export const SESSION_ABSOLUTE_TTL_SECONDS = 30 * 24 * 60 * 60; // D-054: absoluteExpiresAt = createdAt + 30d, never extended by refresh.
export const SESSION_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60; // D-054: idle timeout via purgeAfterTtl.

export interface CookieAttributes {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax";
  path: string;
  maxAgeSeconds: number;
}

/** SameSite=Lax - D-054: must survive the Cognito Hosted UI's cross-site redirect back to
 * the callback route, which a Strict cookie would not attach to. */
export const LOGIN_COOKIE_ATTRIBUTES: CookieAttributes = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
  maxAgeSeconds: LOGIN_ATTEMPT_TTL_SECONDS,
};

/** SameSite=Strict - D-054: only ever minted via a same-origin redirect after the callback
 * completes, so it never needs to survive a cross-site navigation the way the login cookie does. */
export const SESSION_COOKIE_ATTRIBUTES: CookieAttributes = {
  httpOnly: true,
  secure: true,
  sameSite: "Strict",
  path: "/",
  maxAgeSeconds: SESSION_ABSOLUTE_TTL_SECONDS,
};

/** Deliberately NOT HttpOnly - the frontend must read this value to echo it back as the
 * X-CSRF-Token header (double-submit pattern), per D-053 §CSRF. */
export const CSRF_COOKIE_ATTRIBUTES: CookieAttributes = {
  httpOnly: false,
  secure: true,
  sameSite: "Strict",
  path: "/",
  maxAgeSeconds: SESSION_ABSOLUTE_TTL_SECONDS,
};

export function buildSetCookieHeader(name: string, value: string, attrs: CookieAttributes): string {
  const parts = [`${name}=${value}`, `Path=${attrs.path}`, `Max-Age=${attrs.maxAgeSeconds}`, `SameSite=${attrs.sameSite}`];
  if (attrs.secure) parts.push("Secure");
  if (attrs.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

/** Max-Age=0 clears the cookie in every browser - used by logout. */
export function buildClearCookieHeader(name: string, attrs: CookieAttributes): string {
  return buildSetCookieHeader(name, "", { ...attrs, maxAgeSeconds: 0 });
}

/** Parses a raw `Cookie` request header into a name->value map. Never throws on malformed
 * input (a client sending garbage cookies must never crash the BFF - falls back to skipping
 * the unparseable pair). */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
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
