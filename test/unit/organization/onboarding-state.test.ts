import { describe, expect, it } from "vitest";
import { OnboardingStateResolver } from "../../../src/modules/organization/application/onboarding-state.js";
import { membershipGsi4Keys, membershipKey, type Membership, type MembershipStatus } from "../../../src/modules/organization/domain/membership.js";
import { tenantLifecycleKey, TENANT_ACTIVE_STATUS, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { EntityKey, Gsi4QueryInput, OrganizationStore, TransactWriteEntry } from "../../../src/modules/organization/ports/organization-store.js";
import { InMemoryOrganizationStore } from "./in-memory-store.js";

function makeMembership(organizationId: string, userId: string, status: MembershipStatus): Membership {
  return {
    ...membershipKey(organizationId, userId),
    entityType: "Membership",
    membershipId: `mem-${organizationId}-${userId}`,
    organizationId,
    userId,
    role: "MEMBER",
    status,
    joinedAt: "2026-08-30T00:00:00.000Z",
    createdBy: userId,
    version: 1,
    ...membershipGsi4Keys(userId, organizationId, `mem-${organizationId}-${userId}`),
  };
}

function makeLegacyLifecycle(tenantId: string): TenantLifecycleRecord {
  return {
    ...tenantLifecycleKey(tenantId),
    SK: "LIFECYCLE",
    entityType: "TenantLifecycleRecord",
    tenantId,
    status: TENANT_ACTIVE_STATUS,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    version: 1,
  };
}

/**
 * Fake que deliberadamente faz o GSI4 divergir da partição base — o único jeito de provar por
 * teste que o resolver hidrata (re-lê via `membershipKey()`) em vez de confiar direto na
 * projeção do GSI4 (physical model §6). `InMemoryOrganizationStore` compartilha o mesmo mapa
 * para `get`/`queryGsi4`, então não consegue expressar essa divergência.
 */
class StaleGsi4Store implements OrganizationStore {
  constructor(
    private readonly gsi4Rows: Membership[],
    private readonly baseRows: Map<string, Membership>,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    return this.baseRows.get(`${key.PK}#${key.SK}`) as T | undefined;
  }

  async queryGsi4<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi4QueryInput): Promise<T[]> {
    return this.gsi4Rows.filter((row) => row.GSI4PK === input.gsi4pk) as unknown as T[];
  }

  async putIfAbsent(): Promise<boolean> {
    throw new Error("StaleGsi4Store: putIfAbsent not needed by this test");
  }

  async transactWrite(_entries: TransactWriteEntry[]): Promise<void> {
    throw new Error("StaleGsi4Store: transactWrite not needed by this test");
  }

  async queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(): Promise<T[]> {
    throw new Error("StaleGsi4Store: queryByPk not needed by this test");
  }
}

