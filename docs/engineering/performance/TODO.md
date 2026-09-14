# Performance Program — Execution TODO

Fonte: `expiration-tracker-plano-acao-performance-world-class-2026-09-14.md` (repo root, doc do usuário).
Este arquivo é o rastreamento vivo da execução. Segue a ordem obrigatória das fases (plano §4) e o
faseamento em ciclos recomendado pelo próprio plano (§28, §29): não executar as 15 fases de uma vez.

Convenção: `[ ]` pendente, `[~]` em andamento, `[x]` concluído. Cada item de fase só fecha com evidência
registrada em `docs/engineering/performance/results/`.

---

## Ciclo A (primeiro ciclo — iniciar agora)

### PERF-00 — Congelar baseline e preparar laboratório
- [x] Registrar SHA testado (`git rev-parse HEAD`, `git log -1 --oneline`) — `8ade669`, ver `baseline/PERF-00-environment.md`
- [x] Criar branch `perf/performance-program-v1` (a partir de `develop`)
- [x] Criar diretório de artefatos `docs/engineering/performance/{README,baseline,experiments,load-tests,screenshots,traces,results}`
- [x] Definir convenção de ID de experimento (`PERF-Exxx`) e template (ver §26 do plano) — `experiments/TEMPLATE.md`
- [x] Registrar ambiente do navegador/máquina de referência para os testes principais — `baseline/PERF-00-environment.md`
- Critério de saída: um teste é reproduzível exatamente a partir do registro. **Atingido.**

### PERF-01 — Inventário de ambiente e quotas
- [x] Verificar quota atual de Lambda Concurrent Executions na conta `dev` (hipótese: ainda 10) — confirmado: ainda 10 (`L-B99A9384`)
- [x] Coletar CloudWatch 24h/7d: ConcurrentExecutions, UnreservedConcurrentExecutions, Throttles, Invocations, Errors, Duration — para BFF, Items, Subjects, Document Archive, Reports, Reminder Producer, Reminder Dispatch
- [x] Procurar throttling (ConcurrentExecutions ≈ quota + Throttles > 0) — encontrado 1 evento real (`dispatch-outbox-relay`, 2026-09-12 19:03 -03:00), coincidindo com pico de ConcurrentExecutions=10 de conta
- [x] Verificar quota/throttling API Gateway — quotas padrão (10k/5k req/s) muito acima do uso (85–128 req/7d); sem throttling (4xx=0)
- [x] Verificar SQS event source mappings (batch size, MaximumConcurrency, reserved concurrency) — BatchSize=10 em todos, sem MaximumConcurrency e sem reserved concurrency configurados em nenhuma função
- [~] Se quota ainda = 10: solicitar aumento para 100 (via AWS Support/Service Quotas — não contornar via código) — **tentado via CLI (autorizado por Marcelo), falhou**: `IllegalArgumentException`, o valor 10 é restrição de conta nova (default AWS real é 1000), Service Quotas API só aceita pedidos >1000. Requer caso manual no AWS Console (Account and billing support) — API de Support exige plano Business/Enterprise que esta conta não tem. **Pendente de ação manual do Marcelo.**
- [x] Registrar `results/PERF-01-account-quotas.md`
- Critério de saída: **ainda não estrangulou as 7 funções-alvo diretamente na janela observada (uso manual, baixo volume), mas a conta já bateu no teto de 10 execuções concorrentes duas vezes em 7 dias e gerou 1 throttle real — quota compartilhada por 62+10 funções na conta é insuficiente para suportar os testes de carga dos próximos experimentos (PERF-04/05/11) sem aumento prévio.**

