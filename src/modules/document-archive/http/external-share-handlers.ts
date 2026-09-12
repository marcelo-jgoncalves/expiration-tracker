/**
 * HTTP handler for GET /external-share/{shareId}/{token} — D-225 Decision 1/3/5/6. The
 * anonymous visitor's own route, SEPARATE Lambda (external-share-handler.ts) from every other
 * document-archive surface, same "never touches RequestContext/authorize()" posture as
 * document-archive-guest-handlers.ts. `shareId` is logging-only (the pointer keyed by the
 * token's own selector hash is the sole resolution authority — see
 * ExternalShareLinkService.resolveForAnonymousAccess's doc comment); this handler never uses it
 * for resolution, only ever passes `token` (the OTHER path segment) into the service.
 *
 * Decision 3: `Cache-Control: no-store` + `Referrer-Policy: no-referrer` mandatory on every
 * response — the token lives in the path, which some intermediaries/browsers may still cache or
 * forward via `Referer` on a subsequent navigation away from the downloaded resource.
 */
import { AppError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import type { ExternalShareLinkService } from "../application/external-share-link-service.js";

export interface ExternalShareHttpRequest {
  pathParameters?: Record<string, string | undefined>;
  sourceIp: string;
}

export interface ExternalShareHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ExternalShareHttpDeps {
  shareLinks: ExternalShareLinkService;
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

/** Every response from this handler carries `Cache-Control: no-store` + `Referrer-Policy:
 * no-referrer` — Decision 3. */
function baseHeaders(): Record<string, string> {
  return { "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer" };
}

function toResponse(appError: AppError): ExternalShareHttpResponse {
  const status = STATUS_BY_CATEGORY[appError.category] ?? 500;
  return { statusCode: status, headers: baseHeaders(), body: appError.toJSON() };
}

/** GET /external-share/{shareId}/{token} — resolves the credential and mints a fresh presigned
 * download URL in one call (Decision 5/6). Never a "resolve then separate download" 2-step flow
 * — same one-shot-reveal discipline the token itself follows. */
export async function handleResolveExternalShare(deps: ExternalShareHttpDeps, req: ExternalShareHttpRequest): Promise<ExternalShareHttpResponse> {
  try {
    const token = req.pathParameters?.["token"];
    if (!token) throw new ValidationError("Missing token path parameter.");
    const resolved = await deps.shareLinks.resolveForAnonymousAccess(token, { ip: req.sourceIp });
    return {
      statusCode: 200,
      headers: baseHeaders(),
      body: {
        documentTypeNameSnapshot: resolved.documentTypeNameSnapshot,
        documentIssuedDate: resolved.documentIssuedDate,
        fileName: resolved.fileName,
        downloadUrl: resolved.downloadUrl,
      },
    };
  } catch (err) {
    return toResponse(err instanceof AppError ? err : toAppError(err));
  }
}
