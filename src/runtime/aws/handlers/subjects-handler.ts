/** Handler real para /subjects* e /subjects/{subjectId}/requirements* (M9). Mesmo padrão de items-handler.ts. */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildSubjectDeps, buildDocumentRequestDeps } from "../composition/subject.js";
import {
  handleCreateSubject,
  handleGetSubject,
  handleUpdateSubject,
  handleArchiveSubject,
  handleDeleteSubject,
  handleListSubjects,
  type SubjectHttpDeps,
} from "../../../modules/subject/http/subject-handlers.js";
import {
  handleAssignRequirement,
  handleListRequirementAssignments,
  handleGetRequirementAssignment,
  handleUpdateRequirementAssignment,
  handleDeleteRequirementAssignment,
  handleLinkExpirationItem,
  handleUnlinkExpirationItem,
  type RequirementHttpDeps,
} from "../../../modules/subject/http/requirement-handlers.js";
import {
  handleCreateDocumentRequest,
  handleListDocumentRequests,
  handleGetDocumentRequest,
  handleRevokeDocumentRequest,
  handleGetDocumentRequestDeliveryPreference,
  handleUpdateDocumentRequestDeliveryPreference,
  type DocumentRequestHttpDeps,
} from "../../../modules/subject/http/document-request-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
// M10 (D-037): referência de Secrets Manager resolvida para env var pelo Terraform (SEC-006 -
// nunca segredo em claro no código); provisionamento real do secret fica no wiring de infra.
const guestTokenPepper = process.env["GUEST_TOKEN_PEPPER"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!guestTokenPepper) throw new Error("GUEST_TOKEN_PEPPER env var is required.");
// M10 cluster 4 (D-049): kill switch global do convite inicial automatizado - default `false`
// (env var/Terraform, nunca AppConfig - esse mecanismo só existe no design do M7, ainda não
// implementado). SES_FROM_ADDRESS/SES_CONFIGURATION_SET só são exigidos quando `true`.
const initialInviteEmailEnabled = process.env["DOCUMENT_REQUEST_INITIAL_INVITE_EMAIL_ENABLED"] === "true";
const sesFromAddress = process.env["SES_FROM_ADDRESS"];
const sesConfigurationSet = process.env["SES_CONFIGURATION_SET"];
const guestUploadBaseUrl = process.env["GUEST_UPLOAD_BASE_URL"];
if (initialInviteEmailEnabled && (!sesFromAddress || !sesConfigurationSet)) {
  throw new Error("SES_FROM_ADDRESS/SES_CONFIGURATION_SET env vars are required when DOCUMENT_REQUEST_INITIAL_INVITE_EMAIL_ENABLED=true.");
}
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { subjects, requirements } = buildSubjectDeps(client, tableName);
const { requests: documentRequests } = buildDocumentRequestDeps(client, tableName, guestTokenPepper, initialInviteEmailEnabled, sesFromAddress, sesConfigurationSet, guestUploadBaseUrl);
const deps: RequirementHttpDeps & SubjectHttpDeps & DocumentRequestHttpDeps = { resolver, quota, subjects, requirements, documentRequests };

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  return runWithContext({ correlationId: event.requestContext.requestId }, () => handleSubjectsRoute(event));
}

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

  const response = await (async () => {
    try {
      switch (routeKey) {
        case "POST /subjects":
          return await handleCreateSubject(deps, { ...base, body: parseBody(event) });
        case "GET /subjects/dashboard":
          return await handleListSubjects(deps, base);
        case "GET /subjects/{subjectId}":
          return await handleGetSubject(deps, base);
        case "PUT /subjects/{subjectId}":
          return await handleUpdateSubject(deps, { ...base, body: parseBody(event) });
        case "DELETE /subjects/{subjectId}":
          return await handleDeleteSubject(deps, base);
        case "POST /subjects/{subjectId}/archive":
          return await handleArchiveSubject(deps, base);
        case "POST /subjects/{subjectId}/requirements":
          return await handleAssignRequirement(deps, { ...base, body: parseBody(event) });
        case "GET /subjects/{subjectId}/requirements":
          return await handleListRequirementAssignments(deps, base);
        case "GET /subjects/{subjectId}/requirements/{assignmentId}":
          return await handleGetRequirementAssignment(deps, base);
        case "PUT /subjects/{subjectId}/requirements/{assignmentId}":
          return await handleUpdateRequirementAssignment(deps, { ...base, body: parseBody(event) });
        case "DELETE /subjects/{subjectId}/requirements/{assignmentId}":
          return await handleDeleteRequirementAssignment(deps, base);
        case "POST /subjects/{subjectId}/requirements/{assignmentId}/link":
          return await handleLinkExpirationItem(deps, { ...base, body: parseBody(event) });
        case "POST /subjects/{subjectId}/requirements/{assignmentId}/unlink":
          return await handleUnlinkExpirationItem(deps, base);
        case "POST /subjects/{subjectId}/requirements/{assignmentId}/document-requests":
          return await handleCreateDocumentRequest(deps, { ...base, body: parseBody(event) });
        case "GET /subjects/{subjectId}/requirements/{assignmentId}/document-requests":
          return await handleListDocumentRequests(deps, base);
        case "GET /subjects/{subjectId}/document-requests/{documentRequestId}":
          return await handleGetDocumentRequest(deps, base);
        case "POST /subjects/{subjectId}/document-requests/{documentRequestId}/revoke":
          return await handleRevokeDocumentRequest(deps, base);
        case "GET /subjects/document-request-delivery-preference":
          return await handleGetDocumentRequestDeliveryPreference(deps, base);
        case "PUT /subjects/document-request-delivery-preference":
          return await handleUpdateDocumentRequestDeliveryPreference(deps, { ...base, body: parseBody(event) });
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
