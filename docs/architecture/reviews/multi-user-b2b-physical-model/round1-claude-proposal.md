# Multi-User B2B — Physical Model, Wave B2B-1 (Rodada 1, proposta Claude)

Formaliza a "Proposta conceitual de physical model" de `roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §60 em um design físico completo, incorporando os achados de Wave B2B-0 (`multi-user-b2b-wave-b2b0-inventory.md`) e as correções já registradas em §125.2/125.3/125.4. Esta é a rodada 1 de um protocolo Claude↔Codex dedicado (`AGENTS.md` §4, nível 5-6 da `change-risk-scale.md` — novo GSI/access pattern), gate ≥9,0 de ambos.

## 0. Inventário verificado que fundamenta este design (não reinventado)

- GSI1/GSI3/GSI6/GSI7 já em uso real (dashboard de expiração, reminder/chasing scheduler, retenção/purge, listagem de `TrackedSubject`). GSI3/GSI6 são globais (sem `tenantId`) e IAM-isolados via política dedicada.
- **GSI4 já existe no Terraform (`GSI4PK`/`GSI4SK`, projeção `ALL`) mas tem ZERO consumidor real hoje.** `data-model.md` já documenta GSI4 como "membership por usuário", mas com a semântica antiga pré-multi-org (`PK=TENANT#t#USER#u`, `SK=ORG#o#MEMBERSHIP#m`) que `roadmap-evolution/17` §6 já identificou como incompatível com multi-org (pressupõe tenant conhecido antes da query). **Este design reaproveita o slot GSI4, redefinindo sua semântica — não cria um GSI novo.**
- GSI4 hoje está incluído em `locals.tenant_facing_index_names` (política geral tenant-facing) — inofensivo porque não tem consumidor real, mas precisa ser REMOVIDO de lá e receber política restrita dedicada (mesmo padrão de `gsi3_read`/`gsi6_read`) antes de qualquer dado real ser escrito nele, porque a nova semântica cruza tenants.
- GSI2/GSI5 também sem consumidor real — ficam como alternativa se esta rodada rejeitar o reaproveitamento de GSI4 por algum motivo não previsto.
- `IdentityMapping` real hoje: `PK=IDENTITY#COGNITO#<sub>`, `SK=MAP`, com `tenantId` embutido. `RequestContext` já tem um campo `membershipId?` não populado por nenhum código atual. BFF session real hoje: `PK=SESSION#<selectorHash>`, `SK=POINTER`, tabela dedicada, `tenantId` fixo no item, sem seleção mutável.
- S3 real hoje tem 3 prefixos distintos (`tenant/<tenantId>/item/.../slot/...`, `clean/<tenantId>/...`, `ocr/<tenantId>/...`), não 1 uniforme como §68 do roadmap assumia — nenhum deles precisa mudar de FORMATO neste design, só a fonte do valor `tenantId` muda (de `userId` para `Organization.id`).

## 1. `User` (global)

```text
PK = USER#<userId>
SK = PROFILE

Atributos: userId, emailNormalized, name, locale, timezoneDefault,
identityStatus (ACTIVE|SUSPENDED), createdAt, updatedAt, version
```

Sem `tenantId`. Migra de `TENANT#<t>#USER#<u>`/`PROFILE` (User atual, tenant-scoped) — ver §7 (migração).

## 2. `IdentityMapping` (global, tenantless)

```text
PK = IDENTITY#COGNITO#<sub>
SK = MAP

Atributos: cognitoSub, userId, createdAt, updatedAt, version
```

Campo `tenantId` REMOVIDO (hoje presente em `identity-mapping-repository.ts:17`). `findOrCreate(cognitoSub, userId)` — assinatura perde o parâmetro `tenantId`.

## 3. `Organization`

```text
PK = TENANT#<organizationId>#ORG#<organizationId>
SK = META

Atributos: organizationId, displayName, timezone, defaultQuietHours?,
ownerCount (int, ver §6), createdAt, updatedAt, version
```

