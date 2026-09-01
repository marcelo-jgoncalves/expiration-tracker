# Performance Hot Path — Estado Final Consolidado

**Status: `APPROVED` (design) via protocolo Claude↔Codex, 3 rodadas, Claude 9,3/Codex 9,3 (sem arredondamento).** Gatilho: Marcelo reportou dois problemas de UX usando o app (tela demora a mostrar conteúdo; mensagem "validando sessão"-like desnecessária). Duas sessões anteriores produziram `expiration-tracker-performance-audit-2026-08-31.md` e `expiration-tracker-performance-strategies-research-2026-08-31.md` (raiz do repo) com achados mais amplos (P0-P3); esta rodada focou nos itens Type 1 (arquitetura/segurança) que explicam diretamente a queixa do Marcelo.

Documentos-fonte que motivaram esta rodada (movidos da raiz do repo em 2026-08-31, organização de contexto): `source-performance-audit.md`, `source-performance-strategies-research.md`.

Histórico completo: `round1-claude-proposal.md` → `round1-codex-critique.md` (6,4/10 régua, 7,6/10 design — NÃO APROVADO) → `round2-claude-revision.md` → `round2-codex-critique.md` (8,7/10 — NÃO APROVADO) → `round3-claude-final.md` → `round3-codex-critique.md` (9,3/10 — **APPROVED**).

**Achado real mais significativo do protocolo**: a proposta original (D-D, Rodada 1) recomendava trocar o mecanismo `Get+TransactWriteItems` da quota `API_REQUEST` por um `UpdateItem` atômico simples, tratando isso como puramente uma otimização. O Codex achou que essa troca removeria silenciosamente o *fence* do W3-07 (o `ConditionCheck` que impede um tenant em `DELETING` de gerar dado novo pós-purga) — a transação atual protege DUAS garantias (limite de contador E lifecycle fence), não uma. Levou 2 rodadas adicionais para reconciliar isso como uma emenda formal e explícita ao W3-07 (`EphemeralTelemetryMutation`) em vez de uma exceção implícita.

## Declaração E-014 (pesquisa externa)

**SIM PARCIAL.** Unificação de sessão frontend é padrão já resolvido (TanStack Query docs + discussões da comunidade, 2026). Rate limiting multi-tenant tem padrão estabelecido de abordagem em camadas (coarse + tenant-aware), mas a calibração exata depende do modelo de tenant do projeto. O Codex contestou o checklist original da Rodada 1 (sem pesos, sem âncoras, fontes secundárias para uma decisão de segurança) e propôs uma sub-rubrica de 6 critérios ponderados (30% isolamento concorrente / 25% lifecycle-W3-07 / 15% janela-reset / 10% falhas-retries / 10% defesa-em-camadas / 10% operabilidade) — adotada a partir da Rodada 2.

## Decisões (5, todas design-only)

### D-A — Sessão frontend: fonte única + UX sem terminologia técnica

`AuthContext` para de chamar `fetchSessionInfo()` imperativamente; passa a derivar `AuthState` do mesmo `useQuery({ queryKey: sessionQueryKey, ... })` que `ActiveOrganizationContext` já usa — elimina o waterfall real de 2 chamadas sequenciais a `/bff/session` confirmado no código (`AuthContext.tsx`/`ActiveOrganizationContext.tsx`/`App.tsx`). `staleTime` deixa de ser `0` (30-60s, a calibrar), invalidado em logout/logout-all/troca de organização/401 — **em logout, remoção imediata (`removeQueries`), não só invalidação**, para não deixar dado da organização anterior renderizado numa janela. As 2 mensagens sequenciais (`"Verificando sua sessão…"` em `ProtectedRoute.tsx:26`, `"Carregando sua organização…"` em `OnboardingGate.tsx:21`) — exatamente o que o Marcelo reportou — são substituídas por um único skeleton estrutural sem texto técnico, mostrado só depois de um pequeno atraso (150-200ms) para não piscar em conexões rápidas.

### D-B — Session touch coalescing

Mantém `ConsistentRead=true` (não negociável). Renovação do idle TTL deixa de ser por request e passa a ser só quando o tempo restante cair abaixo de um threshold (ex. <5min de um timeout de 30min, a calibrar). O `UpdateItem` de renovação usa `ConditionExpression` que verifica existência/status/não-expiração antes de renovar — nunca ressuscita uma sessão já revogada/expirada por corrida.

### D-C — RequestContext fast path (parcial)

