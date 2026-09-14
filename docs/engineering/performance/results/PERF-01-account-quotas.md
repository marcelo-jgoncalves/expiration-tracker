# PERF-01 — Inventário de ambiente e quotas

## Janela analisada

- CloudWatch, 7 dias: `2026-09-07T15:52Z` → `2026-09-14T15:52Z`, período de agregação 1h (60min para o detalhe de throttle).
- Conta AWS: `975707451904` (perfil `claude-dev`), região `us-east-1`.

## Quota atual — Lambda Concurrent Executions

| Quota | Código | Valor | Ajustável | Nível |
|---|---|---|---|---|
| Concurrent executions | `L-B99A9384` | **10** | Sim | Conta (região) |

Confirma a hipótese do plano: a quota de concorrência da conta `dev` continua em **10**, o valor padrão de
conta nova AWS — não foi customizada desde a criação do ambiente.

Importante: essa quota é **compartilhada por toda a conta**, não só pelas funções do Expiration Tracker.
`aws lambda list-functions` lista **62 funções `exptrk-dev-*`** mais **10 funções de outro projeto**
(`marcelo-goncalves-blog-dev-*`) na mesma conta/região, todas competindo pelo mesmo pool de 10 execuções
concorrentes.

## Uso observado — concorrência de conta

Métrica `AWS/Lambda ConcurrentExecutions` sem dimensão (agregado de conta), estatística Maximum/Average, 168
datapoints horários:

| Métrica | Valor |
|---|---|
| Pico (Maximum) nos 7 dias | **10** (= 100% da quota) |
| Média das médias horárias | ~1.0 |

Datapoints com Maximum > 1:

| Timestamp (America/Sao_Paulo) | Maximum | Average (na hora) |
|---|---|---|
| 2026-09-08 03:53 | 2 | 1.01 |
| 2026-09-09 13:53 | 2 | 1.01 |
| **2026-09-11 16:53** | **10** | 2.32 |
| **2026-09-12 18:53** | **10** | 2.35 |
| 2026-09-14 03:53 | 2 | 1.01 |
| 2026-09-14 08:53 | 2 | 1.02 |

`UnreservedConcurrentExecutions` segue exatamente os mesmos valores (nenhuma função da conta tem
concorrência reservada configurada — ver seção SQS/ESM abaixo — então todo o pool de 10 é "não reservado").

Ou seja: a conta **encostou no teto da quota duas vezes** na última semana, fora do horário comercial
(noite/fim de tarde), provavelmente picos de execuções assíncronas concorrentes (SQS/EventBridge) somados a
alguma atividade manual.

## Throttling encontrado

**Sim, ocorreu 1 evento de throttling na janela.**

- `AWS/Lambda Throttles` agregado de conta: 1 datapoint não-zero em `2026-09-12T18:54` (Sum=1).
- Isolando por função (`get-metric-data` com granularidade de 1 min sobre as 62 funções `exptrk-dev-*`
  entre 21:40–22:10 UTC): o throttle caiu em **`exptrk-dev-dispatch-outbox-relay`**, `2026-09-12T19:03
  -03:00`, Sum=1.
- Esse evento coincide exatamente com o pico de `ConcurrentExecutions=10` do mesmo horário — confirma que
  a conta bateu na quota e pelo menos uma invocação foi rejeitada com `TooManyRequestsException`.
- Nas 7 funções-alvo do plano (BFF, Items, Subjects, Document Archive, Reports, Reminder Producer, Reminder
  Dispatch), `Throttles` somado nos 7 dias foi **0 em todas** — o throttle observado atingiu uma função
  adjacente (`dispatch-outbox-relay`, parte do pipeline assíncrono), não as funções síncronas/BFF
  diretamente. Ainda assim, é a mesma quota de conta que protege (ou limita) as 7 funções-alvo.

## Métricas por função (7 dias, soma/média por hora)

