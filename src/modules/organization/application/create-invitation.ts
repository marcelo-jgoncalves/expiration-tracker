/**
 * CreateInvitationService — Wave B2B-8 (D-099, docs/architecture/multi-user-b2b-wave-b2b8-
 * scope.md). Implementação literal de `multi-user-b2b-physical-model.md` §7 (D-086): `Put
 * Invitation` (PENDING) + `Put InvitationTokenPointer` + `Put InvitationDedupPointer`
 * (`ConditionCheck attribute_not_exists` — se já existir um convite PENDING para (org, e-mail),
 * vira reenvio/rotação do convite existente, nunca um segundo `Invitation` PENDING) + audit.
 *
 * Convidar com `role: "OWNER"` exige `OWNER` chamador (achado corrigido na própria Rodada 1 do
 * debate de escopo, antes de qualquer crítica — mesma classe de decisão que `role-change`,
 * `change-membership-role.ts`) — `membership:invite` sozinho na matriz (`ADMIN_ROLES`) não seria
 * suficiente para bloquear um `ADMIN` convidando alguém já como `OWNER`.
 */
import { authorize } from "../../../modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../modules/identity/domain/request-context.js";
import { InternalError, OwnerTierChangeRequiresOwnerError } from "../../../shared/errors/app-error.js";
import type { TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { deriveInvitationMaintenanceDue, invitationDedupKey, invitationGsi8Keys, invitationKey, type Invitation, type InvitationDedupPointer } from "../domain/invitation.js";
import {
  INVITATION_TOKEN_TTL_SECONDS,
  epochSecondsFromIso,
  invitationTokenPointerKey,
  issueInvitationToken,
  type InvitationTokenPointer,
} from "../domain/invitation-token.js";
import { appendMembershipAuditToTransaction, buildMembershipAuditEvent } from "../domain/audit-event.js";
import type { MembershipRole } from "../domain/membership.js";
import { organizationKey, type Organization } from "../domain/organization.js";
import type { OrganizationStore } from "../ports/organization-store.js";
import type { OrganizationIdGenerator } from "./id-generator.js";
import type { MembershipInviteRateLimiter } from "./membership-invite-rate-limiter.js";
import type { EmailProviderAdapter } from "../../notification/ports/email-provider.js";

export interface CreateInvitationInput {
  email: string;
  role: MembershipRole;
}

export interface CreateInvitationResult {
  invitation: Invitation;
  /** Valor completo do token a ser embutido no link enviado por e-mail — nunca persistido bruto,
   * nunca logado. */
  token: string;
}

export class CreateInvitationService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly tableName: string,
    private readonly ids: OrganizationIdGenerator,
    private readonly rateLimiter: MembershipInviteRateLimiter,
    private readonly tokenPepper: string,
    private readonly now: () => string = () => new Date().toISOString(),
    /** Best-effort, optional (mesmo padrão de `document-request-service.ts`) - falha de SES
     * nunca desfaz a criação/rotação do convite já commitada; o token continua disponível no
     * retorno do método para fallback manual. `undefined` desliga o envio (ex. testes). */
    private readonly emailProvider?: EmailProviderAdapter,
    private readonly invitationBaseUrl?: string,
  ) {}

  private async sendInvitationEmail(ctx: RequestContext, invitation: Invitation, token: string): Promise<void> {
    if (!this.emailProvider || !this.invitationBaseUrl) return;
    const organization = await this.store.get<Organization>(organizationKey(ctx.tenant.tenantId));
    try {
      await this.emailProvider.send({
        to: invitation.emailNormalized,
        templateId: "organization-invitation",
        templateVersion: 1,
        locale: "pt-BR",
        renderContext: {
          organizationDisplayName: organization?.displayName,
          invitationLink: `${this.invitationBaseUrl}?token=${encodeURIComponent(token)}`,
        },
        tags: { attemptId: invitation.invitationId, intentId: invitation.invitationId, tenantId: ctx.tenant.tenantId, correlationId: ctx.correlationId },
      });
    } catch {
      // Best-effort - nunca falha a criação/rotação do convite por causa de uma falha de SES.
    }
  }

  async invite(ctx: RequestContext, input: CreateInvitationInput): Promise<CreateInvitationResult> {
    authorize({ context: ctx, action: "membership:invite", resource: { tenantId: ctx.tenant.tenantId } });
    if (input.role === "OWNER" && !ctx.tenant.roles.includes("OWNER")) {
      throw new OwnerTierChangeRequiresOwnerError("Only an OWNER can invite a new member directly as OWNER.");
    }

    const emailNormalized = input.email.trim().toLowerCase();
    await this.rateLimiter.consumeMembershipInvite(ctx.tenant.tenantId, emailNormalized);

    const existingDedup = await this.store.get<InvitationDedupPointer>(invitationDedupKey(ctx.tenant.tenantId, emailNormalized));
    if (existingDedup) {
      return this.resend(ctx, existingDedup);
    }

    const invitationId = this.ids.newInvitationId();
    const now = this.now();
    const expiresAt = new Date(Date.parse(now) + INVITATION_TOKEN_TTL_SECONDS * 1000).toISOString();
    const issued = issueInvitationToken(this.tokenPepper);
    // D-179 slice 2: the PENDING branch's due date is fully known at creation (expiresAt is set
    // right here, never later) - the GSI8 pointer is stamped now, not deferred to a later
    // transition that doesn't exist for this branch (see domain/invitation.ts's file comment).
    const due = deriveInvitationMaintenanceDue({ status: "PENDING", expiresAt });
    const gsi8Keys = invitationGsi8Keys({ dueAtIso: due!.dueAtIso, tenantId: ctx.tenant.tenantId, invitationId });

    const invitation: Invitation = {
      ...invitationKey(ctx.tenant.tenantId, invitationId),
      entityType: "Invitation",
      invitationId,
      organizationId: ctx.tenant.tenantId,
      emailNormalized,
      role: input.role,
      status: "PENDING",
      tokenPointerId: issued.selectorHash,
      expiresAt,
      createdBy: ctx.principal.userId,
      createdAt: now,
      version: 1,
      ...gsi8Keys,
    };

    const tokenPointer: InvitationTokenPointer = {
      ...invitationTokenPointerKey(issued.selectorHash),
      entityType: "InvitationTokenPointer",
      selectorHash: issued.selectorHash,
      secretHash: issued.secretHash,
      organizationId: ctx.tenant.tenantId,
      invitationId,
      expiresAt,
      purgeAfterTtl: epochSecondsFromIso(expiresAt),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const dedupPointer: InvitationDedupPointer = {
      ...invitationDedupKey(ctx.tenant.tenantId, emailNormalized),
      entityType: "InvitationDedupPointer",
      invitationId,
      organizationId: ctx.tenant.tenantId,
      emailNormalized,
      expiresAt,
    };

    const entries: TransactWriteEntry[] = [
      { Put: { TableName: this.tableName, Item: invitation as unknown as Record<string, unknown>, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      { Put: { TableName: this.tableName, Item: tokenPointer as unknown as Record<string, unknown>, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
      { Put: { TableName: this.tableName, Item: dedupPointer as unknown as Record<string, unknown>, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ];
    appendMembershipAuditToTransaction(
      entries,
      this.tableName,
      buildMembershipAuditEvent({
        auditEventId: this.ids.newAuditEventId(),
        organizationId: ctx.tenant.tenantId,
        resourceType: "Invitation",
        resourceId: invitationId,
        action: "INVITATION_CREATED",
        actor: { type: "USER", userId: ctx.principal.userId },
        newVersion: 1,
        changes: { emailNormalized, role: input.role },
        occurredAt: now,
        correlationId: ctx.correlationId,
      }),
    );

    await this.store.transactWrite(entries);
    await this.sendInvitationEmail(ctx, invitation, issued.token);
    return { invitation, token: issued.token };
  }

  /** Reenvio/rotação (mesmo padrão de `roadmap-evolution/13`): um convite PENDING já existe
   * para (org, e-mail) — em vez de um segundo `Invitation`, emite um NOVO token apontando para o
   * MESMO `invitationId`. O token antigo fica para expirar naturalmente (continua resolvendo
   * para o mesmo invitationId/role/e-mail — sem risco de segurança em deixá-lo alcançável até o
   * próprio TTL). */
  private async resend(ctx: RequestContext, dedup: InvitationDedupPointer): Promise<CreateInvitationResult> {
    const invitation = await this.store.get<Invitation>(invitationKey(ctx.tenant.tenantId, dedup.invitationId));
    if (!invitation) {
      throw new InternalError("InvitationDedupPointer references a missing Invitation.", { invitationId: dedup.invitationId });
    }

    const now = this.now();
    const expiresAt = new Date(Date.parse(now) + INVITATION_TOKEN_TTL_SECONDS * 1000).toISOString();
    const issued = issueInvitationToken(this.tokenPepper);
    // Rotation moves expiresAt forward - the GSI8 pointer's due date (expiresAt + retention) must
    // move with it, same reasoning as the initial Put in invite() above.
    const due = deriveInvitationMaintenanceDue({ status: "PENDING", expiresAt });
    const gsi8Keys = invitationGsi8Keys({ dueAtIso: due!.dueAtIso, tenantId: ctx.tenant.tenantId, invitationId: invitation.invitationId });

    const tokenPointer: InvitationTokenPointer = {
      ...invitationTokenPointerKey(issued.selectorHash),
      entityType: "InvitationTokenPointer",
      selectorHash: issued.selectorHash,
      secretHash: issued.secretHash,
      organizationId: ctx.tenant.tenantId,
      invitationId: invitation.invitationId,
      expiresAt,
      purgeAfterTtl: epochSecondsFromIso(expiresAt),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const entries: TransactWriteEntry[] = [
      {
        Update: {
          TableName: this.tableName,
          Key: invitationKey(ctx.tenant.tenantId, invitation.invitationId),
          UpdateExpression: "SET expiresAt = :expiresAt, tokenPointerId = :tokenPointerId, version = version + :one, GSI8PK = :gsi8pk, GSI8SK = :gsi8sk",
          ConditionExpression: "#status = :pending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":expiresAt": expiresAt,
            ":tokenPointerId": issued.selectorHash,
            ":one": 1,
            ":pending": "PENDING",
            ":gsi8pk": gsi8Keys.GSI8PK,
            ":gsi8sk": gsi8Keys.GSI8SK,
          },
        },
      },
      { Put: { TableName: this.tableName, Item: tokenPointer as unknown as Record<string, unknown>, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    ];
    appendMembershipAuditToTransaction(
      entries,
      this.tableName,
      buildMembershipAuditEvent({
        auditEventId: this.ids.newAuditEventId(),
        organizationId: ctx.tenant.tenantId,
        resourceType: "Invitation",
        resourceId: invitation.invitationId,
        action: "INVITATION_CREATED",
        actor: { type: "USER", userId: ctx.principal.userId },
        newVersion: invitation.version + 1,
        changes: { emailNormalized: invitation.emailNormalized, role: invitation.role, resent: true },
        occurredAt: now,
        correlationId: ctx.correlationId,
      }),
    );

    await this.store.transactWrite(entries);
    const updatedInvitation = { ...invitation, expiresAt, tokenPointerId: issued.selectorHash, version: invitation.version + 1 };
    await this.sendInvitationEmail(ctx, updatedInvitation, issued.token);
    return { invitation: updatedInvitation, token: issued.token };
  }
}
