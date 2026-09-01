/** Composition root for the organization module's membership-management surface (Wave B2B-8,
 * D-099) against real DynamoDB. */
import { QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AssignedActiveItemsLookup } from "../../../modules/organization/ports/assigned-active-items-lookup.js";
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
import { CloseOrganizationService } from "../../../modules/organization/application/close-organization.js";
import { CancelOrganizationClosureService, type ConsistentKeyValueReader } from "../../../modules/organization/application/cancel-organization-closure.js";
import { DynamoDbSystemMutationStore, DynamoDbTenantLifecycleReader } from "../../../shared/dynamodb/tenant-purge-scan.js";
import { buildTenantPurgeExecutionStarter, buildTenantPurgeExecutionStopper, createSfnPurgeClient } from "./tenant-purge.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
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
/** D-122/D-125 (Responsibility Reassignment on Member Removal): a THIN adapter directly against
 * the shared main table's GSI1 (`TENANT#t#ITEMSTATUS#ACTIVE`, `infra/modules/dynamo-table/
 * main.tf`, `projection_type = ALL`) - the same structural pattern as `expiration.ts`'s
 * `buildMemberEligibilityChecker`, but the reverse module direction: this is the FIRST time
 * `organization` reads data owned by `expiration` (ExpirationItem), never a direct import of
 * `expiration`'s domain/persistence internals, only this GSI1 read against the physical table
 * both entities already share. GSI1 is NOT in `security-audit.ts`'s restricted-index taxonomy
 * (only GSI3/GSI6 require the `security.global_index_access` audit event and IAM-scoped access -
 * GSI1 is the general-purpose dashboard index, already broadly readable), so no new audit event
 * is emitted here.
 *
 * Pagination contract (Round-3 Correção 2, `responsibility-reassignment-scoping/
 * round-3-claude-proposal.md`): pages the ACTIVE partition to exhaustion (`LastEvaluatedKey`
 * until `undefined`), applying `FilterExpression: assigneeUserId = :userId` to each page -
 * NEVER a DynamoDB `Query` `Limit` as a truncation proxy (that bounds items evaluated BEFORE the
 * filter, not items surviving it, and would produce false negatives). The 20-item cap applies
 * only to the returned `itemIds`, computed AFTER the true total is counted. */
export function buildAssignedActiveItemsLookup(client: DynamoDBDocumentClient, tableName: string): AssignedActiveItemsLookup {
  const RETURN_CAP = 20;
  return {
    async findAssignedActiveItems(organizationId: string, userId: string) {
      const itemIds: string[] = [];
      let totalKnown = 0;
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const result = await client.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: "GSI1",
            KeyConditionExpression: "GSI1PK = :pk",
            FilterExpression: "assigneeUserId = :userId",
            ExpressionAttributeValues: { ":pk": `TENANT#${organizationId}#ITEMSTATUS#ACTIVE`, ":userId": userId },
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        for (const item of (result.Items ?? []) as Array<{ itemId: string }>) {
          totalKnown += 1;
          if (itemIds.length < RETURN_CAP) itemIds.push(item.itemId);
        }
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return { itemIds, totalKnown, truncated: totalKnown > itemIds.length };
    },
  };
}

export function buildMembershipDeps(
  client: DynamoDBDocumentClient,
  tableName: string,
  invitationTokenPepper: string,
  membershipInviteEmailEnabled = false,
  sesFromAddress?: string,
  sesConfigurationSet?: string,
  invitationBaseUrl?: string,
  /** W3-07 (D-124): the tenant-purge state machine ARN. Optional so every existing caller and test
   * keeps working unchanged; when absent, `closeOrganization` is simply not built and the route is
   * unreachable rather than silently starting nothing. */
  tenantPurgeStateMachineArn?: string,
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
  const assignedItems = buildAssignedActiveItemsLookup(client, tableName);
  const removeMembership = new RemoveMembershipService(organizations, tableName, ids, assignedItems);
  const leaveOrganization = new LeaveOrganizationService(organizations, tableName, ids, assignedItems);
  const updateSettings = new UpdateOrganizationSettingsService(organizations, tableName);
  const closeOrganization = tenantPurgeStateMachineArn
    ? new CloseOrganizationService(
        new DynamoDbSystemMutationStore(client),
        new DynamoDbTenantLifecycleReader(client, tableName),
        buildTenantPurgeExecutionStarter(createSfnPurgeClient(), tenantPurgeStateMachineArn),
        tableName,
      )
    : undefined;
  // D-127: only needs a plain ConsistentRead GetItem against the same main table — deliberately
  // not the full OrganizationStore/IdentityStore surface (see cancel-organization-closure.ts's
  // ConsistentKeyValueReader doc comment for why this is its own narrow port).
  const consistentReader: ConsistentKeyValueReader = {
    get: async (key) => {
      const result = await client.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
      return result.Item as never;
    },
  };
  const cancelOrganizationClosure = new CancelOrganizationClosureService(
    consistentReader,
    new DynamoDbTenantLifecycleReader(client, tableName),
    new DynamoDbSystemMutationStore(client),
    buildTenantPurgeExecutionStopper(createSfnPurgeClient()),
    tableName,
  );
  return {
    createInvitation,
    revokeInvitation,
    acceptInvitation,
    listMembers,
    listInvitations,
    changeRole,
    removeMembership,
    leaveOrganization,
    updateSettings,
    closeOrganization,
    cancelOrganizationClosure,
  };
}
