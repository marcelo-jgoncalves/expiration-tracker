# PERF-04 — Baseline BFF / HTTP / Resource Lambda

## Metodologia

Medição contra o ambiente `dev` real (`https://d1mbs2t047qo9d.cloudfront.net`), tenant sintético
descrito em `docs/engineering/performance/baseline/PERF-04-test-tenant.md` (org
`org_01M2GE4F1SZPSJ47HCGRXH4XMN`, 7 Items, 2 Subjects). Sessão obtida via
`docs/engineering/performance/traces/perf-04-auth.mjs` (OAuth real contra o Cognito Hosted UI),
reaproveitada de uma execução anterior nesta mesma sessão de trabalho (cookie datado de
`2026-09-14T17:06:01Z`, validado com `GET /bff/session` antes do teste).

**Teste warm**: script `docs/engineering/performance/traces/perf-04-latency.mjs` — 50 requests
sequenciais (concurrency=1, delay de 150ms entre requests) por endpoint, descartando as 5
primeiras como aquecimento; latência medida como wall-clock (`performance.now()`) do início do
`fetch` até o corpo da resposta totalmente lido, em Node.js rodando localmente (máquina do
desenvolvedor, não da rede AWS — inclui portanto o RTT real internet→CloudFront→API Gateway→
Lambda→volta). Resultado bruto salvo em
`docs/engineering/performance/traces/perf-04-latency-results.json`.

**Teste cold**: não foi forçado sinteticamente (não há como garantir cold start sob demanda numa
Lambda compartilhada e já aquecida por uso manual recente, sem esperar scale-to-zero natural, que
levaria horas). Em vez disso, seguiu-se a recomendação do próprio enunciado: consulta a
CloudWatch Logs Insights sobre a linha `REPORT` nativa (mesmo padrão de
`results/PERF-02-cold-start.md`), tanto na janela dos últimos 20 minutos (cobrindo exatamente a
execução deste teste) quanto nos últimos 7 dias (tráfego real mais amplo, incluindo uso manual
anterior de PERF-01/02/03/04).

**Decomposição via métricas customizadas (EMF)**: tentada conforme pedido pelo enunciado, mas
**não foi possível** — ver seção "Achado: métricas EMF de BFF/Items/Subjects não estão chegando
ao CloudWatch" abaixo. A decomposição de overhead usa, em vez disso, a `Duration` da linha
`REPORT` (tempo de execução real de cada função, nativo, sem instrumentação extra) comparando BFF
vs. resource Lambda no mesmo período.

**Comparação BFF vs. chamada direta ao Resource API**: **não realizada** (ver seção própria) —
time-boxed conforme instrução da tarefa.

## Endpoints medidos

| Endpoint | Incluído? |
|---|---|
| `GET /bff/session` | Sim |
| `GET /bff/api/items/dashboard` | Sim |
| `GET /bff/api/subjects/dashboard` | Sim |
| `GET /bff/api/subjects/{subjectId}` | Sim (`subject_01M2GE65D5XGV7CXQ6ECB9YYAD`) |
| `GET /bff/api/reports/expiring-soon-items` | **Excluído** — bug conhecido (500, CSV/JSON.parse mismatch no proxy do BFF), já documentado em `baseline/PERF-04-test-tenant.md`, não é alvo de medição de latência |
| `GET /bff/api/document-archive/...` | **Excluído** — ver achado abaixo |

### Achado: todas as rotas de document-archive retornam 500 mesmo para leitura

Testadas 5 rotas de leitura que não dependem dos dados de "requirement" que falharam ao ser
semeados (`storage-usage`, `document-types`, `requirements/{subjectId}`, `reviews`,
`requirements/search`):

