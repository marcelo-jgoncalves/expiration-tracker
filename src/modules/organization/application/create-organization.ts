/**
 * CreateOrganizationService — Wave B2B-3.3 (docs/architecture/multi-user-b2b-physical-model.md
 * §4). Transação atômica única: `Organization`+`Membership` OWNER+`TenantLifecycleRecord`+
 * `TenantEntitlement` defaults — `ownerCount=1` seedado atomicamente com a primeira
 * `Membership OWNER`, nunca calculado depois.
 *
 * `organizationId` (`org_<ulid>`) é gerado independente, nunca derivado de `creatorUserId`
 * (`user_<ulid>`) — os prefixos distintos garantem estruturalmente `userId != organizationId`
 * (physical model §15), não é coincidência de aleatoriedade do ULID.
 *
 * Não wireado a nenhum fluxo de login/onboarding ainda — capability isolada e endereçável,
 * consumida por Wave B2B-4 (Onboarding) quando existir. Sem lógica de corrida/retry como
 * `TenantBootstrapService`: cada chamada cria um recurso NOVO com ID fresco, não há múltiplos
 * chamadores concorrentes visando o MESMO recurso (diferente do bootstrap de identidade, onde
 * dois logins concorrentes podem mirar o mesmo `cognitoSub`) — se `attribute_not_exists(PK)`
 * falhar (colisão de ULID, astronomicamente improvável), o erro propaga sem tentativa de
 * convergência.
 *
 * Decremento de `ownerCount` (remoção/demote/suspensão de um OWNER, physical model §8) fica
 * fora do escopo desta wave — sem writer real de Membership além desta criação até Wave
 * B2B-7/B2B-8 existirem (nota de escopo registrada em
 * docs/architecture/multi-user-b2b-wave-tracker.md B2B-3).
 */
import { buildVersionedCreate, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { tenantLifecycleKey, TENANT_ACTIVE_STATUS, type TenantLifecycleRecord } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { defaultEntitlement } from "../../subject/domain/entitlement.js";
import { organizationKey, type Organization } from "../domain/organization.js";
import { membershipGsi4Keys, membershipKey, type Membership } from "../domain/membership.js";
import type { OrganizationStore } from "../ports/organization-store.js";
import type { OrganizationIdGenerator } from "./id-generator.js";

export interface CreateOrganizationInput {
  creatorUserId: string;
  displayName: string;
  timezone: string;
}

export interface CreateOrganizationResult {
  organization: Organization;
  membership: Membership;
}

export class CreateOrganizationService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly tableName: string,
    private readonly ids: OrganizationIdGenerator,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async createOrganization(input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
    const organizationId = this.ids.newOrganizationId();
    const membershipId = this.ids.newMembershipId();
    const now = this.now();

    const organization: Organization = {
      ...organizationKey(organizationId),
      entityType: "Organization",
      organizationId,
      displayName: input.displayName,
      timezone: input.timezone,
      ownerCount: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const membership: Membership = {
      ...membershipKey(organizationId, input.creatorUserId),
      entityType: "Membership",
      membershipId,
      organizationId,
      userId: input.creatorUserId,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: now,
      createdBy: input.creatorUserId,
      version: 1,
      ...membershipGsi4Keys(input.creatorUserId, organizationId, membershipId),
    };

    const lifecycle: TenantLifecycleRecord = {
      ...tenantLifecycleKey(organizationId),
      SK: "LIFECYCLE",
      entityType: "TenantLifecycleRecord",
      tenantId: organizationId,
      status: TENANT_ACTIVE_STATUS,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const entitlement = defaultEntitlement(organizationId, now);

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(this.tableName, organization as unknown as Record<string, unknown> & { PK: string; SK: string }) },
      { Put: buildVersionedCreate(this.tableName, membership as unknown as Record<string, unknown> & { PK: string; SK: string }) },
      { Put: buildVersionedCreate(this.tableName, lifecycle as unknown as Record<string, unknown> & { PK: string; SK: string }) },
      { Put: buildVersionedCreate(this.tableName, entitlement as unknown as Record<string, unknown> & { PK: string; SK: string }) },
    ];

    await this.store.transactWrite(entries);
    return { organization, membership };
  }
}
