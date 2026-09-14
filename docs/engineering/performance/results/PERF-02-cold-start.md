# PERF-02 — Cold start (InitDuration/Duration/MaxMemoryUsed)

## Pergunta

O plano pede coleta de `InitDuration`, `Duration`, `MaxMemoryUsed`, `PostRuntimeExtensionsDuration` por
invocação. Isso já vem nativo do runtime Lambda na linha `REPORT` do CloudWatch Logs — a dúvida era só:
precisa habilitar CloudWatch Lambda Insights (extensão paga) para ter isso, ou dá pra extrair de graça via
CloudWatch Logs Insights?

## Estado atual das funções-alvo

Verificado com `aws --profile claude-dev lambda get-function-configuration` nas 6 funções do plano (BFF,
Items, Subjects, Document Archive, Reminder Producer, Reminder Dispatch):

| Função | Layers | Lambda Insights? | X-Ray Tracing |
|---|---|---|---|
| `exptrk-dev-bff-handler` | `aws-otel-nodejs-arm64-ver-1-30-0:4` (ADOT) | **Não** | `Active` |
| Items / Subjects / Document Archive / Reminder Producer / Reminder Dispatch | mesmo layer ADOT | **Não** | `Active` |

Nenhuma das 62 funções `exptrk-dev-*` tem a layer `LambdaInsightsExtension` anexada (confirmado por grep em
`infra/` — não há nenhuma menção a `insights`/`LambdaInsightsExtension` fora dos módulos de dashboard
CloudWatch, que são dashboards de métricas gerais, não a extensão de Lambda Insights). Todas já têm o layer
ADOT (OpenTelemetry) e X-Ray Active tracing, herdados de `var.adot_layer_arn` + `var.tracing_active` em
`infra/env/dev.tfvars` / `infra/modules/lambda-function/main.tf`.

## Lambda Insights vs. CloudWatch Logs Insights sobre REPORT lines

**Lambda Insights** (a extensão/layer `LambdaInsightsExtension`):
- Cobra por GB-segundo extra de execução (a extensão roda dentro do runtime) + ingestão/armazenamento de
  métricas customizadas no CloudWatch — custo real, ainda que pequeno por invocação, multiplicado por
  centenas de milhares de invocações/mês pode não ser desprezível.
- Dá dashboards prontos por função (agregação automática de cold start rate, memória, etc.) e correlação
  fácil função↔billing.
- É uma mudança de infra (layer + policy) em produção, fora do escopo desta fatia (análise apenas).

**CloudWatch Logs Insights sobre a linha REPORT** (o que já existe, de graça):
- Toda invocação Lambda já emite uma linha `REPORT RequestId: ... Duration: ... Billed Duration: ...
  Memory Size: ... Max Memory Used: ... [Init Duration: ... ]` no log group `/aws/lambda/<função>` — sem
  nenhuma mudança de código ou infra.
- CloudWatch Logs Insights reconhece essa linha automaticamente e expõe campos derivados prontos:
  `@duration`, `@billedDuration`, `@memorySize`, `@maxMemoryUsed`, `@initDuration` (só presente quando a
  invocação foi cold start).
- Custo: só o de consultas Logs Insights (cobrado por GB escaneado), sem custo adicional por invocação —
  muito mais barato para o volume atual (dezenas/centenas de invocações por dia, ver PERF-01).
- `PostRuntimeExtensionsDuration` também aparece na REPORT line quando há extensões externas configuradas
  (não é o caso hoje, já que só há a layer ADOT, que roda como parte do processo do runtime, não como
  extensão externa separada — por isso esse campo não apareceu nas amostras abaixo).

## Recomendação

**Não habilitar Lambda Insights agora.** A REPORT line + CloudWatch Logs Insights já dá os 4 números pedidos
pelo plano sem custo adicional e sem mudança de infra, e o volume de invocações (baixo, uso manual/dev) não
justifica o custo por invocação da extensão. Revisitar a decisão se/quando o Ciclo C (PERF-11, load testing)
mostrar volume alto o suficiente para justificar dashboards agregados automáticos — nesse ponto vale
reconsiderar Lambda Insights como parte de PERF-14 (regression gates / dashboard consolidado), não antes.

## Query CloudWatch Logs Insights (template reutilizável)

Todas as invocações (cold + warm), últimos N dias:

```
filter @type = "REPORT"
| fields @timestamp, @requestId, @duration, @billedDuration, @maxMemoryUsed, @memorySize, @initDuration
| sort @timestamp desc
| limit 50
```

Só cold starts (campo `@initDuration` só existe quando houve inicialização de novo ambiente de execução):

```
filter @type = "REPORT" and ispresent(@initDuration)
| fields @timestamp, @requestId, @duration, @initDuration, @maxMemoryUsed, @memorySize
| sort @timestamp desc
| limit 20
```

Taxa de cold start e InitDuration médio/p90 por função, numa janela:

```
filter @type = "REPORT"
| stats count(*) as invocations,
        sum(ispresent(@initDuration)) as coldStarts,
        avg(@initDuration) as avgInitDuration,
        pct(@initDuration, 90) as p90InitDuration,
        avg(@duration) as avgDuration,
        pct(@duration, 95) as p95Duration
```

## Prova de conceito — amostra real (BFF, `exptrk-dev-bff-handler`, últimos 14 dias)

Executado via `aws --profile claude-dev logs start-query` / `get-query-results` contra
`/aws/lambda/exptrk-dev-bff-handler`.

Amostra de cold starts reais encontrados (campo `@initDuration` presente):

| Timestamp | Duration (ms) | InitDuration (ms) | MaxMemoryUsed | MemorySize |
|---|---|---|---|---|
| 2026-09-12 22:04:01.780 | 1359.45 | **1934.46** | 184 MB | 256 MB |
| 2026-09-12 22:02:29.853 | 1297.25 | **1963.72** | 184 MB | 256 MB |
| 2026-09-12 22:02:29.460 | 1282.07 | **1644.04** | 184 MB | 256 MB |

Amostra warm (sem `@initDuration`), mesma janela:

| Timestamp | Duration (ms) | Billed (ms) | MaxMemoryUsed |
|---|---|---|---|
| 2026-09-12 22:04:08.993 | 1115.28 | 1116 | 193 MB |
| 2026-09-12 22:04:08.217 | 332.10 | 333 | 198 MB |

Leitura inicial (amostra pequena, não é o baseline formal de PERF-04/05 — só prova que a query funciona e dá
números plausíveis): cold start do BFF fica **~1.6–2.0s de InitDuration** em 256 MB com a layer ADOT
carregada — consistente com o custo conhecido de inicializar o SDK OpenTelemetry Node.js num ambiente Lambda
novo. Esse número deve ser revisitado formalmente em PERF-05 (Lambda Power Tuning, que já prevê comparar
ADOT ON vs OFF isoladamente) — não tirar conclusões de produto desta amostra pequena.

## Conclusão para o critério de saída do PERF-02

Cold start (`InitDuration`/`Duration`/`MaxMemoryUsed`/`PostRuntimeExtensionsDuration`) está **coberto** sem
nenhuma mudança de código ou infra: os números já existem na REPORT line nativa e são consultáveis via
CloudWatch Logs Insights com as queries acima. Nenhuma ação de infra necessária nesta fatia.
