/**
 * CSRF — triple-layer verification per D-053/D-054: (1) Sec-Fetch-Site, checked first and
 * never fail-open when absent (older browsers that omit it fall through to the double-submit
 * check instead of being waved through); (2) X-CSRF-Token request header must equal (3) the
 * non-HttpOnly __Host-et_csrf cookie value, AND both must equal the secret stored server-side
 * on the Session record - an attacker who could somehow set the cookie cross-site (which
 * SameSite=Strict already prevents) would still fail the server-side comparison.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

export function issueCsrfSecret(): string {
  return randomBytes(32).toString("hex");
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requiresCsrfCheck(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/** `undefined` Sec-Fetch-Site (older browser) is treated as "not same-origin" - never
 * fail-open. Only "same-origin" and "none" (user-typed URL / bookmark, i.e. not a
 * cross-site page making the request) pass this layer. */
export function isSameSiteFetch(secFetchSite: string | undefined): boolean {
  return secFetchSite === "same-origin" || secFetchSite === "none";
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface CsrfCheckInput {
  method: string;
  secFetchSite: string | undefined;
  headerToken: string | undefined;
  cookieToken: string | undefined;
  sessionCsrfSecret: string;
}

export function checkCsrf(input: CsrfCheckInput): boolean {
  if (!requiresCsrfCheck(input.method)) return true;
  if (!isSameSiteFetch(input.secFetchSite)) return false;
  if (!input.headerToken || !input.cookieToken) return false;
  return safeEqual(input.headerToken, input.cookieToken) && safeEqual(input.headerToken, input.sessionCsrfSecret);
}
