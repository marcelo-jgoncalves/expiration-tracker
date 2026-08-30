# Multi-User B2B — Physical Model, Wave B2B-1 (Rodada 2, proposta Claude)

Revisão da Rodada 1 (`round1-claude-proposal.md`, nota Claude 6,7/Codex 8,7, ambos abaixo do gate) incorporando os achados reais de ambos os lados — convergentes, não redundantes. Seções inalteradas da Rodada 1 (§1 `User`, §3 `Organization` exceto a transação de criação, §4 `Membership`/§4.1 GSI4, §5.1 token pointer, §7 `RequestContext`, §8 BFF session, §9 migração) não são repetidas aqui — só o que mudou. Ler `round1-claude-proposal.md` primeiro para o design base.

## Correção factual (achado do autograde Claude, verificado contra o arquivo real)

`IdentityMapping.PK` é `IDENTITY#cognitoSub#<sub>` (`identity-mapping-repository.ts:22`), não `IDENTITY#COGNITO#<sub>` como a Rodada 1 (herdando um erro já presente em `multi-user-b2b-wave-b2b0-inventory.md`, agora corrigido lá também). Design físico abaixo usa o literal real.

## 2'. `IdentityMapping` — dois pontos de escrita reais, não um (achado Claude + achado Codex #1)

A Rodada 1 só mudava a assinatura de `IdentityMappingRepository.findOrCreate()`. Verificado contra o código real: existem **dois** pontos de construção, não um:

- `bootstrap-identity.ts:166-177` (`TenantBootstrapService.createAll`) constrói o objeto `IdentityMapping` **inline**, sem passar pelo repositório, dentro de uma `TransactWriteItems` de 3 itens (`IdentityMapping` + `TenantLifecycleRecord` + `UserProfile`).
- `bff-auth-service.ts:158-172` chama `identityMappings.findOrCreate(cognitoSub, newUserId, newTenantId)` — já sabido pela Wave B2B-0 (§1.1 do inventário) como o caminho SEM fencing/`TenantLifecycleRecord`, gap pré-existente independente deste design.

**Correção — contrato único de primeiro login, substituindo os dois pontos acima**: um novo `IdentityBootstrapService.bootstrapUser(cognitoSub)` é o ÚNICO ponto de construção de `IdentityMapping`, chamado pelos dois caminhos de login (direto/API e BFF). Ele faz uma `TransactWriteItems` de **2 itens apenas**: `User` (global, `PK=USER#<userId>`) + `IdentityMapping` (`PK=IDENTITY#cognitoSub#<sub>`). **Nenhuma `Organization`/`TenantLifecycleRecord` é criada aqui** — autenticação deixa de equivaler a criar tenant, exatamente como §22 do roadmap pede. Isso fecha, como efeito colateral desejado, o gap de fencing do caminho BFF encontrado na Wave B2B-0 (§1.1 do inventário): os dois caminhos convergem para o mesmo contrato atômico, então o BFF ganha a mesma garantia que faltava, sem precisar de um chunk de correção isolado antes.

Depois do bootstrap de identidade: `ListOrganizationsForUser` (via GSI4) decide o próximo passo — zero Memberships → onboarding explícito (`CreateOrganization` ou aceitar `Invitation` pendente); uma ou mais → seleção de `activeOrganizationId` na sessão BFF (§8).

## 3'. `CreateOrganization` — transação explícita (achado Claude: transação de criação não estava mostrada)

```text
TransactWriteItems:
  Put Organization      { PK=TENANT#<organizationId>#ORG#<organizationId>, SK=META,
                           ownerCount=1, ... }         ConditionExpression attribute_not_exists(PK)
  Put Membership        { PK=TENANT#<organizationId>#ORG#<organizationId>, SK=MEMBER#<creatorUserId>,
                           role=OWNER, status=ACTIVE, GSI4PK=USER#<creatorUserId>, GSI4SK=ORG#... }
  Put TenantLifecycleRecord { PK=TENANT#<organizationId>#LIFECYCLE, status=ACTIVE }
  Put TenantEntitlement (defaults)  -- mesma partição/padrão já usado por TenantEntitlement hoje
```

`ownerCount=1` é seedado atomicamente com a primeira `Membership OWNER`, nunca calculado depois. `organizationId` gerado antes da transação (ULID/UUIDv7), nunca derivado de `creatorUserId`.

## 4.2'. Aceite de `Invitation` — `Put` condicionado, não `ConditionCheck` separado (achado Codex #2)

A Rodada 1 dizia "`ConditionCheck` de inexistência antes de criar" a `Membership` — `TransactWriteItems` do DynamoDB **não permite duas operações sobre o mesmo item na mesma transação**, então isso precisa ser expresso corretamente:

```text
TransactWriteItems:
  Put Membership  { PK=TENANT#<organizationId>#ORG#<organizationId>, SK=MEMBER#<userId>, ... }
                  ConditionExpression: attribute_not_exists(PK) AND attribute_not_exists(SK)
  Update Invitation { status: ACCEPTED, acceptedAt }
                    ConditionExpression: status = :PENDING
  Delete InvitationDedupPointer (§5.2 da Rodada 1)
```

