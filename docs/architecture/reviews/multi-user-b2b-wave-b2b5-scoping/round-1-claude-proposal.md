# Multi-User B2B — Wave B2B-5 (RequestContext Cutover), Rodada 1 — Proposta Claude

Contexto: Waves B2B-0 a B2B-4 `DONE` (D-084 a D-094). `Organization`/`Membership`/`CreateOrganizationService` (B2B-3) e `OnboardingStateResolver` (B2B-4) existem mas não têm nenhum consumidor real ainda. Esta rodada não é sobre SE avançar (`roadmap-evolution/17` §110 e o physical model `multi-user-b2b-physical-model.md` §3/§10-13 já especificam o design final, `APPROVED` D-086) — é sobre COMO decompor a implementação em unidades de `definition-of-done.md`, e sobre um conjunto de lacunas concretas que o physical model deixa como "derivar depois" e que a implementação real precisa fechar agora, uma vez ou outra.

Submetido ao protocolo por decisão própria (não pedido explícito do Marcelo desta vez, mas por analogia direta com D-092: primeira wave a mexer de verdade em `resolve-request-context.ts`/`bootstrap-identity.ts`/`bff-auth-service.ts`, o núcleo do login real, nível 5-6 de `change-risk-scale.md`).

## 1. Inputs não-negociáveis (já `APPROVED`, D-086 — esta rodada não reabre)

- `bootstrapUser()` estado final (physical model §3): `TransactWriteItems` de **2 itens** (`User` global + `IdentityMapping` tenantless) — nenhuma `Organization`/`TenantLifecycleRecord` criada no login. Autenticação deixa de equivaler a criar tenant.
- `IdentityMapping` perde `tenantId` (§2).
- `DeviceSession` migra para `PK=USER#<userId>`/`SK=SESSION#<deviceId>` (§10) — `logoutAll` passa a ser user-global por construção (mudança de contrato observável, avaliada e aceita no design).
- `RequestContext` (§11): resolução via `claims.sub → IdentityMapping (userId) → seleção de organização → GetItem Membership(userId, organizationId) → TenantLifecycleRecord(organizationId) ACTIVE → RequestContext`. GSI4 só lista, nunca autoriza.
- BFF session ganha `activeOrganizationId?` (§12) e uma operação `POST /bff/organization/select`.
- `resolveCandidateUserId` — disposição já fechada (§13 do physical model): **fora de escopo desta wave**, é condição de saída de B2B-12.
- Cutover de `dev`: reset/reseed, não migração one-shot (§14) — sem fallback de compatibilidade permanente.

## 2. Achado central desta rodada — 3 lacunas reais que o physical model não fecha

O physical model descreve a forma final do dado e o fluxo lógico de resolução, mas não decide três coisas que só aparecem ao confrontar o design com o código real:

### 2.1. O mecanismo de "seleção de organização" não tem como chegar do BFF até o `RequestContextResolver` hoje

A BFF encaminha para a API de recurso o **access token Cognito bruto** (`proxy-service.ts:47`, `Bearer ${session.accessToken}`) — o `RequestContextResolver` do lado do recurso só enxerga `ValidatedClaims` (o JWT já validado pelo authorizer do API Gateway), nunca a linha `Session` da BFF. `activeOrganizationId` (§12) vive só na sessão da BFF; não existe hoje nenhum canal (header, claim customizada, token reemitido) que o carregue até o resolver do lado do recurso. O physical model registra a existência dessa seleção, não o mecanismo de transporte.

**Achado**: hoje, por construção, todo usuário tem **0 ou 1** `Membership` `ACTIVE` (único writer é `CreateOrganizationService`, chamado no máximo uma vez por onboarding até B2B-8/Invitations existir — não há como um usuário ter 2 orgs ainda). Isso torna a ambiguidade que `activeOrganizationId` resolveria **inexistente na prática** até B2B-8. `roadmap-evolution/17` §111 (Wave B2B-6, "BFF Organization Context": "active org session field; org list; switch; CAS; invalid selection recovery; revoked membership behavior; multi-session semantics") é literalmente a wave que resolve esse mecanismo de transporte — e o wave tracker já registra B2B-6 como bloqueada por B2B-5, não o inverso.

