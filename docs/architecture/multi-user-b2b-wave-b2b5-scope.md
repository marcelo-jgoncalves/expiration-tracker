# Multi-User B2B — Wave B2B-5 (RequestContext Cutover), escopo final

**Status: `APPROVED`** via protocolo Claude↔Codex (`AGENTS.md` §4, nível 5-6 de `change-risk-scale.md` — primeira wave a mexer de verdade no fluxo de login real), 3 rodadas, nota cega cada rodada: Rodada 1 Claude 7,8/Codex 7,8; Rodada 2 Claude 8,7/Codex 8,6; Rodada 3 Claude 9,1/Codex 9,1 (fechamento, ambos ≥9,0, sem arredondar). Registrado como `docs/architecture/decisions-log.md` D-095. Evidência completa das 3 rodadas: `docs/architecture/reviews/multi-user-b2b-wave-b2b5-scoping/`.

Submetido por iniciativa própria (não por pedido explícito do Marcelo desta vez — por analogia direta com D-092: primeira wave desde B2B-4 a tocar `resolve-request-context.ts`/`bootstrap-identity.ts`/`bff-auth-service.ts` de verdade). O design técnico final já estava `APPROVED` desde D-086 (`multi-user-b2b-physical-model.md` §3/§10-13) — esta rodada não reabre esse design, só decide COMO decompor a implementação e fecha 3 lacunas concretas que só apareceram ao ler o código real, não estavam documentadas antes.

## Achado central que motivou a rodada

O physical model (D-086) especifica a forma final do dado e o fluxo lógico de resolução de `RequestContext`, mas deixa 3 lacunas reais só visíveis ao confrontar o design com o código:

1. **Não existe canal de transporte** entre a seleção de organização na sessão BFF (`activeOrganizationId`) e o `RequestContextResolver` do lado do recurso — a BFF encaminha só o access token Cognito bruto (`proxy-service.ts:47`), o resolver nunca vê a sessão.
2. **`Membership.role` tem 4 valores (`OWNER|ADMIN|MEMBER|VIEWER`), a matriz de autorização real em produção (`authorization.ts`) só conhece 3** (sem `ADMIN`) — o physical model adia a matriz real para B2B-7 mas não diz o que fazer com `ADMIN` no meio-tempo.
3. **`bootstrapUser()` estado final para de criar tenant automaticamente** — sem um primeiro consumidor HTTP para `CreateOrganizationService` (B2B-3), todo login novo ficaria permanentemente preso em `NO_TENANT_NO_MEMBERSHIP` sem nenhum caminho de saída.

## Escopo final

### Decomposição (per `definition-of-done.md`, cada subitem seu próprio gate)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-5.1 | Domain — `IdentityMapping` sem `tenantId`; `TenantBootstrapService` renomeado `IdentityBootstrapService`, `bootstrapUser()` com `TransactWriteItems` de **2 itens** (`User` global + `IdentityMapping`, nenhuma `Organization`/`TenantLifecycleRecord`); remove `UserProfile`/lógica tenant-scoped legada de `user-repository.ts` (identidade passa a ser só `GlobalUser`) | 5 |
| B2B-5.2 | Persistence — `DeviceSession` migra para `PK=USER#<userId>`/`SK=SESSION#<deviceId>` (perde prefixo `TENANT#` — inatingível por W3-07/purge por construção de chave, mesmo argumento de `User`, physical model §121 Q11); call sites em `bff-auth-service.ts` atualizados | 4 |
| B2B-5.3 | Application — `RequestContextResolver` reescrito: bootstrap (2 itens) → `OnboardingStateResolver.resolve(userId)` → só `HAS_USABLE_MEMBERSHIP` prossegue; resolução de qual `Membership` usar é um passo PRÓPRIO e nomeado dentro do resolver (`queryGsi4()` + hidratação contra a base, mesmo padrão de `OnboardingStateResolver` mas sem reabrir o contrato já `DONE` de D-094) — falha fechado com erro explícito se encontrar mais de uma `ACTIVE` (nunca "pega a primeira"); assert explícito (erro nomeado, testado) se `Membership.role` não for um dos 3 valores que `authorization.ts` conhece hoje (fecha o achado 2 sem inventar política de `ADMIN`) | 5 |
| B2B-5.4 | Application/HTTP — sessão BFF identity-only (`handleCallback` reescrito, nunca falha por falta de organização) + `POST /bff/organizations` com cap transacional (fecha o achado 3) + `GET /bff/session` com self-heal (ver mecanismos abaixo) — mantido como item coeso, mas a linha `DoD:` final lista cada subparte separadamente | 5 |
| B2B-5.5 | Testes — suíte completa + adversariais dos mecanismos abaixo, G-V3 desde a escrita | 2 |

### Mecanismos-chave decididos nesta rodada