| Rota | Status | Causa |
|---|---|---|
| `GET /document-archive/storage-usage` | 500 | `DynamoDB access denied during OrganizationStore.queryGsi4.` |
| `GET /document-archive/document-types` | 500 | idem |
| `GET /document-archive/requirements/{subjectId}` | 500 | idem |
| `GET /document-archive/reviews` | 500 | erro de schema diferente (`Unknown schema $id`), não relacionado a permissão |
| `GET /document-archive/requirements/search?subjectId=...` | 400 | validação de query params (`status` obrigatório) |

O gap de IAM (`OrganizationStore.queryGsi4` — mesmo achado já registrado em
`PERF-04-test-tenant.md` para a tentativa de escrita) bloqueia **todas** as rotas de leitura do
módulo document-archive nesta conta dev, não só a escrita de requirements. Não há rota de
document-archive medível sem essa correção de permissão IAM, que está fora do escopo desta tarefa
de medição. Registrado aqui como achado para acompanhamento; não corrigido.

## Resultados — teste warm (50 requests, 5 descartadas, ms)

| Endpoint | amostras válidas | min | p50 | p75 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|---|
| `GET /bff/session` | 45/45 (200) | 210 | 263 | 299 | 331 | 340 | 476 | 476 |
| `GET /bff/api/items/dashboard` | 45/45 (200) | 365 | 468 | 502 | 594 | 638 | 692 | 692 |
| `GET /bff/api/subjects/dashboard` | 45/45 (200) | 354 | 477 | 530 | 570 | 606 | 945 | 945 |
| `GET /bff/api/subjects/{subjectId}` | 45/45 (200) | 321 | 437 | 498 | 567 | 628 | 804 | 804 |

Todos os 200 requests (4 endpoints × 50) retornaram `200`; nenhum erro/timeout. Latência
wall-clock medida do cliente (inclui rede internet→CloudFront, fora do controle da Lambda).

## Cold start — tráfego real (não forçado)

### Janela do teste (últimos 20 min, cobre exatamente esta execução)

| Função | invocações | cold starts | % cold | InitDuration médio (cold) |
|---|---|---|---|---|
| `exptrk-dev-bff-handler` | 232 | 1 | 0,43% | 1866ms |

### Janela ampla (7 dias, tráfego real de uso manual PERF-01→04)

| Função | invocações | cold starts | % cold | InitDuration médio | InitDuration p90 |
|---|---|---|---|---|---|
| `exptrk-dev-bff-handler` | 360 | 14 | **3,9%** | 1854ms | 1997ms |
| `exptrk-dev-items-handler` | 73 | 4 | **5,5%** | 2156ms | 2186ms |
| `exptrk-dev-subjects-handler` | 112 | 3 | **2,7%** | 2153ms | 2211ms |
| `exptrk-dev-document-archive-handler` | 60 | 6 | **10,0%** | 1847ms | 2262ms |

Leitura: com o volume baixo e irregular de uso manual/dev (sem tráfego constante), a taxa de cold
start observada fica entre ~3% e ~10% dependendo da função — mais alta em funções chamadas com
menos frequência (document-archive) e mais baixa nas mais usadas (subjects). O `InitDuration`
fica consistentemente em **~1,8–2,2s**, confirmando o achado do PERF-02 (custo da layer ADOT
OpenTelemetry inicializando num novo execution environment, em 256MB). Não é uma medição
controlada de "% cold start sob carga real de produção" — é a taxa observada no tráfego
irregular disponível nesta conta dev; deve ser revisitada com dados de produção ou sob carga
controlada (PERF-11).

## Decomposição de overhead — BFF vs. resource Lambda (via `Duration` da REPORT line)

Comparando a `Duration` (tempo de execução da função, nativo, sem instrumentação extra) do BFF
handler com a dos resource handlers Items/Subjects, na mesma janela dos 200 requests deste teste
(últimos 20 min):

