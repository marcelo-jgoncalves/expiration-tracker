/**
 * ProxyService — forwards an allowlisted request to the real API, attaching the session's
 * server-side access token as Bearer (D-053: the browser never sees this value). Never a
 * generic authenticated proxy (FPF-G4): matchAllowlistedRoute() is the only decision point
 * for whether a call is forwarded at all.
 */
import { NotFoundError } from "../../../shared/errors/app-error.js";
import { matchAllowlistedRoute } from "../domain/proxy-allowlist.js";
import type { Session } from "../domain/session.js";

/** Explicit allowlist of request headers forwarded to the backend, and response headers
 * forwarded back to the browser (D-054: "allowlist de headers", never implicit passthrough -
 * same discipline as toApiGatewayResult() only ever setting a fixed header set). */
const FORWARDED_REQUEST_HEADERS = ["content-type", "if-match", "idempotency-key"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "etag"];

export interface ProxyRequest {
  method: string;
  path: string;
  queryString?: string;
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface ProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface BackendFetcher {
  fetch(input: { method: string; url: string; headers: Record<string, string>; body?: string }): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
}

export class ProxyService {
  constructor(
    private readonly backend: BackendFetcher,
    private readonly apiBaseUrl: string,
  ) {}

  async forward(session: Session, req: ProxyRequest): Promise<ProxyResponse> {
    const route = matchAllowlistedRoute(req.method, req.path);
    if (!route) {
      throw new NotFoundError("No such BFF-proxied route.", { method: req.method, path: req.path });
    }

    const headers: Record<string, string> = { authorization: `Bearer ${session.accessToken}` };
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.headers[name];
      if (value !== undefined) headers[name] = value;
    }

    const url = `${this.apiBaseUrl}${req.path}${req.queryString ? `?${req.queryString}` : ""}`;
    const result = await this.backend.fetch({ method: req.method, url, headers, body: req.body });

    const responseHeaders: Record<string, string> = {};
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = result.headers[name];
      if (value !== undefined) responseHeaders[name] = value;
    }
    return { statusCode: result.statusCode, headers: responseHeaders, body: result.body };
  }
}
