/** Real handler for GET /test/ping (M1 exit-criterion route), replacing the 501 placeholder. */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { handleTestRoute } from "../../../modules/identity/http/test-route-handler.js";
import { extractClaims, toApiGatewayResult } from "../http-adapter.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = extractClaims(event);
  const response = await handleTestRoute(
    { resolver, quota },
    { requestId: event.requestContext.requestId, correlationId: ulid(), claims },
  );
  return toApiGatewayResult(response);
}