**Proposta**: B2B-5 implementa o campo `activeOrganizationId` na sessão BFF e o endpoint `POST /bff/organization/select` (bookkeeping real, exercitável e testável mesmo com 1 única org — cumpre §12 literalmente), mas o **lado do recurso** (`RequestContextResolver`) NÃO consome nenhum hint de seleção nesta wave: ele deriva a organização sozinho via `queryGsi4` hidratado contra a base (mesmo padrão do `OnboardingStateResolver`) e, sob a invariante atual de "no máximo 1 `Membership` `ACTIVE`", usa essa única entrada diretamente. Se mais de uma aparecer (impossível hoje, mas defensivo), o resolver falha fechado com um erro explícito em vez de escolher silenciosamente — nunca "pega a primeira". A plumbing real de multi-org (header/claim carregando `activeOrganizationId` do BFF até o recurso) fica para B2B-6, quando `Membership` múltipla passar a ser alcançável de verdade (B2B-8). Isto não contradiz §12 — só separa "a sessão sabe qual organização está ativa" (B2B-5, bookkeeping) de "a chamada de recurso usa essa seleção para desambiguar" (B2B-6, só necessário quando há o que desambiguar).

### 2.2. `Membership.role` tem 4 valores; a matriz de autorização hoje em produção só conhece 3

`authorization.ts` (a matriz `ACTION_ROLES` que já está em produção, gate real de toda ação hoje) usa `Role = "OWNER" | "MEMBER" | "VIEWER"` — sem `ADMIN`. `Membership.role` (`domain/membership.ts`, D-090) já declara `"OWNER" | "ADMIN" | "MEMBER" | "VIEWER"`. O physical model resolve isso adiando para "matriz central... Wave B2B-7" (§11), mas não diz o que o B2B-5 deve fazer com o `ADMIN` no meio-tempo, quando `RequestContext.tenant.roles` passar a vir de `Membership.role` em vez de `UserProfile.roles` fixo (`["OWNER"]`).

**Achado**: hoje `ADMIN` é dado **inalcançável** — o único writer de `Membership` (`CreateOrganizationService`) sempre grava `role: "OWNER"`; não existe endpoint de convite/mudança de role até B2B-7/B2B-8. Um `Membership` `ADMIN` não pode existir em nenhum ambiente real ainda.

