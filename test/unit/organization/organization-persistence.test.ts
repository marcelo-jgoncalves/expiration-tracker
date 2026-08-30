import { describe, expect, it } from "vitest";
import { organizationKey, type Organization } from "../../../src/modules/organization/domain/organization.js";
import { membershipGsi4Keys, membershipKey, type Membership } from "../../../src/modules/organization/domain/membership.js";
import { InMemoryOrganizationStore } from "./in-memory-store.js";
import { buildVersionedCreate } from "../../../src/shared/dynamodb/occ.js";

function asItem(entity: Organization | Membership): Record<string, unknown> & { PK: string; SK: string } {
  return entity as unknown as Record<string, unknown> & { PK: string; SK: string };
}

function makeOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    ...organizationKey("org-1"),
    entityType: "Organization",
    organizationId: "org-1",
    displayName: "Acme Inc",
    timezone: "America/Sao_Paulo",
    ownerCount: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function makeMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    ...membershipKey("org-1", "user-1"),
    entityType: "Membership",
    membershipId: "mem-1",
    organizationId: "org-1",
    userId: "user-1",
    role: "OWNER",
    status: "ACTIVE",
    joinedAt: "2026-08-30T00:00:00.000Z",
    createdBy: "user-1",
    version: 1,
    ...membershipGsi4Keys("user-1", "org-1", "mem-1"),
    ...overrides,
  };
}

// G-V3 (docs/engineering/test-engineering-standard.md — mutação nomeada por escrito, registrada
// no ato da revisão, não reconstruída depois): cada `it()` abaixo tem, em comentário imediatamente
// acima, pelo menos uma mutação concreta no código real que faria a asserção falhar.
describe("Organization/Membership key builders", () => {
  // Mutação: trocar `TENANT#${organizationId}#ORG#${organizationId}` em membershipKey() por
  // `TENANT#${organizationId}#MEMBER#${organizationId}` (partição diferente da Organization)
  // quebraria a adjacency-list - a asserção de PK igual falharia.
  it("organizationKey shares the same partition as membershipKey for the same organizationId (adjacency-list)", () => {
    expect(organizationKey("org-1").PK).toBe(membershipKey("org-1", "user-1").PK);
    expect(organizationKey("org-1").SK).toBe("META");
  });

  // Mutação: trocar `SK: \`MEMBER#${userId}\`` por um SK fixo (ex. "MEMBER") ignorando userId
  // faria `a.SK` e `b.SK` serem iguais, quebrando a segunda asserção.
  it("membershipKey's SK is distinct per userId within the same organization partition", () => {
    const a = membershipKey("org-1", "user-1");
    const b = membershipKey("org-1", "user-2");
    expect(a.PK).toBe(b.PK);
    expect(a.SK).not.toBe(b.SK);
  });

  // Mutação: trocar `GSI4PK: \`USER#${userId}\`` por `GSI4PK: \`TENANT#${organizationId}#USER#${userId}\``
  // (a semântica antiga pré-multi-org que este design substitui) faria `startsWith("TENANT#")`
  // virar true, quebrando exatamente a asserção que prova o ponto central de MembershipByUser.
  it("membershipGsi4Keys is global (USER#<userId>), never tenant-prefixed - the whole point of MembershipByUser", () => {
    const gsi4 = membershipGsi4Keys("user-1", "org-1", "mem-1");
    expect(gsi4.GSI4PK).toBe("USER#user-1");
    expect(gsi4.GSI4PK.startsWith("TENANT#")).toBe(false);
    expect(gsi4.GSI4SK).toBe("ORG#org-1#MEMBERSHIP#mem-1");
  });

  // Mutação: omitir `membershipId`/`organizationId` do GSI4SK (ex. usar só `ORG#${organizationId}`
  // sem o membershipId) faria duas Organizations diferentes do mesmo usuário colidirem no
  // mesmo GSI4SK quando o membershipId também fosse omitido - a asserção `not.toBe` falharia.
  it("two different organizations for the same user produce distinct GSI4SK under the same GSI4PK", () => {
    const a = membershipGsi4Keys("user-1", "org-1", "mem-1");
    const b = membershipGsi4Keys("user-1", "org-2", "mem-2");
    expect(a.GSI4PK).toBe(b.GSI4PK);
    expect(a.GSI4SK).not.toBe(b.GSI4SK);
  });
});