`createProfileIfAbsent()` sai do hot path com confiança (create-if-absent idempotente sem consumidor síncrono dependente). `onboarding.resolve()` **não** sai nesta decisão — fica condicionado a mapear exaustivamente os consumidores do `RequestContext` antes de remover. `membership ACTIVE` e `tenant lifecycle ACTIVE` continuam obrigatórios e revalidados em toda request, sem exceção.

### D-D — `EphemeralTelemetryMutation`: emenda formal ao W3-07 (o item de maior risco do pacote)

Classifica `API_REQUEST` como `QUOTA_TELEMETRY` (classe já aprovada em D-127 — reuso correto confirmado pelo Codex) e cria uma lane nova e explícita, paralela a `executeTenantBusinessMutation()`, com contrato fechado:

- Allowlist fechada: só `API_REQUEST` nesta decisão; tipo novo exige nova decisão Type 1.
- Interface estruturalmente fechada (contador, identificador de janela, `windowSeconds`, `resetAt`, `purgeAfterTtl`) — **sem campo `metadata` livre** que possa carregar PII (precisão do Codex na Rodada 3).
- Proibição explícita de dado de negócio/PII/entitlement/capability na lane.
- Escrita permitida após leitura *stale* de `ACTIVE` já feita pelo `RequestContextResolver` (não pula a checagem de lifecycle, só não repete o `ConditionCheck` transacional).
- Chave `PK=TENANT#<id>#QUOTA`, `SK=TYPE#API_REQUEST#<floor(epochSeconds/windowSeconds)>` (windowSeconds real, não fixo); `purgeAfterTtl = windowEnd + 30d` (atributo real do projeto, confirmado pelo Codex — não `ttl`).
- Item permanece coberto estruturalmente pelo scan/`PURGE_DELETE` real do W3-07 (`begins_with(PK, "TENANT#<id>#")`, confirmado pelo Codex contra o código atual) — TTL nativo do DynamoDB é só limpeza antecipada best-effort (assíncrono, sem limite rígido — AWS não garante remoção imediata), nunca o mecanismo de garantia.
- Leituras tratam bucket com `purgeAfterTtl` no passado como inexistente.
- Nunca reusada para quotas comerciais (`AI_CALL`/`UPLOAD_*`/`IMPORT_*`) sem nova decisão.
- **Teste adversarial obrigatório no DoD/G-V3 de quando isso for implementado**: corrida `ACTIVE→DELETING`→escrita da lane→purge já rodou — confirmar que o resíduo nunca é lido como direito de negócio, é limpo pelo próximo ciclo do sweeper/scan, e gera métrica/alarme com limiar operacional concreto se sobreviver além do esperado (vencimento de TTL não é promessa de remoção imediata).

Classificação tripla de falha no `UpdateItem`: `ConditionalCheckFailedException`→429 (já existente); falha de dependência (DynamoDB indisponível/timeout)→fail-open com log de degradação; erro de validação/corrupção/bug→fail-closed como 5xx real, nunca mascarado.

API Gateway throttle (achado real: infra hoje usa `rate=25/burst=50` global/stage vs. `100/60s` por tenant na aplicação — o throttle coarse já limita antes de qualquer tenant alcançar sua quota individual, não é neutro) recalibrado por critério de capacidade real (concorrência Lambda/DynamoDB sustentável + margem sobre `limite-por-tenant × tenants-ativos-esperados`), não por um número de conveniência — valor exato fica para quando isso for implementado com medição real.

### D-E — Dashboard paginado

`listDashboard()` já aceita `limit` e já usa a GSI correta — falta o handler HTTP aplicar/exigir isso. Cursor opaco, ordenação determinística com tie-breaker estável (`dueDate`+`itemId`), limite máximo imposto pelo servidor (teto absoluto independente do que o cliente pedir), resposta com `nextCursor` explícito.

## Fora de escopo desta rodada (mecânico/operacional, não Type 1)

`React.lazy()` por rota, migração Node 20→22/24 (dívida tecnológica com prazo — Node 20 já depreciado pela AWS desde 30/04/2026, deveria ser tratado independentemente, sem protocolo), ADOT seletivo/atualização 1-30-0→1-30-2, benchmark de memória Lambda/ARM64, batch/concorrência de SQS, `staleTime` por tipo de query fora da sessão, N+1 de `BatchGetItem` na renovação. Todos válidos, nenhum exige nota cega Claude↔Codex — implementação direta em sessão(ões) futura(s), priorizados por valor/esforço.

## Implementação

**Design-only, deliberado** — mesmo padrão de D-121/D-127/D-131. Implementação real fica para sessão(ões) futura(s) dedicada(s). D-D é o item de maior risco (emenda ao W3-07) e deve ser implementado com o teste adversarial acima como parte do DoD, não como nice-to-have opcional.
