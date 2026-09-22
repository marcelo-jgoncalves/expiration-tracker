/** Lambda entrypoint for /bff/* - the auth boundary itself, so (unlike items-handler.ts etc.)
 * this event type carries NO JWT authorizer claims; every handler below does its own
 * cookie/CSRF verification via BffAuthService. */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildBffDeps } from "../composition/bff.js";
import {
  handleLogin,
  handleCallback,
  handleLoginPassword,
  handleSignUp,
  handleConfirmSignUp,
  handleResendConfirmationCode,
  handleForgotPassword,
  handleConfirmForgotPassword,
  handleGetSession,
  handleLogout,
  handleLogoutAll,
  handleCreateOrganization,
  handleAcceptInvitation,
  handleListOrganizations,
  handleSelectOrganization,
  handleProxy,
  type BffHttpDeps,
} from "../../../modules/bff/http/bff-handlers.js";
import type { BffHttpRequest, BffHttpResponse } from "../../../modules/bff/http/http-types.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { withHandlerTiming } from "../../../shared/observability/handler-timing.js";

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
  // Wave B2B-8 (D-099): reaproveita o mesmo secret de GUEST_TOKEN_PEPPER (subject module,
  // D-037) - ver composition/organization.ts para a justificativa completa da reutilização.
  invitationTokenPepper: requiredEnv("GUEST_TOKEN_PEPPER"),
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

// Every BFF response is JSON or a redirect, never HTML with embedded scripts - a maximally
// restrictive CSP is correct here (unlike the SPA's own index.html, which needs to allow its
// own bundle). API Gateway HTTP API is HTTPS-only already, so declaring HSTS is safe.
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

function toApiGatewayResult(res: BffHttpResponse): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: res.statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...SECURITY_HEADERS, ...res.headers },
    cookies: res.cookies,
    // isRawBody (proxied non-JSON bodies, e.g. CSV reports - see handleProxy) must be sent
    // through byte-for-byte; JSON.stringify()ing an already-CSV string would wrap it in quotes
    // and escape it, corrupting the download for every other handler's JSON body untouched.
    body: res.isRawBody ? (res.body as string) : JSON.stringify(res.body ?? {}),
  };
}

const BFF_API_PREFIX = "/bff/api";

// PERF-02 slice 2: total_ms/cold_start now come from the shared withHandlerTiming helper (see
// handler-timing.ts), which standardizes the metric name as "lambda.total_ms" across every
// handler (slice 1 originally emitted it as "bff.total_ms" - no external consumer depended on
// that name yet, so this rename is safe).
export const handler = withHandlerTiming<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>(
  "ExpirationTracker/BFF",
  "bff handler",
  (event) => runWithContext({ correlationId: event.requestContext.requestId }, () => route(event)),
);

async function route(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const req = toBffRequest(event);
  const routeKey = `${event.requestContext.http.method} ${event.routeKey.split(" ")[1] ?? event.rawPath}`;

  // D-3xx (reversal of D-320): the app's own login/signup/reset screens now call these
  // directly - GET /bff/login and GET /bff/callback below are kept dormant (never removed) as
  // a documented rollback path (decisions-log.md D-3xx), not the frontend's entry point anymore.
  if (routeKey === "POST /bff/login") return toApiGatewayResult(await handleLoginPassword(deps, req));
  if (routeKey === "POST /bff/signup") return toApiGatewayResult(await handleSignUp(deps, req));
  if (routeKey === "POST /bff/signup/confirm") return toApiGatewayResult(await handleConfirmSignUp(deps, req));
  if (routeKey === "POST /bff/signup/resend") return toApiGatewayResult(await handleResendConfirmationCode(deps, req));
  if (routeKey === "POST /bff/forgot-password") return toApiGatewayResult(await handleForgotPassword(deps, req));
  if (routeKey === "POST /bff/forgot-password/confirm") return toApiGatewayResult(await handleConfirmForgotPassword(deps, req));

  if (routeKey === "GET /bff/login") return toApiGatewayResult(await handleLogin(deps, req));
  if (routeKey === "GET /bff/callback") return toApiGatewayResult(await handleCallback(deps, req));
  if (routeKey === "GET /bff/session") return toApiGatewayResult(await handleGetSession(deps, req));
  if (routeKey === "POST /bff/session/logout") return toApiGatewayResult(await handleLogout(deps, req));
  if (routeKey === "POST /bff/session/logout-all") return toApiGatewayResult(await handleLogoutAll(deps, req));
  if (routeKey === "POST /bff/organizations") return toApiGatewayResult(await handleCreateOrganization(deps, req));
  if (routeKey === "POST /bff/invitations/accept") return toApiGatewayResult(await handleAcceptInvitation(deps, req));
  if (routeKey === "GET /bff/organizations") return toApiGatewayResult(await handleListOrganizations(deps, req));
  if (routeKey === "POST /bff/organization/select") return toApiGatewayResult(await handleSelectOrganization(deps, req));

  if (event.rawPath.startsWith(BFF_API_PREFIX)) {
    const backendPath = event.rawPath.slice(BFF_API_PREFIX.length) || "/";
    return toApiGatewayResult(await handleProxy(deps, req, backendPath, event.rawQueryString || undefined));
  }

  return toApiGatewayResult({ statusCode: 404, body: { code: "NOT_FOUND", category: "NOT_FOUND", message: "Unknown BFF route.", retryable: false } });
}
