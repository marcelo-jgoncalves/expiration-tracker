/**
 * Handler for /document-archive/guest/document-requests/{token}* (D-143 Decision 4, D-146) —
 * SEPARATE Lambda from `document-archive-handler.ts` (`authorization_type = NONE` at the API
 * Gateway route, no Cognito JWT authorizer), same isolation posture as `guest-documents-handler.ts`
 * (subject module's M10 precedent). Never uses `APIGatewayProxyEventV2WithJWTAuthorizer`/
 * `extractClaims` — there is no JWT on this route.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentArchiveGuestDeps } from "../composition/document-archive.js";
import {
  handleGetGuestRequest,
  handleStartGuestSession,
  handleSubmitEvidence,
  type GuestArchiveHttpDeps,
  type GuestArchiveHttpRequest,
} from "../../../modules/document-archive/http/document-archive-guest-handlers.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const guestAccessPepper = process.env["DOCARCHIVE_GUEST_ACCESS_PEPPER"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!guestAccessPepper) throw new Error("DOCARCHIVE_GUEST_ACCESS_PEPPER env var is required.");
const { guestAccess } = buildDocumentArchiveGuestDeps(client, tableName, guestAccessPepper);
const deps: GuestArchiveHttpDeps = { guestAccess };

function parseBody<T>(event: APIGatewayProxyEventV2): T | undefined {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
  return JSON.parse(raw) as T;
}

function toApiGatewayResult(response: { statusCode: number; headers: Record<string, string>; cookies?: string[]; body: Record<string, unknown> }): APIGatewayProxyStructuredResultV2 {
  return { statusCode: response.statusCode, headers: response.headers, cookies: response.cookies, body: JSON.stringify(response.body) };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  // correlationId never derives from guest-supplied data (public route) — always generated here.
  return runWithContext({ correlationId: randomUUID() }, () => handleGuestArchiveRoute(event));
}

async function handleGuestArchiveRoute(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const routeKey = event.routeKey;
  const base: GuestArchiveHttpRequest = {
    pathParameters: event.pathParameters,
    headers: event.headers,
    sourceIp: event.requestContext.http.sourceIp,
  };

  const response = await (async () => {
    try {
      switch (routeKey) {
        case "GET /document-archive/guest/document-requests/{token}":
          return await handleGetGuestRequest(deps, base);
        case "POST /document-archive/guest/document-requests/{token}/session":
          return await handleStartGuestSession(deps, base);
        case "POST /document-archive/guest/document-requests/{token}/uploads":
          return await handleSubmitEvidence(deps, { ...base, body: parseBody(event) });
        default:
          throw new ValidationError(`Unknown route: ${routeKey}`);
      }
    } catch (err) {
      const appError = toAppError(err);
      return { statusCode: appError.category === "VALIDATION" ? 400 : 500, headers: { "content-type": "application/json", "referrer-policy": "no-referrer" }, body: appError.toJSON() };
    }
  })();

  return toApiGatewayResult(response);
}