| Função | Invocations (soma) | Errors (soma) | Throttles (soma) | Duration avg (ms) | Duration p99 (ms) |
|---|---:|---:|---:|---:|---:|
| exptrk-dev-bff-handler | 128 | 0 | 0 | 1083.5 | 4896.3 |
| exptrk-dev-items-handler | 14 | 0 | 0 | 809.1 | 1553.4 |
| exptrk-dev-subjects-handler | 8 | 0 | 0 | 779.6 | 1439.9 |
| exptrk-dev-document-archive-handler | 54 | 0 | 0 | 297.0 | 1279.5 |
| exptrk-dev-reports-handler | 1 | 0 | 0 | 1301.9 | 1301.9 |
| exptrk-dev-reminder-producer | 10080 | 0 | 0 | 660.0 | 2126.2 |
| exptrk-dev-reminder-dispatch | 0 | 0 | 0 | 0.0 | 0.0 |

Observações:
- Volume é baixíssimo em todas as funções síncronas (uso manual/dev, não carga de teste) — 7 dias com
  8–128 invocações. `reminder-producer` roda em schedule fixo (10080 ≈ 1/min × 7 dias × 24h × 60min).
- `reminder-dispatch` não teve nenhuma invocação na janela — a fila `exptrk-dev-reminder-dispatch` não
  recebeu mensagens nesses 7 dias.
- `bff-handler` tem p99 de ~4.9s, bem acima da média (1.08s) — provável efeito de cold start; a
  decomposição fica para PERF-02/PERF-04, não é objeto deste inventário.
- Zero erros em todas as funções-alvo na janela.

## API Gateway

Duas APIs HTTP (`apigatewayv2`) do projeto:

| API | ApiId | Descrição |
|---|---|---|
| `exptrk-dev-bff-api` | `4nl1x2vufc` | BFF full (fronteira de sessão/auth) |
| `exptrk-dev-api` | `uav7id1muh` | Resource API (ADR-0009) |

Quotas de conta (`apigateway`, padrão AWS, não customizadas):

| Quota | Código | Valor |
|---|---|---|
| Throttle rate (steady-state) | `L-8A5B8E43` | 10.000 req/s |
| Throttle burst rate | `L-CDF5615A` | 5.000 req/s |
| API Stage throttles em usage plan | `L-A9DBC573` | 20 |

Uso observado (7 dias, `AWS/ApiGateway` por `ApiId`):

| API | Count | 4xx (soma) | 5xx (soma) | Latency avg (ms) | IntegrationLatency avg (ms) |
|---|---:|---:|---:|---:|---:|
| exptrk-dev-bff-api | 128 | 0 | 54 | 1292.7 | 1288.1 |
| exptrk-dev-api | 85 | 0 | 55 | 1533.9 | 1497.1 |

Não há evidência de throttling de API Gateway: `4xx = 0` em ambas as APIs (throttling do API Gateway
aparece como `429`, contabilizado em `4xx`). O volume de tráfego (85–128 requests em 7 dias) está
ordens de magnitude abaixo das quotas de 10k/5k req/s — API Gateway não é gargalo nesta fase. O `5xx`
elevado (54/128 e 55/85) é um sinal relevante, mas de erro de aplicação/backend (não de quota/throttle) —
fica registrado aqui como achado colateral para investigação em PERF-02/PERF-04, fora do escopo de
"estrangulamento por quota" deste experimento.

## SQS — event source mappings (funções assíncronas relevantes)

| Fila SQS | Função Lambda | BatchSize | MaximumBatchingWindow | MaximumConcurrency (ESM) | Reserved Concurrency (função) |
|---|---|---:|---:|---|---|
| `exptrk-dev-reminder-dispatch` | `exptrk-dev-reminder-dispatch` | 10 | 0s | não configurado | não configurado |
| `exptrk-dev-notification-email-deliver` | `exptrk-dev-email-delivery` | 10 | 0s | não configurado | não configurado |
| `exptrk-dev-whatsapp-deliver` | `exptrk-dev-whatsapp-delivery` | 10 | 0s | não configurado | não configurado |
| `exptrk-dev-reminder-materialization-trigger` | `exptrk-dev-reminder-materialization-trigger` | 10 | 0s | não configurado | não configurado |
| `exptrk-dev-notification-router` | — (sem event source mapping por SQS; roteamento por outro gatilho) | — | — | — | — |

