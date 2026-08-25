/**
 * The BFF's own session/auth endpoints (login, callback redirect target, session probe,
 * logout) - distinct from ApiClient, which only ever talks to /bff/api/* (the allowlisted
 * resource proxy). These are never JWT-authenticated calls; they ARE the auth boundary.
 */
import { ApiError } from "./errors.js";

export interface SessionInfo {
  authenticated: boolean;
  tenantId?: string;
  userId?: string;
}

/** Never throws on a network/parse failure by returning `{authenticated:false}` - a broken
 * session probe must never be mistaken for "definitely not authenticated" vs. "we don't know
 * yet"; callers should treat a thrown SessionProbeError as SESSION_MISSING-with-uncertainty,
 * not silently assume logged-out. */
export class SessionProbeError extends Error {}

export async function fetchSessionInfo(): Promise<SessionInfo> {
  let response: Response;
  try {
    response = await fetch("/bff/session", { credentials: "include" });
  } catch (cause) {
    throw new SessionProbeError(`Could not reach the session endpoint: ${String(cause)}`);
  }
  if (!response.ok) {
    throw new SessionProbeError(`Session endpoint returned ${response.status}`);
  }
  try {
    return (await response.json()) as SessionInfo;
  } catch (cause) {
    throw new SessionProbeError(`Could not parse session response: ${String(cause)}`);
  }
}

/** Redirects the whole page (not an XHR - this is a real navigation to the BFF, which
 * redirects again to Cognito's Hosted UI). `returnTo` is validated server-side
 * (BffAuthService.startLogin) - never trust a client-side check as the only guard against an
 * open redirect. */
export function startLogin(returnTo: string): void {
  const params = new URLSearchParams({ returnTo });
  window.location.assign(`/bff/login?${params.toString()}`);
}

async function postSessionAction(path: string): Promise<void> {
  const csrfCookie = document.cookie.split("; ").find((row) => row.startsWith("__Host-et_csrf="));
  const headers: Record<string, string> = {};
  if (csrfCookie) headers["x-csrf-token"] = csrfCookie.split("=")[1] ?? "";

  let response: Response;
  try {
    response = await fetch(path, { method: "POST", credentials: "include", headers });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  if (!response.ok && response.status !== 204) {
    throw ApiError.fromResponseBody(await response.json().catch(() => undefined), response.status);
  }
}

export function logout(): Promise<void> {
  return postSessionAction("/bff/session/logout");
}

export function logoutAll(): Promise<void> {
  return postSessionAction("/bff/session/logout-all");
}