`organizationId` gerado independente (`ULID`/`UUIDv7`), nunca igual a nenhum `userId` existente — mesmo princípio de §15 do roadmap. Status de lifecycle continua vindo de `TenantLifecycleRecord` (inalterado, já é `PK=TENANT#${tenantId}#LIFECYCLE`), não duplicado aqui.

## 4. `Membership` (org-side)

```text
PK = TENANT#<organizationId>#ORG#<organizationId>
SK = MEMBER#<userId>

Atributos: membershipId, organizationId, userId, role (OWNER|ADMIN|MEMBER|VIEWER),
status (ACTIVE|SUSPENDED), joinedAt, createdBy, version

GSI4PK = USER#<userId>
GSI4SK = ORG#<organizationId>#MEMBERSHIP#<membershipId>
```

Mesma partição do `Organization` (adjacency-list — uma única `Query` em `PK=TENANT#<organizationId>#ORG#<organizationId>` retorna a org + todos os membros + convites, ver §5). `GSI4PK`/`GSI4SK` só existem no item `Membership` (índice esparso — nenhum outro tipo de item deste projeto grava esses atributos, então GSI4 só contém linhas de Membership).

### 4.1 `MembershipByUser` (GSI4, redefinido)

```text
GSI4PK = USER#<userId>
GSI4SK = ORG#<organizationId>#MEMBERSHIP#<membershipId>
```

Resolve "quais Organizations este User pode acessar" sem tenant prévio — exatamente o access pattern que §6 do roadmap pede. Cruza tenants por natureza, então **exige política IAM restrita dedicada** (ver §0): só as roles que resolvem contexto de identidade (BFF/session context, `RequestContextResolver`, onboarding) recebem `dynamodb:Query` em `.../index/GSI4` — nunca a role tenant-facing geral.

## 5. `Invitation`

Registro tenant-scoped, mesma partição do `Organization`:

```text
PK = TENANT#<organizationId>#ORG#<organizationId>
SK = INVITATION#<invitationId>

Atributos: invitationId, organizationId, emailNormalized, role, status
(PENDING|ACCEPTED|REVOKED|EXPIRED), tokenPointerId, expiresAt, createdBy,
createdAt, acceptedAt?, revokedAt?, version
```

### 5.1 Token pointer (tenantless, família `GuestTokenPointer`)

```text
PK = INVITATION_TOKEN#<selectorHash>
SK = POINTER

Atributos: selectorHash, tokenDigest (HMAC), organizationId, invitationId,
expiresAt, consumedAt?
```

Resolve tenant a partir do token (quem clica o link ainda não tem contexto de organização) — mesmo padrão de `GuestTokenPointer`, nunca reaproveitado diretamente (§20 do roadmap já pede isso).

### 5.2 Dedup pointer PENDING por (org, e-mail) — fecha achado 125.3 Rodada 2

**Desvio deliberado da redação literal de §125.3** (que sugeria um pointer tenantless): como `organizationId` já é conhecido no momento da criação do convite (quem convida já está autenticado dentro de uma Organization), um pointer **tenant-scoped**, na MESMA partição do `Organization`, é suficiente e mais simples — não há necessidade de resolver tenant a partir dele (isso já é resolvido pelo token pointer em 5.1, que cobre o caso realmente tenantless: alguém clicando um link sem contexto prévio):

```text
PK = TENANT#<organizationId>#ORG#<organizationId>
SK = INVITE_DEDUP#<emailNormalized>

Atributos: invitationId (referência ao convite PENDING atual), organizationId,
emailNormalized, expiresAt
```

Criar um convite faz um `TransactWriteItems` com `ConditionCheck attribute_not_exists(PK) AND attribute_not_exists(SK)` neste item — se falhar, a operação vira reenvio/rotação do convite existente referenciado (mesmo padrão de `roadmap-evolution/13`), nunca um segundo `Invitation` PENDING. Ao aceitar/revogar/expirar o convite, o dedup pointer é removido na mesma transação. **Pergunta explícita para o Codex**: esta simplificação (tenant-scoped em vez de tenantless) é aceitável, ou há um cenário real que só o design tenantless original cobriria?

