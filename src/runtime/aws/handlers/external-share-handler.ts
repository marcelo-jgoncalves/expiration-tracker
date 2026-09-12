/**
 * Handler for GET /external-share/{shareId}/{token} (D-225 Decision 3/estado-final-consolidado)
 * — SEPARATE Lambda from every other document-archive surface, `authorization_type = NONE` (no
 * Cognito JWT authorizer), same isolation posture as `document-archive-guest-handler.ts`. Never
 * uses `APIGatewayProxyEventV2WithJWTAuthorizer`/`extractClaims` — there is no JWT on this route.
 * Own pepper pair (`DOCARCHIVE_SHARE_LINK_PEPPER`/`EXTERNAL_SHARE_IP_AUDIT_PEPPER`), never
 * `DOCARCHIVE_GUEST_ACCESS_PEPPER`/`GUEST_TOKEN_PEPPER` — distinct credential shape, distinct
 * blast radius (Decision 2/11).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildExternalShareAnonymousDeps } from "../composition/document-archive.js";
import { handleResolveExternalShare, type ExternalShareHttpDeps } from "../../../modules/document-archive/http/external-share-handlers.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const pepper = process.env["DOCARCHIVE_SHARE_LINK_PEPPER"];
if (!pepper) throw new Error("DOCARCHIVE_SHARE_LINK_PEPPER env var is required.");
const ipAuditPepper = process.env["EXTERNAL_SHARE_IP_AUDIT_PEPPER"];
if (!ipAuditPepper) throw new Error("EXTERNAL_SHARE_IP_AUDIT_PEPPER env var is required.");
const { shareLinks } = buildExternalShareAnonymousDeps(client, tableName, pepper, ipAuditPepper);
const deps: ExternalShareHttpDeps = { shareLinks };

function toApiGatewayResult(response: { statusCode: number; headers: Record<string, string>; body: Record<string, unknown> }): APIGatewayProxyStructuredResultV2 {
  return { statusCode: response.statusCode, headers: response.headers, body: JSON.stringify(response.body) };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  // correlationId never derives from visitor-supplied data (public route) - always generated here.
  return runWithContext({ correlationId: randomUUID() }, () => handleExternalShareRoute(event));
}

async function handleExternalShareRoute(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const routeKey = event.routeKey;
  const base = { pathParameters: event.pathParameters, sourceIp: event.requestContext.http.sourceIp };

  const response = await (async () => {
    try {
      switch (routeKey) {
        case "GET /external-share/{shareId}/{token}":
          return await handleResolveExternalShare(deps, base);
        default:
          throw new ValidationError(`Unknown route: ${routeKey}`);
      }
    } catch (err) {
      const appError = toAppError(err);
      return { statusCode: appError.category === "VALIDATION" ? 400 : 500, headers: { "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer" }, body: appError.toJSON() };
    }
  })();

  return toApiGatewayResult(response);
}
