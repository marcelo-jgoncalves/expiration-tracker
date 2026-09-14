Rodada 1 (proposta inicial). Decisão E-018/E-021 (full-audit round2, achado convergente, `docs/engineering/decisions-log.md`): "EMF/`metrics.ts`/dashboard permanece sem correção — confirmado por grep, nenhum arquivo de métrica customizada nem `aws_cloudwatch_dashboard` existe" — critério "Observabilidade Operacional & Visão por Tenant" (`joint-review-criteria.md`, 11% de peso). Também nomeado como fora de escopo deliberado em `m5-observability-design.md` §1 ("fica para uma sessão de produto").

## Contexto real (verificado no código antes de propor)

`src/shared/observability/logger.ts`'s próprio comentário já registra uma restrição de design que qualquer proposta de métrica precisa respeitar: **"tenantId may appear in structured logs for investigation... but must never become an EMF metric dimension"** — CloudWatch EMF custom metrics são cobradas por combinação única de dimensões; usar `tenantId` como dimensão explodiria custo/cardinalidade a cada tenant novo (o projeto já tem `AuthorizedTenantId` propagado por 4 módulos, D-237/238/239/240, então o volume de tenants é uma variável real de crescimento, não hipotética). Isso significa: a "visão por tenant" do critério do audit não pode vir de dimensão de métrica CloudWatch — precisa vir de CloudWatch Logs Insights sobre os logs estruturados já existentes (que JÁ carregam `tenantId`, `logger.ts` linha 1). Registro este trade-off explicitamente porque o nome do critério ("visão por tenant") sugere dimensionamento por tenant, e a proposta abaixo delibera NÃO fazer isso.

30 workers assíncronos existem hoje (`src/workers/*`). Instrumentar EMF em todos nesta rodada seria desproporcional (`principles.md` #1) — a proposta escopa aos 3 pipelines já citados repetidamente em `decisions-log.md` como ponto de risco operacional real: `reminder-dispatch` (SLO de drenagem crítico, D-046), `dispatch-outbox-relay`/entrega de notificação (email+whatsapp, achados reais de claim-before-send em D-233/pendente em `deliver.ts`), e `guest-credential-delivery` (mesma classe de achado, D-233 já corrigiu o lease mas nenhuma métrica existe para alertar se voltar a quebrar).

## Pesquisa externa (E-014, decisão nível 5 que redefine convenção de observabilidade): SIM

AWS's own guidance (Embedded Metric Format best practices, docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html, acessado 2026-09-14) confirma o padrão: EMF metrics são structured JSON log lines com um bloco `_aws.CloudWatchMetrics` que o CloudWatch Logs agent extrai automaticamente — nenhum SDK novo, nenhuma chamada de API síncrona adicional (`PutMetricData` custaria latência/custo por chamada; EMF é fire-and-forget via stdout, mesmo custo marginal de um `console.log` já pago). Confirma também o teto de 30 dimensões/100 valores por dimensão por evento EMF — irrelevante aqui (a proposta usa 2 dimensões fixas). E confirma que dimensões de alta cardinalidade (como `tenantId`, um user ID, um request ID) são o antipadrão nomeado explicitamente na doc — validando a restrição que `logger.ts` já tinha registrado por instinto de custo, agora com fonte externa citada.

## Proposta de desenho

### 1. `src/shared/observability/metrics.ts` (mecanismo, reusável por qualquer handler futuro)

```ts
export interface MetricPoint {
  name: string;
  value: number;
  unit: "Count" | "Milliseconds";
}

export function emitMetric(component: string, point: MetricPoint): void {
  // console.log de uma linha EMF: { _aws: { CloudWatchMetrics: [...] }, Component: component, [point.name]: point.value }
  // Dimensões: SÓ "Component" (ex. "reminder-dispatch") - NUNCA tenantId/requestId/qualquer
  // valor de alta cardinalidade, mesma restrição já documentada em logger.ts.
}
```

Sem SDK novo, sem IAM novo (EMF é só `console.log`, a permissão `logs:PutLogEvents` que toda Lambda já tem via `AWSLambdaBasicExecutionRole` basta). `emitMetric` nunca lança — uma falha ao formatar/escrever uma métrica não pode derrubar o handler que a chama (mesmo princípio de "observabilidade nunca é caminho crítico" que `SecureLogger` já segue).

### 2. Instrumentação real, 3 pipelines (nunca os 30 workers nesta rodada)

- `reminder-dispatch/dispatch.ts`: `emitMetric("reminder-dispatch", {name: "OccurrenceProcessed", value: 1, unit: "Count"})` no sucesso, `{name: "OccurrenceFailed", ...}` no catch — mesmo padrão em `document-chasing-dispatch` (mesmo mecanismo compartilhado, D-039).
- `dispatch-outbox-relay/relay.ts` (usado tanto por email quanto whatsapp, D-9): `{name: "DeliveryAttempted"}`/`{name: "DeliverySucceeded"}`/`{name: "DeliveryFailed"}`.
- `guest-credential-delivery/deliver.ts`: `{name: "CredentialDeliverySucceeded"}`/`{name: "CredentialDeliveryFailed"}` — fecha parte real do gap nomeado em E-021 (claim-before-send): hoje uma falha silenciosa não dispara NADA observável; um alarme sobre `CredentialDeliveryFailed > 0` teria pego o próprio incidente que o achado descreve, mesmo sem corrigir a causa raiz (que continua fora de escopo, decisão de Marcelo pendente).

### 3. Dashboard (`infra/modules/observability-dashboard/`, novo módulo, mesmo padrão de `alert-topic`/`reminder-observability`)

Um `aws_cloudwatch_dashboard` único combinando:
- Métricas NATIVAS já existentes sem código novo (Lambda Errors/Duration/Throttles por função, SQS ApproximateNumberOfMessagesVisible/Age por fila, DynamoDB ConsumedCapacity/ThrottledRequests) — valor imediato, zero risco, zero instrumentação nova.
- As métricas customizadas novas dos 3 pipelines acima (`Component`="reminder-dispatch"/"dispatch-outbox-relay"/"guest-credential-delivery").

Nunca por tenant (ver trade-off acima) — "visão agregada operacional", não "visão por tenant". Isso é uma redução de escopo real vs. o nome do critério do audit, registrada explicitamente aqui, não escondida.

## Pergunta

O desenho fecha a lacuna real nomeada (EMF+dashboard inexistentes) com escopo proporcional? A decisão de nunca usar `tenantId` como dimensão (fonte externa citada) está correta, ou existe um padrão AWS de "visão por tenant" agregada que a proposta está deixando passar (ex. CloudWatch Contributor Insights, que agrega por campo de log sem virar dimensão de métrica paga por combinação)? Escopo de 3 pipelines de 30 workers — razoável para uma primeira rodada, ou deveria ser maior/menor?
