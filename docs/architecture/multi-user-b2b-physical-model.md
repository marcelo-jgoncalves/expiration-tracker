# Multi-User B2B — Physical Model (Wave B2B-1)

**Status: `APPROVED`** via protocolo Claude↔Codex (`AGENTS.md` §4, nível 5-6 da `change-risk-scale.md` — novo GSI/access pattern), 5 rodadas, nota cega cada rodada: Rodada 1 Claude 6,7/Codex 8,7; Rodada 2 Claude 8,1/Codex 8,9; Rodada 3 Claude 8,4/Codex 9,2; Rodada 4 Claude 8,6/Codex 9,4; Rodada 5 Claude 9,3/Codex 9,5 (fechamento, ambos ≥9,0). Registrado como `docs/architecture/decisions-log.md` D-086. Formaliza a "Proposta conceitual de physical model" de `roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §60/§106, incorporando os achados de Wave B2B-0 (`multi-user-b2b-wave-b2b0-inventory.md`) e as correções de §125.2/125.3/125.4. Evidência completa das 5 rodadas (propostas, achados, respostas do Codex): `docs/architecture/reviews/multi-user-b2b-physical-model/`.

Este documento é a especificação FINAL consolidada — não um diff por rodada (isso fica no diretório `reviews/`). Próxima ação real depois deste documento: Wave B2B-2 (Global Identity Foundation), primeira wave de implementação real.

## 1. `User` (global)

```text
PK = USER#<userId>
SK = PROFILE

Atributos: userId, emailNormalized, name, locale, timezoneDefault,
identityStatus (ACTIVE|SUSPENDED), createdAt, updatedAt, version
```

Sem `tenantId`, sem `roles` (**supersessão explícita**: `UserProfile.roles: string[]` tenant-scoped de hoje não sobrevive — role deixa de ser propriedade do usuário, passa a ser propriedade de cada `Membership`, por Organization). `emailNormalized` deve vir só de e-mail verificado (mesma garantia que o resto do sistema já assume) e usar a MESMA função de normalização usada para `Invitation.emailNormalized` (ver §7).

## 2. `IdentityMapping` (global, tenantless)

```text
PK = IDENTITY#cognitoSub#<sub>
SK = MAP