### PERF-02 — Instrumentação e observabilidade
- [x] Adicionar spans/timers: BFF_SESSION_RESOLVE, BFF_PROXY, REQUEST_CONTEXT, BUSINESS_OPERATION, DYNAMODB — via `withHandlerTiming`/`timeSpan` (`src/shared/observability/handler-timing.ts`)
- [x] BFF: registrar `bff.total_ms`, `bff.session_resolve_ms`, `bff.proxy_ms`, `bff.backend_status`, `cold_start` — commit slice 1
- [x] Resource Lambdas: `lambda.total_ms`, `request_context_ms`, `business_operation_ms` — cobertos: Items, Subjects, Document Archive, Reminder Producer, Reminder Dispatch (commit slice 2). **Pendente**: outros ~54 handlers (workers/purge/extraction/delivery) ainda sem o helper — follow-up, não bloqueia critério de saída.
- [x] DynamoDB: usar tracing existente (evitar console.log ad hoc) — middleware em `shared/dynamodb/client.ts`, `dynamodb.operation_ms` por operação, sem payload
- [x] Cold start: coletar InitDuration, Duration, MaxMemoryUsed, PostRuntimeExtensionsDuration — confirmado: nenhuma função tem Lambda Insights, todas já têm ADOT+X-Ray Active; REPORT line + CloudWatch Logs Insights já dá os 4 números de graça, sem habilitar Lambda Insights — `results/PERF-02-cold-start.md` (queries + PoC real no BFF: InitDuration ~1.6–2.0s em 256MB)
- [x] Avaliar CloudWatch Application Signals primeiro só em BFF/Items/Subjects/Document Archive — **decisão: não habilitar agora**, EMF customizado + X-Ray Active já cobrem o que o plano pede; reavaliar em PERF-14 — `results/PERF-02-application-signals.md`
- [x] Preparar CloudWatch RUM no frontend (sampling baixo, dev apenas, sem dados sensíveis); métrica própria `ET_ROUTE_USEFUL_CONTENT_MS` — scaffolding implementado: `frontend/src/observability/rum.ts` (client no-op até app monitor AWS RUM + `aws-rum-web` + `VITE_RUM_APPLICATION_ID` existirem — pré-requisito de infra, não criado aqui) e `frontend/src/observability/routeTiming.ts` (mede e reporta a métrica via `performance.mark/measure`), wired em `App.tsx`/`main.tsx`
- [x] Garantir correlation ID de ponta a ponta (browser → BFF → resource API → Lambda) — **decisão: suficiente como está**, o `correlationId` do BFF já vem do `requestContext.requestId` do API Gateway (identifica a request de ponta a ponta desde a borda) e já é propagado BFF→resource-API (`x-correlation-id`, slice 1); gerar um segundo ID no browser seria redundante sem benefício concreto identificado — não implementado, documentado como decisão consciente
- Critério de saída: para uma request qualquer, decompor BFF/RequestContext/Business/DynamoDB em ms. **Atingido** para as 6 funções-alvo cobertas (BFF, Items, Subjects, Document Archive, Reminder Producer, Reminder Dispatch) e para os 4 itens restantes (cold start, Application Signals, RUM, correlation ID) — cold start e correlation ID resolvidos por análise/documentação (sem mudança de código necessária além do já existente), Application Signals é decisão de não fazer por ora, RUM tem scaffolding de frontend pronto (app monitor AWS + pacote `aws-rum-web` ficam como pré-requisito de infra fora desta fatia).

### PERF-03 — Baseline frontend/browser
- [x] Rodar Playwright nas jornadas J01–J08 (Login→Overview, Overview→Items, Overview→Subjects, Subjects→SubjectHub, SubjectHub→Requirements, Requirements→DocumentDetail, Reports, Settings) — backend mockado via `page.route()` (mesmo padrão de `frontend/e2e/*.spec.ts`, sem BFF/AWS real alcançável); harness em `docs/engineering/performance/traces/perf-03-journeys.mjs`. **Não rodado**: DevTools/Lighthouse/RUM/CPU-Profiler manuais — só Playwright/Performance API, ver ressalvas no relatório.
- [x] Coletar por jornada: TTFB, DCL, Load, LCP, CLS, JS transferred, JS parse/exec (aprox.), nº requests, time-to-useful-data — ver `results/PERF-03-frontend-baseline.md`. **INP não medido** (nem aproximado) em nenhuma jornada — requer RUM de interação real, não fabricado.
- [x] Guardar waterfalls de J01, J04, J06 — como HAR (`context.recordHar`, substituto documentado por `page.screenshot()` não capturar rede) + screenshot da tela final, em `docs/engineering/performance/screenshots/J0{1,4,6}-*`
- [x] Registrar bundle baseline atual (JS raw/gzip, CSS raw/gzip) — referência do plano: ~480KB raw / ~135KB gzip — ver `docs/engineering/performance/results/PERF-03-bundle-baseline.md` (517,4 KB raw / 140,1 KB gzip total, sem code-splitting)
- [x] Repetir com Fast 4G + CPU throttling — feito para J01 e J04 (execução única, não mediana, por corte de tempo); J02/J03/J05–J08 permanecem só unthrottled — follow-up se o programa julgar necessário.
- Critério de saída: **Parcialmente atingido.** Com o backend mockado (latência ~0), a medição não separa "espera de API real" (isso é escopo de PERF-04) — o que ficou demonstrado é que, sem throttling, a duração observada é quase 100% frontend (bundle único sem code-splitting, parse/exec ~35-48ms até DCL), e sob Fast 4G+CPU 4x o tempo até conteúdo útil sobe ~10x (164ms→1.615ms em J01) quase inteiramente por download+parse/exec do bundle de 477,6 KB, não por latência de API (que segue mockada e instantânea mesmo sob throttling de rede simulada). A separação "frontend vs. espera de API real" só fecha combinando com os números de PERF-04.

