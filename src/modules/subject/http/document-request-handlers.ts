/** HTTP handlers para /subjects/{subjectId}/requirements/{assignmentId}/document-requests*
 * (lado autenticado do tenant, M10, D-037). Mesmo pipeline de subject-handlers.ts. */
import { ValidationError } from "../../../shared/errors/app-error.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { DocumentRequestService } from "../application/document-request-service.js";
import type { CreateDocumentRequestInput } from "../domain/document-request.js";
import {
  withErrorMapping,
  requireSubjectId,
  requireExpectedVersion,
  type HttpRequest,
  type HttpResponse,
  type SubjectHttpDeps,
} from "./subject-handlers.js";

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) throw new ValidationError("Request body failed schema validation.", { errors });
}

const CREATE_DOCUMENT_REQUEST_SCHEMA_ID = "https://expiration-tracker/schemas/api/create-document-request-request.v1.json";

export interface DocumentRequestHttpDeps extends SubjectHttpDeps {
  documentRequests: DocumentRequestService;
}

function requireAssignmentId(req: HttpRequest): string {
  const assignmentId = req.pathParameters?.["assignmentId"];
  if (!assignmentId) throw new ValidationError("Missing assignmentId path parameter.");
  return assignmentId;
}

function requireDocumentRequestId(req: HttpRequest): string {
  const documentRequestId = req.pathParameters?.["documentRequestId"];
  if (!documentRequestId) throw new ValidationError("Missing documentRequestId path parameter.");
  return documentRequestId;
}

async function consumeQuota(deps: DocumentRequestHttpDeps, context: import("../../identity/domain/request-context.js").RequestContext): Promise<void> {
  await deps.quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
}

export async function handleCreateDocumentRequest(deps: DocumentRequestHttpDeps, req: HttpRequest<CreateDocumentRequestInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const assignmentId = requireAssignmentId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CREATE_DOCUMENT_REQUEST_SCHEMA_ID, req.body);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await consumeQuota(deps, context);
    const { request, guestToken } = await deps.documentRequests.createDocumentRequest(context, subjectId, assignmentId, req.body);
    // guestToken só é retornado nesta chamada - nunca reconstruível depois (só o hash persiste).
    return { statusCode: 201, body: { request, guestToken } };
  });
}

export async function handleListDocumentRequests(deps: DocumentRequestHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const assignmentId = requireAssignmentId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await consumeQuota(deps, context);
    const requests = await deps.documentRequests.listDocumentRequests(context, subjectId, assignmentId);
    return { statusCode: 200, body: { requests } };
  });
}

export async function handleGetDocumentRequest(deps: DocumentRequestHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const documentRequestId = requireDocumentRequestId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await consumeQuota(deps, context);
    const request = await deps.documentRequests.getDocumentRequest(context, subjectId, documentRequestId);
    return { statusCode: 200, body: { request } };
  });
}

export async function handleRevokeDocumentRequest(deps: DocumentRequestHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const documentRequestId = requireDocumentRequestId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await consumeQuota(deps, context);
    await deps.documentRequests.revokeDocumentRequest(context, subjectId, documentRequestId, expectedVersion);
    return { statusCode: 204, body: {} };
  });
}
