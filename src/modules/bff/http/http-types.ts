/** Minimal, SDK-agnostic HTTP shape for BFF handlers - mirrors the style already used by
 * src/modules/expiration/http/item-handlers.ts's HttpRequest/HttpResponse, extended with raw
 * cookie/header access since the BFF routes are the auth boundary itself (no JWT authorizer
 * has already run for them). */
export interface BffHttpRequest {
  method: string;
  path: string;
  queryStringParameters?: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface BffHttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  cookies?: string[]; // one entry per Set-Cookie header - API Gateway HTTP API v2 supports a `cookies` response array natively
  body: unknown;
}
