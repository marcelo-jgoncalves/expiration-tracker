/** Handler real para /subjects* (TrackedSubject CRUD). ADR-0016 Decision A retired every
 * RequirementAssignment/DocumentRequest(subject)/guest-upload route this handler used to also
 * serve — see document-archive-handler.ts for their M10+ replacements (Requirement/
 * DocumentRequest/series). Mesmo padrão de items-handler.ts. */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildSubjectDeps } from "../composition/subject.js";
import {
  handleCreateSubject,
  handleGetSubject,
  handleUpdateSubject,
  handleArchiveSubject,
  handleDeleteSubject,
  handleListSubjects,
  handleSearchSubjects,
  type SubjectHttpDeps,
} from "../../../modules/subject/http/subject-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { timeSpan, withHandlerTiming } from "../../../shared/observability/handler-timing.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { subjects } = buildSubjectDeps(client, tableName);
const deps: SubjectHttpDeps = { resolver, quota, subjects };

const NAMESPACE = "ExpirationTracker/Subjects";

export const handler = withHandlerTiming<APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2>(
  NAMESPACE,
  "subjects handler",
  (event) => runWithContext({ correlationId: event.requestContext.requestId }, () => handleSubjectsRoute(event)),
);

async function handleSubjectsRoute(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = extractClaims(event);
  const base = {
    requestId: event.requestContext.requestId,
    correlationId: ulid(),
    claims,
    pathParameters: event.pathParameters,
    queryStringParameters: event.queryStringParameters,
    headers: event.headers,
  };
  const routeKey = event.routeKey;

  // PERF-02 slice 2: see items-handler.ts's identical comment - business_operation_ms covers
  // the whole dispatch (RequestContext resolve+quota+business), not business logic alone.
  const response = await timeSpan(NAMESPACE, "lambda.business_operation_ms", "subjects business operation timing", async () => (async () => {
    try {
      switch (routeKey) {
        case "POST /subjects":
          return await handleCreateSubject(deps, { ...base, body: parseBody(event) });
        case "GET /subjects/dashboard":
          return await handleListSubjects(deps, base);
        // D-194 Fatia 3 (search/filters) - literal segment, routed before "GET /subjects/{subjectId}".
        case "GET /subjects/search":
          return await handleSearchSubjects(deps, base);
        case "GET /subjects/{subjectId}":
          return await handleGetSubject(deps, base);
        case "PUT /subjects/{subjectId}":
          return await handleUpdateSubject(deps, { ...base, body: parseBody(event) });
        case "DELETE /subjects/{subjectId}":
          return await handleDeleteSubject(deps, base);
        case "POST /subjects/{subjectId}/archive":
          return await handleArchiveSubject(deps, base);
        default:
          throw new ValidationError(`Unknown route: ${routeKey}`);
      }
    } catch (err) {
      const appError = toAppError(err);
      return { statusCode: appError.category === "VALIDATION" ? 400 : 500, body: appError.toJSON() };
    }
  })());

  return toApiGatewayResult(response);
}
