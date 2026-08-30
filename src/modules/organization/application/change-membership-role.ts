/**
 * ChangeMembershipRoleService — Wave B2B-8 (D-099). Autorização em 2 camadas (achado de
 * pesquisa, Slack "Owners assign Owners... [and] assign Admins"): a matriz (`ADMIN_ROLES`)
 * decide quem pode sequer tentar `membership:role-change`; uma checagem de serviço nomeada
 * (`OwnerTierChangeRequiresOwnerError`) exige `OWNER` chamador quando a transição ENVOLVE o tier
 * `OWNER` (promover para OWNER, ou mudar o role de uma Membership hoje OWNER) — nenhuma fonte
 * pesquisada mostra um ADMIN tocando o tier OWNER.
 *
 * Last-owner protection: reaproveita `buildOwnerCountDeltaEntry` (mesmo builder de
 * `RemoveMembershipService`/`LeaveOrganizationService`) — decrementar de OWNER ACTIVE para
 * outro role é bloqueado atomicamente se essa Membership for a última OWNER ACTIVE.
 */
import { authorize } from "../../../modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../modules/identity/domain/request-context.js";
import { getCancellationReasonCodes, isTransactionCanceled, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { LastOwnerError, NotFoundError, OwnerTierChangeRequiresOwnerError } from "../../../shared/errors/app-error.js";
import { membershipKey, type Membership, type MembershipRole } from "../domain/membership.js";
import { appendMembershipAuditToTransaction, buildMembershipAuditEvent } from "../domain/audit-event.js";
import { buildOwnerCountDeltaEntry } from "./owner-count-guard.js";
import type { OrganizationStore } from "../ports/organization-store.js";
import type { OrganizationIdGenerator } from "./id-generator.js";

export class ChangeMembershipRoleService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly tableName: string,
    private readonly ids: OrganizationIdGenerator,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async changeRole(ctx: RequestContext, targetUserId: string, newRole: MembershipRole, expectedVersion: number): Promise<void> {
    authorize({ context: ctx, action: "membership:role-change", resource: { tenantId: ctx.tenant.tenantId } });

    const target = await this.store.get<Membership>(membershipKey(ctx.tenant.tenantId, targetUserId));
    if (!target || target.status !== "ACTIVE") {
      throw new NotFoundError("No active membership for this user.", { targetUserId });
    }

    const involvesOwnerTier = target.role === "OWNER" || newRole === "OWNER";
    if (involvesOwnerTier && !ctx.tenant.roles.includes("OWNER")) {
      throw new OwnerTierChangeRequiresOwnerError();
    }

    const wasActiveOwner = target.role === "OWNER";
    const willBeActiveOwner = newRole === "OWNER";
    const ownerCountEntry = buildOwnerCountDeltaEntry(this.tableName, ctx.tenant.tenantId, wasActiveOwner, willBeActiveOwner);

    const now = this.now();
    const entries: TransactWriteEntry[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: membershipKey(ctx.tenant.tenantId, targetUserId),
          UpdateExpression: "SET role = :newRole, version = version + :one",
          ConditionExpression: "#status = :active AND version = :expectedVersion",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":newRole": newRole, ":active": "ACTIVE", ":one": 1, ":expectedVersion": expectedVersion },
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
        action: "ROLE_CHANGED",
        actor: { type: "USER", userId: ctx.principal.userId },
        previousVersion: expectedVersion,
        newVersion: expectedVersion + 1,
        changes: { fromRole: target.role, toRole: newRole, targetUserId },
        occurredAt: now,
        correlationId: ctx.correlationId,
      }),
    );

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const reasons = getCancellationReasonCodes(err);
        // Índice 1 é o entry de ownerCount SE presente (índice 0 é sempre a Membership) - nunca
        // colapsa "a transação cancelou" em "a condição que EU esperava falhou" sem checar o
        // índice específico (Codex Rodada 1 achado 6/D-095 achado 2.2, mesma disciplina).
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
