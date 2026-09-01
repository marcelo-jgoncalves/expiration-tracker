/**
 * LeaveOrganizationService — Wave B2B-8 (D-099). `membership:leave` é self-service
 * (`READ_ONLY_ROLES` — qualquer papel real): `leave()` NÃO aceita nenhum `targetUserId` como
 * parâmetro, opera SEMPRE sobre `ctx.principal.userId` por assinatura — mais forte que uma
 * checagem de runtime "targetUserId === principal.userId" (não há como chamar errado, resposta
 * à pergunta 3 da Rodada 1/2 do debate de escopo, aceita pelo Codex). A proteção real contra
 * "o único OWNER sai" é o `LastOwnerError` transacional (mesmo builder de
 * `ChangeMembershipRoleService`/`RemoveMembershipService`), nunca uma permissão extra.
 *
 * D-122/D-125 (Responsibility Reassignment on Member Removal): same best-effort, non-atomic
 * precondition as `RemoveMembershipService.remove()` - before the removal transaction, checks
 * whether the leaving user is still `assigneeUserId` of any `ACTIVE` `ExpirationItem` and throws
 * `ResponsibilityReassignmentRequiredError` instead of proceeding. Runs before the transaction's
 * own atomic `LastOwnerError` guard, same ordering rationale as `remove-membership.ts`.
 */
import type { RequestContext } from "../../../modules/identity/domain/request-context.js";
import { getCancellationReasonCodes, isTransactionCanceled, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { LastOwnerError, NotFoundError, ResponsibilityReassignmentRequiredError } from "../../../shared/errors/app-error.js";
import { membershipKey, type Membership } from "../domain/membership.js";
import { appendMembershipAuditToTransaction, buildMembershipAuditEvent } from "../domain/audit-event.js";
import { buildOwnerCountDeltaEntry } from "./owner-count-guard.js";
import type { OrganizationStore } from "../ports/organization-store.js";
import type { AssignedActiveItemsLookup } from "../ports/assigned-active-items-lookup.js";
import type { OrganizationIdGenerator } from "./id-generator.js";

export class LeaveOrganizationService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly tableName: string,
    private readonly ids: OrganizationIdGenerator,
    private readonly assignedItems: AssignedActiveItemsLookup,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Sem `authorize()` explícito: `membership:leave` é `READ_ONLY_ROLES` (qualquer papel real já
   * passou pela resolução de `RequestContext`, que por si só exige uma Membership ACTIVE) - a
   * ação em si não distingue por role, só existe/não existe uma Membership própria para sair. */
  async leave(ctx: RequestContext): Promise<void> {
    const target = await this.store.get<Membership>(membershipKey(ctx.tenant.tenantId, ctx.principal.userId));
    if (!target || target.status !== "ACTIVE") {
      throw new NotFoundError("No active membership to leave.", {});
    }

    const assigned = await this.assignedItems.findAssignedActiveItems(ctx.tenant.tenantId, ctx.principal.userId);
    if (assigned.itemIds.length > 0) {
      throw new ResponsibilityReassignmentRequiredError({ targetUserId: ctx.principal.userId, ...assigned });
    }

    const ownerCountEntry = buildOwnerCountDeltaEntry(this.tableName, ctx.tenant.tenantId, target.role === "OWNER", false);

    const now = this.now();
    const entries: TransactWriteEntry[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: membershipKey(ctx.tenant.tenantId, ctx.principal.userId),
          UpdateExpression: "SET #status = :removed, removedAt = :now, version = version + :one",
          ConditionExpression: "#status = :active AND version = :expectedVersion",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":removed": "REMOVED", ":active": "ACTIVE", ":now": now, ":one": 1, ":expectedVersion": target.version },
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
        action: "MEMBER_LEFT",
        actor: { type: "USER", userId: ctx.principal.userId },
        previousVersion: target.version,
        newVersion: target.version + 1,
        changes: { role: target.role },
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
          throw new NotFoundError("Membership was modified concurrently - reload and retry.", {});
        }
      }
      throw err;
    }
  }
}
