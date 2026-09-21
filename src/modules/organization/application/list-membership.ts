/**
 * ListMembersService / ListInvitationsService — Wave B2B-8 (D-099). Superfícies de leitura
 * separadas por sensibilidade (achado real da Rodada 1 do Codex, docs/architecture/reviews/
 * multi-user-b2b-wave-b2b8-scoping/round-1-codex-critique.md): membros ativos são
 * `membership:list-members` (READ_ONLY_ROLES, qualquer papel real); convites pendentes carregam
 * e-mail + intenção, são `membership:list-invitations` (ADMIN_ROLES). Reaproveitam
 * `queryByPk` já existente — nenhuma porta nova.
 */
import { authorize, authorizedTenantId } from "../../../modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../modules/identity/domain/request-context.js";
import { organizationKey } from "../domain/organization.js";
import type { Membership } from "../domain/membership.js";
import type { Invitation } from "../domain/invitation.js";
import type { OrganizationStore } from "../ports/organization-store.js";
import type { GlobalUserRepository } from "../../identity/persistence/global-user-repository.js";

/** #15 (2026-09-21): `Membership` enriched with the resolved `GlobalUser` profile, so screens
 * can show a name/email instead of a raw userId for `assigneeUserId`. `email`/`displayName` are
 * present ONLY when the member's global identity is ACTIVE (same rule
 * `notification/persistence/dynamodb-recipient-resolver.ts` already enforces before exposing
 * `GlobalUser` PII to anyone) - never leaked for a suspended identity, even to teammates. */
export interface MemberProfile extends Membership {
  email?: string;
  displayName?: string;
}

export class ListMembersService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly globalUsers: GlobalUserRepository,
  ) {}

  async listMembers(ctx: RequestContext): Promise<MemberProfile[]> {
    authorize({ context: ctx, action: "membership:list-members", resource: { tenantId: ctx.tenant.tenantId } });
    const { PK } = organizationKey(authorizedTenantId(ctx));
    const members = await this.store.queryByPk<Membership>(PK, "MEMBER#");
    return Promise.all(
      members.map(async (member) => {
        const user = await this.globalUsers.get(member.userId);
        const active = user?.identityStatus === "ACTIVE";
        return {
          ...member,
          email: active && user?.emailNormalized ? user.emailNormalized : undefined,
          displayName: active ? user?.displayName : undefined,
        };
      }),
    );
  }
}

export class ListInvitationsService {
  constructor(private readonly store: OrganizationStore) {}

  async listInvitations(ctx: RequestContext): Promise<Invitation[]> {
    authorize({ context: ctx, action: "membership:list-invitations", resource: { tenantId: ctx.tenant.tenantId } });
    const { PK } = organizationKey(authorizedTenantId(ctx));
    return this.store.queryByPk<Invitation>(PK, "INVITATION#");
  }
}
