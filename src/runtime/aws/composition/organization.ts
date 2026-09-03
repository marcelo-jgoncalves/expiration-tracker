/** Composition root for the organization module's membership-management surface (Wave B2B-8,
 * D-099) against real DynamoDB. */
import { QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AssignedActiveItemsLookup, AssignedActiveItemsResult } from "../../../modules/organization/ports/assigned-active-items-lookup.js";
import type { AssignedActiveRequirementsLookup, AssignedActiveRequirementsResult } from "../../../modules/organization/ports/assigned-active-requirements-lookup.js";
import { ServiceUnavailableError } from "../../../shared/errors/app-error.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
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
/** Observability-only accumulator (D-194 Fatia 2) - mutated in place by the raw lookup
 * implementations below, read AFTER the call (success or failure) by
 * `withReassignmentTimeoutAndLogging`'s SecureLogger event. Deliberately not part of either
 * port's declared interface (an implementation detail of THIS composition root's own logging, an
 * in-memory test double for either port has no reason to populate it) - both raw builders accept
 * it as an optional trailing parameter, so every existing call site (including
 * `assigned-active-items-lookup.test.ts`, which never passes one) keeps working unchanged. */
export interface ReassignmentLookupStats {
  pagesEvaluated: number;
  consumedCapacityUnits: number;
}

export function buildAssignedActiveItemsLookup(client: DynamoDBDocumentClient, tableName: string): AssignedActiveItemsLookup {
  const RETURN_CAP = 20;
  return {
    async findAssignedActiveItems(organizationId: string, userId: string, stats?: ReassignmentLookupStats) {
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
            ReturnConsumedCapacity: "TOTAL",
          }),
        );
        for (const item of (result.Items ?? []) as Array<{ itemId: string }>) {
          totalKnown += 1;
          if (itemIds.length < RETURN_CAP) itemIds.push(item.itemId);
        }
        if (stats) {
          stats.pagesEvaluated += 1;
          stats.consumedCapacityUnits += result.ConsumedCapacity?.CapacityUnits ?? 0;
        }
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return { itemIds, totalKnown, truncated: totalKnown > itemIds.length };
    },
  };
}

/** D-194 Fatia 2 (`docs/architecture/reviews/search-and-filters-scoping/estado-final-consolidado.md`
 * §"Responsável"): sibling adapter to `buildAssignedActiveItemsLookup` above, against
 * `document-archive`'s Requirement GSI1 namespace (`TENANT#t#REQSTATUS#<status>`) rather than
 * `expiration`'s ExpirationItem one - the FIRST time `organization` reads Requirement data,
 * permitted only here at the composition root (never `organization/application`, which stays
 * unreachable from `document-archive` per `.dependency-cruiser.cjs`).
 *
 * Queries all 4 non-terminal/non-NOT_APPLICABLE statuses (`MISSING`/`PENDING`/`SATISFIED`/
 * `NOT_SATISFIED`) IN PARALLEL (`Promise.all`), each paged to exhaustion independently - same
 * "never use `Limit` as a truncation proxy" discipline as the ExpirationItem sibling. The 20-item
 * `requirementIds` cap and `totalKnownRequirements`/`truncatedRequirements` are computed AFTER
 * merging every status partition's true count, never per-partition. */
export function buildAssignedActiveRequirementsLookup(client: DynamoDBDocumentClient, tableName: string): AssignedActiveRequirementsLookup {
  const RETURN_CAP = 20;
  const STATUSES = ["MISSING", "PENDING", "SATISFIED", "NOT_SATISFIED"] as const;
  return {
    async findAssignedActiveRequirements(organizationId: string, userId: string, stats?: ReassignmentLookupStats) {
      const perStatus = await Promise.all(
        STATUSES.map(async (status) => {
          const ids: string[] = [];
          let count = 0;
          let exclusiveStartKey: Record<string, unknown> | undefined;
          do {
            const result = await client.send(
              new QueryCommand({
                TableName: tableName,
                IndexName: "GSI1",
                KeyConditionExpression: "GSI1PK = :pk",
                FilterExpression: "assigneeUserId = :userId",
                ExpressionAttributeValues: { ":pk": `TENANT#${organizationId}#REQSTATUS#${status}`, ":userId": userId },
                ExclusiveStartKey: exclusiveStartKey,
                ReturnConsumedCapacity: "TOTAL",
              }),
            );
            for (const item of (result.Items ?? []) as Array<{ requirementId: string }>) {
              count += 1;
              ids.push(item.requirementId);
            }
            if (stats) {
              stats.pagesEvaluated += 1;
              stats.consumedCapacityUnits += result.ConsumedCapacity?.CapacityUnits ?? 0;
            }
            exclusiveStartKey = result.LastEvaluatedKey;
          } while (exclusiveStartKey);
          return { ids, count };
        }),
      );
      let totalKnownRequirements = 0;
      const requirementIds: string[] = [];
      for (const { ids, count } of perStatus) {
        totalKnownRequirements += count;
        for (const id of ids) {
          if (requirementIds.length < RETURN_CAP) requirementIds.push(id);
        }
      }
      return { requirementIds, totalKnownRequirements, truncatedRequirements: totalKnownRequirements > requirementIds.length };
    },
  };
}

