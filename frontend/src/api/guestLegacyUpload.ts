/**
 * G01 (Block 7, D-2xx) — Upload de convidado (rastreamento legado), M10/D-037. Deliberately NOT
 * `apiClient` (`api/client.ts`) - same reasoning as `guestDocumentArchive.ts`: this is a
 * structurally separate, unauthenticated surface (`guest-handlers.ts`'s own header comment:
 * "o convidado nunca passa por RequestContextResolver/authorize()"), reached via its own
 * CloudFront behaviors (`infra/modules/spa-hosting/main.tf`). Simpler than G02's client, though:
 * this legacy Lambda (`guest-documents-handler.ts`) has NO CSRF cookie/header pair at all - only
 * the opaque token in the URL - so this module never reads or sends one.
 *
 * The bare `GET /guest/document-requests/{token}` route is reserved for the SPA's own client-side
 * page load (same collision G02 already solved for its own bare token path) - this module instead
 * calls `GET /guest/document-requests/{token}/info`, a new alias added in this same block
 * (`guest-documents-handler.ts`) that answers with the exact same data, addressable by its own
 * CloudFront behavior without hijacking the page route.
 *
 * Every failure the backend attributes to the TOKEN ITSELF (401 - `GuestTokenInvalidError`,
 * `guest-submission-service.ts`'s own single error for invalid/expired/revoked/wrong-secret)
 * collapses to `GuestUnavailableError` - anti-enumeration discipline, the guest never learns
 * which of those internal causes applied (see `GuestLinkUnavailable`'s own header comment).
 *
 * Codex review round 1 (Block 7, D-267) MÉDIO finding, corrected: a genuinely TRANSIENT failure
 * (network unreachable, a 5xx from the Lambda/CloudFront itself) is NOT a token problem and must
 * never be presented as "this link is unavailable" (a false, unrecoverable claim) - it throws
 * `GuestTransientError` instead, so the caller can offer a real "tentar novamente" affordance.
 */
import type { LegacyGuestRequestInfo, LegacyGuestSubmissionInput, LegacyGuestSubmissionResult } from "./types.js";

export class GuestUnavailableError extends Error {
  constructor() {
    super("Guest access unavailable.");
    this.name = "GuestUnavailableError";
  }
}

export class GuestTransientError extends Error {
  constructor() {
    super("Guest access temporarily unavailable.");
    this.name = "GuestTransientError";
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new GuestTransientError();
  }
  if (response.status >= 500) throw new GuestTransientError();
  if (!response.ok) throw new GuestUnavailableError();
  return (await response.json()) as T;
}

export function fetchLegacyGuestRequestInfo(token: string): Promise<{ request: LegacyGuestRequestInfo }> {
  return request<{ request: LegacyGuestRequestInfo }>(`/guest/document-requests/${encodeURIComponent(token)}/info`);
}

export function submitLegacyGuestUpload(token: string, input: LegacyGuestSubmissionInput): Promise<LegacyGuestSubmissionResult> {
  return request<LegacyGuestSubmissionResult>(`/guest/document-requests/${encodeURIComponent(token)}/uploads`, { method: "POST", body: input });
}
