/** Shared API Gateway HTTP API v2 (JWT authorizer) <-> internal HttpRequest/HttpResponse
 * translation (M3.5). Used by every HTTP composition-root handler (TestPingHandler,
 * ItemsHandler, RemindersHandler) so claims extraction and response shaping happen in
 * exactly one place. */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { AuthenticationError } from "../../shared/errors/app-error.js";
import type { ValidatedClaims } from "../../modules/identity/application/resolve-request-context.js";

export function extractClaims(event: APIGatewayProxyEventV2WithJWTAuthorizer): ValidatedClaims {
  const claims = event.requestContext.authorizer.jwt.claims;
  const sub = claims["sub"];
  const jti = claims["jti"];
  const iat = claims["iat"];
  const exp = claims["exp"];
  if (typeof sub !== "string" || typeof jti !== "string") {
    throw new AuthenticationError("Missing required JWT claims.");
  }
  const deviceId = typeof claims["device_id"] === "string" ? claims["device_id"] : undefined;
  return {
    sub,
    tokenId: jti,
    issuedAt: new Date(Number(iat) * 1000).toISOString(),
    expiresAt: new Date(Number(exp) * 1000).toISOString(),
    deviceId,
  };
}

export function parseBody<T>(event: APIGatewayProxyEventV2WithJWTAuthorizer): T | undefined {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
  return JSON.parse(raw) as T;
}

export function toApiGatewayResult(response: { statusCode: number; body: Record<string, unknown> }): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: response.statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(response.body),
  };
}
