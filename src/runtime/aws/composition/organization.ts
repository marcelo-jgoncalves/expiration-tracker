/** Composition root for the organization module's membership-management surface (Wave B2B-8,
 * D-099) against real DynamoDB. */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbOrganizationStore } from "../../../modules/organization/persistence/dynamodb-organization-store.js";
import { CreateInvitationService } from "../../../modules/organization/application/create-invitation.js";
import { RevokeInvitationService } from "../../../modules/organization/application/revoke-invitation.js";
import { AcceptInvitationService } from "../../../modules/organization/application/accept-invitation.js";
import { MembershipInviteRateLimiter } from "../../../modules/organization/application/membership-invite-rate-limiter.js";
import { ListMembersService, ListInvitationsService } from "../../../modules/organization/application/list-membership.js";
import { ChangeMembershipRoleService } from "../../../modules/organization/application/change-membership-role.js";
import { RemoveMembershipService } from "../../../modules/organization/application/remove-membership.js";
import { LeaveOrganizationService } from "../../../modules/organization/application/leave-organization.js";
import { UpdateOrganizationSettingsService } from "../../../modules/organization/application/update-organization-settings.js";
import { UlidIdGenerator } from "../ids.js";
import { SesEmailAdapter, createSesClient } from "../../../modules/notification/providers/ses-email-adapter.js";

/** `invitationTokenPepper` reuses the SAME secret as `GUEST_TOKEN_PEPPER` (subject module,
 * D-037) - a deliberate judgment call (level 3-4, reuse of an already-approved secret-
 * management mechanism, not a new Type 1 security decision): `InvitationTokenPointer` lives in
 * a structurally distinct key namespace (`INVITATION_TOKEN#`, never `GUESTTOKEN#`), so sharing
 * the pepper creates no cross-family confusion, and provisioning a brand new Terraform secret
 * for one more HMAC pepper would be disproportionate (`principles.md` #1).
 *
 * Wave B2B-14 (D-120): `membershipInviteEmailEnabled`/`sesFromAddress`/`sesConfigurationSet`/
 * `invitationBaseUrl` mirror `subject.ts`'s `buildDocumentRequestDeps` exactly - same kill-switch
 * pattern (D-049), same `SesEmailAdapter`, no new provider. The token itself never leaves this
 * process except via the e-mail this builds (`create-invitation.ts`'s HTTP handler still never
 * returns it in the response body - that boundary is unchanged by this wave). */
export function buildMembershipDeps(
  client: DynamoDBDocumentClient,
  tableName: string,
  invitationTokenPepper: string,
  membershipInviteEmailEnabled = false,
  sesFromAddress?: string,
  sesConfigurationSet?: string,
  invitationBaseUrl?: string,
) {
  const organizations = new DynamoDbOrganizationStore(client, tableName);
  const ids = new UlidIdGenerator();
  const rateLimiter = new MembershipInviteRateLimiter(organizations);
  const emailProvider =
    membershipInviteEmailEnabled && sesFromAddress && sesConfigurationSet ? new SesEmailAdapter(createSesClient(), sesFromAddress, sesConfigurationSet) : undefined;
  const createInvitation = new CreateInvitationService(organizations, tableName, ids, rateLimiter, invitationTokenPepper, undefined, emailProvider, invitationBaseUrl);
  const revokeInvitation = new RevokeInvitationService(organizations, tableName, ids);
  const acceptInvitation = new AcceptInvitationService(organizations, tableName, ids, invitationTokenPepper);
  const listMembers = new ListMembersService(organizations);
  const listInvitations = new ListInvitationsService(organizations);
  const changeRole = new ChangeMembershipRoleService(organizations, tableName, ids);
  const removeMembership = new RemoveMembershipService(organizations, tableName, ids);
  const leaveOrganization = new LeaveOrganizationService(organizations, tableName, ids);
  const updateSettings = new UpdateOrganizationSettingsService(organizations, tableName);
  return { createInvitation, revokeInvitation, acceptInvitation, listMembers, listInvitations, changeRole, removeMembership, leaveOrganization, updateSettings };
}
