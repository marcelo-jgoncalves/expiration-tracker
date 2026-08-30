/**
 * HTTP handlers for Wave B2B-8 (Invitations/Team, D-099) membership-management routes —
 * mirrors `expiration/http/item-handlers.ts`'s pipeline (resolve -> service, which internally
 * calls `authorize()`) and its AppError -> status-code mapping, so every route in the system
 * fails the same way. `AcceptInvitation` is NOT here — it is identity-only (no tenant yet,
 * same class as `POST /bff/organizations`, D-096), wired in `bff/http/bff-handlers.ts` instead.
 */
import { AppError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { AuthorizationError } from "../../../shared/errors/app-error.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { CreateInvitationInput, CreateInvitationService } from "../application/create-invitation.js";
import type { RevokeInvitationService } from "../application/revoke-invitation.js";
import type { ListMembersService, ListInvitationsService } from "../application/list-membership.js";
import type { ChangeMembershipRoleService } from "../application/change-membership-role.js";
import type { RemoveMembershipService } from "../application/remove-membership.js";
import type { LeaveOrganizationService } from "../application/leave-organization.js";
import type { MembershipRole } from "../domain/membership.js";

export interface HttpRequest<TBody = unknown> {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: TBody;
}

export interface HttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface MembershipHttpDeps {
  resolver: RequestContextResolver;
  createInvitation: CreateInvitationService;
  revokeInvitation: RevokeInvitationService;
  listMembers: ListMembersService;
  listInvitations: ListInvitationsService;
  changeRole: ChangeMembershipRoleService;
  removeMembership: RemoveMembershipService;
  leaveOrganization: LeaveOrganizationService;
}

const STATUS_BY_CATEGORY: Record<string, number> = {
  VALIDATION: 400,
  AUTH: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  BUSINESS_RULE: 422,
  INTERNAL: 500,
};

function toResponse(appError: AppError): HttpResponse {
  const status = STATUS_BY_CATEGORY[appError.category] ?? 500;
  return { statusCode: status, body: appError.toJSON() };
}

async function withErrorMapping(fn: () => Promise<HttpResponse>): Promise<HttpResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthorizationDeniedError) {
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      return toResponse(new AuthorizationError(err.message, { reason: err.reason }));
    }
    const appError = err instanceof AppError ? err : toAppError(err);
    return toResponse(appError);
  }
}

function requireUserIdParam(req: HttpRequest): string {
  const userId = req.pathParameters?.["userId"];
  if (!userId) throw new ValidationError("Missing userId path parameter.");
  return userId;
}

function requireInvitationIdParam(req: HttpRequest): string {
  const invitationId = req.pathParameters?.["invitationId"];
  if (!invitationId) throw new ValidationError("Missing invitationId path parameter.");
  return invitationId;
}

function requireExpectedVersion(req: HttpRequest): number {
  const raw = req.headers?.["if-match"] ?? req.queryStringParameters?.["expectedVersion"];
  const version = Number(raw);
  if (!raw || Number.isNaN(version) || !Number.isInteger(version) || version < 1) {
    throw new ValidationError("Missing or invalid expected version (If-Match header).");
  }
  return version;
}

const CREATE_INVITATION_SCHEMA_ID = "https://expiration-tracker/schemas/api/create-invitation-request.v1.json";
const CHANGE_MEMBERSHIP_ROLE_SCHEMA_ID = "https://expiration-tracker/schemas/api/change-membership-role-request.v1.json";

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) throw new ValidationError("Request body failed schema validation.", { errors });
}

export async function handleCreateInvitation(deps: MembershipHttpDeps, req: HttpRequest<CreateInvitationInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CREATE_INVITATION_SCHEMA_ID, req.body);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    const { invitation } = await deps.createInvitation.invite(context, req.body);
    // O token bruto NUNCA volta na resposta HTTP - só é entregue pelo canal de e-mail (achado
    // real: o response de criação de convite não é o mesmo canal que prova posse do link).
    return { statusCode: 201, body: { invitation: { invitationId: invitation.invitationId, emailNormalized: invitation.emailNormalized, role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt } } };
  });
}

export async function handleRevokeInvitation(deps: MembershipHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const invitationId = requireInvitationIdParam(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await deps.revokeInvitation.revoke(context, invitationId);
    return { statusCode: 204, body: {} };
  });
}

export async function handleListMembers(deps: MembershipHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    const members = await deps.listMembers.listMembers(context);
    // Wave B2B-14 (D-120): real finding - this used to return the raw Membership item
    // (PK/SK/GSI4PK/GSI4SK/entityType, internal DynamoDB key structure) straight to the client,
    // unlike handleListInvitations' sibling below which already projects to a safe subset.
    // Never found until a real browser session actually inspected the response body.
    return { statusCode: 200, body: { members: members.map((m) => ({ userId: m.userId, role: m.role, status: m.status, version: m.version })) } };
  });
}

export async function handleListInvitations(deps: MembershipHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    const invitations = await deps.listInvitations.listInvitations(context);
    // Nunca inclui `tokenPointerId` (referencia o token de posse) na resposta HTTP.
    return { statusCode: 200, body: { invitations: invitations.map((i) => ({ invitationId: i.invitationId, emailNormalized: i.emailNormalized, role: i.role, status: i.status, expiresAt: i.expiresAt })) } };
  });
}

export async function handleChangeMembershipRole(deps: MembershipHttpDeps, req: HttpRequest<{ role: MembershipRole }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const targetUserId = requireUserIdParam(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CHANGE_MEMBERSHIP_ROLE_SCHEMA_ID, req.body);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await deps.changeRole.changeRole(context, targetUserId, req.body.role, expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

export async function handleRemoveMembership(deps: MembershipHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const targetUserId = requireUserIdParam(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await deps.removeMembership.remove(context, targetUserId, expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

export async function handleLeaveOrganization(deps: MembershipHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await deps.leaveOrganization.leave(context);
    return { statusCode: 204, body: {} };
  });
}
