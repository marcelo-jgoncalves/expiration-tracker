/**
 * RemoveMembershipService — Wave B2B-8 (D-099). `membership:remove` (`ADMIN_ROLES` baseline) +
 * checagem de serviço nomeada para o tier OWNER (só `OWNER` remove uma `Membership` `OWNER`,
 * achado de pesquisa Slack) + last-owner protection (mesmo builder de `ChangeMembershipRoleService`).
 * Remoção é soft (`status: REMOVED`, nunca hard-delete — mesmo padrão de retenção/auditoria de
 * `Membership`, `domain/membership.ts`).
 *
 * D-122/D-125 (Responsibility Reassignment on Member Removal): before the removal transaction, a
 * best-effort (never atomic - Round-3 "Estado final consolidado") precondition checks whether
 * `targetUserId` is still `assigneeUserId` of any `ACTIVE` `ExpirationItem` in the organization
 * (`AssignedActiveItemsLookup`) and throws `ResponsibilityReassignmentRequiredError` instead of
 * proceeding. Runs AFTER the owner-tier check (an authorization-shaped question - can THIS
 * caller remove THIS target at all - is answered before a business-rule question about the
 * target's own state) but BEFORE the transaction (which still separately enforces LastOwnerError
 * atomically) - a target can legitimately trip both checks; responsibility reassignment surfaces
 * first because it is resolvable by the caller without any role change, so it is the more
 * actionable failure to see first.
 */
import { authorize } from "../../../modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../modules/identity/domain/request-context.js";
import { getCancellationReasonCodes, isTransactionCanceled, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { LastOwnerError, NotFoundError, OwnerTierChangeRequiresOwnerError, ResponsibilityReassignmentRequiredError } from "../../../shared/errors/app-error.js";
import { membershipKey, type Membership } from "../domain/membership.js";
import { appendMembershipAuditToTransaction, buildMembershipAuditEvent } from "../domain/audit-event.js";
import { buildOwnerCountDeltaEntry } from "./owner-count-guard.js";
import type { OrganizationStore } from "../ports/organization-store.js";
import type { AssignedActiveItemsLookup } from "../ports/assigned-active-items-lookup.js";
import type { OrganizationIdGenerator } from "./id-generator.js";

export class RemoveMembershipService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly tableName: string,
    private readonly ids: OrganizationIdGenerator,
    private readonly assignedItems: AssignedActiveItemsLookup,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async remove(ctx: RequestContext, targetUserId: string, expectedVersion: number): Promise<void> {
    authorize({ context: ctx, action: "membership:remove", resource: { tenantId: ctx.tenant.tenantId } });

    const target = await this.store.get<Membership>(membershipKey(ctx.tenant.tenantId, targetUserId));
    if (!target || target.status !== "ACTIVE") {
      throw new NotFoundError("No active membership for this user.", { targetUserId });
    }

    if (target.role === "OWNER" && !ctx.tenant.roles.includes("OWNER")) {
      throw new OwnerTierChangeRequiresOwnerError("Only an OWNER can remove another OWNER.");
    }

    const assigned = await this.assignedItems.findAssignedActiveItems(ctx.tenant.tenantId, targetUserId);
    if (assigned.itemIds.length > 0) {
      throw new ResponsibilityReassignmentRequiredError({ targetUserId, ...assigned });
    }

    const ownerCountEntry = buildOwnerCountDeltaEntry(this.tableName, ctx.tenant.tenantId, target.role === "OWNER", false);

    const now = this.now();
    const entries: TransactWriteEntry[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: membershipKey(ctx.tenant.tenantId, targetUserId),
          UpdateExpression: "SET #status = :removed, version = version + :one",
          ConditionExpression: "#status = :active AND version = :expectedVersion",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":removed": "REMOVED", ":active": "ACTIVE", ":one": 1, ":expectedVersion": expectedVersion },
        },
      },
    ];
    if (ownerCountEntry) entries.push(ownerCountEntry);
    appendMembershipAuditToTransaction(
      entries,
      this.tableName,
      buildMembershipAuditEvent({
        auditEventId: this.ids.newAuditEventId(),
        organizationId: ctx.tenant.tenantId,
        resourceType: "Membership",
        resourceId: target.membershipId,
        action: "MEMBER_REMOVED",
        actor: { type: "USER", userId: ctx.principal.userId },
        previousVersion: expectedVersion,
        newVersion: expectedVersion + 1,
        changes: { targetUserId, role: target.role },
        occurredAt: now,
        correlationId: ctx.correlationId,
      }),
    );

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const reasons = getCancellationReasonCodes(err);
        if (ownerCountEntry && reasons?.[1] === "ConditionalCheckFailed") {
          throw new LastOwnerError();
        }
        if (reasons?.[0] === "ConditionalCheckFailed") {
          throw new NotFoundError("Membership was modified concurrently - reload and retry.", { targetUserId });
        }
      }
      throw err;
    }
  }
}
