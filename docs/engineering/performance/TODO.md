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
- [ ] Cold start: coletar InitDuration, Duration, MaxMemoryUsed, PostRuntimeExtensionsDuration — **pendente**: isso vem nativamente do CloudWatch Lambda Insights/relatório de plataforma (REPORT lines), não requer código; falta habilitar/confirmar Lambda Insights nas funções-alvo e documentar como consultar
- [ ] Avaliar CloudWatch Application Signals primeiro só em BFF/Items/Subjects/Document Archive — **pendente**, é decisão/análise, não código
- [ ] Preparar CloudWatch RUM no frontend (sampling baixo, dev apenas, sem dados sensíveis); métrica própria `ET_ROUTE_USEFUL_CONTENT_MS` — **pendente**, greenfield no frontend
- [~] Garantir correlation ID de ponta a ponta (browser → BFF → resource API → Lambda) — **parcial**: perna BFF→resource-API fechada (`x-correlation-id`, commit slice 1); browser→BFF e o ulid interno de cada resource Lambda ainda desconectados
- Critério de saída: para uma request qualquer, decompor BFF/RequestContext/Business/DynamoDB em ms. **Atingido para as 6 funções-alvo cobertas** (BFF, Items, Subjects, Document Archive, Reminder Producer, Reminder Dispatch); cold start nativo, Application Signals, RUM e correlation ID completo continuam pendentes.

### PERF-03 — Baseline frontend/browser
- [ ] Rodar DevTools/Lighthouse/Playwright/RUM/Profiler nas jornadas J01–J08 (Login→Overview, Overview→Items, Overview→Subjects, Subjects→SubjectHub, SubjectHub→Requirements, Requirements→DocumentDetail, Reports, Settings)
- [ ] Coletar por jornada: TTFB, DCL, Load, LCP, INP, CLS, JS transferred, JS parse/exec, nº requests, time-to-useful-data
- [ ] Guardar waterfalls (screenshots) de J01, J04, J06
- [ ] Registrar bundle baseline atual (JS raw/gzip, CSS raw/gzip) — referência do plano: ~480KB raw / ~135KB gzip
- [ ] Repetir com Fast 4G + CPU throttling
- Critério de saída: separar tempo gasto em frontend vs. espera de API.

### PERF-04 — Baseline BFF / HTTP / Resource Lambda
- [ ] Selecionar endpoints representativos (`/bff/session`, items/dashboard, subjects/dashboard, subject/{id}, document-archive, reports)
- [ ] Teste warm: 50 requests, concurrency=1, descartar cold; coletar p50/p75/p90/p95/p99
- [ ] Teste cold: 10–20 amostras isoladas
- [ ] Comparar BFF x chamada direta ao Resource API (medir overhead estrutural do BFF, sem mudar produto)
- Critério de saída: saber % cold start, overhead do BFF, tempo do resource handler, share do RequestContext.

### PERF-05 — Lambda Power Tuning
- [ ] Selecionar funções: BFF, Items, Subjects, Document Archive, Reminder Producer, Reminder Dispatch, Dossier Generator, PDF Parser
- [ ] Testar 256/512/1024/1769 MB por função
- [ ] Coletar cold InitDuration, warm Duration, p50/p95/p99, MaxMemoryUsed, custo estimado
- [ ] Escolher configuração por melhor ponto latência x custo x tail latency (não "a mais rápida")
- [ ] Experimento isolado ADOT ON vs OFF (função de teste apenas, não remover de produção com base nisso)
- Saída: tabela memória x Lambda com recomendação.

**Fim do Ciclo A**: nova análise profunda com os dados coletados antes de iniciar o Ciclo B.

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