| Função | invocações | Duration p50 | Duration p90 | Duration p95 | Duration max |
|---|---|---|---|---|---|
| `exptrk-dev-bff-handler` | 232 | 269ms | 474ms | 809ms | 4609ms |
| `exptrk-dev-items-handler` | 59 | 213ms | 545ms | 1005ms | 1198ms |
| `exptrk-dev-subjects-handler` | 104 | 213ms | 381ms | 647ms | 1651ms |

**Overhead estrutural do BFF (estimativa)**: `Duration(BFF) − Duration(resource Lambda)` ≈
**269ms − 213ms ≈ 56ms no p50** (~21% do tempo do BFF). Essa diferença cobre: resolução de sessão
(`resolveSession`, decode/valida cookie + possível refresh de token), checagem de CSRF, montagem
da chamada HTTP de saída para o resource API (`ProxyService.forward`, sobre a mesma VPC/AWS
network, não sobre a internet pública) e mapeamento da resposta de volta. É uma estimativa por
correlação estatística no mesmo período (não pareada request-a-request, já que o BFF chama Items
e Subjects em proporções diferentes das medidas aqui) — suficiente para responder à pergunta do
plano ("overhead do BFF" em ordem de grandeza), não uma medição controlada por trace individual
(isso exigiria X-Ray trace analysis correlacionando `TraceId`, fora do escopo desta fatia).

**Nota sobre o wall-clock do cliente vs. `Duration` da Lambda**: o wall-clock medido pelo script
(ex.: items.dashboard p50 = 468ms) é ~200ms maior que a `Duration` do BFF handler sozinho
(269ms) — essa diferença é rede (internet→CloudFront→API Gateway) + tempo de fila/frio do API
Gateway, não tempo de execução Lambda. Não foi decomposta região a região (fora do escopo; isso é
PERF-06, Edge/CloudFront).

## Achado: métricas EMF de BFF/Items/Subjects não estão chegando ao CloudWatch

O enunciado pedia usar as métricas customizadas já instrumentadas no PERF-02
(`bff.session_resolve_ms`, `bff.proxy_ms`, `lambda.request_context_ms`,
`lambda.business_operation_ms`) via CloudWatch EMF para decompor o overhead. Investigado e
**confirmado que essas métricas não existem no CloudWatch nesta conta**:

- `aws cloudwatch list-metrics` não retorna nenhum namespace `ExpirationTracker/BFF`,
  `ExpirationTracker/RequestContext`, `ExpirationTracker/Items` ou `ExpirationTracker/Subjects` —
  apenas `ExpirationTracker/DispatchOutboxRelay` existe entre os namespaces customizados do
  projeto.
- Busca direta nos logs brutos (`CloudWatch Logs Insights`, `filter @message like /.../`) por
  `session_resolve_ms`, `proxy timing`, `CloudWatchMetrics` (a chave que identifica uma linha EMF)
  no log group `/aws/lambda/exptrk-dev-bff-handler` (2h e 7 dias) e por `business_operation_ms`
  em `/aws/lambda/exptrk-dev-items-handler` (2h) retornou **zero resultados**, apesar de 232 e 59
  invocações reais respectivamente na mesma janela (confirmado via `filter @type = "REPORT"`, que
  funciona normalmente).
- Ou seja: o código que chama `emitMetric()`/`logger.info()` em `handleProxy`
  (`src/modules/bff/http/bff-handlers.ts:335-337`) e nos handlers de recurso
  (`src/runtime/aws/handlers/items-handler.ts` etc., via `timeSpan(NAMESPACE, ...)`) existe e foi
  mergeado (PERF-02), mas a linha de log EMF que deveria sair via `console.log` não está
  aparecendo no CloudWatch Logs desta função — nem como métrica extraída, nem como texto bruto.
  `ExpirationTracker/DispatchOutboxRelay` (que roda `emitMetric` no handler de um worker SQS,
  não atrás do API Gateway) **funciona normalmente**, o que sugere que o problema é específico do
  caminho BFF/Items/Subjects (funções atrás do API Gateway, com a layer ADOT ativa) — hipótese
  mais provável: a instrumentação ADOT intercepta/reescreve `console.log` de um jeito que
  interfere com a extração automática de EMF pelo CloudWatch para essas funções especificamente,
  mas não foi confirmado a causa raiz (fora do escopo de uma tarefa de medição).

