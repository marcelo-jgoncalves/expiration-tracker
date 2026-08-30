/**
 * ListMembersService / ListInvitationsService — Wave B2B-8 (D-099). Superfícies de leitura
 * separadas por sensibilidade (achado real da Rodada 1 do Codex, docs/architecture/reviews/
 * multi-user-b2b-wave-b2b8-scoping/round-1-codex-critique.md): membros ativos são
 * `membership:list-members` (READ_ONLY_ROLES, qualquer papel real); convites pendentes carregam
 * e-mail + intenção, são `membership:list-invitations` (ADMIN_ROLES). Reaproveitam
 * `queryByPk` já existente — nenhuma porta nova.
 */
import { authorize } from "../../../modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../modules/identity/domain/request-context.js";
import { organizationKey } from "../domain/organization.js";
import type { Membership } from "../domain/membership.js";
import type { Invitation } from "../domain/invitation.js";
import type { OrganizationStore } from "../ports/organization-store.js";

export class ListMembersService {
  constructor(private readonly store: OrganizationStore) {}

  async listMembers(ctx: RequestContext): Promise<Membership[]> {
    authorize({ context: ctx, action: "membership:list-members", resource: { tenantId: ctx.tenant.tenantId } });
    const { PK } = organizationKey(ctx.tenant.tenantId);
    return this.store.queryByPk<Membership>(PK, "MEMBER#");
  }
}

export class ListInvitationsService {
  constructor(private readonly store: OrganizationStore) {}

  async listInvitations(ctx: RequestContext): Promise<Invitation[]> {
    authorize({ context: ctx, action: "membership:list-invitations", resource: { tenantId: ctx.tenant.tenantId } });
    const { PK } = organizationKey(ctx.tenant.tenantId);
    return this.store.queryByPk<Invitation>(PK, "INVITATION#");
  }
}
