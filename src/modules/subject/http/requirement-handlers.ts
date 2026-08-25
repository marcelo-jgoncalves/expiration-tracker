/** HTTP handlers para /subjects/{subjectId}/requirements* — reaproveita os helpers comuns
 * de subject-handlers.ts (mesmo pipeline resolve->authorize->service->AppError mapping). */
import { ValidationError } from "../../../shared/errors/app-error.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequirementService } from "../application/requirement-service.js";
import type { AssignRequirementInput, UpdateRequirementAssignmentInput } from "../domain/requirement-assignment.js";
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
  if (!valid) {
    throw new ValidationError("Request body failed schema validation.", { errors });
  }
}

const ASSIGN_REQUIREMENT_SCHEMA_ID = "https://expiration-tracker/schemas/api/assign-requirement-request.v1.json";
const UPDATE_REQUIREMENT_ASSIGNMENT_SCHEMA_ID = "https://expiration-tracker/schemas/api/update-requirement-assignment-request.v1.json";
const LINK_ITEM_SCHEMA_ID = "https://expiration-tracker/schemas/api/link-requirement-item-request.v1.json";

export interface RequirementHttpDeps extends SubjectHttpDeps {
  requirements: RequirementService;
}

function requireAssignmentId(req: HttpRequest): string {
  const assignmentId = req.pathParameters?.["assignmentId"];
  if (!assignmentId) throw new ValidationError("Missing assignmentId path parameter.");
  return assignmentId;
}

export async function handleAssignRequirement(deps: RequirementHttpDeps, req: HttpRequest<AssignRequirementInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(ASSIGN_REQUIREMENT_SCHEMA_ID, req.body);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await deps.quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
    const assignment = await deps.requirements.assignRequirement(context, subjectId, req.body);
    return { statusCode: 201, body: { assignment } };
  });
}

export async function handleListRequirementAssignments(deps: RequirementHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await deps.quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
    const assignments = await deps.requirements.listRequirementAssignments(context, subjectId);
    return { statusCode: 200, body: { assignments } };
  });
}

export async function handleGetRequirementAssignment(deps: RequirementHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const assignmentId = requireAssignmentId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await deps.quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
    const assignment = await deps.requirements.getRequirementAssignment(context, subjectId, assignmentId);
    return { statusCode: 200, body: { assignment } };
  });
}

export async function handleUpdateRequirementAssignment(
  deps: RequirementHttpDeps,
  req: HttpRequest<UpdateRequirementAssignmentInput>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const assignmentId = requireAssignmentId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(UPDATE_REQUIREMENT_ASSIGNMENT_SCHEMA_ID, req.body);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await deps.quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
    const assignment = await deps.requirements.updateRequirementAssignment(context, subjectId, assignmentId, req.body, expectedVersion);
    return { statusCode: 200, body: { assignment } };
  });
}

export async function handleDeleteRequirementAssignment(deps: RequirementHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const assignmentId = requireAssignmentId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await deps.quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
    await deps.requirements.deleteRequirementAssignment(context, subjectId, assignmentId, expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

export async function handleLinkExpirationItem(deps: RequirementHttpDeps, req: HttpRequest<{ itemId: string }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const assignmentId = requireAssignmentId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(LINK_ITEM_SCHEMA_ID, req.body);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await deps.quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
    const assignment = await deps.requirements.linkExpirationItem(context, subjectId, assignmentId, req.body.itemId, expectedVersion);
    return { statusCode: 200, body: { assignment } };
  });
}

export async function handleUnlinkExpirationItem(deps: RequirementHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const assignmentId = requireAssignmentId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await deps.quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
    const assignment = await deps.requirements.unlinkExpirationItem(context, subjectId, assignmentId, expectedVersion);
    return { statusCode: 200, body: { assignment } };
  });
}

function requireSubmissionId(req: HttpRequest): string {
  const submissionId = req.pathParameters?.["submissionId"];
  if (!submissionId) throw new ValidationError("Missing submissionId path parameter.");
  return submissionId;
}

/** BLOCKER-A (segunda metade): GET /subjects/{subjectId}/requirements/{assignmentId}/submissions. */
export async function handleListDocumentSubmissions(deps: RequirementHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const assignmentId = requireAssignmentId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await deps.quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
    const submissions = await deps.requirements.listDocumentSubmissions(context, subjectId, assignmentId);
    return { statusCode: 200, body: { submissions } };
  });
}

/** BLOCKER-A (segunda metade): GET /subjects/{subjectId}/requirements/{assignmentId}/submissions/{submissionId}. */
export async function handleGetDocumentSubmission(deps: RequirementHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const assignmentId = requireAssignmentId(req);
    const submissionId = requireSubmissionId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await deps.quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
    const submission = await deps.requirements.getDocumentSubmission(context, subjectId, assignmentId, submissionId);
    return { statusCode: 200, body: { ...submission } };
  });
}
