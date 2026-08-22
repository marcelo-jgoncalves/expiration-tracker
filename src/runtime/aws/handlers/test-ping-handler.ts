/** Real handler for GET /test/ping (M1 exit-criterion route), replacing the 501 placeholder.
 * Comment-only touch (2026-08-22) deliberately forces a new published version, to generate
 * a real second deploy manifest and exercise rollback.yml end-to-end against dev (rollback
 * design entrega 1's own acceptance criterion - see NEXT_SESSION_PROMPT.md). No behavior
 * change. */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { handleTestRoute } from "../../../modules/identity/http/test-route-handler.js";
import { extractClaims, toApiGatewayResult } from "../http-adapter.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  // m5-observability-design.md #2: API Gateway (HTTP API) - event.requestContext.requestId
  // is the ambient log correlationId; the pure business correlationId (ulid, below) that
  // flows into DomainEvent.correlationId is unrelated and stays exactly as before.
  return runWithContext({ correlationId: event.requestContext.requestId }, async () => {
    const claims = extractClaims(event);
    const response = await handleTestRoute(
      { resolver, quota },
      { requestId: event.requestContext.requestId, correlationId: ulid(), claims },
    );
    return toApiGatewayResult(response);
  });
}