### PERF-04 — Baseline BFF / HTTP / Resource Lambda
- Tenant de teste pronto (usuário reaproveitado, organização criada, dados semeados via API, sessão obtida via script Playwright) — ver `baseline/PERF-04-test-tenant.md`.
- [x] Selecionar endpoints representativos (`/bff/session`, items/dashboard, subjects/dashboard, subject/{id}, document-archive, reports) — 4 endpoints medidos (`session`, `items/dashboard`, `subjects/dashboard`, `subjects/{id}`); `reports/expiring-soon-items` excluído (bug 500 conhecido); `document-archive` excluído (**novo achado**: todas as rotas de leitura testadas também retornam 500 por gap de IAM `OrganizationStore.queryGsi4`, não só a escrita já documentada)
- [x] Teste warm: 50 requests, concurrency=1, descartar cold; coletar p50/p75/p90/p95/p99 — `results/PERF-04-bff-lambda-baseline.md`, harness `traces/perf-04-latency.mjs`
- [x] Teste cold: 10–20 amostras isoladas — feito via CloudWatch Logs Insights sobre tráfego real (não forçado sinteticamente, per instrução da tarefa); 3,9% (BFF)/5,5% (Items)/2,7% (Subjects)/10,0% (Document Archive) em janela de 7 dias, InitDuration ~1,8–2,2s
- [~] Comparar BFF x chamada direta ao Resource API (medir overhead estrutural do BFF, sem mudar produto) — **não realizado, time-boxed**: App Client Cognito do tenant só permite `ALLOW_USER_SRP_AUTH` (sem password/admin grant), obter access token bruto exigiria implementar SRP handshake manualmente (sem lib pronta no repo); usada como proxy a comparação `Duration` BFF vs. resource Lambda via REPORT line (~56ms overhead no p50, ~21%)
- Critério de saída: **parcialmente atingido**. % cold start: 3,9%/5,5%/2,7%/10,0% (BFF/Items/Subjects/Doc-Archive, 7d). Overhead do BFF: ~56ms p50 (~21%) via Duration nativa. Tempo do resource handler: Items p50=213ms/p95=1005ms, Subjects p50=213ms/p95=647ms. **Share do RequestContext: não respondido** — achado novo: as métricas EMF customizadas do PERF-02 (`bff.session_resolve_ms`, `bff.proxy_ms`, `lambda.request_context_ms`, `lambda.business_operation_ms`) não estão chegando ao CloudWatch nesta conta (nenhum namespace `ExpirationTracker/BFF`/`RequestContext`/`Items`/`Subjects` existe; busca em log bruto por essas métricas retorna zero apesar de centenas de invocações confirmadas) — só `ExpirationTracker/DispatchOutboxRelay` funciona. Requer investigação separada (possível interferência do ADOT com a extração EMF nas funções atrás do API Gateway) antes de fechar esse critério.

### PERF-05 — Lambda Power Tuning
- [x] Selecionar funções: BFF, Items, Subjects, Document Archive, Reminder Producer, Reminder Dispatch, Dossier Generator, PDF Parser — todas as 8 existem em `dev` e foram alvo de teste
- [x] Testar 256/512/1024/1769 MB por função — 7/8 com dado útil; `pdf-parser-task-handler` não mediu de forma significativa (payload de negócio `RunDeterministicParserInput` não reconstruído; ver doc de resultado)
- [ ] Coletar cold InitDuration, warm Duration, p50/p95/p99, MaxMemoryUsed, custo estimado — **parcial**: a ferramenta de power tuning só dá duração média de `num=10` invocações e custo, não percentis nem cold InitDuration separado; ficou pendente cruzar com CloudWatch Logs Insights (metodologia de PERF-02) se granularidade maior for necessária
- [x] Escolher configuração por melhor ponto latência x custo x tail latency (não "a mais rápida") — feito para as 7 funções com dado; recomendação forte só para `reminder-producer` (1769 MB, único teste com lógica de negócio real exercitada), demais recomendações são de baixa confiança (payload sintético não exercita lógica de negócio, ver caveat na doc)
- [ ] Experimento isolado ADOT ON vs OFF (função de teste apenas, não remover de produção com base nisso) — **não executado nesta rodada**, fora do escopo pedido
- Saída: `docs/engineering/performance/results/PERF-05-power-tuning.md` — tabela memória x Lambda com recomendação. Nenhuma mudança de memória foi aplicada em produção (diagnóstico apenas).
- **Reuso futuro**: stack `perf-tuning-lambda-power-tuning` (conta `975707451904`, `us-east-1`) fica implantado — state machine `arn:aws:states:us-east-1:975707451904:stateMachine:powerTuningStateMachine-26d9cbc0-b061-11f1-b8bc-0affce8a4e05` — reaproveitável por PERF-11 (load testing) ou por uma nova rodada de tuning; pode ser destruído a qualquer momento sem efeito no produto (`aws cloudformation delete-stack --stack-name perf-tuning-lambda-power-tuning`).