**Resolução de `RequestContext` sem transporte de seleção (desvio faseado explícito de §11/§12)**: B2B-5 assume, por invariante de dados (cap abaixo), no máximo 1 `Membership` `ACTIVE`/`SUSPENDED` por usuário — o resolver do lado do recurso deriva essa única entrada sozinho via `queryGsi4()` hidratado, sem consumir nenhum hint da sessão BFF (não há canal de transporte, achado 1). Isto **não é** a resolução final de §11 — é válida só enquanto a invariante de unicidade se sustenta. Wave B2B-6 substitui pela resolução real de §11 quando B2B-8 tornar múltiplas Memberships alcançáveis. `POST /bff/organization/select` **não nasce nesta wave** — com o cap abaixo, "selecionar" entre organizações é degenerado (nunca há mais de uma opção); nasce em B2B-6 junto com lista/switch/CAS real.

**Cap transacional em `POST /bff/organizations`**: `GlobalUser` ganha `hasCreatedOrganization?: boolean`, atualizado via `Update` condicionado (`attribute_not_exists`) na MESMA `TransactWriteItems` de `CreateOrganizationService` (5 itens, não 4) — não check-then-act. `CreateOrganizationService` (D-091) ganha uma refatoração aditiva (`buildCreateEntries()` separado de `createOrganization()`, comportamento idêntico para chamadores existentes) para o novo fluxo HTTP compor o 5º entry sem duplicar a lógica dos outros 4. `CreateOrganizationService.createOrganization()` em si continua sem cap embutido — a decisão de exigir cap é do chamador HTTP de onboarding, preservando o motivo original de D-091. **Cuidados de implementação identificados pelo Codex, registrados aqui para não se perderem**:
- Não usar `buildVersionedUpdate()` como está para o `Update` do `hasCreatedOrganization` — esse builder injeta uma condição de `tenantId` (`occ.ts`) que `GlobalUser` (tenantless) não tem; precisa de um builder tenantless específico ou entry manual, testado.
- O mapeamento de `TransactionCanceledException` para `409` precisa inspecionar `CancellationReasons` **por índice** (qual dos 5 itens cancelou), não tratar qualquer cancelamento da transação como "cap atingido" — os outros 4 `Put`s também têm suas próprias condições.
- `hasCreatedOrganization` é semanticamente "já criou uma organização própria", não "tem uma Membership ativa/suspensa" — nomear isso explicitamente como cap temporário de auto-criação; B2B-6/B2B-8 não devem reaproveitá-lo como regra geral de multi-org ou convite.
- Teste obrigatório: usuário/`GlobalUser` existente sem o atributo (fixture pré-cutover) — primeira criação seta o atributo, retry seguinte recebe `409`.

**Recovery entre tabela principal e tabela de sessão BFF**: a tabela principal é a única fonte de verdade (`Organization`/`Membership`); `Session.activeOrganizationId` é cache/hint de UX, nunca usado para autorização (autorização real é sempre o `RequestContextResolver` do lado do recurso, independente da sessão) — uma sessão desatualizada não pode causar escalação de privilégio, só um soluço de UX. `POST /bff/organizations` grava a organização (atômico, tabela principal) e SÓ DEPOIS tenta atualizar a sessão (`Update` OCC, best-effort, tabela separada — não há `TransactWriteItems` cruzando as duas tabelas). Falha nesse segundo passo é inofensiva por construção, fechada pelo self-heal abaixo.

**Self-heal em `GET /bff/session`/`handleCallback`**: se `session.activeOrganizationId` ausente, chama `OnboardingStateResolver.resolve(userId)` — se `HAS_USABLE_MEMBERSHIP`, deriva a organização (mesma hidratação de B2B-5.3), retorna na resposta IMEDIATAMENTE, tenta gravar de volta na sessão best-effort (idempotente, não bloqueia a resposta). Fecha o cenário de um usuário preso vendo "crie uma organização" quando já tem uma (corrida do passo anterior, ou segunda sessão/dispositivo).

## O que fica fora desta wave (redesignado, não esquecido)

- Plumbing real de `activeOrganizationId` do BFF até o `RequestContextResolver` do recurso, e o próprio endpoint `select` — Wave B2B-6, quando B2B-8 tornar multi-org alcançável.
- Matriz real de `permissions`/política real de `ADMIN` — Wave B2B-7 (B2B-5 só torna o `ADMIN` não-suportado um erro nomeado/testado, não silencioso — não decide a política real).
- Lista/switch de organizations, UX de onboarding no frontend — Wave B2B-6/B2B-10.
- Migração de dados legados de `dev` (`TenantLifecycleRecord(tenantId=userId)` pré-cutover) — Wave B2B-12 decide reset vs. migração; B2B-5 não escreve nenhuma lógica de auto-migração silenciosa (`LEGACY_TENANT_ONLY` recebe o mesmo tratamento de `NO_TENANT_NO_MEMBERSHIP` — onboarding, nunca conversão automática).
- Caminho direto/API (bearer JWT sem sessão BFF) para criar a primeira organização — deferido, não implementado nesta wave.

## Aplicação de `docs/engineering/definition-of-done.md` (E-013)

Implementação real desta wave deve cobrir com teste, no mínimo: os 3 mecanismos-chave acima (resolução de Membership única com falha fechada em >1; cap transacional incluindo o cenário de retry pós-criação; self-heal de sessão), o assert de `ADMIN` não suportado, e a migração de `DeviceSession` (chave nova, inatingível por purge). G-V3 (mutação nomeada por escrito) aplicado desde a escrita de cada teste, não retrofitado depois.
