# Frontend Production Foundation — BFF completo + fundação de frontend real

Status: **APPROVED AS FRONTEND PRODUCTION FOUNDATION** (protocolo `AGENTS.md` §4 completo — Rodada A §29, Rodada B §30, Rodada C §31, Rodada D §32/§33, 6 passagens até convergir, 5 achados bloqueantes reais encontrados e corrigidos, todos verificados experimentalmente contra o código pré-correção). Escopo: implementação real (não só design) do Full BFF (D-053/D-054, antes só aprovado em design) e de uma fundação de frontend de produção — explicitamente **não** as 17 Interaction Surfaces completas, não é identidade visual/design system final, não é validação de UX (`docs/frontend/README.md`'s "User Validation" continua não iniciada e não é pré-requisito deste trabalho).

## 1. Executive Summary

Esta sessão implementou, de ponta a ponta, o Full BFF desenhado em D-053/D-054 (`src/modules/bff/`, 56 testes unitários, infra Terraform real em `infra/modules/bff-session-table/` e `infra/modules/bff-api-gateway/`) e uma fundação de frontend de produção real (`frontend/`, projeto npm separado — Vite + React 18 + TypeScript + React Router v7 + TanStack Query v5, 41 testes unitários/componente + 6 cenários de smoke E2E via Playwright). Uma única tela real (Overview, somente leitura) prova que o pipeline completo — Browser → cookie de sessão → BFF → backend real via JWT authorizer nativo → resposta tipada → UI — funciona de ponta a ponta, sem construir as 17 Interaction Surfaces nem qualquer decisão de design visual final.

Durante o trabalho, dois achados reais de segurança/corretude pré-existentes foram corrigidos: o `requestHash` de idempotência de `createItem` usava concatenação por delimitador (`|`), com colisão real possível para campos livres contendo esse caractere — migrado para JSON canônico + SHA-256 (§17); e o frontend agora efetivamente envia o header `Idempotency-Key` que o backend já suportava de forma opt-in-não-usada desde `interface-validation-readiness.md`.

Nenhuma decisão de UX/hierarquia/copy/navegação foi cristalizada — a estrutura de rotas, o shell e os componentes estruturais foram desenhados para sobreviver a User Validation sem reescrita arquitetural (ver auto-checagem final em §33).

## 2. Scope

Nesta etapa (fases F0-F3 + fatia mínima de F4, nomenclatura desta sessão):

- **F0** — confirmação de stack (nenhuma decisão prévia existia; ver §6).
- **F1** — Full BFF real: sessão opaqua, OIDC/PKCE, callback, refresh transparente com rotação nativa do Cognito, CSRF em 3 camadas, logout (local + best-effort `RevokeToken`), proxy com allowlist explícita.
- **F2** — fundação de app frontend: bootstrap, roteamento, rotas protegidas com return-context, shell estrutural, cliente de API único, modelo de erro tipado.
- **F3** — primitivas de interação: loading/empty/error/async-state, OCC como estado explícito, idempotência de mutação, `UNKNOWN_OUTCOME`.
- **F4 (mínimo)** — uma vertical slice real e propositalmente fina: Overview (`/overview`), somente leitura, para provar que o pipeline conecta de ponta a ponta.

## 3. Non-Goals

Explicitamente fora de escopo nesta etapa (não avaliar como "faltando", são exclusões deliberadas):

- As 17 Interaction Surfaces (`SURF-001`–`SURF-017`) completas.
- Identidade visual, design system definitivo, alta fidelidade visual — `frontend/src/styles/foundation.css` é estrutural/neutro (tokens em escala de cinza), não uma decisão de marca.
- Copy final de produto — todo texto visível é funcional/provisório.
- Layout final de collections, dashboard final, fluxo final de fechamento do `BLOCKER-C`.
- Resolução de `BLOCKER-A`/`BLOCKER-B`/`BLOCKER-C`/`GTR-01` (permanecem bloqueados no backend — ver §26).
- Lançamento em produção pública.
- Infraestrutura de hospedagem estática do SPA (S3 privado + CloudFront) — não construída nesta sessão, ver gap explícito em §21/§26.

## 4. Baseline

Antes desta sessão: backend M0-M5 implementado e testado (590 testes antes desta sessão, ver `AGENTS.md` §7); planejamento de interface com 8 de 9 etapas `APPROVED` (`docs/frontend/README.md`), sem nenhum frontend de produção; Full BFF **aprovado apenas em design** (D-053 nota 9,2/9,3, D-054 amendment nota 9,2/9,4) — nenhuma linha de `src/modules/bff/` existia; `bff-frontend-quality-standard-proposal.md` (movido da raiz em 2026-08-29) como padrão de qualidade ainda não adotado formalmente, mas usado aqui como referência de linguagem/checklist (CSRF, allowlist, cookies `SameSite`, etc.).

## 5. Existing Frontend State (verificado empiricamente antes de escrever qualquer código)

Confirmado por inspeção direta do repositório no início desta sessão: não existia diretório `frontend/` nem `web/` nem qualquer `package.json` de SPA. `prototype/` (`docs/frontend/interface-interaction-prototype.md`) é HTML/CSS/JS estático sem dependências, propositalmente descartável — nunca foi tratado como código de produção e não foi reaproveitado como base de implementação (só como referência de convenções já validadas: `structuralNav()`, `feedback()`, nomenclatura de estados). Nenhuma decisão de stack de frontend existia em nenhum ADR ou documento de arquitetura.

## 6. Stack Decision/Confirmation

Nenhuma decisão prévia existia — escolhida objetivamente nesta sessão, critério "simples, maduro, previsível, baixo custo operacional", não hype-driven:

| Camada | Escolha | Por quê |
|---|---|---|
| Build/dev server | Vite 5 | Padrão de facto para SPA React em 2026, config mínima, HMR rápido |
| UI | React 18 | Já usado implicitamente como referência mental do projeto (protótipo é vanilla, mas toda a documentação de interface pressupõe componentização React-like); maduro, grande ecossistema de testing-library |
| Linguagem | TypeScript estrito | Consistência com o backend (`tsconfig.json` do backend também usa `strict`+`noUncheckedIndexedAccess`) |
| Roteamento | React Router v7 (API declarativa v6-compatível) | Maduro, sem dependência de framework full-stack (Next.js) desnecessária — `bff-frontend-quality-standard-proposal.md` §6 já descartava Next.js só para ter BFF, pois o BFF é um Lambda separado, não parte do frontend |
| Estado de servidor | TanStack Query v5 | Cache/retry/loading-state de chamadas HTTP sem reinventar — retry configurado por call site (§41 da missão), nunca um default genérico |
| Estado local/global | Nenhuma lib (sem Redux/Zustand) | Nenhuma necessidade comprovada ainda — `AuthContext` via Context API nativa é suficiente para o único estado verdadeiramente global (sessão) |
| CSS | Nenhum framework, CSS estrutural puro | Design visual final explicitamente fora de escopo (§3) — qualquer framework de UI hoje seria descartado depois de User Validation |
| Testes unitário/componente | Vitest + Testing Library | Mesmo test runner do backend (`vitest`), consistência de ferramental |
| Testes E2E | Playwright | Já usado como dependência (`@playwright/test`) nos testes automatizados do protótipo (`prototype/`) — reaproveita familiaridade, não introduz ferramenta nova |

Nenhuma dependência de gerenciamento de formulário (Formik/React Hook Form) foi adicionada — não há formulário real nesta fase (Overview é somente leitura); a convenção de formulário fica para quando a primeira tela de mutação for construída, para não fixar uma escolha sem um caso real para validá-la.

## 7. Frontend Architecture

```text
frontend/
  src/
    api/            cliente HTTP único, tipos de contrato, erro tipado, política de retry
    auth/           AuthContext (máquina de estados), ProtectedRoute
    components/     primitivas de loading/erro/empty/async-state, ErrorBoundary
    hooks/          useIdempotentMutation, useOccMutation
    observability/  sink de eventos (console por padrão, trocável)
    routes/         páginas (Overview real; demais são placeholders honestos)
    shell/          AppShell (landmarks estruturais, navegação)
    styles/         CSS estrutural único
    capabilities.ts flags de capacidade mapeadas 1:1 a blockers de backend
    App.tsx         composição raiz (QueryClient, Router, AuthProvider, ErrorBoundary)
    main.tsx        bootstrap
  test/             espelha src/ por tipo de teste
  e2e/              smoke tests Playwright (mockam o BFF via page.route())
```

Fiação de dependência deliberadamente unidirecional: `AuthContext` importa `apiClient` (para registrar `setOnUnauthorized`), mas `ApiClient` nunca importa `AuthContext` — o setter é a única costura entre os dois, evitando um ciclo de import entre a camada de rede e a camada de autenticação.

`QueryClient` tem `retry: false`/`refetchOnWindowFocus: false` como *default* — cada `useQuery`/`useMutation` real define sua própria política via `retryPolicyFor()` (§41 da missão), então um call site que esquecer de configurar falha visivelmente rápido em vez de herdar um retry que ninguém escolheu conscientemente.

## 8. BFF Architecture Mapping

```text
Browser
  |  cookie __Host-et_session (HttpOnly, opaco)
  v
CloudFront/API Gateway (bff-api-gateway)
  |
  v
BFF Lambda (src/runtime/aws/handlers/bff-handler.ts)
  |                                  \
  | lê/escreve sessão                 \ refresh/exchange via OIDC
  v                                    v
DynamoDB — tabela dedicada       Cognito (Hosted UI, /oauth2/token,
(bff-session-table, sem GSI,      /oauth2/revoke) — RefreshTokenRotation
KMS CMK dedicada p/ refresh       nativo como fonte de verdade
token cifrado)
  |
  | Bearer access token anexado server-side
  v
API Gateway (api-gateway existente) → JWT authorizer nativo → Lambdas de recurso
(inalterados desde M1-M5 — Full BFF é aditivo, nunca revoga o Bearer direto)
```

Camadas de `src/modules/bff/`:

- `domain/` — puro, sem I/O: `opaque-token.ts` (selector/secret, padrão generalizado de `GuestTokenPointer`), `cookies.ts` (nomes/atributos/TTLs), `session.ts` (forma de `Session`/`LoginAttempt`), `refresh-outcome.ts` (máquina de 5 estados), `csrf.ts`, `proxy-allowlist.ts` (39 rotas, extraídas exaustivamente dos `case "MÉTODO /rota":` reais de cada handler Lambda de recurso).
- `ports/` — `SessionStore`, `TokenEncryptor`, `CognitoOidcClient`/`IdTokenVerifier`.
- `application/bff-auth-service.ts` — orquestra login/callback/resolve/refresh/logout; `application/proxy-service.ts` — encaminha ao backend só rotas allowlisted.
- `persistence/` — adapters reais: DynamoDB, KMS (`@aws-sdk/client-kms`), Cognito via `fetch` nativo, verificação de ID token via `aws-jwt-verify`.
- `http/` — `bff-handlers.ts` (lógica HTTP pura, SDK-agnóstica) + `http-types.ts`.

`src/runtime/aws/handlers/bff-handler.ts` é o único ponto de composição real (lê 10 env vars obrigatórias via `requiredEnv()`, monta os adapters reais, roteia por `method + path`).

## 9. Authentication Flow

`GET /bff/login` gera um `LoginAttempt` de uso único (state/nonce/code_verifier PKCE) e redireciona ao Hosted UI do Cognito com `scope: "openid email"`. `GET /bff/callback` consome o `LoginAttempt` **atomicamente** (evita replay), troca o código de autorização por tokens, valida o `id_token` (assinatura/issuer/audience via `aws-jwt-verify` + verificação de `nonce` via `customJwtCheck`, já que o Cognito não valida nonce por si), resolve/cria o `IdentityMapping` (bug real corrigido nesta sessão: `newUserId()` era chamado duas vezes, produzindo `userId`≠`tenantId` e quebrando a invariante MVP "tenant = usuário"; corrigido para uma única chamada reaproveitada — ver §11), cria a sessão e redireciona de volta ao `returnTo` original.

## 10. Session Lifecycle

Sessão vive em tabela DynamoDB dedicada (`bff-session-table`, sem GSI, D-054), nunca na tabela principal. `absoluteExpiresAt` fixo na criação (nunca estendido por refresh) + `purgeAfterTtl` como idle timeout (TTL nativo do DynamoDB). Refresh é 100% transparente ao frontend — o SPA nunca chama um endpoint de refresh, só reage a um 401 na chamada de recurso.

`BffAuthService.refresh()` implementa a máquina de 5 estados (`RefreshOutcome`): `SUCCESS`, `DEFINITIVE_AUTH_FAILURE` (mata a sessão), `TRANSIENT_TRANSPORT_FAILURE` (sessão intacta, retryable), `CONCURRENT_REFRESH` (outra requisição já tem a lease, back off e releitura), `UNKNOWN_OUTCOME` (resposta perdida depois que o Cognito pode já ter rotacionado — nunca re-tentado silenciosamente além do que o chamador decidir). A rotação nativa do Cognito (`RefreshTokenRotation`, grace period 30s) é a fonte de verdade real; a lease do próprio BFF (`refreshState`/`refreshLeaseId`/`refreshLeaseUntil`, fencing token via `updateConditional`) é só uma otimização de latência sob concorrência, nunca a garantia de não-replay em si (D-054).

## 11. CSRF

Verificação em 3 camadas, todas precisam concordar (`checkCsrf()`, `src/modules/bff/domain/csrf.ts`):

1. `Sec-Fetch-Site` — falha fechado se ausente ou cross-site.
2. Double-submit cookie — header `X-CSRF-Token` deve ser igual ao cookie não-`HttpOnly` `__Host-et_csrf`.
3. Segredo armazenado na sessão — comparado ao cookie, nunca confiando só no double-submit (que sozinho não protege contra um atacante que também controla um subdomínio).

`frontend/src/api/client.ts` só anexa o header em métodos mutantes (`POST`/`PUT`/`PATCH`/`DELETE`) — nunca em `GET`, coberto por `test/api/client.test.ts`.

## 12. Routing

React Router v7 (API declarativa v6-compatível — upgrade de `^6.26.2` para `^7.18.2` durante esta sessão para corrigir uma CVE moderada de open-redirect, ver §23). Rotas mapeiam só as âncoras de topo do dual-anchor IA aprovado (Overview, Vencimentos, Fornecedores, Configurações) — nenhuma rota inventada por conveniência técnica.

`ProtectedRoute` (`src/auth/ProtectedRoute.tsx`) decide **quando** redirecionar (estado não `AUTHENTICATED`), mas o redirecionamento real ao Cognito é sempre navegação de página inteira (`window.location.assign`, nunca roteamento client-side) — o "return context" (path original) é capturado só como `${pathname}${search}` (nunca estado de formulário/dados sensíveis) e ida-e-volta pelo `LoginAttempt` do próprio BFF (server-side), nunca por `localStorage`/`sessionStorage`.

## 13. API Client

Camada única e coerente (`src/api/client.ts`'s `ApiClient`) — nenhum componente chama `fetch()` diretamente. Sempre `credentials: "include"` (o cookie de sessão é a única credencial, D-053). Timeout via `AbortController` distingue: timeout numa leitura → `NETWORK`; timeout numa mutação → `UNKNOWN_OUTCOME` (a mutação pode ter chegado ao backend mesmo sem resposta vista — a mesma lição de `CREATE-IDEMPOTENCY-01`). `onUnauthorized` dispara em todo 401 (nunca em 403 — `AUTHORIZATION` é "autenticado mas sem permissão", não "sessão morta"). `setOnUnauthorized()` é o único ponto de acoplamento com `AuthContext` (§7).

## 14. Contract Types

`src/api/types.ts` declara só o subconjunto de domínio de `ExpirationItem` que a UI realmente usa — a resposta real do backend também carrega campos internos de armazenamento (`PK`/`SK`/`GSI1PK`/`GSI1SK`); a tipagem estrutural do TypeScript torna esses campos extras inofensivos (nunca referenciados), evitando exigir uma mudança de forma de resposta do backend que esta fase não precisa.

## 15. Error Model

`src/api/errors.ts`'s `ApiError` espelha exatamente a forma que todo `AppError` do backend já serializa (`{code, category, message, retryable, details}`, `src/shared/errors/app-error.ts`) — reuso deliberado do contrato existente em vez de reinventar. Três categorias adicionais (`NETWORK`, `UNKNOWN_OUTCOME`, `PROCESSING`) não têm equivalente no backend — descrevem falhas que acontecem antes/ao redor de uma resposta do backend existir, uma preocupação exclusiva do frontend. Nunca reduzido a "Something went wrong": todo call site que captura um `ApiError` tem estrutura suficiente para renderizar algo específico (`isConflict`/`isAuthError`/`isUnknownOutcome`, todos com guarda contra valor não-`ApiError` — nunca lançam).

## 16. OCC

`useOccMutation()` (`src/hooks/useOccMutation.ts`) expõe `isConflict` (derivado de `isConflict(mutation.error)`), distinto de `isError` — um 409 nunca é apresentado como uma falha genérica. `ApiClient` anexa `If-Match: <expectedVersion>` quando `expectedVersion` é passado em `RequestOptions`.

## 17. Idempotency

`useIdempotentMutation()` (`src/hooks/useIdempotentMutation.ts`) gera **uma** `Idempotency-Key` (`crypto.randomUUID()`) por submissão lógica via `useRef`, só regenerada por uma chamada explícita a `newIntent()` — nunca por retry da mesma intenção (coberto por `test/hooks/useIdempotentMutation.test.tsx`, incluindo o caso "retry sem chamar `newIntent()` reusa a mesma chave").

Achado real investigado e corrigido no backend (`src/modules/expiration/application/expiration-service.ts`'s `createItem`): o `requestHash` usado para detectar reenvio-com-payload-diferente sob a mesma chave era concatenação por delimitador (`` `${name}|${category}|...` ``) — dois payloads genuinamente diferentes podiam colidir se um campo livre contivesse `|` (ex.: `name: "Foo|Bar", category: "Baz"` vs. `name: "Foo", category: "Bar|Baz"` produziam a mesma string). Migrado para serialização estruturada canônica (`JSON.stringify` de um objeto com chaves fixas) + SHA-256 (`node:crypto`, sem nova dependência) — teste de colisão adicionado em `test/unit/expiration/expiration-service.test.ts` provando o esquema antigo colidiria e o novo rejeita corretamente via `ConcurrentOperationError`.

O achado de "liveness" residual já conhecido (crash entre commit e conclusão pode devolver `ConcurrentOperationError` num retry em vez de reconciliar) foi preservado sem alteração — mudar esse comportamento para "reconciliar automaticamente" arriscaria duplicação sob uma condição de corrida mal coberta por teste; segurança de dados (não-duplicação) permanece estritamente mais importante que conveniência automática, e essa troca nunca foi reavaliada aqui por não ser necessária para esta fundação.

## 18. UNKNOWN_OUTCOME

Continua existindo como categoria de erro explícita mesmo com `createItem` agora idempotente — outras operações (e um timeout client-side em **qualquer** operação, inclusive uma já idempotente) ainda podem produzir um resultado ambíguo (§13). `ApiError.unknownOutcome()` é deliberadamente não-retryable no nível genérico — cada chamador decide, por classe de operação, se um retry automático é seguro (§41/`retryPolicyFor`).

## 19. Loading/Async Model

`src/components/AsyncStates.tsx`: `InitialLoading`/`BackgroundRefreshIndicator` (`role="status"`, `aria-live="polite"`) distinguem carregamento inicial de atualização de fundo; `ErrorState` (`role="alert"`) com retry opcional; 5 tipos de estado vazio (`true-empty`/`filtered-empty`/`not-ready`/`unavailable`/`permission-limited`) com copy default distinta por tipo — nunca colapsados na mesma mensagem; `AsyncFeedback` cobre os 5 estados de ação assíncrona (`PENDING`/`PROCESSING`/`COMPLETED`/`FAILED`/`UNKNOWN`), com `role="alert"` só para `FAILED`/`UNKNOWN`. Nenhuma decisão visual — aparência estrutural/neutra deliberada.

## 20. Accessibility Foundation

Nascida correta, não retrofitada: skip-link (`AppShell`), landmarks (`<nav aria-label>`, `<main id="surface-content" tabIndex={-1}>`), roles de status/alerta corretos desde a primeira versão de cada primitiva, `eslint-plugin-jsx-a11y` configurado como **erro** (não warning) desde o primeiro commit do projeto — `frontend/.eslintrc.cjs`. Testado em `test/components/AsyncStates.test.tsx` (roles reais via Testing Library, não snapshot) e nos smoke tests E2E (`getByRole` como seletor primário, não `data-testid`, forçando que os elementos sejam navegáveis por tecnologia assistiva).

## 21. Security Baseline

Cookies: `__Host-` prefix (exige `Secure`, `Path=/`, sem `Domain` — bloqueia sobrescrita por subdomínio), `HttpOnly` para sessão e login, `SameSite` diferenciado (`Lax` para login — sobrevive ao redirect cross-site do Hosted UI; `Strict` para sessão — só nasce após callback same-origin). CSRF em 3 camadas (§11). Proxy nunca é um proxy aberto — `PROXY_ALLOWLIST` (39 rotas exatas, extraídas do código real de cada handler, `/guest/*` deliberadamente excluído por já ser público) é a única superfície que `ProxyService.forward()` encaminha.

Headers de segurança adicionados nesta sessão: respostas do BFF Lambda (`toApiGatewayResult`, `src/runtime/aws/handlers/bff-handler.ts`) agora incluem `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security` e um CSP maximamente restritivo (`default-src 'none'; frame-ancestors 'none'` — toda resposta do BFF é JSON/redirect, nunca HTML executável). `frontend/index.html` ganhou um CSP via `<meta>` sem `unsafe-inline`/`unsafe-eval` (`default-src 'self'` + diretivas específicas).

**Gap real, documentado, não escondido**: `frame-ancestors`/`X-Frame-Options` não têm equivalente via `<meta>` (ignorados por especificação quando entregues assim) — proteção real contra clickjacking e HSTS para o próprio SPA (não o BFF) exigem uma CloudFront Response Headers Policy, que não existe ainda porque **nenhuma infraestrutura de hospedagem estática (S3 privado + CloudFront) foi construída nesta sessão** — o blueprint já previa essa camada (`docs/architecture/`), mas construí-la não estava nas fases F0-F4 desta missão. Registrado aqui como próximo passo real, não como "resolvido".

## 22. Observability

`src/observability/report.ts` — porta `ObservabilitySink` (mesmo padrão SDK-agnóstico de `src/shared/idempotency/idempotency.ts` no backend), sink padrão é só `console.error` (nenhum vendor escolhido ainda — decisão explicitamente adiada, não uma omissão). Cobre erro não-capturado (via `ErrorBoundary`), falha de BFF/rota/autenticação, falha de mutação crítica. **Nunca loga**: token, cookie, guest token, PII, conteúdo de documento — o parâmetro `context` é só para metadado estrutural (nome de rota/componente), nunca um valor de domínio.

## 23. Testing Strategy

| Camada | Onde | O quê |
|---|---|---|
| Unit (BFF backend) | `test/unit/bff/` | 56 testes — token opaco, CSRF, allowlist, proxy, `bff-auth-service` (login/callback/resolve/refresh nos 5 outcomes/logout/logout-all) |
| Unit (idempotência backend) | `test/unit/expiration/expiration-service.test.ts` | Teste de colisão do `requestHash` antigo vs. novo esquema |
| Unit/component (frontend) | `frontend/test/` | 41 testes — `ApiError`, `ApiClient` (CSRF/timeout/credentials/401), `retryPolicyFor`, `useIdempotentMutation`, `useOccMutation`, `AuthContext` (6 transições de estado), `AsyncStates` (roles de acessibilidade reais) |
| E2E/smoke (frontend) | `frontend/e2e/smoke.spec.ts` | 6 cenários via Playwright + Chromium real, BFF mockado via `page.route()` — redirect não-autenticado com `returnTo`, dashboard ordenado, estado vazio, falha de backend com retry funcional, expiração de sessão em 401, logout |
| Infra | `infra/modules/bff-*/tests/*.tftest.hcl` | `mock_provider` para atributos de recurso; provider real em modo plan só para conteúdo JSON de `aws_iam_policy_document` (mock substitui por string opaca) |

OCC e idempotência **não** são exercitados no E2E porque não existe UI de mutação nesta fase (Overview é somente leitura) — cobertos onde a lógica real vive (`useOccMutation.test.tsx`/`useIdempotentMutation.test.tsx`), em vez de forjados contra uma UI que ainda não existe. Nenhuma meta de 100% de cobertura — prioridade explícita em auth/sessão/BFF/roteamento/semântica de erro crítico/idempotência/OCC (mission §62), confirmada pela composição real da suíte acima.

## 24. CI Integration

Novo job `frontend` em `.github/workflows/ci.yml` (paralelo a `guardrails`/`dynamodb-integration`/`infra`, mesmo padrão de actions pinadas por SHA): install imutável, typecheck, lint, testes unitários, build de produção, `npm audit` (produção bloqueante, dev informacional referenciando `docs/engineering/exceptions.md`), instalação do Chromium do Playwright e os 6 smoke tests E2E, com upload do relatório do Playwright só em caso de falha.

## 25. Feature/Capability Flags

`src/capabilities.ts`'s `CAPABILITIES` — objeto constante simples, não um framework de feature flag (explicitamente rejeitado pela missão). Cada flag mapeia 1:1 a um blocker de backend nomeado (`documentsReadEnabled`→`BLOCKER-A`, `remindersEnabled`→`BLOCKER-B`, `externalClosureEnabled`→`BLOCKER-C`, `guestRequesterIdentityEnabled`→`GTR-01`), todas `false` — nenhuma virou `true` nesta sessão porque nenhum blocker foi resolvido no backend.

## 26. Known Blockers

Herdados de `docs/frontend/README.md`, carregados explicitamente, nenhum mascarado:

- `BLOCKER-A` (nenhuma rota lê/lista `Document`) — `documentsReadEnabled: false`.
- `BLOCKER-B` (materialização de `ReminderOccurrence` desconectada) — `remindersEnabled: false`.
- `BLOCKER-C` (ciclo de coleta externa não fecha sozinho) — `externalClosureEnabled: false`.
- `GTR-01` (guest flow não expõe identidade real do solicitante) — `guestRequesterIdentityEnabled: false`.
- `CREATE-IDEMPOTENCY-01`: **backend** resolvido desde `interface-validation-readiness.md` §14; nesta sessão o frontend passou a efetivamente enviar `Idempotency-Key` (§17) — a lacuna "nenhum frontend/BFF real envia o header" registrada em `docs/frontend/README.md` está fechada para o caminho de criação de item.
- Gap novo, registrado nesta sessão: infraestrutura de hospedagem estática (S3+CloudFront) do SPA não existe (§21) — headers de segurança reais (clickjacking/HSTS no domínio do próprio app) ficam parciais até essa camada existir.

## 27. First Vertical Slice

`frontend/src/routes/Overview.tsx` — real, somente leitura, conectada de ponta a ponta (`AuthProvider` → `ProtectedRoute` → `ApiClient` → `/bff/api/items/dashboard` → backend real protegido por JWT authorizer). Ordenada por `dueDate` ascendente (mesma correção de ordenação por urgência que `interface-validation-readiness.md` §12 encontrou faltando no protótipo, aplicada aqui desde o início em vez de redescoberta). Deliberadamente fina: nenhum formulário de criação/renovação, nenhuma ação mutante — existe só para provar que o pipeline conecta, não como uma tela validada de produto.

## 28. Deferred Visual Decisions

Toda decisão de aparência final é adiada para depois de User Validation: paleta de cor, tipografia, espaçamento, iconografia, copy final, layout de coleções, navegação lateral/topo definitiva, todo o design system de `bff-frontend-quality-standard-proposal.md` §27. `frontend/src/styles/foundation.css` é intencionalmente cru (tokens estruturais em escala de cinza) para que nenhum esforço visual seja descartado depois.

## 29. Claude Review (Rodada A — autoavaliação)

Autoavaliação contra os 12 gates da missão (`FPF-G1`–`FPF-G12`, nomeação desta sessão):

- **FPF-G1 (exposição de token)**: nenhum token OAuth alcança o browser em nenhum caminho testado — confirmado via `test/unit/bff/bff-auth-service.test.ts` (callback só seta o cookie opaco) e `frontend/test/api/client.test.ts` (nenhum header `Authorization` é construído pelo frontend).
- **FPF-G2 (segurança de sessão)**: tabela dedicada, KMS CMK dedicada, `SameSite` diferenciado, TTL absoluto+idle — todos implementados e testados.
- **FPF-G3 (lacuna de CSRF)**: 3 camadas, testadas individualmente (`test/unit/bff/csrf.test.ts`) e via header real (`frontend/test/api/client.test.ts`).
- **FPF-G4 (proxy genérico)**: `PROXY_ALLOWLIST` fechado, `/guest/*` fora, testado com rota não-listada retornando `undefined` (`proxy-allowlist.test.ts`).
- **FPF-G5 (retry inseguro)**: `retryPolicyFor` nunca retry em `non-idempotent-mutation`, nunca retry em erro não-`ApiError`/não-`retryable` — testado.
- **FPF-G6 (compressão de OCC)**: `isConflict` distinto de `isError`, testado isoladamente.
- **FPF-G7 (regressão epistêmica)**: `presentItemStatus()` centraliza domínio→apresentação, nenhum componente inventa label; nenhuma tela afirma capacidade além do que `CAPABILITIES` permite.
- **FPF-G8 (blocker escondido)**: `docs/frontend/README.md`/`CAPABILITIES`/este documento citam os 4 blockers nomeados consistentemente.
- **FPF-G9 (falha de baseline de acessibilidade)**: jsx-a11y como erro desde o primeiro commit, roles reais testados.
- **FPF-G10 (lock-in visual prematuro)**: nenhuma cor/fonte/marca definida; `foundation.css` é estrutural.
- **FPF-G11 (testes faltando)**: 41 unit/componente + 6 E2E + 56 BFF + 1 colisão de idempotência — cobrindo exatamente as áreas priorizadas pela missão.
- **FPF-G12 (confusão produção/protótipo)**: `frontend/` é um projeto de produção real (build/lint/typecheck real, sem HTML estático solto); `prototype/` continua claramente separado e nunca referenciado como base de implementação.

Achado próprio antes de qualquer revisão externa: ausência de headers de segurança HTTP no BFF e de CSP no SPA — corrigido nesta própria rodada (§21) antes de submeter à revisão do Codex, para não levar um gap conhecido e evitável à Rodada B.

## 30. Codex Review (Rodada B)

Executada via `codex exec` (protocolo `AGENTS.md` §4), com acesso de leitura ao repositório completo — Codex inspecionou o código real (não só a autoavaliação da Rodada A) contra 25 itens específicos de segurança/corretude. Achados reais (formato: item — severidade — resumo):

- **Item 7 — importante**: `LoginAttempt` não era consumido atomicamente — `get()` seguido de `update()` incondicional permitia duas callbacks concorrentes lerem `consumedAt=undefined` antes de qualquer uma gravar.
- **Item 10 — importante**: os 5 estados de `RefreshOutcome` existiam, mas `handleGetSession` capturava qualquer falha de `resolveSession` (incluindo falha transitória) e devolvia sempre `{authenticated:false}` — uma alegação mais forte do que o sistema podia sustentar (violação do próprio princípio de integridade epistêmica do projeto).
- **Item 11 — bloqueante**: o commit final de sucesso de `refresh()` usava `update()` incondicional em vez de `updateConditional()` — um refresh lento concluindo depois de um logout concorrente podia ressuscitar uma sessão revogada.
- **Item 12 — menor**: `checkCsrfForSession` (usado por logout/logout-all) tratava QUALQUER falha de `resolveSession` (não só "sessão realmente ausente") como "nada a proteger", incluindo uma falha transitória onde uma sessão real podia existir.
- **Item 19 — menor**: só o timeout em mutação (→ `UNKNOWN_OUTCOME`) tinha teste; o timeout em leitura (→ `NETWORK`) não.
- **Achado extra — importante**: `NEXT_SESSION_PROMPT.md` e `docs/architecture/README.md` ainda afirmavam "Full BFF: zero código implementado", contradizendo o código real já existente.
- **Achado extra — menor**: nenhum teste unitário direto para `src/modules/bff/http/bff-handlers.ts` (a fronteira HTTP que monta cookies, colapsa erros e aplica CSRF) — só seus serviços constituintes tinham teste.

Os demais 20 itens da lista de 25 foram confirmados `OK` com evidência de arquivo:linha real (não aceitos por alegação) — token nunca exposto ao browser, cookies `__Host-`/`HttpOnly`/`SameSite` corretos, refresh token cifrado, tabela de sessão IAM-isolada, `selectorHash` correto em todos os lookups, PKCE S256 real, nonce validado, allowlist do proxy fiel aos handlers reais, `requestHash` novo elimina a colisão comprovada, `useIdempotentMutation`/`useOccMutation`/`retryPolicyFor` corretos e testados, `CAPABILITIES` sem promessa não sustentada, headers de segurança presentes, observabilidade sem dado sensível, E2E não-tautológico, CI com working-directory/Node/lockfile corretos.

Resumo do Codex: "Há implementação real, mas não aprovaria ainda. Bloqueante principal: refresh lease/fencing não é seguro na finalização."

## 31. Reconciliation (Rodada C)

Todos os achados foram investigados contra o código real (nunca aceitos por alegação) e corrigidos nesta sessão, antes da Rodada D:

| Achado | Evidência confirmada | Correção aplicada |
|---|---|---|
| Item 11 (bloqueante) | Rastreamento manual confirmou: `refresh()`'s commit final usava `session` pré-lease e `update()` incondicional; um `logout()` concorrente não bumpava `version`, então mesmo uma correção ingênua não teria detectado a colisão | `refresh()` agora usa `updateConditional({...}, {version: session.version+1})`; em falha, relê a sessão — se revogada, retorna `DEFINITIVE_AUTH_FAILURE`, senão `UNKNOWN_OUTCOME`. `logout()`/`logoutAll()` agora bumpam `version` na revogação (necessário para o `updateConditional` acima realmente detectar a colisão). Teste novo: `bff-auth-service.test.ts`'s "a session revoked ... WHILE a refresh is in flight is never resurrected" (usa um novo hook de teste `onBeforeRefreshReturns` para simular a corrida deterministicamente) |
| Item 7 (importante) | Confirmado: `LoginAttempt` não tinha campo `version`, consumo era `get()`+`update()` simples | Adicionado `version` a `LoginAttempt`; consumo agora via `updateConditional`, falha → `AuthenticationError`. Teste novo: "two concurrent callbacks racing on the SAME LoginAttempt" (interleaving determinístico via `Promise.allSettled`, sem timers/IO real) |
| Item 10 (importante) | Confirmado: `handleGetSession`'s `catch` genérico não distinguia `AuthenticationError` de `DependencyUnavailableError` | `handleGetSession` agora só retorna `{authenticated:false}` para `AuthenticationError`; qualquer outra falha passa por `toErrorResponse` (o frontend já tem `REFRESH_FAILED` para exatamente este caso, via `SessionProbeError`). Também: `DependencyUnavailableError` ganhou um 4º parâmetro `retryable` (default `true`, compatível com os 2 call sites pré-existentes) e o `UNKNOWN_OUTCOME` de refresh agora usa `retryable: false` (Cognito pode já ter rotacionado — mesma convenção do `ApiError.unknownOutcome()` do frontend). Testes novos/atualizados em `bff-auth-service.test.ts` e novo `bff-handlers.test.ts` |
| Item 12 (menor) | Confirmado: o `catch` de `checkCsrfForSession` tratava qualquer erro como "sem sessão" | Agora só `AuthenticationError` retorna `true` (nada a proteger); qualquer outro erro falha fechado (`return false`) | 
| Item 19 (menor) | Confirmado: só existia teste de timeout em mutação | Teste novo em `frontend/test/api/client.test.ts`: timeout em `GET` → `NETWORK` |
| Docs desatualizadas (importante) | Confirmado: `NEXT_SESSION_PROMPT.md`/`docs/architecture/README.md` diziam "zero código" | Ambos atualizados para refletir a implementação real, incluindo o achado do próprio Codex sobre `UNKNOWN_OUTCOME`/`LoginAttempt`/commit incondicional |
| Sem teste de `bff-handlers.ts` (menor) | Confirmado: `find test/unit/bff` não listava nenhum arquivo para esse módulo | Novo `test/unit/bff/bff-handlers.test.ts` (11 testes) usando um `BffAuthService`/`ProxyService` reais (não duplos artificiais) — cobre login/callback/cookies, `handleGetSession` nos dois ramos (definitivo vs. incerto), CSRF em `handleLogout`/`handleProxy` nas 3 combinações (correto, header ausente, `Sec-Fetch-Site` cross-site) |

Todas as correções foram verificadas com testes reais executados (não apenas escritos), incluindo uma verificação deliberada de que cada teste novo falha contra o código pré-correção (`git stash`, rodar, `git stash pop`) — não apenas passa contra o código pós-correção, o que provaria pouco por si só.

## 32. Verification (Rodada D)

Primeira execução real via `codex exec`: Codex re-verificou cada correção da Rodada C contra o código (não aceitou a alegação), confirmou todas como reais, e encontrou **um achado bloqueante residual novo, da mesma classe do Item 11**: o bump de idle TTL dentro de `resolveSession()` (fora do caminho de refresh) ainda usava `sessionStore.update()` incondicional sobre um snapshot potencialmente obsoleto — uma sessão revogada por um `logout()` concorrente, entre a leitura inicial de `resolveSession` e esse bump, podia ser ressuscitada pela própria escrita do bump (que não carrega `revokedAt` por vir de uma cópia anterior à revogação). Citação literal do Codex: *"Achado bloqueante novo/residual: ainda existe uma escrita incondicional capaz de ressuscitar sessão revogada [...] Além disso, essa escrita não bumpa version, contrariando a premissa documentada [...] de que mutações de Session precisam mover version para proteger escritores condicionais."* `STATUS FINAL` desta primeira passagem: `NOT APPROVED`.

Correção aplicada imediatamente: o bump de idle TTL agora usa `updateConditional({...}, {version: session.version})`; em falha, relê a sessão — se revogada, `resolveSession` lança `AuthenticationError`; senão, retorna a versão mais recente (permite que um bump concorrente e benigno de outra chamada "vença" sem erro). Teste novo em `test/unit/bff/bff-auth-service.test.ts` ("a session revoked [...] between resolveSession's initial read and its own idle-TTL bump write") usa um novo utilitário de teste (`HookableSessionStore`, `test/unit/bff/in-memory-session-store.ts`) que injeta a revogação concorrente exatamente entre a leitura inicial e o bump — **verificado experimentalmente que este teste FALHA contra o código pré-correção** (`git stash`/rodar/`git stash pop`), não é um teste vácuo. 604 testes de backend (era 590 no início da sessão), 42 testes de frontend, `typecheck`/`lint`/`check-boundaries`/`check-docs` limpos após a correção.

**Segunda passagem**: Codex confirmou a correção do achado da primeira passagem como real e o teste como não-tautológico, mas encontrou um **segundo achado bloqueante residual, ainda na mesma família**: dentro de `resolveSession()`, as duas releituras pós-refresh (branch `CONCURRENT_REFRESH`, após o backoff de 75ms; branch `SUCCESS`, logo após o commit) checavam apenas a **existência** da sessão (`!reread`/`!refreshed`), nunca `revokedAt`. Uma sessão revogada por um `logout()` concorrente exatamente nessa janela não seria ressuscitada no DynamoDB (a escrita do bump de idle TTL, já corrigida, preservaria `revokedAt`), mas `resolveSession()` a retornaria como autenticada mesmo assim — permitindo que uma requisição atravessasse a fronteira de autenticação do BFF logo após o usuário ter saído. Citação literal: *"Ainda não aprovo, porque encontrei uma variante residual no próprio resolveSession: [...] Se uma sessão for revogada durante o backoff de CONCURRENT_REFRESH, ou logo antes da releitura após SUCCESS, resolveSession pode atribuir uma sessão já revogada a session e retornar esse objeto como autenticado. [...] Para uma fundação de autenticação de browser, isso continua sendo bloqueante."* `STATUS FINAL` desta segunda passagem: `NOT APPROVED`.

Correção aplicada: as duas releituras agora checam `reread.revokedAt`/`refreshed.revokedAt` além de existência, lançando `AuthenticationError` em qualquer um dos dois casos. Teste novo em `bff-auth-service.test.ts` ("a session revoked (concurrent logout) exactly between refresh()'s successful commit and resolveSession's own subsequent re-read") usa uma extensão do `HookableSessionStore` (hook em `updateConditional` bem-sucedido, disparando no commit final real do refresh via checagem de `refreshState === "IDLE"`, não no commit da lease) — **também verificado experimentalmente que falha contra o código pré-correção**. 605 testes de backend, `typecheck`/`lint` limpos após a correção.

**Terceira passagem**: Codex confirmou a segunda correção como real e não-tautológica, mas encontrou um **terceiro achado bloqueante, numa superfície diferente da mesma preocupação (validade de sessão)**: `logout()` e `logoutAll()` procuravam a sessão só pelo `selectorHash`, **sem nunca verificar o `secret`** do token opaco (ao contrário de `resolveSession()`, que sempre verifica os dois). Combinado com `checkCsrfForSession` (que trata `AuthenticationError` de `resolveSession` como "nenhuma sessão a proteger" e libera a requisição), um cookie forjado com o `selector` real de outra pessoa mas um `secret` inventado conseguia: (a) passar pela checagem de CSRF de `handleLogout`/`handleLogoutAll` (que usa `resolveSession`, falha com `AuthenticationError`, e por isso libera), e (b) ainda assim revogar a sessão real ou disparar logout global da conta da vítima, porque `logout()`/`logoutAll()` nunca comparavam o `secret`. Citação literal: *"logout e logoutAll leem Session diretamente por selector [...] sem validar o secret do token, revokedAt ou expiração [...] Resultado: um cookie com selector real e secret inválido pode chegar a logout ou logoutAll [...] Para uma fronteira BFF de produção, isso não passa."* Também apontou um risco formal menor (não bloqueante): as releituras pós-refresh não revalidavam `absoluteExpiresAt` contra um `now` novo. `STATUS FINAL` desta terceira passagem: `NOT APPROVED`.

Correções aplicadas: `logout()`/`logoutAll()` agora chamam `opaqueTokenSecretMatches()` antes de agir, com o mesmo `return` silencioso (no-op) já usado para um cookie ausente/malformado — um `secret` incorreto passa a ser indistinguível de "nenhuma sessão", nunca uma autorização parcial para revogar. As releituras pós-refresh (`CONCURRENT_REFRESH`/`SUCCESS`) também passaram a revalidar `absoluteExpiresAt` contra um `now` recém-obtido (correção de baixo custo, aplicada mesmo com severidade menor). Dois testes novos ("logout with the correct selector but a WRONG secret..." e o equivalente para `logoutAll`) — **ambos verificados experimentalmente como falhando contra o código pré-correção** (o teste de `logout` falha revelando exatamente o ataque: a sessão real era revogada pelo cookie forjado, fazendo a chamada de verificação `resolveSession` subsequente lançar `AuthenticationError` de forma não capturada). 607 testes de backend, `typecheck`/`lint` limpos.

**Quarta passagem**: Codex confirmou a terceira correção (secret check em `logout`/`logoutAll`) como real, mas — reiniciando a varredura do zero com a lente "todo caminho que trata uma Session/LoginAttempt como válida precisa checar existência + secret (quando um token foi apresentado) + não revogada + dentro da expiração absoluta + version check apropriado para escritas concorrentes" — encontrou **três achados novos**, dois bloqueantes e um menor, todos por não aplicar essa lente de forma uniforme em todos os métodos:

1. **Bloqueante**: `logoutAll()` verificava o `secret` mas nunca `revokedAt`/`absoluteExpiresAt` antes de disparar `users.logoutAll()` — um cookie de sessão já revogada ou já expirada (mas com o `secret` ainda batendo, já que revogação/expiração não apagam o registro) conseguia forçar logout global de **todas as outras sessões/dispositivos** da conta, um raio de ação (blast radius) que nenhuma outra ação do BFF tem.
2. **Bloqueante**: `handleCallback()` nunca validava `purgeAfterTtl` do `LoginAttempt` contra o relógio atual — dependia inteiramente da exclusão por TTL do DynamoDB, que é *best-effort* e pode atrasar bem além do timestamp (documentado pela própria AWS). Um objeto de autenticação curto e de uso único não pode depender só disso.
3. **Menor**: a releitura de `resolveSession()` no ramo de falha do bump de idle TTL checava `revokedAt` mas não `absoluteExpiresAt` — a mesma classe formal já corrigida nos outros dois ramos, ainda não uniforme neste terceiro.

Citação literal sobre o achado 1: *"Combinado com [...] uma sessão expirada ou revogada faz checkCsrfForSession retornar true como 'nada a proteger', mas logoutAll depois usa o mesmo cookie [...] para disparar logout global. Isso trata uma sessão inválida como autenticação suficiente para uma ação cross-device."* `STATUS FINAL`: `NOT APPROVED`.

Correções aplicadas: novo método privado `sessionIsCurrentlyValid()` (não-revogada + dentro da expiração absoluta) aplicado **simetricamente em `logout()` e `logoutAll()`** (não só onde o achado apontou — para não deixar uma assimetria que uma 5ª passagem encontraria); `handleCallback()` agora rejeita explicitamente um `LoginAttempt` com `purgeAfterTtl` no passado, antes de qualquer consumo; a releitura da falha de bump de idle TTL ganhou a mesma checagem de `absoluteExpiresAt` que os outros dois ramos. Cinco testes novos (TTL do LoginAttempt; `logout`/`logoutAll` com token correto mas sessão já expirada; `logoutAll` com token correto mas sessão já revogada) — **todos os três testes de comportamento novo verificados experimentalmente como falhando contra o código pré-correção**. 610 testes de backend, `typecheck`/`lint`/`check-boundaries` limpos.

**Quinta passagem**: Codex confirmou as correções da quarta passagem, mas — reiniciando a varredura mais uma vez — encontrou **um quinto achado, mesma família exata do achado 2 (TTL de `LoginAttempt`)**: `resolveSession()` nunca validava `purgeAfterTtl` (o timeout de idle da própria `Session`) contra o relógio, dependendo só da exclusão física por TTL do DynamoDB (best-effort, pode atrasar) — uma sessão idle-expirada mas ainda fisicamente presente era aceita como autenticada e tinha seu próprio `purgeAfterTtl` "ressuscitado" pelo bump de idle TTL. `sessionIsCurrentlyValid()` (usada por `logout`/`logoutAll`) tinha a mesma lacuna. Citação literal: *"O comentário do próprio método diz que a sessão nunca deve resolver além do idle expiry, então isso é um bug real, não só lacuna cosmética."* `STATUS FINAL`: `NOT APPROVED`.

Correção aplicada: novo método privado `isPastIdleTimeout()`, chamado em **todos** os pontos que já verificavam `absoluteExpiresAt` (a checagem inicial de `resolveSession()`, as duas releituras pós-refresh, a releitura de falha do bump de idle TTL) e incorporado em `sessionIsCurrentlyValid()`. Dois testes novos (`resolveSession` rejeita sessão idle-expirada fisicamente presente; `logoutAll` com token correto mas sessão idle-expirada nunca dispara logout global) — **ambos verificados experimentalmente como falhando contra o código pré-correção**. 612 testes de backend, `typecheck`/`lint` limpos.

**Sexta passagem (final)**: em vez de buscar um ângulo novo, Codex foi instruído a fazer uma varredura mecânica e exaustiva — uma tabela cobrindo **toda** ocorrência de leitura (`sessionStore.get<Session>`/`get<LoginAttempt>`) e escrita (`update`/`updateConditional`) em `bff-auth-service.ts` (8 leituras, 7 escritas), cada uma avaliada contra as 5 propriedades (existência/secret/`revokedAt`/`absoluteExpiresAt`/`purgeAfterTtl`) e, para escritas, `version`/condicional corretos. Todas as 15 linhas marcadas `Sim`/`Completo`. Releu também `bff-handlers.ts` e `proxy-service.ts` confirmando que nenhum dos dois introduz um caminho próprio que contorna essas checagens (ambos delegam inteiramente a `BffAuthService`). Conclusão literal: *"A tabela acima cobre 100% dos pontos de leitura/escrita de Session/LoginAttempt no arquivo, todos completos."*

**`STATUS FINAL: APPROVED AS FRONTEND PRODUCTION FOUNDATION`**

## Resumo da Rodada D (6 passagens)

A Rodada D encontrou e corrigiu **5 achados bloqueantes reais**, todos na mesma família (uma leitura de `Session`/`LoginAttempt` tratada como autoridade válida sem checar todas as propriedades necessárias — existência, secret do token, não-revogada, dentro da expiração absoluta, dentro do timeout de idle — ou uma escrita concorrente sem `version`/condicional correto), nenhum encontrado nas Rodadas A/B/C:

1. Commit final de `refresh()` incondicional podia ressuscitar sessão revogada concorrentemente.
2. Releituras pós-refresh em `resolveSession()` não checavam `revokedAt`.
3. `logout()`/`logoutAll()` não verificavam o `secret` do token, só o `selectorHash` — um cookie forjado com selector real e secret inventado conseguia revogar sessão real/disparar logout global.
4. `logoutAll()` não checava `revokedAt`/`absoluteExpiresAt` antes de agir (mesmo com secret correto); `handleCallback()` não validava `purgeAfterTtl` do `LoginAttempt` contra o relógio, dependendo só do TTL best-effort do DynamoDB.
5. Nem `resolveSession()` nem `sessionIsCurrentlyValid()` checavam `purgeAfterTtl` (idle timeout) da própria `Session` — mesma classe do achado 4, na `Session` em vez do `LoginAttempt`.

Todas as 5 correções foram verificadas experimentalmente (não só logicamente): cada teste novo correspondente foi confirmado **falhando contra o código pré-correção** (via `git stash`/rodar/`git stash pop`) antes de ser aceito como prova válida — nenhuma correção foi aceita só pela alegação de tê-la feito. O padrão real que essas 5 rodadas expõem: um `updateConditional`/checagem de validade introduzido para fechar UM achado precisa ser aplicado com disciplina de "varredura completa", não "só onde o achado apontou" — cada correção pontual da Rodada C/D revelou a mesma lacuna em um ponto irmão ainda não visitado. A Rodada D só converge quando a varredura deixa de ser heurística ("onde eu acho que pode ter bug") e vira mecânica ("toda leitura/escrita de X, sem exceção").

## 33. Final Status

**APPROVED AS FRONTEND PRODUCTION FOUNDATION**

Não a variante "...WITH CORE EXPIRATION VERTICAL SLICE" — o Overview (`frontend/src/routes/Overview.tsx`) é deliberadamente somente-leitura, sem nenhum formulário de criação/renovação de Vencimentos; não há CRUD real para qualificar como vertical slice completa, apenas prova de que o pipeline conecta de ponta a ponta.

Auto-checagem final (mission's própria pergunta de fechamento): se User Validation mudar hierarquia/copy/navegação/layout, a foundation sobrevive sem reescrita arquitetural? Sim — nenhuma tela real além do Overview foi construída, o shell (`AppShell`) é estrutural sem decisão visual, as primitivas de `AsyncStates.tsx` são neutras por design, e toda a camada de autenticação/sessão/roteamento/API/erro é inteiramente independente de qualquer decisão de UX ainda não tomada. A reescrita que User Validation pode exigir é toda em `src/routes/`/`src/shell/`/CSS — nunca em `src/api/`, `src/auth/`, `src/hooks/`, ou no BFF.

Pendências reais, não bloqueantes para esta etapa, registradas explicitamente (não escondidas):
- Infraestrutura de hospedagem estática do SPA (S3 privado + CloudFront) — não construída nesta sessão (§21).
- `frame-ancestors`/`X-Frame-Options`/HSTS reais para o próprio SPA dependem dessa infraestrutura — o CSP via `<meta>` do `index.html` é um paliativo, não a proteção final.
- As 16 Interaction Surfaces restantes, toda decisão de design visual, User Validation em si — todos explicitamente fora de escopo (§3).
- `EX-002` (vulnerabilidades transitivas de devDependencies do `frontend/`, mesma causa-raiz de `EX-001`) registrada em `docs/engineering/exceptions.md`.

## 33. Final Status

*(preenchida ao final da Rodada D)*
