/**
 * RevokeInvitationService — Wave B2B-8 (D-099). `Update Invitation` (PENDING→REVOKED) + `Delete
 * InvitationDedupPointer` (libera o (org, e-mail) para um convite novo) + audit, na mesma
 * transação.
 */
import { authorize } from "../../../modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../modules/identity/domain/request-context.js";
import { NotFoundError } from "../../../shared/errors/app-error.js";
import { isTransactionCanceled, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { invitationDedupKey, invitationKey, type Invitation } from "../domain/invitation.js";
import { appendMembershipAuditToTransaction, buildMembershipAuditEvent } from "../domain/audit-event.js";
import type { OrganizationStore } from "../ports/organization-store.js";
import type { OrganizationIdGenerator } from "./id-generator.js";

export class RevokeInvitationService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly tableName: string,
    private readonly ids: OrganizationIdGenerator,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async revoke(ctx: RequestContext, invitationId: string): Promise<void> {
    authorize({ context: ctx, action: "membership:revoke-invitation", resource: { tenantId: ctx.tenant.tenantId } });

    const invitation = await this.store.get<Invitation>(invitationKey(ctx.tenant.tenantId, invitationId));
    if (!invitation || invitation.status !== "PENDING") {
      throw new NotFoundError("No pending invitation with this id.", { invitationId });
    }

    const now = this.now();
    const entries: TransactWriteEntry[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: invitationKey(ctx.tenant.tenantId, invitationId),
          UpdateExpression: "SET #status = :revoked, revokedAt = :now",
          ConditionExpression: "#status = :pending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":revoked": "REVOKED", ":pending": "PENDING", ":now": now },
        },
      },
      { Delete: { TableName: this.tableName, Key: invitationDedupKey(ctx.tenant.tenantId, invitation.emailNormalized) } },
    ];
    appendMembershipAuditToTransaction(
      entries,
      this.tableName,
      buildMembershipAuditEvent({
        auditEventId: this.ids.newAuditEventId(),
        organizationId: ctx.tenant.tenantId,
        resourceType: "Invitation",
        resourceId: invitationId,
        action: "INVITATION_REVOKED",
        actor: { type: "USER", userId: ctx.principal.userId },
        newVersion: invitation.version + 1,
        changes: { emailNormalized: invitation.emailNormalized },
        occurredAt: now,
        correlationId: ctx.correlationId,
      }),
    );

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        // Corrida real: o convite foi aceito/revogado entre a leitura acima e o commit - trata
        // como "já não está mais pendente", nunca um erro genérico de infraestrutura.
        throw new NotFoundError("No pending invitation with this id.", { invitationId });
      }
      throw err;
    }
  }
}
