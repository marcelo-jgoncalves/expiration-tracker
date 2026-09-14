Rodada 2 (revisão). Codex R1: 6,8/10, NEEDS FIXES, 7 achados BLOQUEANTES + 3 MENORES — todos aceitos como reais após verificação direta do código citado abaixo. Nenhuma discordância; cada achado fechado nominalmente.

## Achados aceitos e correções

**#1 (workers puros, AGENTS.md §7/E-007)** — ACEITO, confirmado (`AGENTS.md` linha 76: "workers assíncronos puros... deliberadamente observability-agnostic"). Instrumentação MOVIDA dos 3 arquivos `src/workers/**` para os 3 handlers Lambda reais que já logam `outcome.kind` hoje:
- `src/runtime/aws/handlers/reminder-dispatch-handler.ts:90-91` (`logger.info("reminder-dispatch outcome", { outcome: outcome.kind })`)
- `src/runtime/aws/handlers/dispatch-outbox-relay-processor.ts:63` (mesmo padrão)
- `src/runtime/aws/handlers/guest-credential-delivery-handler.ts:55` (mesmo padrão)

`emitMetric()` é chamado logo ao lado de cada `logger.info(...)` já existente — nunca dentro do worker puro, nunca uma porta nova injetada no worker (o worker continua sem saber que métricas existem, mesmo padrão do handler já traduzir `outcome.kind` para log estruturado).

**#2 (nomenclatura `dispatch-outbox-relay`)** — ACEITO, confirmado (`relay.ts:105` retorna só `PUBLISHED`, nunca prova entrega ao destinatário; componente é destination-agnostic por design, `relay.ts:111`). Renomeado: métrica `OutboxPublishOutcome` (nunca `Delivery*`), dimensão `Outcome` = um dos 5 kinds reais confirmados em `relay.ts:49-53` (`PUBLISHED`/`SKIPPED_WRONG_DESTINATION`/`SKIPPED_ALREADY_PUBLISHED`/`SKIPPED_LEASE_HELD`/`FAILED`) — nunca um contador binário sucesso/falha que perderia a distinção entre skip esperado e falha real.

**#3 (taxonomia `reminder-dispatch`)** — ACEITO. `dispatch.ts:54-58` tem exatamente 5 kinds (`TRIGGERED`/`ALREADY_TRIGGERED`/`CANCELLED_STALE`/`SKIPPED_NOT_CLAIMED`/`ABORTED_FRESHNESS_RACE`), todos bounded/low-cardinality — seguros como valor de dimensão `Outcome` de `OccurrenceDispatchOutcome`. Nenhum "catch genérico de falha": o catch em `reminder-dispatch-handler.ts:91-99` só existe para erro de infraestrutura real (schema inválido já tratado à parte, `schemaInvalid` flag) — este catch emite `OccurrenceDispatchOutcome{Outcome="HANDLER_ERROR"}` separadamente, nunca confundido com `CANCELLED_STALE`/`ABORTED_FRESHNESS_RACE` (races esperadas, não erro).

**#4 (`guest-credential-delivery` já alerta desde D-233)** — ACEITO, confirmado (`deliver.ts:59` chama `notifyUncertainDelivery`/fila `guest-credential-delivery-failures` + alarme já existentes, `infra/main.tf:631-639`). Frase "não dispara NADA observável" removida — reformulada: hoje existe alarme para o AGREGADO de `SEND_FAILED`/`SKIPPED_LEASE_ACTIVE` via essa fila dedicada, mas nenhuma métrica distingue os 9 kinds reais (`deliver.ts:94-102`: `SENT`/`ALREADY_DELIVERED`/`SKIPPED_REQUEST_NOT_FOUND`/`SKIPPED_STALE_GENERATION`/`SKIPPED_NO_RECIPIENT_EMAIL`/`SKIPPED_LEASE_ACTIVE`/`SEND_FAILED`/`SEND_UNCERTAIN_NOT_RETRIED`/`PREVIOUSLY_UNCERTAIN`) — a métrica nova fecha ISSO (diagnóstico por outcome), não "cria alerta onde não havia nenhum". Dimensão `Outcome` = um dos 9 kinds.

**#5 (visão por tenant precisa de Logs Insights, não só texto reconhecendo o trade-off)** — ACEITO. Dashboard ganha 2 widgets `log` (Logs Insights), um por família de log group (reminder-dispatch + dispatch-outbox-relay + guest-credential-delivery de um lado, o resto do outro não é necessário nesta rodada): `fields tenantId, outcome | filter outcome not in ["TRIGGERED","PUBLISHED","SENT","ALREADY_DELIVERED"] | stats count() by tenantId, outcome | sort count() desc | limit 20` — usa o `tenantId` que `logger.ts` já inclui no `runWithContext` de cada handler (confirmado: os 3 handlers já chamam `runWithContext({tenantId: ...})` antes de logar o outcome), nunca dimensão de métrica.

**#6 (módulo de dashboard concreto)** — especificado abaixo, seção "Dashboard concreto".

**#7 (`emitMetric` nunca lança — contrato real)** — ACEITO. Assinatura revisada:
```ts
export interface MetricSink { write(line: string): void; } // injetável, default = console.log
export function emitMetric(component: string, point: MetricPoint, sink: MetricSink = defaultSink): void {
  try {
    sink.write(JSON.stringify(buildEmfLine(component, point)));
  } catch {
    // nunca lança - uma falha ao serializar/escrever uma métrica não pode derrubar o
    // handler de negócio que a chama, mesmo princípio que SecureLogger já segue.
  }
}
```
Teste novo obrigatório na implementação: um sink que lança em `write()` prova que `emitMetric` engole o erro e o processamento de negócio (`handler`) continua — mesma disciplina G-V3 (`definition-of-done.md`) de mutação nomeada.