Atributos: cognitoSub, userId, createdAt, updatedAt, version
```

Campo `tenantId` removido (hoje presente em `identity-mapping-repository.ts:17`).

## 3. `bootstrapUser()` — contrato único de primeiro login

Hoje existem **dois** pontos reais de construção de `IdentityMapping`, não um: `bootstrap-identity.ts:166-177` (constrói inline, atômico com `TenantLifecycleRecord`+`UserProfile`, 3 itens) e `bff-auth-service.ts:158-172` (via `IdentityMappingRepository.findOrCreate`, sem fencing — gap pré-existente achado na Wave B2B-0 §1.1). Os dois convergem para um único `IdentityBootstrapService.bootstrapUser(cognitoSub)`:

```text
TransactWriteItems (2 itens, não 3):
  Put User            { PK=USER#<userId>, SK=PROFILE, ... }   ConditionExpression attribute_not_exists(PK)
  Put IdentityMapping { PK=IDENTITY#cognitoSub#<sub>, SK=MAP, userId, ... } ConditionExpression attribute_not_exists(PK)
```

**Nenhuma `Organization`/`TenantLifecycleRecord` é criada aqui** — autenticação deixa de equivaler a criar tenant (§22 do roadmap). Efeito colateral desejado: os dois caminhos de login convergem no mesmo contrato atômico, fechando o gap de fencing do BFF encontrado na Wave B2B-0 sem precisar de um chunk de correção isolado antes. Depois do bootstrap: `ListOrganizationsForUser` (via GSI4, §6) decide o próximo passo — zero Memberships → onboarding explícito (`CreateOrganization` ou aceitar `Invitation` pendente); uma ou mais → seleção de `activeOrganizationId` na sessão BFF (§9).

## 4. `Organization`

```text
PK = TENANT#<organizationId>#ORG#<organizationId>
SK = META

Atributos: organizationId, displayName, timezone, defaultQuietHours?,
ownerCount (int, ver §8), createdAt, updatedAt, version
```

`organizationId` gerado independente (ULID/UUIDv7), nunca igual a nenhum `userId` (§15 do roadmap). Status de lifecycle continua vindo de `TenantLifecycleRecord` (`PK=TENANT#${tenantId}#LIFECYCLE`, inalterado), não duplicado aqui.

### `CreateOrganization` — transação explícita

```text
TransactWriteItems:
  Put Organization          { ..., ownerCount=1 }  ConditionExpression attribute_not_exists(PK)
  Put Membership             { ..., role=OWNER, status=ACTIVE, GSI4PK=USER#<creatorUserId>, ... }
  Put TenantLifecycleRecord  { status=ACTIVE }
  Put TenantEntitlement (defaults)
```

`ownerCount=1` é seedado atomicamente com a primeira `Membership OWNER`, nunca calculado depois.

## 5. `Membership`

```text
PK = TENANT#<organizationId>#ORG#<organizationId>
SK = MEMBER#<userId>

Atributos: membershipId, organizationId, userId, role (OWNER|ADMIN|MEMBER|VIEWER),
status (ACTIVE|SUSPENDED|REMOVED), joinedAt, createdBy, version

GSI4PK = USER#<userId>
GSI4SK = ORG#<organizationId>#MEMBERSHIP#<membershipId>
```

Mesma partição do `Organization` (adjacency-list: uma `Query` em `PK=TENANT#<organizationId>#ORG#<organizationId>` retorna org + membros + convites). `GSI4PK`/`GSI4SK` só existem no item `Membership` — índice esparso, verificado seguro (grep independente em 2 rodadas de autograde: nenhum outro tipo de item grava esses atributos).

**Três estados, nunca hard-delete**: `REMOVED` substitui remoção física (mesmo padrão de retenção/auditoria já usado por `AuditEvent`/W3-07 neste projeto) — a linha permanece, só o `status` muda. `SUSPENDED` ainda É membro (conta para `ownerCount` se `role=OWNER`, sem acesso operacional), reversível só por `unsuspend` administrativo explícito (fora do escopo desta wave). `REMOVED` é o único estado que um reingresso via convite pode sobrescrever.

## 6. `MembershipByUser` (GSI4, reaproveitado — não é GSI novo)

```text
GSI4PK = USER#<userId>
GSI4SK = ORG#<organizationId>#MEMBERSHIP#<membershipId>
```

**Achado real da Wave B2B-1**: GSI4 já existe no Terraform (`GSI4PK`/`GSI4SK`, projeção `ALL`) mas tem zero consumidor real hoje — `data-model.md` já o documentava para "membership por usuário", só que com a semântica antiga pré-multi-org (`PK=TENANT#t#USER#u`), incompatível com multi-org. Este design reaproveita o slot, não cria um GSI novo. **Precondição de infra antes de qualquer escrita real**: remover `"GSI4"` de `locals.tenant_facing_index_names` (`infra/modules/dynamo-table/main.tf`) e adicionar política restrita dedicada, mesmo padrão de `gsi3_read`/`gsi6_read` — só as roles que resolvem contexto de identidade (BFF/session context, `RequestContextResolver`, onboarding) recebem `dynamodb:Query` em `.../index/GSI4`, nunca a role tenant-facing geral (GSI2/GSI5, também sem consumidor real, ficam como alternativa se uma restrição de infra impedir o reaproveitamento de GSI4).

**Contrato de consistência — invariante explícita**: GSI4 é eventually consistent por natureza do DynamoDB e **nunca é fonte de autorização**. Resolução de `RequestContext`/decisão de acesso sempre faz `GetItem`/`Query` direto na partição base do `Membership`, nunca via GSI4. GSI4 serve exclusivamente para LISTAGEM ("quais Organizations este usuário pode acessar" — seletor de organização). Consumidores de listagem devem tolerar janela curta (tipicamente sub-segundo) de leitura obsoleta/duplicada logo após qualquer mudança de `membershipId` (criação, aceite de convite, reingresso — `membershipId` é regenerado a cada [re]ingresso) — UI de seletor de organização deduplica por `organizationId` antes de renderizar, e hidrata/valida contra a base ao selecionar.

## 7. `Invitation`

```text
PK = TENANT#<organizationId>#ORG#<organizationId>
SK = INVITATION#<invitationId>

Atributos: invitationId, organizationId, emailNormalized, role, status
(PENDING|ACCEPTED|REVOKED|EXPIRED), tokenPointerId, expiresAt, createdBy,
createdAt, acceptedAt?, revokedAt?, version
```

### Token pointer (tenantless, família `GuestTokenPointer`)

```text
PK = INVITATION_TOKEN#<selectorHash>
SK = POINTER

Atributos: selectorHash, tokenDigest (HMAC), organizationId, invitationId, expiresAt, consumedAt?
```

Resolve tenant a partir do token — quem clica o link ainda não tem contexto de organização. Nunca reaproveita `GuestTokenPointer` diretamente (§20 do roadmap).

### Dedup pointer PENDING por (org, e-mail) — tenant-scoped por desvio deliberado

```text
PK = TENANT#<organizationId>#ORG#<organizationId>
SK = INVITE_DEDUP#<emailNormalized>

Atributos: invitationId (convite PENDING atual), organizationId, emailNormalized, expiresAt
```

**Desvio deliberado da redação literal de §125.3** (que sugeria tenantless): como `organizationId` já é conhecido no momento de criar o convite, um pointer tenant-scoped na mesma partição da `Organization` é suficiente — tenantless só é necessário para o token lookup (caso genuinamente sem contexto prévio, já coberto acima). Confirmado aceitável por ambos os lados do protocolo. Criar convite faz `TransactWriteItems` com `ConditionCheck attribute_not_exists(PK) AND attribute_not_exists(SK)` neste item; se falhar, vira reenvio/rotação do convite existente (mesmo padrão de `roadmap-evolution/13`), nunca um segundo `Invitation` PENDING.

## 8. `ownerCount` — mecanismo transacional

`Organization.ownerCount` = contagem de `Membership` `ACTIVE` com `role=OWNER`. Toda transição que reduziria essa contagem — remoção (`REMOVED`), demote, ou suspensão de uma `Membership OWNER` `ACTIVE` — inclui, na MESMA `TransactWriteItems`: `Update Organization` (`ownerCount = ownerCount - 1`, `ConditionExpression: ownerCount > :one`) + a mudança no `Membership` afetado. Se a condição falhar, a transação inteira é rejeitada atomicamente (mesma disciplina de `occ.ts`/W3-07 — nenhuma leitura solta antes da decisão). Promover um segundo membro a `OWNER` incrementa `ownerCount` na mesma transação.

## 9. Aceite de `Invitation` — transação final

```text
TransactWriteItems:
  Update Membership { PK=TENANT#<organizationId>#ORG#<organizationId>, SK=MEMBER#<userId>,
                       SET role=:role, #status=:ACTIVE, membershipId=:newMembershipId, joinedAt=:now,
                           GSI4PK=USER#<userId>, GSI4SK=ORG#<organizationId>#MEMBERSHIP#<newMembershipId>,
                           version=if_not_exists(version,:one), createdAt=if_not_exists(createdAt,:now) }
                     ConditionExpression: attribute_not_exists(PK) OR #status = :REMOVED
  Update Invitation { SET #status=:ACCEPTED, acceptedAt=:now }
                     ConditionExpression: #status = :PENDING AND emailNormalized = :callerVerifiedEmail
  Delete InvitationDedupPointer
```

Três propriedades, cada uma fechando um achado real de uma rodada distinta:

1. **`Update` (não `Put`) com upsert nativo do DynamoDB**: cria a `Membership` se não existir, permite reingresso legítimo se `status=REMOVED`, bloqueia corretamente `ACTIVE`/`SUSPENDED` como outcome terminal idempotente ("já é membro", §77 do roadmap). `attribute_not_exists(PK)` (não `attribute_not_exists(#status)`) é a condição mais robusta contra um item malformado sem `status`.
2. **`membershipId` regenerado a cada (re)ingresso** — cada "vida" de membership ganha ID distinto para correlação de auditoria; `version`/`createdAt` preservados via `if_not_exists` num reingresso.
3. **`emailNormalized = :callerVerifiedEmail`** — fecha §121 Q13/§21 do roadmap ("e-mail verificado → e-mail == invitation.email") como invariante ESTRUTURAL dentro da própria transação atômica, não só checagem de aplicação antes dela. `:callerVerifiedEmail` é um valor literal já resolvido do `User` global do chamador (autenticado, e-mail verificado é pré-requisito de login) — comparação padrão contra literal via `ExpressionAttributeValues`, mesma forma de toda outra checagem OCC (`version = :expectedVersion`) já usada no projeto, não lógica condicional entre itens diferentes (que `TransactWriteItems` de fato não expressa).

## 10. `DeviceSession` — migra para o `User` global, `logoutAll` fica user-global

`DeviceSession` é mecanismo **compartilhado** pelos dois caminhos de login hoje (`bff-auth-service.ts:178,471,499` chama `upsertDeviceSession`/`logoutDevice`/`logoutAll` diretamente), não exclusivo do caminho direto/API. Migra para a partição do `User` global:

```text
PK = USER#<userId>
SK = SESSION#<deviceId>
```

**Mudança de contrato de comportamento observável, não só relocação de schema**: `logoutAll(userId)` (perde `tenantId`) passa a ser user-global por construção — uma `Query` em `PK=USER#<userId>` retorna todos os dispositivos em todas as Organizations. "Logout all" revoga tudo, sempre, não só a Organization ativa no momento da chamada. Avaliado como a escolha de segurança/produto correta (contenção de comprometimento de credencial é função da revogação de `Membership`, não de logout de sessão — a credencial pertence ao usuário, não à Organization). Contrato de seleção de organização no caminho direto/API sem sessão BFF mediando (ex. header `X-Organization-Id` como hint, §13 do roadmap) fica adiado para Wave B2B-5/B2B-6 como decisão de contrato de API, não lacuna de schema.

## 11. `RequestContext` (cutover)

```ts
{
  userId: string,
  tenant: {
    tenantId: string,        // = organizationId
    membershipId: string,    // já existe como campo opcional hoje, passa a ser sempre populado
    role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
    permissions: Permission[], // derivado do role via matriz central, Wave B2B-7
  }
}
```

Resolução: `claims.sub → IdentityMapping (userId) → BFF session.activeOrganizationId (seleção) → GetItem direto Membership(userId, organizationId) → TenantLifecycleRecord ACTIVE → RequestContext`. GSI4 só é consultado para LISTAR organizations (`GET /me`, seletor), nunca para resolver o `RequestContext` de uma chamada já com organização selecionada.

## 12. BFF session

```text
PK = SESSION#<selectorHash>   (inalterado)
SK = POINTER                   (inalterado)

tenantId REMOVIDO; activeOrganizationId?: string (novo, mutável)
```

Nova operação `POST /bff/organization/select`: valida `Membership` ACTIVE + `TenantLifecycleRecord` ACTIVE, CAS/OCC na sessão (mesma disciplina do Full BFF), grava `activeOrganizationId`. Organization apagada/Membership revogada: próximo `resolve()` falha fechado, sessão limpa `activeOrganizationId` e retorna `ORGANIZATION_UNAVAILABLE` — identidade global sobrevive, só a seleção invalida (§45/§46 do roadmap).

## 13. `resolveCandidateUserId(assigneeUserId ?? tenantId)` — disposição explícita

Hoje seguro porque `tenantId=userId`. **Pós-cutover, `tenantId=organizationId`, nunca um `userId` válido** — o fallback resolveria notificações para um "usuário" que na verdade é `organizationId`, falha silenciosa grave (`principles.md` #6). **Condição de saída da Wave B2B-12 (cutover), não trabalho best-effort da B2B-11**: substituto provisório até responsible member real existir — primeiro `Membership` `ACTIVE` `role=OWNER` da Organization via `Query` na partição base, nunca `tenantId` bruto.

## 14. Migração/cutover de `dev`

Dados de `dev` classificados como sintéticos → reset/reseed, não migração one-shot (§63 do roadmap). BFF sessions: invalidação total. S3 (3 prefixos reais confirmados pela Wave B2B-0 — `tenant/<t>/item/.../slot/...`, `clean/<t>/...`, `ocr/<t>/...`) não muda de formato, só a fonte do `tenantId` (de `userId` para `Organization.id`). Nenhum fallback de compatibilidade permanente em produção após o cutover.

## 15. Checklist §121 — 25 perguntas, respostas finais

1. **Algum `tenantId=userId` implícito remanescente?** Não — os 3 pontos de origem confirmados (`bootstrap-identity.ts`/`bff-auth-service.ts` convergem em `bootstrapUser()`; `recipient-resolver.ts` tem disposição explícita, §13) são todos endereçados.
2. **`IdentityMapping` ainda tem tenant único?** Não — `tenantId` removido (§2).
3. **`User` é realmente global?** Sim (§1), incluindo `DeviceSession` (§10).
4. **`MembershipByUser` descobre todas as Organizations sem tenant prévio?** Sim, via GSI4 (§6).
5. **Organization header pode ser spoofado?** Não — nunca é fonte de autorização; só seleciona qual `Membership` consultar, a autorização real é `GetItem` server-side (§11).
6. **Revogação de `Membership` é efetiva?** Sim — validação por request (`REMOVED`/`SUSPENDED` bloqueiam no próximo `GetItem`).
7. **Roles vazam entre Organizations?** Não — `role` vive em `Membership`, por par (org, user), nunca no `User` global.
8. **Cache do frontend pode mostrar dados de tenant anterior?** Fora do escopo físico desta wave — Wave B2B-10 (a Wave B2B-0 já confirmou zero isolamento hoje, green-field).
9. **BFF switch tem race?** Não — CAS/OCC reaproveita a mesma versionamento de sessão já aprovado em D-053/D-054 (§12).
10. **Sessão de User multi-org sobrevive à deleção de uma Organization?** Sim (§12) — `ORGANIZATION_UNAVAILABLE`, sessão não é destruída.
11. **W3-07 pode apagar um User global por acidente?** Não, por construção de chave — `User.PK=USER#<userId>` nunca começa com `TENANT#`, todo scan de purge filtra por `begins_with(PK, "TENANT#<tenantId>")` — inatingível pela forma da chave, não por exclusão lógica no código.
12. **User DSR e Organization DSR confundidos?** Não — fisicamente separados por partição (`USER#...` vs `TENANT#<organizationId>#...`); reconciliação completa de W3-07 (purge/retenção por classe) fica para Wave B2B-9.
13. **Invitation permite account takeover?** Não — `emailNormalized = :callerVerifiedEmail` estrutural na transação de aceite (§9).
14. **Invitation pode ser replayed?** Não — token one-time consumption (token pointer, §7).
15. **Last OWNER pode desaparecer?** Não — `ownerCount` transacional (§8).
16. **Presigned URLs têm overclaim de revogação?** Não — admission semantics já estabelecido em D-067 preservado, só a fonte do `tenantId` muda.
17. **Async workers dependem incorretamente de Membership atual?** Não — autorização decidida no admission point, workers só herdam `tenantId`+lifecycle+idempotência.
18. **Quotas continuam por Organization?** Sim — `TenantEntitlement` inalterado, `tenantId=organizationId`.
19. **Idempotency continua tenant-scoped?** Sim, com `tenantId=organizationId` pós-cutover.
20. **S3 organization-scoped?** Sim, incluindo os 3 prefixos reais confirmados (§14).
21. **Guest trust usa Organization?** Supersessão explícita de D-060/GTR-01 (`UserProfile.requesterDisplayName` → `Organization.displayName`) registrada; implementação real na Wave B2B-11.
22. **Responsible user precisa Membership?** Sim conceitualmente; matriz/integração completa é Wave B2B-11.
23. **Removed member continua recebendo notificações?** Não deveria — disposição do fallback em §13 evita isso estruturalmente; integração completa é Wave B2B-11.
24. **Query keys incluem tenant?** Fora do escopo físico desta wave — Wave B2B-10.
25. **Tests usam IDs realmente diferentes?** Estratégia (identidades distintas, matriz cross-tenant) citada no roadmap §72-73; vira gate/test plan explícito na implementação real (Wave B2B-2 em diante), não nesta rodada de design.

## 16. Fora de escopo desta wave (fronteiras já declaradas, não omissões)

Matriz completa de permissions por role (Wave B2B-7); UI/IA de onboarding, switcher, invite flow (Wave B2B-4/B2B-10); tabela mantém/emenda/refaz completa do W3-07 além de §125.4 (Wave B2B-9, usar `w3-07-writer-inventory.md` como base); responsible member/notification routing (Wave B2B-11); frontend cache isolation (Wave B2B-10, green-field confirmado pela Wave B2B-0).
