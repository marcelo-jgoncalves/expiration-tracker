/** Lambda entrypoint for /bff/* - the auth boundary itself, so (unlike items-handler.ts etc.)
 * this event type carries NO JWT authorizer claims; every handler below does its own
 * cookie/CSRF verification via BffAuthService. */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildBffDeps } from "../composition/bff.js";
import { handleLogin, handleCallback, handleGetSession, handleLogout, handleLogoutAll, handleProxy, type BffHttpDeps } from "../../../modules/bff/http/bff-handlers.js";
import type { BffHttpRequest, BffHttpResponse } from "../../../modules/bff/http/http-types.js";
import { runWithContext } from "../../../shared/observability/context.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required.`);
  return value;
}

const client = createDocumentClient();
const { auth, proxy } = buildBffDeps(client, client, {
  mainTableName: requiredEnv("TABLE_NAME"),
  sessionTableName: requiredEnv("BFF_SESSION_TABLE_NAME"),
  sessionTokenPepper: requiredEnv("SESSION_TOKEN_PEPPER"),
  kmsKeyId: requiredEnv("SESSION_KMS_KEY_ID"),
  cognitoUserPoolId: requiredEnv("COGNITO_USER_POOL_ID"),
  cognitoClientId: requiredEnv("COGNITO_CLIENT_ID"),
  cognitoClientSecret: requiredEnv("COGNITO_CLIENT_SECRET"),
  cognitoDomain: requiredEnv("COGNITO_DOMAIN"),
  authorizeUrl: `${requiredEnv("COGNITO_DOMAIN")}/oauth2/authorize`,
  redirectUri: requiredEnv("BFF_REDIRECT_URI"),
  apiBaseUrl: requiredEnv("API_BASE_URL"),
});
const deps: BffHttpDeps = { auth, proxy, appOrigin: requiredEnv("APP_ORIGIN") };

function toBffRequest(event: APIGatewayProxyEventV2): BffHttpRequest {
  const headers: Record<string, string | undefined> = { ...event.headers };
  const cookieHeader = (event.cookies ?? []).join("; ");
  if (cookieHeader) headers["cookie"] = cookieHeader;
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body) : undefined;
  const query: Record<string, string | undefined> = { ...event.queryStringParameters };
  return { method: event.requestContext.http.method, path: event.rawPath, queryStringParameters: query, headers, body };
}

function toApiGatewayResult(res: BffHttpResponse): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: res.statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...res.headers },
    cookies: res.cookies,
    body: JSON.stringify(res.body ?? {}),
  };
}

const BFF_API_PREFIX = "/bff/api";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return runWithContext({ correlationId: event.requestContext.requestId }, () => route(event));
}

async function route(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const req = toBffRequest(event);
  const routeKey = `${event.requestContext.http.method} ${event.routeKey.split(" ")[1] ?? event.rawPath}`;

  if (routeKey === "GET /bff/login") return toApiGatewayResult(await handleLogin(deps, req));
  if (routeKey === "GET /bff/callback") return toApiGatewayResult(await handleCallback(deps, req));
  if (routeKey === "GET /bff/session") return toApiGatewayResult(await handleGetSession(deps, req));
  if (routeKey === "POST /bff/session/logout") return toApiGatewayResult(await handleLogout(deps, req));
  if (routeKey === "POST /bff/session/logout-all") return toApiGatewayResult(await handleLogoutAll(deps, req));

  if (event.rawPath.startsWith(BFF_API_PREFIX)) {
    const backendPath = event.rawPath.slice(BFF_API_PREFIX.length) || "/";
    return toApiGatewayResult(await handleProxy(deps, req, backendPath, event.rawQueryString || undefined));
  }

  return toApiGatewayResult({ statusCode: 404, body: { code: "NOT_FOUND", category: "NOT_FOUND", message: "Unknown BFF route.", retryable: false } });
}
