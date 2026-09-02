/**
 * RevokeInvitationService — Wave B2B-8 (D-099). `Update Invitation` (PENDING→REVOKED) + `Delete
 * InvitationDedupPointer` (libera o (org, e-mail) para um convite novo) + audit, na mesma
 * transação.
 */
import { authorize } from "../../../modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../modules/identity/domain/request-context.js";
import { NotFoundError } from "../../../shared/errors/app-error.js";
import { isTransactionCanceled, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { deriveInvitationMaintenanceDue, invitationDedupKey, invitationGsi8Keys, invitationKey, type Invitation } from "../domain/invitation.js";
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
    // D-179 slice 2: REVOKED is a real transition (unlike PENDING's creation-time write) -
    // overwrite the pointer atomically in the SAME Update as the status flip, moving the due
    // date from the original expiresAt-based one to revokedAt + retention (revocation can make a
    // row eligible sooner than its natural PENDING expiry would have).
    const due = deriveInvitationMaintenanceDue({ status: "REVOKED", revokedAt: now, expiresAt: invitation.expiresAt });
    const gsi8Keys = invitationGsi8Keys({ dueAtIso: due!.dueAtIso, tenantId: ctx.tenant.tenantId, invitationId });
    const entries: TransactWriteEntry[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: invitationKey(ctx.tenant.tenantId, invitationId),
          UpdateExpression: "SET #status = :revoked, revokedAt = :now, GSI8PK = :gsi8pk, GSI8SK = :gsi8sk",
          ConditionExpression: "#status = :pending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":revoked": "REVOKED",
            ":pending": "PENDING",
            ":now": now,
            ":gsi8pk": gsi8Keys.GSI8PK,
            ":gsi8sk": gsi8Keys.GSI8SK,
          },
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
