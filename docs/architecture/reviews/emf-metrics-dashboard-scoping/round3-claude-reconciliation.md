Rodada 3 (reconciliação). Codex R2: 7,2/10, NEEDS FIXES, 6 achados (4 BLOQUEANTES + 2 NÃO FECHADO). Todos aceitos como reais, verificados diretamente:

**#1 (tenantId ausente em dispatch-outbox-relay-processor.ts)** — ACEITO, confirmado (`processor.ts:54` só tem `correlationId`). `OutboxRecord.tenantId` já existe (`outbox.ts:96`). Corrigido: `runWithContext({ correlationId, tenantId: item.tenantId }, ...)` — mesmo padrão que `guest-credential-delivery-handler.ts:55` já usa (2 níveis de `runWithContext`, o segundo aninhado adicionando `tenantId` uma vez conhecido).

**#2 (mecanismo de alerta guest-credential-delivery mal descrito)** — ACEITO. Reformulado com precisão: `notifyUncertainDelivery()` alimenta `guest-credential-delivery-failures` nos estados incertos (chamada direta, dentro do fluxo); `destination_config.on_failure` da mesma fila (`infra/main.tf:729-730`) só recebe um registro quando o event source mapping o abandona de vez (`maximum_retry_attempts=-1`/`bisect_batch_on_function_error`, retry infinito até convergir ou o alarme de `IteratorAge` disparar primeiro). São 2 caminhos DISTINTOS para a MESMA fila, nunca confundidos daqui em diante.

**#3 (widget "Lambda saúde" não detecta falha de Lambda com ReportBatchItemFailures)** — ACEITO, acknowlegded pelo próprio comentário do código (`infra/main.tf:734-736`: "ReportBatchItemFailures means a retried record never surfaces as a Lambda Errors metric"). Dashboard corrigido: `IteratorAge` (não `Errors`) para as 3 funções acionadas por DynamoDB Streams com partial-batch-failure (`notification-email-outbox-relay`, `notification-whatsapp-outbox-relay`, `guest-credential-delivery`) — `Errors`/`Invocations`/`Duration` continuam válidos SÓ para `reminder-dispatch` (acionada por SQS, sem essa ressalva).

**#4 (exceções sem outcome nomeado em 2 dos 3 pipelines)** — ACEITO. `HANDLER_ERROR` estendido aos 3 catches (não só reminder-dispatch): `dispatch-outbox-relay-processor.ts:67-70`'s catch e `guest-credential-delivery-handler.ts:63-66`'s catch ganham `logger.error(...)` com o campo `outcome: "HANDLER_ERROR"` explícito (hoje só logam `error`, sem `outcome`) — necessário tanto para a métrica quanto para a query Logs Insights incluir esses eventos (a query original já filtrava por `outcome not in [...]`, então um evento SEM o campo `outcome` ficava invisível nela; corrigido pelo campo agora sempre presente).

**#5 (Terraform inválido — default referenciando outra variável)** — ACEITO, erro real (Terraform não permite um `default` de variável referenciar outra `var.*`). Corrigido: `variable "dashboard_name" { type = string, default = null }` + `locals { dashboard_name = var.dashboard_name != null ? var.dashboard_name : "${var.name_prefix}-operations" }`, `main.tf` usa `local.dashboard_name`.

**#6 (contagem de log groups/funções — são 4, não 3)** — ACEITO. Escopo real: `reminder-dispatch` (SQS), `notification-email-outbox-relay` (Streams), `notification-whatsapp-outbox-relay` (Streams), `guest-credential-delivery` (Streams) — 4 funções/log groups distintos, `notification-email-outbox-relay`/`notification-whatsapp-outbox-relay` são 2 deploys SEPARADOS do MESMO código (`dispatch-outbox-relay-processor.ts`), cada um com seu próprio nome/log group real. Variáveis do módulo e queries Logs Insights atualizadas para nomear os 4 explicitamente (nunca "os 3 handlers" de novo).

## Dashboard corrigido (resumo das mudanças vs. Rodada 2)

- Widget "Lambda saúde" dividido em 2: `Errors`/`Invocations`/`Duration` só para `reminder_dispatch_function_name`; `IteratorAge` para as 3 funções Streams-based (`notification_email_outbox_relay_function_name`/`notification_whatsapp_outbox_relay_function_name`/`guest_credential_delivery_function_name`).
- 4 séries em vez de 3 nos metric widgets custom (`OutboxPublishOutcome` agora rotulado por `FunctionName` também, já que 2 funções distintas emitem essa mesma métrica de negócio — dimensão extra `FunctionName` ou 2 widgets lado a lado, decisão de implementação, não de design).
- `HANDLER_ERROR` presente nos 3 pipelines, nunca só 1.
- 2 widgets Logs Insights viram 2 queries sobre os 4 log groups reais (`fields tenantId, outcome | filter outcome not in [...] | stats count() by tenantId, outcome, @logStream | ...` — `@logStream` opcional para distinguir qual das 4 funções, útil quando o outbox relay dividir por função).
- `variables.tf` ganha os 4 nomes de função/log group explícitos, nunca 3.

## Pergunta

Os 6 achados da Rodada 2 estão fechados? Pronto para implementar, ou falta mais alguma verificação antes do código real?