## 6. `ownerCount` — mecanismo transacional (fecha achado 125.2)

`Organization.ownerCount` = contagem de `Membership` `ACTIVE` com `role=OWNER`. Toda transição que reduziria essa contagem — remoção, demote para outra role, **ou suspensão** de uma Membership `OWNER` — inclui, na MESMA `TransactWriteItems`:

1. `Update` no item `Organization` (mesma partição): `ownerCount = ownerCount - 1`, `ConditionExpression: ownerCount > :one`.
2. `Update`/`Delete` no item `Membership` afetado.

Se a condição falhar, a transação inteira é rejeitada atomicamente (`TransactionCanceledException`, mesma disciplina de `occ.ts`/W3-07 — nenhuma leitura solta antes da decisão). Promover um segundo membro a `OWNER` incrementa `ownerCount` na mesma transação da mudança de role.

## 7. `RequestContext` (cutover)

```ts
{
  userId: string,
  tenant: {
    tenantId: string,        // = organizationId
    membershipId: string,    // já existe como campo opcional hoje, passa a ser sempre populado
    role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
    permissions: Permission[], // derivado do role via matriz central (§28/29 do roadmap)
  }
}
```

Resolução: `claims.sub → IdentityMapping (userId) → BFF session.activeOrganizationId (seleção) → Membership(userId, organizationId) lookup direto (não via GSI4 — já se conhece a PK) → TenantLifecycleRecord ACTIVE → RequestContext`. GSI4 só é consultado para LISTAR organizations do usuário (ex. `GET /me`, seletor de organização), nunca para resolver o `RequestContext` de uma chamada já com organização selecionada.

## 8. BFF session — REFAZ (fecha achado 125.4, não é emenda pontual)

```text
PK = SESSION#<selectorHash>   (inalterado)
SK = POINTER                   (inalterado)

Atributos: ...(inalterados)..., tenantId REMOVIDO, activeOrganizationId?: string (novo, mutável)
```

Nova operação `POST /bff/organization/select`: valida `Membership` ACTIVE + `TenantLifecycleRecord` ACTIVE, CAS/OCC na sessão (mesma disciplina de versão já usada pelo Full BFF), grava `activeOrganizationId`. Se a Organization selecionada for apagada ou a Membership revogada: próximo `resolve()` falha fechado, sessão limpa `activeOrganizationId` e retorna `ORGANIZATION_UNAVAILABLE` — identidade global sobrevive, só a seleção é invalidada (§45/§46 do roadmap).

## 9. Migração/cutover de `dev`

Dados de `dev` classificados como sintéticos (nenhum usuário real hoje) → **reset/reseed**, não migração one-shot (§63 do roadmap: mais barato e mais seguro nesta fase). BFF sessions: invalidação total (nenhuma sessão real de cliente hoje). S3: os 3 prefixos reais (§0 acima) não mudam de formato — só a fonte do valor `tenantId` que os alimenta muda de `userId` para `Organization.id`; objetos de `dev` existentes podem ser descartados junto com o reseed. Nenhum fallback de compatibilidade permanente em código de produção após o cutover (§64 do roadmap).

## 10. O que este design explicitamente NÃO decide ainda (fora do escopo de B2B-1)

- Matriz completa de permissions por role (Wave B2B-7).
- UI/IA de onboarding, switcher, invite flow (Wave B2B-4/B2B-10).
- Tabela mantém/emenda/refaz completa do W3-07 além do que §125.4 já registrou (Wave B2B-9).
- Responsible member / notification routing (Wave B2B-11).

## 11. Checklist §121 — autoavaliação preliminar (a confirmar pelo Codex)

Preenchido item a item nas próximas rodadas conforme achados reais aparecerem — não reivindicar fechamento aqui antes da revisão adversarial.
