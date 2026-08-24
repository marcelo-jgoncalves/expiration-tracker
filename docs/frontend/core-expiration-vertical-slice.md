# Core Expiration Vertical Slice

> Implementação real do primeiro vertical slice de produção do anchor Vencimentos: Expiration
> Collection, Expiration Detail, Create Expiration, Renew Expiration. Distinto dos 8 documentos
> de planejamento de interface em `docs/frontend/` (que cobrem UX/IA/journeys, nunca código de
> produção) e de `docs/frontend/frontend-production-foundation.md` (Full BFF + fundação real de
> frontend, que este slice consome sem alterar arquitetura).

## 1. Executive Summary

Implementa o primeiro fluxo real e completo do anchor Vencimentos sobre a Frontend Production
Foundation (PR #48): um usuário autenticado via Full BFF consegue listar vencimentos, abrir o
detalhe de um, criar um novo com o menor caminho correto, e renovar um existente — preservando
idempotência real (`Idempotency-Key`), OCC real (`If-Match`/versão), epistemic integrity (nunca
afirmar o que `BLOCKER-A`/`BLOCKER-B` impedem observar) e acessibilidade estrutural desde o
início. Todas as rotas usadas já estavam allowlisted no BFF (`src/modules/bff/domain/proxy-allowlist.ts:21-27`)
— nenhuma mudança de arquitetura de BFF foi necessária.

Durante a implementação, um bug real e pré-existente de liveness de idempotência foi encontrado
e corrigido no backend (§16) — não um achado de revisão adversarial, mas uma correção descoberta
ao construir o fluxo de recuperação de OCC do Renew.

## 2. Scope

Expiration Collection, Expiration Detail, Create Expiration, Renew Expiration, e o cross-flow
Overview → Collection → Detail → Create/Renew → return, usando contratos reais de ponta a ponta
(frontend real → BFF real → API real → application/domain real → persistência real).

## 3. Non-Goals

Documents, materialização de Reminder, External Collection, Guest Submission, Subject/Requirement
completos, Billing, OCR, Design System visual final, High-Fidelity UI. Nenhum destes foi expandido
além do estritamente necessário para o slice de Vencimentos funcionar corretamente.

## 4. Baseline

`develop` na Frontend Production Foundation (PR #48, commit `29967e5`): Full BFF implementado
(`src/modules/bff/`), fundação de frontend real (`frontend/` — Vite+React+TS+React Router
v7+TanStack Query v5), auth state machine, API client único, suporte a OCC/idempotência,
primitives acessíveis, thin read-only Overview slice. 42 testes unitários/componente + 6 E2E
Playwright nessa baseline.

## 5. Inputs

Os 8 documentos de planejamento de interface aprovados (`docs/frontend/interface-*.md`),
`docs/frontend/frontend-production-foundation.md`, e o código real de
`src/modules/expiration/{application,http,domain,ports}` como fonte de verdade de contrato —
nunca assumido a partir da documentação de design.

## 6. Production Architecture Reused

Sem mudanças: `ApiClient` único (`frontend/src/api/client.ts`), auth state machine
(`frontend/src/auth/AuthContext.tsx`), `ProtectedRoute`, `AppShell`, primitives de
loading/erro/empty (`frontend/src/components/AsyncStates.tsx`), `useIdempotentMutation`,
`retryPolicyFor`, o modelo de erro discriminado (`frontend/src/api/errors.ts`). Estendidos (não
substituídos): `useIdempotentMutation` ganhou a opção `persistenceKey` (§15);
`sortByDueDateAscending` foi extraído de `Overview.tsx` para `api/presentation.ts` e reusado pela
Collection, eliminando a duplicação local que existia antes.

## 7. Vertical Slice Architecture

```
frontend/src/api/items.ts            — único ponto de chamada às rotas reais de item
frontend/src/api/presentation.ts     — status/urgência/formatação de data (puro, testável)
frontend/src/api/validation.ts       — draft de Create + mapeamento de erro de validação
frontend/src/hooks/{useItem,useItemsDashboard,useCreateItem,useRenewItem,useFormDraft}.ts
frontend/src/routes/items/{ItemsCollection,ItemDetail,CreateItem,RenewItem}.tsx
frontend/src/components/forms/{TextField,FormErrorSummary}.tsx
```

Toda comunicação passa por `api/items.ts` → `apiClient` (nunca `fetch()` direto em componente).
Nenhuma abstração nova de state management — TanStack Query (server state) + `useState`/
`sessionStorage` (form state local), como a fundação já estabelecia.

## 8. Expiration Collection

`ItemsCollection.tsx` — tabs de status (Ativos/Arquivados/Renovados), cada uma disparando uma
query real (`GET /items/dashboard?status=X`, uma partição GSI1 por status — não existe "todos os
status" num único call, ver §24). Dentro de Ativos, itens agrupam por urgência (Vencidos/Vence em
breve/Demais ativos), mesmo vocabulário e limiar de 7 dias do protótipo aprovado. Estados cobertos:
`INITIAL_LOADING`, `LOADED`, `TRUE_EMPTY`, `FILTERED_EMPTY`, `BACKGROUND_REFRESH`, `ERROR`,
`PERMISSION_ERROR` (`AUTH_REQUIRED` já é tratado globalmente por `ProtectedRoute`, não duplicado
aqui). Testado com um dataset de 15+ itens espalhados pelos 3 buckets de urgência
(`ItemsCollection.test.tsx`), não apenas os poucos registros triviais de um fluxo feliz.

## 9. Expiration Detail

`ItemDetail.tsx` — nome, categoria, urgência, todos os campos opcionais presentes (via
`DetailList`, que omite campos ausentes em vez de mostrar rótulos vazios), link de renovação
quando `ACTIVE`, e uma "linhagem de renovação" de um único salto (`renewedFromId`) quando
recuperável — nunca uma cadeia completa que o modelo de dados não expõe (§13). Deliberadamente
**sem seção de Documentos** — `BLOCKER-A` significa que não há contrato real para uma; omitir é a
escolha honesta sobre uma afirmação fabricada de "nenhum documento" (§25).

## 10. Create Expiration

`CreateItem.tsx` — o menor formulário correto: apenas `name`/`category`/`dueDate` obrigatórios,
espelhando `CreateItemInput`/`create-item-request.v1.json` exatamente. Nunca exige
Subject/Requirement/Document/Reminder. Erros de validação são por campo, valores preservados
(`useFormDraft`, sessionStorage). `Idempotency-Key` real enviado em toda submissão; ver §15.

## 11. Renew Expiration

`RenewItem.tsx` — aviso permanente (não um modal) explicando a consequência antes da submissão:
o ciclo atual será marcado `RENEWED`, um novo ciclo `ACTIVE` é criado com a nova data — renovar
não é editar. `If-Match` carrega a versão atualmente carregada; um 409 aciona uma recuperação
dedicada ("Recarregar" reexecuta o fetch do item e reseta a mutation) em vez de erro genérico ou
retry cego. Ver §16 para o mecanismo de idempotência.

## 12. Routing

`items`, `items/new`, `items/:itemId`, `items/:itemId/renew` — nomes REST-like escolhidos
livremente; nenhum documento de UX aprovado fixa uma convenção de URL (deliberadamente fora do
escopo de wireframe/protótipo). Substitui o placeholder "Vencimentos" anterior. Foco move-se para
`#surface-content` em toda transição de rota pós-montagem inicial (`AppShell.tsx`), para que um
usuário de leitor de tela seja avisado da mudança de página — sem isso, navegação client-side não
reseta o foco como um load de página real faria.

## 13. API Contracts

Todas as seis rotas usadas já estavam no allowlist do BFF antes desta sessão
(`src/modules/bff/domain/proxy-allowlist.ts:21-27`) — nenhuma mudança de BFF necessária:

| Rota | Uso | Header obrigatório |
|---|---|---|
| `POST /items` | Create | `Idempotency-Key` opcional |
| `GET /items/dashboard?status=X` | Collection | — |
| `GET /items/{itemId}` | Detail, Renew (fetch inicial), linhagem | — |
| `POST /items/{itemId}/renew` | Renew | `If-Match` obrigatório, `Idempotency-Key` opcional |

Corpo/erro exatos verificados contra `src/modules/expiration/http/item-handlers.ts` e
`src/modules/expiration/application/expiration-service.ts` diretamente, nunca assumidos a partir
de documentação de design.

## 14. Authentication / Session

Sem mudanças na máquina de autenticação. Testado explicitamente (E2E-06, §22): uma sessão que
expira no meio de um Create redireciona para reautenticação real da BFF e, ao retornar à mesma
rota, o rascunho do formulário e a `Idempotency-Key` são recuperados do `sessionStorage` — a
mesma chave lógica é reenviada, nunca uma nova (§29).

## 15. Idempotency

`useIdempotentMutation` ganhou a opção `persistenceKey` (`frontend/src/hooks/useIdempotentMutation.ts`):
quando fornecida, a chave sobrevive a um reload de página inteira (sessionStorage, nunca
localStorage — escopo de aba/submissão, não deve sobreviver além dela). Uma retentativa da mesma
submissão reusa a mesma chave; `newIntent()` (chamado só após sucesso confirmado) gera uma nova.
Create e Renew usam essa opção; o rascunho do formulário (`useFormDraft`, mesmo padrão de
sessionStorage) acompanha a mesma chave de armazenamento por submissão.

**Request hash — Create**: já migrado (antes desta sessão, `NEXT_SESSION_PROMPT.md` confirmado
contra o código) de concatenação por delimitador para JSON canônico + SHA-256
(`expiration-service.ts:101-117`) — campos de texto livre (`name`, `issuer`, etc.) tornam
delimitador-concatenado ambíguo; hash de JSON estruturado não tem essa colisão. Nenhuma mudança
adicional foi necessária (mission §31 — verificado, sem risco material).

**Request hash — Renew**: permanece `itemId|expectedVersion|cycle` (concatenação por
delimitador), deliberadamente inalterado — `itemId` é um id gerado opaco, `expectedVersion` é um
inteiro, `cycle` é uma data ISO; nenhum pode conter `|`, logo não há colisão real possível
(comentário em `expiration-service.ts:94-100`/`:318-321`). Documentado, não expandido.

## 16. OCC

`If-Match` (inteiro, versão esperada) em `renew`. Conflito (409, categoria `CONFLICT`) nunca é
colapsado em erro genérico — `isConflict()` no frontend aciona a UI de recuperação dedicada
(§11). Nenhum retry cego: "Recarregar" busca o estado atual e reseta a mutation antes de permitir
nova submissão.

**Achado real corrigido nesta sessão** (residual de liveness de idempotência, mission §32):
`renewItem`/`createItem` adquiriam um lock de idempotência via `begin()` mas nunca chamavam
`complete()` quando a escrita protegida falhava (ex.: conflito de OCC) — o registro ficava
`IN_PROGRESS` para sempre, e toda retentativa sob a mesma chave (mesmo com uma `expectedVersion`
recém-buscada) atingia `ConcurrentOperationError` permanentemente. Corrigido com um novo estado
terminal `ABORTED` em `IdempotencyStore` (`src/shared/idempotency/idempotency.ts`) e um `abort()`
chamado nos catch-paths de `renewItem`/`createItem`. Verificado (revisão de código desta sessão):
`abort()` só é acionado quando a escrita transacional realmente falhou (nunca depois de um commit
bem-sucedido) — no único caso residual onde o commit tem sucesso mas a chamada de `complete()`
falha, a condição de versão da própria transação atômica (não o registro de idempotência) segue
sendo a proteção real contra duplicação; uma retentativa nesse caso raro resulta em um 409 (que o
Renew já trata como recuperação dedicada) em vez do 500 genérico que ocorria antes — uma melhoria
de UX, não uma regressão de segurança. 9 testes novos (`test/unit/idempotency.test.ts`,
`test/unit/expiration/expiration-service.test.ts`).

## 17. Error Model

Reusa o modelo discriminado existente (`frontend/src/api/errors.ts`) sem alteração de shape:
`VALIDATION` → erros por campo preservando valores; `CONFLICT` → recuperação de OCC dedicada;
`NOT_FOUND` → ação de retorno à lista; `AUTHORIZATION` → `EmptyState kind="permission-limited"`;
`UNKNOWN_OUTCOME` → nunca "falhou", sempre "verifique a lista antes de tentar de novo".

## 18. Loading / Empty / Async

Collection: `INITIAL_LOADING`, `BACKGROUND_REFRESH` (indicador textual, nunca só visual),
`TRUE_EMPTY` vs. `FILTERED_EMPTY` (cópia distinta), `ERROR` com retry. Detail/Renew:
`InitialLoading`/`ErrorState` reusados da fundação. Create: `SUBMITTING` desabilita o botão
(`disabled={mutation.isPending}`) e evita double-submit no cliente — complementar à idempotência
real do backend, nunca um substituto dela (§35).

## 19. Epistemic Integrity

Nenhuma alegação além do que o domínio sustenta: Detail omite Documentos inteiramente (§9);
status usa rótulos fixos (`Ativo`/`Arquivado`/`Renovado`) nunca reinterpretados como
"aprovado"/"em dia"; `UNKNOWN_OUTCOME` nunca vira "falhou" nem "criado" — sempre "não foi possível
confirmar, verifique antes de tentar de novo" (Create §10, Renew §11); linhagem de renovação
mostra só o salto que o backend realmente permite recuperar (`renewedFromId`), nunca uma cadeia
completa fabricada.

## 20. Accessibility

`TextField`/`FormErrorSummary` (`frontend/src/components/forms/`): `<label htmlFor>` real (nunca
placeholder), `aria-describedby`/`aria-invalid` associando erro ao campo, `role="alert"` em
mensagens de erro. Foco movido para `#surface-content` em toda transição de rota (§12). Links
(`react-router-dom`'s `Link`) para navegação, `<button>` para ações/mutações — nunca invertido.
Estados assíncronos usam `role="status"`/`role="alert"` com `aria-live`, nunca dependência só de
cor (`data-tone` sempre acompanha um rótulo textual).

## 21. Security

Toda chamada passa por `apiClient` (nunca `fetch()` direto) — CSRF, cookies de sessão, e o header
`Idempotency-Key`/`If-Match` são responsabilidade única desse client, herdada sem reimplementação.
Nenhum token Cognito chega ao browser (inalterado da fundação). Nenhum `dangerouslySetInnerHTML`
introduzido.

## 22. Testing

96 testes unitário/componente de frontend (era 42 na fundação — 54 novos), 12 testes Playwright
E2E (era 6 — 6 novos cobrindo E2E-01 a E2E-06 do mission), 9 testes novos de backend
(`idempotency.test.ts`, `expiration-service.test.ts`) para o achado de §16. Cobertura explícita:
semântica de status/urgência/data, ordenação por urgência, ciclo de vida de idempotency-key
(reuso em retry, nova chave só após `newIntent()`, persistência entre reload), mapeamento de erro
(validação/conflito/desconhecido), comportamento de validação (preservação de valores), OCC
(conflito, recuperação, versão fresca no retry).

## 23. Density Validation

`ItemsCollection.test.tsx` inclui um cenário com itens espalhados pelos três buckets de urgência
(vencidos/vence em breve/demais ativos) para provar que o agrupamento e a ordenação por
`dueDate` ascendente seguem corretos além do caso trivial de poucos registros — a mesma classe de
defeito que `PROTO-STRESS-DENSITY-01` encontrou no protótipo (ordenação por urgência ausente em
volume) não se repete aqui porque `sortByDueDateAscending` é aplicado antes de qualquer
agrupamento, e é testado isoladamente (`presentation.urgency.test.ts`) independente do
componente.

## 24. Deferred UX Decisions

**IMPLEMENTATION FINDING**: os wireframes/protótipo aprovados assumem implicitamente uma lista
"todos os status" filtrável; o contrato real (`GET /items/dashboard?status=X`) só suporta uma
partição GSI1 por chamada — não há endpoint que combine ACTIVE+ARCHIVED+RENEWED num único call.
A Collection implementa 3 tabs, cada uma disparando sua própria query, em vez de uma lista
combinada com filtro client-side (que exigiria 3 chamadas de qualquer forma, sem ganho real) — uma
decisão de implementação, não de produto; não reabre a IA aprovada, apenas documenta a
divergência entre o contrato assumido no wireframe e o real.

## 25. Known Blockers

`BLOCKER-A` (leitura de Document), `BLOCKER-B` (materialização de Reminder), `BLOCKER-C` (fechamento
de coleta externa), `GTR-01` (identidade do solicitante) — nenhum resolvido nesta sessão, nenhum
mascarado. Nenhuma superfície deste slice implica que qualquer um deles foi resolvido.

## 26. Claude Review

Autorrevisão (Round A) cobriu: consistência arquitetural (nenhuma rota nova de BFF necessária,
nenhum `fetch()` fora do client único), contrato de UX (epistemic integrity, estados
requeridos presentes e só os aplicáveis), integração de API (verificada linha a linha contra
`item-handlers.ts`/`expiration-service.ts`, nunca assumida), auth/sessão (E2E-06), idempotência
(rastreada até o mecanismo real de hash e o novo `abort()`), OCC (rastreada até a transação
atômica que é a proteção real contra duplicação), semântica de erro, acessibilidade (label/foco/
associação de erro), segurança (BFF único caminho, sem token exposto), testes (96 unit + 12 E2E +
9 backend, todos verificados passando nesta sessão: `npm test`/`npm run typecheck`/`npm run
lint`/`npm run build`/`npm run test:e2e` no `frontend/`, e `npm test`/`npm run typecheck`/`npm run
lint` na raiz — 617 testes de backend, nenhuma regressão).

## 27. Codex Review

Round B (`codex exec --skip-git-repo-check`, adversarial, 30-point checklist do mission §85 +
stress-test explícito do argumento de segurança do §16) rodou contra o código real (não a
documentação) e confirmou `npm run typecheck`/`npm run lint` limpos nas duas árvores antes de
reportar. Achados reais, mais severo primeiro:

1. **S1 — `IdempotencyStore.begin()` permitia duas retentativas concorrentes reaquirirem o
   mesmo registro `ABORTED`.** `src/shared/idempotency/idempotency.ts:116` fazia `get()` seguido
   de `update()` incondicional — uma corrida TOCTOU real: duas chamadas concorrentes podiam ler
   `ABORTED` antes de qualquer uma escrever, e ambas "vencerem" a reaquisição, executando a
   operação guardada duas vezes.
2. **S2 — `renewItem()` podia chamar `abort()` depois de um commit bem-sucedido** se
   `idempotency.complete()` falhasse (o catch envolvia `completeRenewal()` inteiro, não só a
   escrita transacional) — descartando a capacidade de repetir o sucesso real via idempotência.
   A alegação original da §16 (que a versão condicionada na transação bastava) era verdadeira
   para segurança de dados, mas não capturava essa perda de replay legítimo.
3. **S2 — hash de requisição do Renew ignorava `newDueDate` quando `cycle` era enviado
   explicitamente** — `renew-item-request.v1.json` permite `cycle` independente de `newDueDate`;
   duas requisições com o mesmo `itemId`/`expectedVersion`/`cycle` mas `newDueDate` diferente
   colidiam no mesmo hash.
4. **S2 — `Overview.tsx` ainda formatava `dueDate` via `new Date(...).toLocaleDateString`**,
   não via `formatAbsoluteDate` — exatamente a classe de bug de fuso horário que
   `api/presentation.ts` foi desenhado para prevenir (um vencimento à meia-noite UTC podia
   renderizar o dia anterior em fusos negativos, ex.: Brasil).

Nenhum S0. S3/S4: nenhum achado adicional de código de produção (uma discrepância de contagem
entre a descrição desta doc e o dataset real de teste de densidade foi notada, não elevada a
severidade de produção). Veredito da Rodada B: **não seguro para merge como estava.**

## 28. Reconciliation

Todos os 4 achados foram aceitos e corrigidos nesta sessão (Round C):

| # | Finding | Accepted/Rejected | Fix | Tests added |
|---|---|---|---|---|
| 1 | Corrida TOCTOU na reaquisição de `ABORTED` | Accepted | Novo `DynamoLike.transitionIfStatus(item, expectedStatus)` — escrita condicional via `transactWrite` de uma entrada só (`ConditionExpression: "#status = :expected"`), substituindo o `get()`+`update()` incondicional. Reusado também em `abort()` (mesma classe de corrida, não achada pela Rodada B, fechada pelo mesmo mecanismo). Implementado nos 3 módulos que constroem `IdempotencyStore` (expiration/document/import) via um helper compartilhado `transitionIdempotencyStatus()`. | 2 novos em `test/unit/idempotency.test.ts` (reaquisição concorrente — exatamente um vencedor; `abort()` nunca sobrescreve um `complete()` concorrente) |
| 2 | `abort()` após commit bem-sucedido | Accepted | `renewItem` reestruturado: o `try/catch` que chama `abort()` agora envolve só o guard de status + a escrita transacional (`completeRenewal`, que não chama mais `complete()` internamente); `idempotency.complete()` roda depois, fora desse catch — uma falha ali deixa o registro `IN_PROGRESS` (o residual já documentado no mission §32), nunca `ABORTED` incorretamente. | 1 novo em `expiration-service.test.ts` (falha simulada de `complete()`: nenhuma duplicata, retry vira `ConcurrentOperationError`, não perda de dado) |
| 3 | Hash do Renew ignorava `newDueDate` | Accepted | `requestHash` passou a ser `${itemId}\|${expectedVersion}\|${input.newDueDate}\|${cycle}` — sempre inclui `newDueDate`, independente de `cycle` ter sido enviado. | 1 novo em `expiration-service.test.ts` (mesma chave/cycle, `newDueDate` diferente → `ConcurrentOperationError`, nunca tratado como replay) |
| 4 | Overview com bug de fuso horário | Accepted | `Overview.tsx` agora usa `formatAbsoluteDate` (já usado pela Collection/Detail), removendo o `new Date(...).toLocaleDateString` duplicado e divergente. | Coberto indiretamente pelos testes existentes de `presentation.urgency.test.ts` (`formatAbsoluteDate`); nenhum teste de Overview existia antes desta correção para regredir. |

Nenhum achado foi rejeitado ou parcial — todos os 4 eram bugs reais e de baixo risco de correção,
dentro do escopo já estabelecido (nenhuma mudança de arquitetura, só correção da implementação já
existente).

## 29. Verification

Round D (Codex, `codex exec --skip-git-repo-check`, sobre o código já corrigido) reexecutou os 4
cenários afetados e o checklist completo do §85; ver resultado abaixo. Verificação final completa
executada nesta sessão após o Round C: `npm run typecheck`/`npm run lint`/`npm test` (621 testes,
raiz) e `npm run typecheck`/`npm run lint`/`npm test`/`npm run test:e2e` (`frontend/`, 96 testes
unitários + 12 E2E) — todos verdes, nenhuma regressão.

## 30. Final Status

[Preenchido após o Round D.]