Nenhuma das 7 funções-alvo do plano (nem as funções de outbox/dispatch relacionadas) tem
`ReservedConcurrentExecutions` configurado. Isso significa que **todas competem livremente pelo pool
não-reservado de 10** — não há isolamento entre, por exemplo, `bff-handler` (síncrono, latência sensível)
e `reminder-dispatch`/`dispatch-outbox-relay` (assíncrono, em lote). Nenhum event source mapping usa
`MaximumConcurrency` do ESM para limitar concorrência do lado do consumidor SQS — outra alavanca disponível
além do aumento de quota.

## Conclusão — a conta dev está estrangulando os testes?

**Ainda não, mas está no limiar — e vai estrangular assim que a carga de teste (PERF-04/PERF-05/PERF-11)
começar.**

Evidências:
- A quota de conta é 10, compartilhada entre 62 funções `exptrk-dev-*` + 10 funções de outro projeto.
- A conta **já bateu no teto de 10** duas vezes em 7 dias de uso manual/dev de baixíssimo volume,
  gerando **1 throttle real confirmado** (`dispatch-outbox-relay`, 2026-09-12 19:03 -03:00).
- Nas 7 funções-alvo do plano, throttling = 0 na janela observada — mas o volume nelas foi trivial
  (8–128 invocações em 7 dias). Não há reserva de concorrência isolando essas funções do resto da conta.
- Qualquer teste de carga real (PERF-04 com concorrência simulada, PERF-05 Power Tuning testando várias
  funções em paralelo, PERF-11 k6 com ramp até 100 VU) vai facilmente ultrapassar 10 execuções concorrentes
  somando todas as funções da conta — o throttling estrangularia o teste em si, mascarando os resultados
  de performance do produto (o teste mediria a quota, não a latência real das funções).

## Recomendação

1. **Solicitar aumento da quota `Concurrent executions` (Lambda) de 10 para 100** via Service Quotas antes
   de iniciar PERF-04/PERF-05/PERF-11 (testes de carga/concorrência). Não contornar via código
   (reserved concurrency por função apenas redistribuiria o mesmo teto de 10, não resolveria).
   - **Tentativa executada em 2026-09-14 (autorizada por Marcelo)**:
     ```
     aws --profile claude-dev service-quotas request-service-quota-increase \
       --service-code lambda --quota-code L-B99A9384 --desired-value 100 --region us-east-1
     ```
     Falhou: `IllegalArgumentException: You must provide a quota value greater than the default quota
     value of 1000.0`. Confirmado via `get-aws-default-service-quota`: o **default padrão da AWS para
     esta quota é 1000**, não 10 — o valor de 10 nesta conta é uma **restrição de conta nova/não
     verificada**, não uma quota ajustável normal. A API Service Quotas só aceita pedidos de aumento
     **acima** do default (ou seja, >1000), não para "restaurar" o default reduzido por restrição de
     conta.
   - Caminho correto: abrir um **caso de suporte manual pelo AWS Console** (Account and billing support,
     disponível mesmo no plano Basic, gratuito) pedindo a remoção da restrição de conta nova. **Não é
     possível via CLI/API**: a AWS Support API (`aws support ...`) retornou
     `SubscriptionRequiredException` — requer plano Business/Enterprise, que esta conta não tem. Esta
     etapa fica pendente de ação manual do Marcelo no Console AWS.
   - Verificado antes da tentativa: **não havia pedido de aumento pendente** para essa quota
     (`list-requested-service-quota-change-history-by-quota` retornou lista vazia).
2. Considerar `ReservedConcurrentExecutions` em `bff-handler`/`items-handler`/`subjects-handler` (funções
   síncronas, latência sensível) para isolá-las do pool competido por funções assíncronas em lote, mesmo
   após o aumento de quota — evita que um pico assíncrono (ex.: reprocessamento de outbox) throttle
   requests de usuário.
3. Nenhuma ação necessária em API Gateway (quotas muito acima do volume observado).
4. O `5xx` de API Gateway (~40-65% das respostas em ambas APIs) merece investigação separada — não é
   quota/throttle, mas é um achado que pode distorcer PERF-04 se não for entendido antes.