Se o `Put Membership` falhar por já existir (usuário já é membro ativo), a transação inteira cancela e o outcome é o mesmo terminal idempotente já previsto ("já é membro") — não uma tentativa de `ConditionCheck` isolado que a API real do DynamoDB não modela dessa forma.

## Achado Codex #3 — `DeviceSession` no modelo `User` global

Hoje `DeviceSession` vive sob `TENANT#<tenantId>#USER#<userId>`/`SESSION#<deviceId>` (`user-repository.ts:56`, caminho direto/API, distinto da sessão BFF). Com `User` global (`PK=USER#<userId>`, sem prefixo `TENANT#`), `DeviceSession` migra para a mesma partição do `User`:

```text
PK = USER#<userId>
SK = SESSION#<deviceId>
```

Mesmo princípio de "seleção, não identidade" da sessão BFF (§8 da Rodada 1): a revogação/logout por dispositivo continua funcionando por mecanismo idêntico, só a partição física muda. **Não resolvido nesta rodada, explicitamente adiado para Wave B2B-5/B2B-6** (não é decisão de schema, é decisão de contrato de API): como o caminho direto/API sinaliza qual Organization está ativa numa chamada autenticada por JWT puro (sem sessão BFF mediando) — um header `X-Organization-Id` como hint (§13 do roadmap) é a direção provável, mas a validação de Membership por request (§31 do roadmap) já cobre a segurança independente de como o hint chega.

## Achado Codex #4 — `resolveCandidateUserId(assigneeUserId ?? tenantId)` fica ativamente errado pós-cutover, não só desatualizado

Hoje esse fallback (`recipient-resolver.ts:29`) funciona seguramente porque `tenantId=userId`. **Pós-cutover, `tenantId=organizationId`, que nunca é um `userId` válido** — o fallback passaria a resolver notificações para um "usuário" que é na verdade um `organizationId`, uma falha silenciosa (não um erro visível) exatamente do tipo que este projeto trata como grave (`principles.md` #6, "auditar contra a realidade"). **Disposição explícita, não deferida vagamente**: este fallback DEVE ser removido ou substituído antes que qualquer tenant real opere sob o novo modelo — condição de saída da Wave B2B-12 (cutover), não trabalho best-effort da Wave B2B-11. Substituição provisória aceitável até a Wave B2B-11 implementar responsible member de verdade: cair para o primeiro `Membership` `ACTIVE` com `role=OWNER` da Organization (via `Query` na partição do `Organization`, não via GSI4), nunca para `tenantId` bruto.

## §121 — respostas explícitas às perguntas que a Rodada 1 deixou implícitas ou não mencionou

- **Q5 (organization header pode ser spoofado?)**: Não — `RequestContext` nunca deriva de header/hint do cliente sem validação; o hint (`X-Organization-Id` ou equivalente) só seleciona QUAL `Membership` consultar, a autorização real vem da `Query`/`GetItem` server-side em `Membership(userId, organizationId)` + `TenantLifecycleRecord`, mesma disciplina de §12 do roadmap.
- **Q11 (W3-07 pode apagar um User global por acidente?)**: Não, por construção de chave — `User.PK=USER#<userId>` nunca começa com `TENANT#`, e todo scan de purge do W3-07 (`purge-tenant.ts`) filtra por `begins_with(PK, "TENANT#<tenantId>")`. Um `User` global estrutural e fisicamente fora do espaço de chaves que qualquer purge de tenant enumera — não depende de uma exclusão lógica no código do purge, é inatingível pela própria forma da chave.
- **Q21 (GTR-01/`Organization.displayName` supersede `UserProfile.requesterDisplayName`, D-060)**: Confirmado como supersessão explícita de D-060 (mesmo achado 125.5 do roadmap) — decisão de produto/arquitetura registrada aqui, implementação real fica para Wave B2B-11 (junto com responsible member/notification routing, que também consome dados de `Organization`).
- **Q1 (algum `tenantId=userId` implícito remanescente?)**: Os 3 pontos de origem confirmados pela Wave B2B-0 são todos endereçados por este design: `bootstrap-identity.ts`/`bff-auth-service.ts` convergem no novo `bootstrapUser()` (§2' acima, sem `tenantId` nenhum); `recipient-resolver.ts` tem disposição explícita (achado Codex #4 acima). Nenhum ponto de origem real fica sem tratamento — o fallback provisório do achado #4 não reintroduz `tenantId=userId`, usa `tenantId` só como chave de busca de Membership, nunca como valor de `userId`.

Itens do checklist que seguem legitimamente fora do escopo físico desta rodada (não é omissão, é fronteira de wave já declarada): Q8 (matriz de permissions — Wave B2B-7), Q22-24 (responsible/notificações/query keys frontend — Wave B2B-10/B2B-11).

## O que permanece igual da Rodada 1 (não precisou de correção)

GSI4 reaproveitado como `MembershipByUser` (esparso, seguro — confirmado por grep independente nas duas rodadas de autograde); `ownerCount` transacional (mecanismo confirmado correto sob `TransactWriteItems` real); dedup pointer de convite tenant-scoped em vez de tenantless (confirmado aceitável por ambos os lados — organizationId já é conhecido no momento de criar o convite); S3/migração/cutover de `dev` (§9 da Rodada 1, sem achado novo).
