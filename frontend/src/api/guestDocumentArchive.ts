/**
 * G02 (Block 6, D-2xx) — Solicitação de documento (convidado). Deliberately NOT `apiClient`
 * (`api/client.ts`): that client always prefixes `/bff/api` and sends the BFF's OWN CSRF cookie
 * (`__Host-et_csrf`) — the guest surface is a structurally separate, unauthenticated domain
 * (`document-archive-guest-handlers.ts`'s own header comment: "never touches
 * RequestContextResolver/authorize()") with its OWN double-submit CSRF pair
 * (`__Host-et_docarchive_guest_csrf`/`x-csrf-token`), reached via the THREE specific CloudFront
 * behaviors added in this same block (`infra/modules/spa-hosting/main.tf`) — same-origin relative
 * fetches, no cross-origin CORS needed.
 *
 * Every failure this module surfaces collapses to `GuestUnavailableError` — the frontend
 * mirrors the backend's own anti-enumeration discipline (never let a guest distinguish
 * "expired" from "wrong token" from "session gone" from "CSRF mismatch") rather than
 * re-deriving a friendlier message per HTTP status.
 */
import type { GuestConfirmUploadResult, GuestDocumentTypeOption, GuestStartSessionResult, GuestSubmitEvidenceResult } from "./types.js";

export class GuestUnavailableError extends Error {
  constructor() {
    super("Guest access unavailable.");
    this.name = "GuestUnavailableError";
  }
}

const CSRF_COOKIE_NAME = "__Host-et_docarchive_guest_csrf";

function readCookie(name: string): string | undefined {
  try {
    const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
    return match?.split("=")[1];
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown; csrf?: boolean } = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.csrf) {
    const token = readCookie(CSRF_COOKIE_NAME);
    if (token) headers["x-csrf-token"] = token;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "include",
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new GuestUnavailableError();
  }

  if (!response.ok) throw new GuestUnavailableError();

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** `POST /document-archive/guest/document-requests/{token}/session` — layer 2, the explicit
 * human interstitial that mints a GuestSession AND resolves the credential internally
 * (`GuestDocumentAccessService.startGuestSession`) — G02 never calls the bare layer-1 GET route
 * directly (see `infra/modules/spa-hosting/main.tf`'s own comment on why that path is reserved
 * for the SPA page load, never a fetch target). */
export function startGuestSession(token: string): Promise<GuestStartSessionResult> {
  return request<GuestStartSessionResult>(`/document-archive/guest/document-requests/${encodeURIComponent(token)}/session`, { method: "POST" });
}

/** `GET .../document-types` — discovery route, only ACTIVE types. */
export function listGuestDocumentTypes(token: string): Promise<{ documentTypes: GuestDocumentTypeOption[] }> {
  return request<{ documentTypes: GuestDocumentTypeOption[] }>(`/document-archive/guest/document-requests/${encodeURIComponent(token)}/document-types`);
}

/** `POST .../uploads` — layer 3, idempotent evidence submission. Reads the session from the
 * HttpOnly cookie server-side (never sent here) — only the CSRF header/cookie pair travels
 * explicitly. ADR-0013 (D-265) closed the real, pre-existing gap this module's earlier header
 * comment named: `submitEvidence` now persists a real `DocumentFile` (PENDING_UPLOAD) and, when
 * `uploadUrl` comes back present, the caller is expected to PUT the actual bytes to it and then
 * confirm via `confirmGuestUpload` — see `GuestDocumentRequest.tsx` for the full 3-call flow. */
export function submitGuestEvidence(
  token: string,
  input: { fileName: string; documentTypeId: string; mediaType: string; contentLength: number; checksumSha256: string; idempotencyKey: string },
): Promise<GuestSubmitEvidenceResult> {
  return request<GuestSubmitEvidenceResult>(`/document-archive/guest/document-requests/${encodeURIComponent(token)}/uploads`, { method: "POST", body: input, csrf: true });
}

/** `PATCH .../uploads` — ADR-0013 (D-265), called immediately after the browser's direct-to-S3
 * PUT resolves with a 2xx. Narrows the race against the reconciliation worker's TIMEOUT sweep
 * down to this call's own round-trip — see `GuestDocumentAccessService.confirmUploadInFlight`'s
 * doc comment for the full guarantee. Same session/CSRF discipline as `submitGuestEvidence`. */
export function confirmGuestUpload(token: string, input: { idempotencyKey: string }): Promise<GuestConfirmUploadResult> {
  return request<GuestConfirmUploadResult>(`/document-archive/guest/document-requests/${encodeURIComponent(token)}/uploads`, { method: "PATCH", body: input, csrf: true });
}