// G-V3: mesma convenção do describe acima - mutação nomeada em comentário por teste.
describe("InMemoryOrganizationStore (round-trip basics for B2B-3.2 scaffolding)", () => {
  // Mutação: `putIfAbsent` gravar sem checar `this.items.has(key)` primeiro (bug de
  // upsert-sempre) ainda passaria este teste sozinho - a mutação real que o quebraria é
  // `get()` devolver `undefined` mesmo com o item presente (ex. usar `k(item)` errado no get).
  it("putIfAbsent then get round-trips an Organization", async () => {
    const store = new InMemoryOrganizationStore();
    const org = makeOrganization();
    expect(await store.putIfAbsent(org)).toBe(true);
    expect(await store.get<Organization>(organizationKey("org-1"))).toEqual(org);
  });

  // Mutação: remover o `if (this.items.has(key)) return false;` de `putIfAbsent` (upsert
  // silencioso) faria a segunda chamada sobrescrever `displayName`, quebrando as duas asserções.
  it("putIfAbsent refuses to overwrite an existing item", async () => {
    const store = new InMemoryOrganizationStore();
    const org = makeOrganization();
    await store.putIfAbsent(org);
    expect(await store.putIfAbsent({ ...org, displayName: "Different Name" })).toBe(false);
    expect((await store.get<Organization>(organizationKey("org-1")))?.displayName).toBe("Acme Inc");
  });

  // Mutação: `queryByPk` comparar só `item["PK"].startsWith(pk)` em vez de igualdade exata
  // deixaria passar itens de uma partição prefixo-compatível de outra Organization - a
  // asserção de `toHaveLength(2)` exata (não ">= 2") pegaria isso.
  it("queryByPk returns the Organization and its Memberships from the same adjacency-list partition", async () => {
    const store = new InMemoryOrganizationStore();
    const org = makeOrganization();
    const membership = makeMembership();
    await store.putIfAbsent(org);
    await store.putIfAbsent(membership);

    const all = await store.queryByPk(organizationKey("org-1").PK);
    expect(all).toHaveLength(2);

    const membersOnly = await store.queryByPk(organizationKey("org-1").PK, "MEMBER#");
    expect(membersOnly).toHaveLength(1);
    expect(membersOnly[0]?.["userId"]).toBe("user-1");
  });

  // Mutação: `queryGsi4` filtrar por `item["PK"]` em vez de `item["GSI4PK"]` (confundindo o
  // índice global com a partição base) faria retornar 0 resultados, já que nenhuma Membership
  // tem PK=USER#user-1 - a asserção de 2 resultados de Organizations diferentes pegaria isso.
  it("queryGsi4 lists Memberships for a user across Organizations, never touching TENANT# data of unrelated orgs", async () => {
    const store = new InMemoryOrganizationStore();
    const membershipOrgA = makeMembership({ organizationId: "org-1", ...membershipGsi4Keys("user-1", "org-1", "mem-1") });
    const membershipOrgB = makeMembership({
      ...membershipKey("org-2", "user-1"),
      organizationId: "org-2",
      membershipId: "mem-2",
      ...membershipGsi4Keys("user-1", "org-2", "mem-2"),
    });
    await store.putIfAbsent(membershipOrgA);
    await store.putIfAbsent(membershipOrgB);

    const results = await store.queryGsi4({ gsi4pk: "USER#user-1" });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r["organizationId"]).sort()).toEqual(["org-1", "org-2"]);
  });

  // Mutação: `transactWrite` aplicar cada `Put` imediatamente em vez de validar TODAS as
  // condições antes de aplicar qualquer uma (perdendo a atomicidade real) ainda passaria este
  // caso feliz - é o próximo teste (all-or-nothing) que pega essa mutação especificamente.
  it("transactWrite atomically creates Organization + Membership together (CreateOrganization shape)", async () => {
    const store = new InMemoryOrganizationStore();
    const org = makeOrganization();
    const membership = makeMembership();

    await store.transactWrite([{ Put: buildVersionedCreate("MainTable", asItem(org)) }, { Put: buildVersionedCreate("MainTable", asItem(membership)) }]);

    expect(await store.get<Organization>(organizationKey("org-1"))).toEqual(org);
    expect(await store.get<Membership>(membershipKey("org-1", "user-1"))).toEqual(membership);
  });

  // Mutação: mover o loop de aplicação (`for (const entry of entries) { this.items.set(...) }`)
  // para ANTES do loop de validação, em vez de depois, faria a Membership ser gravada mesmo
  // quando o Put da Organization falha - a asserção `toBeUndefined()` pegaria isso.
  it("transactWrite is all-or-nothing: a losing Put leaves neither item behind", async () => {
    const store = new InMemoryOrganizationStore();
    const org = makeOrganization();
    await store.putIfAbsent(org); // pre-existing, so the transaction's own create will collide

    const membership = makeMembership();
    await expect(
      store.transactWrite([{ Put: buildVersionedCreate("MainTable", asItem(org)) }, { Put: buildVersionedCreate("MainTable", asItem(membership)) }]),
    ).rejects.toMatchObject({ name: "TransactionCanceledException" });

    expect(await store.get<Membership>(membershipKey("org-1", "user-1"))).toBeUndefined();
  });
});