**Isto é um achado real, não um erro deste teste** — vale um item de acompanhamento (possivelmente
dentro de PERF-05, que já vai isolar ADOT ON/OFF, ou um item dedicado) antes de depender dessas
métricas em qualquer decisão futura do programa de performance. A decomposição de overhead acima
foi feita com a `Duration` nativa da REPORT line como alternativa, que está confirmada funcionando.

## BFF vs. chamada direta ao Resource API — não realizado

Avaliado e **descartado por time-box**, não forçado: o App Client Cognito usado pelo tenant de
teste (`7n8g55k4vsmg9rat962666jthd`) só tem `ALLOW_USER_SRP_AUTH` habilitado
(`aws cognito-idp describe-user-pool-client`) — nem `USER_PASSWORD_AUTH` nem
`ADMIN_USER_PASSWORD_AUTH`. Obter um access token Cognito bruto (necessário para chamar
`https://uav7id1muh.execute-api.us-east-1.amazonaws.com` — `exptrk-dev-api`, confirmado via
`aws apigatewayv2 get-apis` — diretamente com `Authorization: Bearer` + `x-organization-id`, sem
passar pelo BFF) exigiria implementar o handshake SRP (Secure Remote Password) completo
manualmente (aritmética de big-number, HKDF) — não há biblioteca pronta no repo
(`amazon-cognito-identity-js` não está instalado; só o SDK `@aws-sdk/client-cognito-identity-
provider`, que não implementa SRP por conta própria). Isso é plumbing de autenticação
significativo, fora do time-box desta fatia — corretamente escopado como "pular e documentar" pela
própria instrução da tarefa.

Como proxy aproximado da comparação, a seção anterior (`Duration` BFF vs. resource Lambda) já
mostra a ordem de grandeza do overhead estrutural do BFF (~56ms no p50) mesmo sem a chamada direta
ao resource API isolada da rede pública.

## Resposta ao critério de saída do plano

> saber % cold start, overhead do BFF, tempo do resource handler, share do RequestContext

- **% cold start**: 3,9% (BFF, 7 dias/360 invocações), 5,5% (Items), 2,7% (Subjects), 10,0%
  (Document Archive) — tráfego real de uso manual/dev, não carga controlada. `InitDuration`
  consistente em ~1,8–2,2s em todas as funções (layer ADOT, 256MB).
- **Overhead do BFF**: ~56ms no p50 (Duration BFF − Duration resource Lambda, mesma janela),
  ~21% do tempo de execução Lambda do BFF. Decomposição fina (session_resolve_ms vs. proxy_ms)
  **não disponível** — ver achado EMF acima.
- **Tempo do resource handler**: Items p50=213ms/p95=1005ms; Subjects p50=213ms/p95=647ms
  (Duration nativa da REPORT line).
- **Share do RequestContext**: **não respondido** — depende da métrica
  `lambda.request_context_ms` (`ExpirationTracker/RequestContext`), que sofre do mesmo problema de
  EMF não aparecendo no CloudWatch (achado acima). Sem essa métrica, não há como isolar o tempo de
  `resolveRequestContext` dentro do `Duration` total do resource handler nesta fatia. Pendente até
  o achado EMF ser investigado/corrigido.

## Arquivos

- `docs/engineering/performance/traces/perf-04-latency.mjs` — harness reutilizável (warm test).
- `docs/engineering/performance/traces/perf-04-latency-results.json` — amostra bruta desta
  execução (200 requests, 4 endpoints, timestamps `2026-09-14T17:14:11Z`).
- `docs/engineering/performance/results/PERF-04-bff-lambda-baseline.md` — este arquivo.
