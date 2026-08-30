# Multi-User B2B — Wave B2B-5, Rodada 2 — Proposta Claude (incorpora crítica do Codex, Rodada 1: 7,8/10)

Todos os achados 2.1-2.3 da Rodada 1 foram confirmados genuínos pelo Codex (verificação linha-a-linha contra o código real). Esta rodada só revisa o que a crítica encontrou de errado/incompleto — a seção 1 (inputs não-negociáveis) e os achados 2.1-2.3 em si continuam válidos e não são repetidos aqui na íntegra (ver `round-1-claude-proposal.md`).

## Mudanças em resposta à crítica da Rodada 1

### A. B2B-5.4 estava misturando riscos diferentes — dividido, e um subitem removido

Aceito a crítica: `POST /bff/organization/select` e `POST /bff/organizations` são mudanças de natureza diferente (seleção vs. criação), e a crítica adicional é ainda mais forte — com a regra de cap da mudança C abaixo (no máximo 1 `Membership` `ACTIVE`/`SUSPENDED` por usuário até B2B-6), "selecionar" entre organizações continua sendo degenerado (nunca há mais de uma opção real). Em vez de manter um endpoint `POST /bff/organization/select` vestigial nesta wave, **removo-o do escopo de B2B-5 inteiramente** — ele nasce em B2B-6, quando `select`/`switch` realmente têm o que fazer. B2B-5 seta `activeOrganizationId` na sessão automaticamente como efeito colateral de `POST /bff/organizations` (mudança D abaixo), sem precisar de uma chamada explícita separada.

Decomposição revisada:

| Subitem | Camada | Risco |
|---|---|---|
| B2B-5.1 | Domain — `IdentityMapping` sem `tenantId`; `IdentityBootstrapService.bootstrapUser()` (renomeia `TenantBootstrapService`) com transact de 2 itens; remove `UserProfile`/`user-repository.ts` legado | 5 |
| B2B-5.2 | Persistence — `DeviceSession` migrado para `PK=USER#<userId>` | 4 |
| B2B-5.3 | Application — `RequestContextResolver` reescrito (ver mudança B abaixo para a resolução de Membership única) | 5 |
| B2B-5.4 | Application/HTTP — sessão BFF identity-only (mudança E) + `POST /bff/organizations` com cap (mudança C/D) + `GET /bff/session` com contrato novo (mudança E) | 4 |
| B2B-5.5 | Testes — suíte completa + adversariais dos achados A-E, G-V3 desde a escrita | 2 |

`activeOrganizationId?` na sessão BFF (schema, §12) continua nascendo em B2B-5.4 — só a operação `select` explícita é que sai. Registro explícito (não elidido): isto é uma implementação PARCIAL de §12 do physical model, deliberada — ver mudança B abaixo em vez de alegar cumprimento literal.

### B. Desvio faseado de §11/§12 registrado explicitamente (em vez de "bookkeeping cumpre o design")

Aceito a crítica: dizer que a Rodada 1 "cumpre §12 literalmente" enquanto o resolver do lado do recurso não consome nada é impreciso. Registro como **desvio faseado explícito**, a ser fechado por B2B-6:

> B2B-5 implementa a resolução de `RequestContext` assumindo, por invariante de dados (mudança C), no máximo 1 `Membership` `ACTIVE`/`SUSPENDED` por usuário — o `RequestContextResolver` do lado do recurso hidrata via `queryGsi4()` e usa essa única entrada diretamente, sem consumir nenhuma seleção transportada da sessão BFF (não há canal de transporte, achado 2.1). Isto NÃO é a resolução final de §11 (`... → BFF session.activeOrganizationId (seleção) → GetItem direto Membership ...`) — é uma resolução válida apenas enquanto a invariante de unicidade se sustenta. Wave B2B-6 substitui esta resolução pela de §11 real quando B2B-8 tornar múltiplas Memberships alcançáveis e a invariante deixar de valer.

E, aceitando a crítica de que a resolução de "qual Membership usar" não pode ficar escondida dentro de um branch informal sobre o resultado do `OnboardingStateResolver`: `RequestContextResolver` (B2B-5.3) ganha seu próprio passo explícito de resolução, **sem alterar o contrato já aprovado/mergeado de `OnboardingStateResolver`** (D-094 — respeitar o que já fechou): depois de `OnboardingStateResolver.resolve(userId)` retornar `HAS_USABLE_MEMBERSHIP`, o resolver faz sua PRÓPRIA `queryGsi4()` + hidratação (mesmo padrão, poucas linhas, duplicação aceita como custo de não reabrir um contrato já `DONE`) filtrando só `ACTIVE`, e **falha fechado com um erro interno explícito e testado** se encontrar mais de uma (nunca "pega a primeira" — exatamente o que a Rodada 1 já previa, agora com o passo nomeado em vez de implícito).

### C. Regra de cap explícita em `POST /bff/organizations` — fecha o achado novo do Codex

Aceito integralmente: sem isso, a própria B2B-5 torna `Membership` múltipla alcançável antes de existir qualquer plumbing para lidar com isso (contradiz a invariante da mudança B). `POST /bff/organizations` chama `OnboardingStateResolver.resolve(userId)` **antes** de `CreateOrganizationService.createOrganization()` — só prossegue se o estado for `NO_TENANT_NO_MEMBERSHIP` ou `LEGACY_TENANT_ONLY`; `HAS_USABLE_MEMBERSHIP`/`SUSPENDED_ONLY` retornam `409`. Efeito colateral bom, não custo: dá ao `OnboardingStateResolver` (B2B-4, D-094) seu primeiro consumidor real.