**Proposta**: não escrever nenhum mapeamento especulativo de `ADMIN` em `authorization.ts` nesta wave (`principles.md` #1 — não inventar política de permissão para um valor que nenhum writer produz). Deixar o `Role` de `authorization.ts` como está (3 valores); o cast existente `context.tenant.roles as Role[]` já é unsafe e, se um dia um `ADMIN` aparecer antes de B2B-7, falha fechado por acidente (nenhum `ACTION_ROLES` set contém `"ADMIN"` → `INSUFFICIENT_ROLE` para tudo) — comportamento seguro, não silenciosamente permissivo. Documentar isso explicitamente (comentário em `authorization.ts` + `decisions-log.md`) como decisão consciente, não lacuna esquecida, e registrar como pré-condição textual de B2B-7: "a matriz real de permissions deve tratar `ADMIN` antes que qualquer writer real o produza."

### 2.3. Fechar o loop de onboarding precisa de um primeiro consumidor HTTP para `CreateOrganizationService` — senão B2B-5 sozinha deixa todo login novo permanentemente preso

Uma vez que `bootstrapUser()` para de criar tenant automaticamente, um usuário recém-logado com zero `Membership` fica em `NO_TENANT_NO_MEMBERSHIP` (`OnboardingStateResolver`) sem NENHUM caminho de saída, porque `CreateOrganizationService` (B2B-3) não tem consumidor real. D-092 deixou essa exposição HTTP "adiada até haver consumidor real (provavelmente B2B-5/B2B-6)" — ambíguo entre as duas.

**Proposta**: B2B-5 inclui um endpoint mínimo `POST /bff/organizations` (só criação, sem lista/switch — isso é B2B-6) chamando `CreateOrganizationService` diretamente. Autorização desse endpoint é **por identidade, não por tenant**: qualquer usuário autenticado e bootstrapped (JWT válido + `IdentityMapping` resolvida) pode chamar, independente de já ter ou não uma `Membership` em outra organização — não passa pelo `authorize()`/`ACTION_ROLES` tenant-scoped (não há tenant ainda no momento da chamada, por definição). Superfície do caminho direto/API (bearer JWT sem sessão BFF) para criar a primeira org fica deliberadamente fora desta wave — nomeado aqui como decisão explícita, não omissão.

## 3. Decomposição proposta (per `definition-of-done.md`, cada subitem seu próprio gate)

| Subitem | Camada | Risco proposto |
|---|---|---|
| B2B-5.1 | Domain — `IdentityMapping` sem `tenantId`; `IdentityBootstrapService.bootstrapUser()` (renomeia `TenantBootstrapService`, a razão de manter o nome antigo em B2B-2 — "ainda cria tenant" — deixa de existir) com o transact de 2 itens; remoção de `UserProfile`/`user-repository.ts` legado (identidade agora é só `GlobalUser`) | 5 (muda contrato de `IdentityMapping` e elimina o auto-provision — o próprio gatilho central da wave, `change-risk-scale.md`) |
| B2B-5.2 | Persistence — `DeviceSession` migrado para `PK=USER#<userId>`; call sites em `bff-auth-service.ts` (linhas 178/470/498 hoje) atualizados | 4 (schema move mecânico, mas contrato observável de `logoutAll` muda, já aceito no design) |
| B2B-5.3 | Application — `RequestContextResolver` reescrito: bootstrap → `OnboardingStateResolver` → branch (`HAS_USABLE_MEMBERSHIP` só caminho que produz `RequestContext` real; os outros 3 estados produzem um erro tipado novo, ex. `OnboardingRequiredError` carregando o `OnboardingState`, mapeado pela camada HTTP/BFF a uma resposta distinguível) | 5 (o gate real de login, achado 2.1/2.2 resolvidos aqui) |
| B2B-5.4 | Application/HTTP — BFF `activeOrganizationId` + `POST /bff/organization/select` (bookkeeping, achado 2.1); `POST /bff/organizations` mínimo (achado 2.3) | 4 (novo endpoint, mas reaproveita `CreateOrganizationService` já existente sem mudança) |
| B2B-5.5 | Testes — suíte completa + matriz cross-tenant/adversarial cobrindo os 4 estados de onboarding pelo caminho real (não só o `OnboardingStateResolver` isolado de B2B-4), G-V3 desde a escrita | 2 (verificação) |

## 4. Fora de escopo desta wave (redesignado, não esquecido)

- Plumbing de `activeOrganizationId` do BFF até o `RequestContextResolver` do recurso (achado 2.1) — Wave B2B-6, condicionado a B2B-8 tornar multi-org alcançável.
- Matriz real de `permissions`/tratamento de `ADMIN` (achado 2.2) — Wave B2B-7.
- Lista/switch de organizations, UX de onboarding no frontend — Wave B2B-6/B2B-10.
- Migração de dados legados de `dev` (`TenantLifecycleRecord(tenantId=userId)` pré-cutover) — Wave B2B-12 decide reset vs. migração; B2B-5 não escreve nenhuma lógica de auto-migração silenciosa de tenant legado para Organization (`LEGACY_TENANT_ONLY` recebe o mesmo `OnboardingRequiredError` que `NO_TENANT_NO_MEMBERSHIP`, nunca uma conversão automática).
- Caminho direto/API para criar a primeira organização (achado 2.3) — deferido, não implementado.

## 5. Pergunta aberta para a crítica do Codex

Os achados 2.1-2.3 foram encontrados por leitura direta do código real (`proxy-service.ts`, `authorization.ts`, `bff-auth-service.ts`), não só do physical model. Pontos que quero pressão adversarial específica:

1. A separação B2B-5 (bookkeeping de `activeOrganizationId` sem consumo no resolver) / B2B-6 (plumbing real) é proporcional, ou esconde um risco de fazer o trabalho de sessão duas vezes?
2. O fail-closed acidental do `ADMIN` (achado 2.2) é aceitável para uma wave que se autodenomina "cutover", ou merece um assert explícito em vez de silêncio?
3. `POST /bff/organizations` autorizado só por identidade (sem tenant) é a superfície certa, ou deveria nascer com algum limite (ex. rate limit, cap de orgs por usuário) já nesta wave em vez de esperar abuso real?