**#8 (limite EMF citado errado)** — CORRIGIDO: até 30 chaves em um DimensionSet e até 100 `MetricDefinition` por diretiva EMF (não "100 valores por dimensão"). Fonte: docs.aws.amazon.com/en_en/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html, confirmada pela verificação do Codex.

**#9 (custo não é zero)** — CORRIGIDO: EMF evita a chamada síncrona `PutMetricData` (sem latência de handler bloqueada numa API call), mas GERA custo real de ingestão/retenção de log (já pago hoje, mas o VOLUME cresce com cada linha de métrica nova) + custo de métrica customizada extraída (cobrada por métrica, não por chamada). Registrado como custo real esperado, não "marginal zero" — mas ainda assim baixo/proporcional: só 3 pipelines, ~1 linha por outcome já logado hoje mesmo sem a métrica (o log já existe, só ganha o bloco `_aws.CloudWatchMetrics` extra).

**#10 (3 componentes não são estágios equivalentes)** — ACEITO. Nomenclatura já reflete os estágios reais após #2 (`OutboxPublishOutcome` é publicação-na-fila, nunca entrega). Estágio de entrega final REAL de e-mail/WhatsApp (`email-delivery-handler.ts`/`whatsapp-delivery-handler.ts`, que chamam o provider de fato) permanece EXPLICITAMENTE fora do escopo desta rodada — nomeado aqui como gap conhecido para rodada futura, não escondido. Esta rodada cobre: dispatch de lembrete (decisão de acionar), publicação de outbox (fila correta), entrega de credencial guest (único dos 3 que já chega ao provider real, SES). Entrega real de e-mail/WhatsApp de lembrete fica para depois.

## Dashboard concreto (`infra/modules/observability-dashboard/`)

Novo módulo, mesmo padrão estrutural de `alert-topic`/`reminder-observability` (variables.tf/main.tf/outputs.tf, sem `tests/` obrigatório para um único `aws_cloudwatch_dashboard` — nenhum outro módulo deste repo testa a FORMA de um dashboard JSON via `terraform test`, seria o primeiro precedente; validação real é `terraform plan`/`validate` limpos + inspeção visual pós-apply, registrado como decisão consciente de nível de teste proporcional ao recurso).

`variables.tf`: `name_prefix`, `aws_region`, `dashboard_name` (default `"${name_prefix}-operations"`), `reminder_dispatch_function_name`/`reminder_dispatch_queue_name`, `notification_email_outbox_function_name`/`_queue_name`, `notification_whatsapp_outbox_function_name`/`_queue_name`, `guest_credential_delivery_function_name`, `table_name`, `log_group_names` (list, os 3 log groups reais dos handlers acima).

`main.tf`: um `aws_cloudwatch_dashboard` com `dashboard_body` (jsonencode), widgets:
1. **Lambda saúde** (metric widget, `stat=Sum`, `period=300`): `Errors`/`Invocations`/`Duration` (p99) para as 4 funções nomeadas acima (native AWS/Lambda namespace, zero instrumentação nova).
2. **Fila saúde** (metric widget): `ApproximateNumberOfMessagesVisible`/`ApproximateAgeOfOldestMessage` para as 3 filas nomeadas (native AWS/SQS namespace).
3. **DynamoDB** (metric widget): `ConsumedReadCapacityUnits`/`ConsumedWriteCapacityUnits`/`ThrottledRequests` para `table_name` (native AWS/DynamoDB namespace).
4. **OccurrenceDispatchOutcome** (metric widget, custom namespace `ExpirationTracker/ReminderDispatch`, `stat=Sum`): série por `Outcome` (5 kinds).
5. **OutboxPublishOutcome** (metric widget, `ExpirationTracker/DispatchOutboxRelay`): série por `Outcome` (5 kinds).
6. **GuestCredentialDeliveryOutcome** (metric widget, `ExpirationTracker/GuestCredentialDelivery`): série por `Outcome` (9 kinds).
7. **Falhas por tenant — reminder/outbox** (log widget, Logs Insights, query acima).
8. **Falhas por tenant — guest credential delivery** (log widget, Logs Insights, mesma forma de query sobre o log group do handler de credential delivery).

`outputs.tf`: `dashboard_arn`, `dashboard_name`.

Wiring no root (`infra/main.tf`): módulo instanciado após os módulos de Lambda/fila/tabela relevantes, passando os nomes reais já resolvidos (`module.reminder_dispatch.function_name`, `module.dispatch_queue.queue_name`, etc. — mesmos outputs que `infra/outputs.tf`'s `lambda_function_names` já usa, nenhum output novo necessário nos módulos existentes).

## Escopo desta rodada (reafirmado, nunca escondido)

3 pipelines de decisão/roteamento (nunca entrega final de e-mail/WhatsApp — achado #10). Dashboard combina métricas nativas (zero código) + 3 métricas customizadas novas (taxonomia completa por outcome, nunca binário) + 2 widgets Logs Insights (visão por tenant real, sem dimensão de métrica cara). `emitMetric()` nunca lança, testado com sink que lança.

## Pergunta

As correções fecham os 7 achados bloqueantes e 3 menores da Rodada 1? Falta algum ponto real antes de implementar?
