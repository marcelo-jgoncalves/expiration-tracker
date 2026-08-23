/**
 * Handler real para /guest/document-requests/{token}* (M10, D-037) — PRIMEIRA rota pública do
 * projeto (`authorization_type = NONE` no API Gateway, WAF na frente é pré-requisito de infra,
 * não item de M8). Nunca usa `APIGatewayProxyEventV2WithJWTAuthorizer`/`extractClaims` — não
 * há JWT nesta rota, o convidado é validado só pelo token (ver guest-submission-service.ts).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildGuestSubmissionDeps } from "../composition/subject.js";
import { handleGetGuestRequest, handleStartGuestSubmission, type GuestHttpDeps } from "../../../modules/subject/http/guest-handlers.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { randomUUID } from "node:crypto";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const quarantineBucket = process.env["QUARANTINE_BUCKET_NAME"];
const guestTokenPepper = process.env["GUEST_TOKEN_PEPPER"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!quarantineBucket) throw new Error("QUARANTINE_BUCKET_NAME env var is required.");
if (!guestTokenPepper) throw new Error("GUEST_TOKEN_PEPPER env var is required.");
const { guestSubmissions } = buildGuestSubmissionDeps(client, tableName, quarantineBucket, guestTokenPepper);
const deps: GuestHttpDeps = { guestSubmissions };

function parseBody<T>(event: APIGatewayProxyEventV2): T | undefined {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
  return JSON.parse(raw) as T;
}

function toApiGatewayResult(response: { statusCode: number; body: Record<string, unknown> }): APIGatewayProxyStructuredResultV2 {
  return { statusCode: response.statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(response.body) };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  // correlationId nunca deriva de dado fornecido pelo convidado (rota pública) - sempre gerado aqui.
  return runWithContext({ correlationId: randomUUID() }, () => handleGuestRoute(event));
}

async function handleGuestRoute(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const routeKey = event.routeKey;
  const base = { pathParameters: event.pathParameters };

  const response = await (async () => {
    try {
      switch (routeKey) {
        case "GET /guest/document-requests/{token}":
          return await handleGetGuestRequest(deps, base);
        case "POST /guest/document-requests/{token}/uploads":
          return await handleStartGuestSubmission(deps, { ...base, body: parseBody(event) });
        default:
          throw new ValidationError(`Unknown route: ${routeKey}`);
      }
    } catch (err) {
      const appError = toAppError(err);
      return { statusCode: appError.category === "VALIDATION" ? 400 : 500, body: appError.toJSON() };
    }
  })();

  return toApiGatewayResult(response);
}