// G-V3 (test-engineering-standard.md, aplicado desde a escrita per docs/engineering/
// definition-of-done.md E-013): cada `it()` abaixo tem, em comentário, pelo menos uma
// mutação concreta no código real que faria a asserção falhar.
describe("OnboardingStateResolver", () => {
  // Mutação: inverter a ordem dos dois `if` (checar SUSPENDED antes de ACTIVE) ainda passaria
  // este teste sozinho, mas o próximo (precedência com ambos presentes) pegaria a inversão -
  // este teste cobre o caso isolado mais simples do passo 1 do procedimento.
  it("classifies HAS_USABLE_MEMBERSHIP when an ACTIVE Membership exists", async () => {
    const store = new InMemoryOrganizationStore();
    const membership = makeMembership("org-1", "user-1", "ACTIVE");
    await store.putIfAbsent(membership);

    const resolver = new OnboardingStateResolver(store);
    expect(await resolver.resolve("user-1")).toBe("HAS_USABLE_MEMBERSHIP");
  });

  // Mutação: usar `memberships.every(...)` em vez de `.some(...)` para o check de ACTIVE (ou
  // fazer o passo 1 parar no primeiro Membership da lista em vez de olhar todos) faria este
  // caso — ACTIVE numa org, SUSPENDED em outra — cair incorretamente para SUSPENDED_ONLY,
  // contradizendo o passo 1 do procedimento ("incondicional, vence mesmo com outras
  // SUSPENDED/REMOVED presentes").
  it("HAS_USABLE_MEMBERSHIP wins even when other SUSPENDED and REMOVED memberships exist for the same user", async () => {
    const store = new InMemoryOrganizationStore();
    await store.putIfAbsent(makeMembership("org-active", "user-1", "ACTIVE"));
    await store.putIfAbsent(makeMembership("org-suspended", "user-1", "SUSPENDED"));
    await store.putIfAbsent(makeMembership("org-removed", "user-1", "REMOVED"));

    const resolver = new OnboardingStateResolver(store);
    expect(await resolver.resolve("user-1")).toBe("HAS_USABLE_MEMBERSHIP");
  });

  // Mutação: remover o passo 2 inteiro (não checar SUSPENDED antes de cair para
  // legado/NO_TENANT) faria este caso pular direto para LEGACY_TENANT_ONLY/NO_TENANT, nunca
  // retornando SUSPENDED_ONLY mesmo sem nenhuma Membership ACTIVE.
  it("classifies SUSPENDED_ONLY when no ACTIVE Membership exists but a SUSPENDED one does", async () => {
    const store = new InMemoryOrganizationStore();
    await store.putIfAbsent(makeMembership("org-1", "user-1", "SUSPENDED"));

    const resolver = new OnboardingStateResolver(store);
    expect(await resolver.resolve("user-1")).toBe("SUSPENDED_ONLY");
  });

  // Mutação: agrupar REMOVED junto de SUSPENDED no mesmo `.some(...)` (o erro real introduzido
  // e depois corrigido na Rodada 3 do debate de escopo) faria este caso retornar SUSPENDED_ONLY
  // em vez de LEGACY_TENANT_ONLY, mesmo sem nenhuma Membership SUSPENDED real.
  it("ignores a REMOVED-only Membership and falls through to LEGACY_TENANT_ONLY when the legacy tenant record exists", async () => {
    const store = new InMemoryOrganizationStore();
    await store.putIfAbsent(makeMembership("org-1", "user-1", "REMOVED"));
    await store.putIfAbsent(makeLegacyLifecycle("user-1"));

    const resolver = new OnboardingStateResolver(store);
    expect(await resolver.resolve("user-1")).toBe("LEGACY_TENANT_ONLY");
  });

  // Mutação: trocar `tenantLifecycleKey(userId)` por `tenantLifecycleKey(membership.organizationId)`
  // (checar o tenant legado errado) faria este teste falhar, já que o único registro de
  // lifecycle existente pertence a `userId`, não a nenhuma organizationId de Membership.
  it("classifies LEGACY_TENANT_ONLY when no usable Membership exists at all, only the legacy TenantLifecycleRecord", async () => {
    const store = new InMemoryOrganizationStore();
    await store.putIfAbsent(makeLegacyLifecycle("user-1"));

    const resolver = new OnboardingStateResolver(store);
    expect(await resolver.resolve("user-1")).toBe("LEGACY_TENANT_ONLY");
  });

  // Mutação: retornar `"LEGACY_TENANT_ONLY"` como fallback padrão em vez de
  // `"NO_TENANT_NO_MEMBERSHIP"` quando `legacy` for `undefined` faria este teste (fixture
  // sintético sem nenhum Membership e sem TenantLifecycleRecord) falhar.
  it("classifies NO_TENANT_NO_MEMBERSHIP when neither a usable Membership nor a legacy tenant record exists (synthetic fixture, only reachable for real post-B2B-5)", async () => {
    const store = new InMemoryOrganizationStore();

    const resolver = new OnboardingStateResolver(store);
    expect(await resolver.resolve("user-1")).toBe("NO_TENANT_NO_MEMBERSHIP");
  });

  // Mutação: ler `pointer.status` direto do resultado de `queryGsi4()` em vez de re-buscar via
  // `store.get(membershipKey(...))` faria este teste retornar HAS_USABLE_MEMBERSHIP (o status
  // ACTIVE "stale" que o GSI4 ainda mostra), quando o status real e atual na partição base já é
  // REMOVED — exatamente a leitura de autorização via GSI4 que o physical model §6 proíbe.
  it("hydrates against the base partition instead of trusting the GSI4 projection's status directly", async () => {
    const staleGsi4Row = makeMembership("org-1", "user-1", "ACTIVE");
    const trueBaseRow = makeMembership("org-1", "user-1", "REMOVED");
    const baseRows = new Map<string, Membership>([[`${trueBaseRow.PK}#${trueBaseRow.SK}`, trueBaseRow]]);
    const store = new StaleGsi4Store([staleGsi4Row], baseRows);

    const resolver = new OnboardingStateResolver(store);
    expect(await resolver.resolve("user-1")).toBe("NO_TENANT_NO_MEMBERSHIP");
  });
});
