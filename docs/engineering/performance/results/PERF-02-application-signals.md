# PERF-02 — Avaliação: CloudWatch Application Signals

## Pergunta

O plano pede uma avaliação (não implementação) de habilitar CloudWatch Application Signals para
BFF/Items/Subjects/Document Archive: vale a pena?

## O que Application Signals exige

Application Signals é construído em cima do **ADOT** (AWS Distro for OpenTelemetry) — a mesma layer que este
projeto já anexa a (praticamente) todas as Lambdas via `var.adot_layer_arn`
(`infra/env/dev.tfvars`: `arn:aws:lambda:us-east-1:901920570463:layer:aws-otel-nodejs-arm64-ver-1-30-0:4`) e
`infra/modules/lambda-function/main.tf` (condicionado a `var.tracing_active`, que já está `true` — X-Ray
`TracingConfig.Mode = Active` confirmado via `get-function-configuration` nas 6 funções-alvo).

Para ligar Application Signals de fato, falta:
1. Variável de ambiente `OTEL_AWS_APPLICATION_SIGNALS_ENABLED=true` (e normalmente
   `OTEL_AWS_APPLICATION_SIGNALS_EXPORTER_ENDPOINT` apontando pro CloudWatch Agent/extension) em cada função
   — mudança de infra (env vars em `infra/main.tf`/`local.common_env`).
2. Uma "service" discovery/configuração habilitada no console/API do Application Signals para a conta —
   ação de conta, não de Terraform puro (embora exista provider/resource `aws_applicationsignals_*` em
   versões recentes do provider AWS — não usado hoje neste repo).
3. Permissões IAM adicionais (`CloudWatchApplicationSignalsFullAccess` ou policy equivalente) nas execution
   roles.

Ou seja: **não é gratuito nem automático** — mesmo já tendo ADOT, ligar Application Signals é uma mudança de
infra real (env vars + IAM + habilitação de conta), não uma flag passiva.

## O que ganharíamos vs. o que já existe

O que o PERF-02 já entregou nas 6 funções-alvo (commits anteriores desta fatia):
- Métricas EMF customizadas granulares: `bff.total_ms`, `bff.session_resolve_ms`, `bff.proxy_ms`,
  `lambda.total_ms`, `request_context_ms`, `business_operation_ms`, `dynamodb.operation_ms` por operação,
  `cold_start` flag — via `withHandlerTiming`/`timeSpan` (`src/shared/observability/handler-timing.ts`).
- X-Ray Active tracing já ligado em todas as funções (traces distribuídos ponta a ponta via ADOT).
- Correlation ID (`x-correlation-id`) propagado BFF → resource API (slice 1 desta fatia).

O que Application Signals adicionaria por cima disso:
- Um **service map** automático (grafo de dependências entre serviços/Lambdas/DynamoDB/SQS) sem precisar
  construir dashboards manualmente.
- **SLOs** geridos pelo CloudWatch (latência/disponibilidade) com alarmes prontos.
- Correlação automática entre métricas de negócio e traces X-Ray (o "Application Signals" liga métrica →
  trace → log num clique), reduzindo trabalho manual de dashboard building.

Praticamente tudo isso é **conveniência de visualização/operação**, não dado novo: os números granulares já
existem (EMF) e os traces já existem (X-Ray Active). Application Signals não mede nada que este projeto não
esteja já medindo — ele agrega e visualiza melhor, e adiciona SLO/alarme gerenciado.

## Custo

Application Signals cobra por métrica de serviço monitorada + por trace processado (além do custo normal de
X-Ray/CloudWatch que já existe). Para o volume atual (uso manual/dev, dezenas de invocações/dia — ver
PERF-01), o custo absoluto é pequeno, mas é **custo recorrente novo** para um ganho que hoje é
majoritariamente de conveniência de dashboard, não de cobertura de dados.

## Recomendação

**Não habilitar agora.** As métricas EMF customizadas que a fatia PERF-02 acabou de entregar já cobrem a
decomposição pedida pelo plano (BFF/RequestContext/Business/DynamoDB em ms), e X-Ray Active já dá tracing
distribuído. Application Signals valeria a pena quando:
- o número de serviços/Lambdas envolvidos numa jornada crescer o suficiente pra que montar dashboards
  manuais vire trabalho recorrente (hoje 6 funções cobertas, plano tem ~62 funções na conta), **ou**
- Ciclo C (PERF-14, regression gates / dashboard consolidado) precisar de SLOs formais com alarme gerenciado
  em vez de alarmes CloudWatch manuais.

Reavaliar em PERF-14, não antes. Nenhuma ação de infra tomada nesta fatia.