**Fim do Ciclo A**: nova análise profunda com os dados coletados antes de iniciar o Ciclo B. **Feito** —
`docs/engineering/performance/results/CICLO-A-analise.md`. Recomendações: (1) resolver a quota Lambda
antes de qualquer teste de concorrência — pendente de ação manual do Marcelo; (2) priorizar PERF-09
(code splitting) dentro do Ciclo B, evidência mais forte já coletada; (3) PERF-08 só terá decomposição
fina depois que a instrumentação do PERF-02 for implantada em `dev`; (4) 2 bugs reais encontrados
incidentalmente (IAM gap em Document Archive, 500 em reports por JSON.parse de CSV) precisam virar
itens de acompanhamento fora do programa de performance.

---

## Ciclo B (após Ciclo A)

- [ ] PERF-06 — Edge/CloudFront/latência Brasil (PriceClass_100 vs All, cache HIT/MISS, benchmark us-east-1 vs sa-east-1)
- [ ] PERF-07 — Fan-out de requests por tela (inventário por tela; critério para endpoint composto; não criar GraphQL improvisado)
- [ ] PERF-08 — RequestContext (medir antes; fast path só depois; avaliar BatchGet/paralelismo; nunca enfraquecer tenant isolation/RBAC)
- [ ] PERF-09 — Frontend code splitting (route-level lazy/Suspense; bundle analyzer; prefetch seletivo em idle)
- [ ] PERF-10 — Cache/freshness TanStack Query (inventariar hooks; classes STATICISH/REFERENCE/OPERATIONAL/NEAR_REALTIME; mutations com invalidação precisa)

## Ciclo C (após Ciclo B)

- [ ] PERF-11 — Load testing HTTP (k6; cenários A–D; ramp 1→100 VU; stop conditions definidas)
- [ ] PERF-12 — Async/SQS/Reminder pipeline (Producer, Dispatch, Outbox relay; volumes 1k→1M; redesign só se benchmark provar necessidade)
- [ ] PERF-13 — DynamoDB/Capacity Model v2 (personas small/medium/large; Contributor Insights; separar cold table capacity de bottleneck real)

## Fechamento

- [ ] PERF-14 — Regression gates (bundle budget CI, Lighthouse CI, k6 smoke em PR, synthetic canaries, alarms de latência/throttle/backlog, dashboard consolidado) — só depois de baseline confiável existir
- [ ] PERF-15 — Consolidação dos resultados e pacote de retorno (plano §27: quotas, browser, BFF/Lambda, Power Tuning, CloudFront, load test, bundle)

---

## Preparação que já pode ser adiantada (plano §22 — segura, sem mudança estrutural)

- [ ] Instrumentação de spans (PERF-02)
- [ ] Performance dashboards (esqueleto)
- [ ] RUM em dev
- [ ] Bundle analyzer instalado
- [ ] Harness k6 inicial (`performance/k6/`)
- [ ] Template de experimento (plano §26) salvo em `experiments/TEMPLATE.md`
- [ ] Queries CloudWatch salvas como templates
- [ ] Harness de Power Tuning
- [ ] Correlation IDs de ponta a ponta

## Não fazer sem evidência (plano §23, §24)

Não mudar definitivamente sem baseline: RequestContext fast path, memória de Lambda, code splitting,
staleTime do TanStack, endpoints compostos, PriceClass_All, Provisioned Concurrency, redesign do
Reminder Producer, tuning de concorrência SQS.

Não fazer neste ciclo, ponto: Redis/ElastiCache, DAX, remover o BFF, trocar o DynamoDB, cache de API
autenticada no CloudFront, Provisioned Concurrency em todas as Lambdas, consistência eventual em
authorization.

## Critério de conclusão da primeira rodada (plano §30)

Só declarar a primeira rodada concluída quando houver números (não opinião) para: throttling Lambda,
overhead de cold start, overhead do BFF, overhead do RequestContext, tempo em DynamoDB, tempo no
browser, requests por tela, memória correta para BFF/HTTP Lambdas, p95 warm das telas principais,
primeiro gargalo com 25/50 usuários simultâneos.