/** D-194 Fatia 2: fixed 5s time budget for the COMBINED reassignment-lookup call
 * (`RemoveMembershipService`/`LeaveOrganizationService` running `assignedItems`+
 * `assignedRequirements` in `Promise.all`) - wraps each of the two ports independently at this
 * exact deadline so the pair, run in parallel by the service, still resolves (or fails) within
 * ~5s total, never ~10s. Fail-CLOSED: a timeout throws `ServiceUnavailableError` (retryable),
 * never resolves with an empty/optimistic result - an undiscovered real assignment must never be
 * silently treated as "nothing to reassign".
 *
 * Observability: a SecureLogger event of its own (`membership.reassignment_lookup.*`) - never
 * `security-audit.ts` (that module's taxonomy is closed to authorization/restricted-GSI events,
 * GSI1 is neither). `ALLOWED`/`BLOCKED` reflect whether THIS lookup call found any assigned
 * work (not the final cross-port decision, made by the caller after both resolve);
 * `TIMEOUT`/`ERROR` cover the two failure paths. */
export function withReassignmentTimeoutAndLogging<TResult extends { totalKnown?: number; totalKnownRequirements?: number }>(
  fn: (organizationId: string, userId: string, stats?: ReassignmentLookupStats) => Promise<TResult>,
  opts: { entity: "ExpirationItem" | "Requirement"; timeoutMs: number; logger: SecureLogger },
): (organizationId: string, userId: string) => Promise<TResult> {
  return async (organizationId, userId) => {
    const start = Date.now();
    // Mutated in place by `fn` as it pages - read here regardless of the success/timeout/error
    // branch below, since the underlying Query calls that already completed before a timeout
    // still consumed real capacity worth logging.
    const stats: ReassignmentLookupStats = { pagesEvaluated: 0, consumedCapacityUnits: 0 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new ServiceUnavailableError(`Reassignment lookup for ${opts.entity} did not complete within ${opts.timeoutMs}ms.`, {
            entity: opts.entity,
            organizationId,
            userId,
          }),
        );
      }, opts.timeoutMs);
    });
    try {
      const result = await Promise.race([fn(organizationId, userId, stats), timeoutPromise]);
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const evaluated = result.totalKnown ?? result.totalKnownRequirements ?? 0;
      opts.logger.info(evaluated > 0 ? "membership.reassignment_lookup.BLOCKED" : "membership.reassignment_lookup.ALLOWED", {
        entity: opts.entity,
        organizationId,
        userId,
        durationMs,
        itemsEvaluated: evaluated,
        pagesEvaluated: stats.pagesEvaluated,
        consumedCapacityUnits: stats.consumedCapacityUnits,
      });
      return result;
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (err instanceof ServiceUnavailableError) {
        opts.logger.error("membership.reassignment_lookup.TIMEOUT", {
          entity: opts.entity,
          organizationId,
          userId,
          durationMs,
          pagesEvaluated: stats.pagesEvaluated,
          consumedCapacityUnits: stats.consumedCapacityUnits,
        });
      } else {
        opts.logger.error("membership.reassignment_lookup.ERROR", {
          entity: opts.entity,
          organizationId,
          userId,
          durationMs,
          pagesEvaluated: stats.pagesEvaluated,
          consumedCapacityUnits: stats.consumedCapacityUnits,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  };
}

const REASSIGNMENT_LOOKUP_TIMEOUT_MS = 5000;

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
  // D-194 Fatia 2: each raw port is wrapped with its OWN 5s deadline + SecureLogger event -
  // RemoveMembershipService/LeaveOrganizationService then run both wrapped calls in `Promise.all`
  // (see those files), so the pair still bounds to ~5s total (parallel, not additive) while the
  // structured log lives here at the composition root, never inside the application services.
  const reassignmentLogger = new SecureLogger({ baseContext: { component: "membership-reassignment-lookup" } });
  const assignedItemsRaw = buildAssignedActiveItemsLookup(client, tableName);
  const assignedRequirementsRaw = buildAssignedActiveRequirementsLookup(client, tableName);
  const assignedItems: AssignedActiveItemsLookup = {
    findAssignedActiveItems: withReassignmentTimeoutAndLogging<AssignedActiveItemsResult>(assignedItemsRaw.findAssignedActiveItems.bind(assignedItemsRaw), {
      entity: "ExpirationItem",
      timeoutMs: REASSIGNMENT_LOOKUP_TIMEOUT_MS,
      logger: reassignmentLogger,
    }),
  };
  const assignedRequirements: AssignedActiveRequirementsLookup = {
    findAssignedActiveRequirements: withReassignmentTimeoutAndLogging<AssignedActiveRequirementsResult>(
      assignedRequirementsRaw.findAssignedActiveRequirements.bind(assignedRequirementsRaw),
      { entity: "Requirement", timeoutMs: REASSIGNMENT_LOOKUP_TIMEOUT_MS, logger: reassignmentLogger },
    ),
  };
  const removeMembership = new RemoveMembershipService(organizations, tableName, ids, assignedItems, assignedRequirements);
  const leaveOrganization = new LeaveOrganizationService(organizations, tableName, ids, assignedItems, assignedRequirements);
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
