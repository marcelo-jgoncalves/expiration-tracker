/** Handler real para /organizations/members* e /organizations/invitations* (Wave B2B-8, D-099).
 * Mesmo padrão de subjects-handler.ts. */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildMembershipDeps } from "../composition/organization.js";
import { buildIdentityDeps } from "../composition/identity.js";
import {
  handleCreateInvitation,
  handleRevokeInvitation,
  handleListMembers,
  handleListInvitations,
  handleChangeMembershipRole,
  handleRemoveMembership,
  handleLeaveOrganization,
  type MembershipHttpDeps,
} from "../../../modules/organization/http/membership-handlers.js";
import { handleUpdateOrganizationSettings, type OrganizationSettingsHttpDeps } from "../../../modules/organization/http/organization-settings-handlers.js";
import { handleCloseOrganization, handleCancelOrganizationClosure, type OrganizationLifecycleHttpDeps } from "../../../modules/organization/http/organization-lifecycle-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
// Wave B2B-8 (D-099): reaproveita o mesmo secret de GUEST_TOKEN_PEPPER (subject module, D-037)
// - ver composition/organization.ts para a justificativa completa da reutilização.
const invitationTokenPepper = process.env["GUEST_TOKEN_PEPPER"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!invitationTokenPepper) throw new Error("GUEST_TOKEN_PEPPER env var is required.");

// Wave B2B-14 (D-120): kill switch + SES config, same pattern as subjects-handler.ts's
// DOCUMENT_REQUEST_INITIAL_INVITE_EMAIL_ENABLED - absent/false env values default the
// composition root's own params, never a required env var (email stays off unless explicitly
// enabled).
const membershipInviteEmailEnabled = process.env["MEMBERSHIP_INVITE_EMAIL_ENABLED"] === "true";
const sesFromAddress = process.env["SES_FROM_ADDRESS"];
const sesConfigurationSet = process.env["SES_CONFIGURATION_SET"];
const invitationBaseUrl = process.env["INVITATION_BASE_URL"];
// W3-07 (D-124): required for POST /organizations/close. Absent means the closure route returns a
// 500 rather than silently pretending to have started a purge - see the dispatch below.
const tenantPurgeStateMachineArn = process.env["TENANT_PURGE_STATE_MACHINE_ARN"];

const { resolver } = buildIdentityDeps(client, tableName);
const membership = buildMembershipDeps(client, tableName, invitationTokenPepper, membershipInviteEmailEnabled, sesFromAddress, sesConfigurationSet, invitationBaseUrl, tenantPurgeStateMachineArn);
const deps: MembershipHttpDeps = { resolver, ...membership };
const settingsDeps: OrganizationSettingsHttpDeps = { resolver, updateSettings: membership.updateSettings };
const lifecycleDeps: OrganizationLifecycleHttpDeps | undefined = membership.closeOrganization
  ? { resolver, closeOrganization: membership.closeOrganization, cancelOrganizationClosure: membership.cancelOrganizationClosure }
  : undefined;

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  return runWithContext({ correlationId: event.requestContext.requestId }, () => handleMembershipsRoute(event));
}

async function handleMembershipsRoute(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
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
        case "POST /organizations/members/invite":
          return await handleCreateInvitation(deps, { ...base, body: parseBody(event) });
        case "POST /organizations/invitations/{invitationId}/revoke":
          return await handleRevokeInvitation(deps, base);
        case "GET /organizations/members":
          return await handleListMembers(deps, base);
        case "GET /organizations/invitations":
          return await handleListInvitations(deps, base);
        case "PUT /organizations/members/{userId}/role":
          return await handleChangeMembershipRole(deps, { ...base, body: parseBody(event) });
        case "DELETE /organizations/members/{userId}":
          return await handleRemoveMembership(deps, base);
        case "POST /organizations/members/leave":
          return await handleLeaveOrganization(deps, base);
        case "PATCH /organizations/settings":
          return await handleUpdateOrganizationSettings(settingsDeps, { ...base, body: parseBody(event) });
        case "POST /organizations/close":
          if (!lifecycleDeps) throw new Error("TENANT_PURGE_STATE_MACHINE_ARN env var is required to close an organization.");
          return await handleCloseOrganization(lifecycleDeps, { ...base, body: parseBody(event) });
        case "POST /organizations/cancel-close":
          if (!lifecycleDeps) throw new Error("TENANT_PURGE_STATE_MACHINE_ARN env var is required to cancel an organization closure.");
          return await handleCancelOrganizationClosure(lifecycleDeps, { ...base, body: parseBody(event) });
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