`CreateOrganizationService` (D-091) **não é alterado** — a regra de cap vive na camada de aplicação do novo endpoint, não no serviço de criação em si (respeita o contrato já aprovado "cada chamada cria um recurso novo, sem retry/idempotência").

**Limitação nomeada, não escondida**: checar-então-agir (`resolve()` depois `createOrganization()`) não é atômico — duas requisições concorrentes do mesmo usuário (duplo clique) podem ambas passar o cap antes de qualquer uma criar, violando a invariante por uma janela de corrida. Aceitável para esta wave (sem produção real, pior caso é inconveniência a corrigir manualmente em `dev`, D-093) mas registrado explicitamente como gap conhecido, não descoberto depois: fechamento real (ex. atributo transacional em `GlobalUser` tipo `hasOwnedOrganization`) fica para se/quando B2B-6/B2B-7 precisarem de uma garantia mais forte.

### D. `activeOrganizationId` setado automaticamente na criação, sem endpoint `select` separado

`POST /bff/organizations`, ao suceder, grava `activeOrganizationId = <nova org>` na sessão BFF na mesma operação (CAS/OCC já existente na sessão, mesma disciplina de D-053/D-054) — não precisa de uma segunda chamada do frontend. Isto é suficiente para o único fluxo real possível em B2B-5 (0 → 1 organização); o mecanismo de troca entre múltiplas (quando existirem) é B2B-6.

### E. Sessão BFF identity-only — fecha os dois achados novos do Codex

- **`handleCallback` (bff-auth-service.ts)**: substitui o check atual (`if (!profile) throw ...`) — pós-cutover não existe mais `profile`/`UserProfile`. Novo fluxo: `bootstrapUser()` (2 itens, sempre cria/retorna `GlobalUser`+`IdentityMapping`) → checa `GlobalUser.identityStatus === "ACTIVE"` (substitui o check de status antigo, mesma função, fonte diferente) → chama `OnboardingStateResolver.resolve(userId)` uma vez → cria a sessão BFF com `tenantId` REMOVIDO do schema (§12) e `activeOrganizationId` setado SE `HAS_USABLE_MEMBERSHIP` (auto-seleciona a única existente), ausente caso contrário. Sessão sempre é criada (login nunca falha por falta de organização) — só o `activeOrganizationId` fica vazio.
- **`GET /bff/session` (`bff-handlers.ts`)**: contrato novo — `{ authenticated: true, userId, activeOrganizationId?: string, onboardingState?: OnboardingState }` (`onboardingState` recalculado a cada leitura via `OnboardingStateResolver` quando `activeOrganizationId` estiver ausente, para o frontend saber se deve mostrar "criar organização" vs. algo mais específico como suspenso). `tenantId` sai da resposta.
- `logoutDevice`/`logoutAll` (linhas 470/498 hoje) passam a usar a chave `USER#<userId>` (mudança B2B-5.2), sem mais depender de `session.tenantId`.

### F. `ADMIN` — assert explícito no boundary, não fail-closed acidental

Aceito a crítica: no ponto onde `Membership.role` vira `RequestContext.tenant.roles`, `RequestContextResolver` valida explicitamente `role` contra o conjunto conhecido (`"OWNER" | "MEMBER" | "VIEWER"`) e lança um erro interno tipado e nomeado (`UnsupportedMembershipRoleError` ou similar) se encontrar `"ADMIN"` (ou qualquer valor futuro desconhecido) — em vez de deixar isso silenciosamente virar `INSUFFICIENT_ROLE` em todo `authorize()`. Teste dedicado com G-V3 ("remover este assert deixaria um `Membership` `ADMIN` produzir um `RequestContext` que nega toda ação, sem nenhum sinal de que a causa raiz é falta de suporte a `ADMIN`, não falta de permissão real — o teste verifica que o erro certo aparece"). `authorization.ts` continua sem nenhuma mudança de política — a decisão de como `ADMIN` deve se comportar continua sendo Wave B2B-7, só o modo de falha muda de silencioso para nomeado.

## O que NÃO mudou desde a Rodada 1

- Achados 2.1/2.2/2.3 (fatos) — confirmados pelo Codex, mantidos.
- Fora de escopo (seção 4 da Rodada 1): plumbing real de `activeOrganizationId` (B2B-6), matriz de `permissions`/política real de `ADMIN` (B2B-7), lista/switch/UX (B2B-6/B2B-10), migração de dados legados de `dev` (B2B-12), caminho direto/API para criar a primeira org (deferido).

## Pergunta aberta para a Rodada 2

A remoção completa de `POST /bff/organization/select` (mudança A) resolve a crítica de escopo misturado, mas é o extremo oposto: B2B-6 herda tanto o transporte real (`activeOrganizationId` → recurso) quanto a própria existência do endpoint de seleção. Isso é proporcional, ou faz mais sentido manter um `select` mínimo (sem CAS multi-org ainda, só re-afirmar a única org existente) em B2B-5 como preparação de contrato para B2B-6?