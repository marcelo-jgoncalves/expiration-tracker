/**
 * IdentityBootstrapService — Multi-User B2B Wave B2B-5 (RequestContext Cutover, D-095,
 * docs/architecture/multi-user-b2b-physical-model.md §3 "bootstrapUser() — contrato único de
 * primeiro login", estado final). Renomeia `TenantBootstrapService`: a razão de manter esse
 * nome em B2B-2 (D-087 — "ainda cria TenantLifecycleRecord/UserProfile tenant-scoped junto
 * deste row") deixa de existir agora que `bootstrapUser()` não cria mais nenhum tenant.
 *
 * `TransactWriteItems` de **2 itens**, não mais 4: Put `GlobalUser` + Put `IdentityMapping`,
 * ambos condicionados a `attribute_not_exists(PK)`. Nenhuma `Organization`/`TenantLifecycleRecord`/
 * `UserProfile` criada aqui — autenticação deixa de equivaler a criar tenant (roadmap §110/§22).
 * Depois do bootstrap, `RequestContextResolver` decide o próximo passo via
 * `OnboardingStateResolver` (Wave B2B-4/D-094): zero `Membership` utilizável → onboarding
 * explícito; uma existe → resolve a `Organization` normalmente.
 *
 * Race/retry: duas primeiras autenticações concorrentes do mesmo `cognitoSub` disputam a mesma
 * transação de 2 itens — a perdedora recebe `TransactionCanceledException`
 * (`attribute_not_exists(PK)` falhou em pelo menos um dos itens), re-lê e resolve contra a
 * vencedora, sem erro — first-login continua seguro para retry, mesmo contrato que a versão
 * anterior já documentava, agora mais simples (sem fencing de `TenantLifecycleRecord`, que não
 * existe mais neste ponto do fluxo).
 */
import { InternalError } from "../../../shared/errors/app-error.js";
import { isTransactionCanceled, buildVersionedCreate, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import type { IdentityStore } from "../ports/identity-store.js";
import { identityMappingKey, type IdentityMapping } from "../persistence/identity-mapping-repository.js";
import { globalUserKey, type GlobalUser } from "../persistence/global-user-repository.js";

export interface BootstrapResult {
  mapping: IdentityMapping;
  user: GlobalUser;
}

export class IdentityBootstrapService {
  constructor(
    private readonly store: IdentityStore,
    private readonly tableName: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * `emailNormalized` is only used on first-login creation, and only by callers who actually
   * have a verified email at hand (BFF/OIDC login — `idClaims.email`). The direct-API path
   * (bearer JWT, no OIDC claims beyond `sub`) omits it, matching prior behavior
   * (`emailNormalized: ""`) exactly — same single bootstrap contract both real call sites share
   * since B2B-2 (D-087).
   */
  async bootstrapUser(cognitoSub: string, newUserId: string, emailNormalized = ""): Promise<BootstrapResult> {
    const existingMapping = await this.store.get<IdentityMapping>(identityMappingKey(cognitoSub));
    if (existingMapping) {
      const user = await this.store.get<GlobalUser>(globalUserKey(existingMapping.userId));
      if (!user) {
        throw new InternalError("GlobalUser missing for an existing IdentityMapping.", { userId: existingMapping.userId });
      }
      return { mapping: existingMapping, user };
    }
    return this.createAll(cognitoSub, newUserId, emailNormalized);
  }

  private async createAll(cognitoSub: string, newUserId: string, emailNormalized: string): Promise<BootstrapResult> {
    const now = this.now();
    const mapping: IdentityMapping = {
      ...identityMappingKey(cognitoSub),
      SK: "MAP",
      entityType: "IdentityMapping",
      cognitoSub,
      userId: newUserId,
      createdAt: now,
    };
    const user: GlobalUser = {
      ...globalUserKey(newUserId),
      SK: "PROFILE",
      entityType: "GlobalUser",
      userId: newUserId,
      emailNormalized,
      identityStatus: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(this.tableName, user as unknown as Record<string, unknown> & { PK: string; SK: string }) },
      { Put: buildVersionedCreate(this.tableName, mapping as unknown as Record<string, unknown> & { PK: string; SK: string }) },
    ];

    try {
      await this.store.transactWrite(entries);
      return { mapping, user };
    } catch (err) {
      if (!isTransactionCanceled(err)) throw err;
      // Lost the race: another concurrent first-login for the same cognitoSub committed its own
      // 2-item create between our get() and transactWrite(). Re-read and resolve against the
      // winner instead of erroring - first login must be safe to retry.
      const winnerMapping = await this.store.get<IdentityMapping>(identityMappingKey(cognitoSub));
      if (!winnerMapping) {
        throw new InternalError("IdentityMapping vanished after losing bootstrap race.", { cognitoSub });
      }
      const winnerUser = await this.store.get<GlobalUser>(globalUserKey(winnerMapping.userId));
      if (!winnerUser) {
        throw new InternalError("GlobalUser vanished after losing bootstrap race.", { userId: winnerMapping.userId });
      }
      return { mapping: winnerMapping, user: winnerUser };
    }
  }
}
