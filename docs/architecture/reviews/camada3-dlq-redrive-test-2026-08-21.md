---
status: active
owner: engineering
authority: evidence
---

# Camada 3 — teste real de DLQ/redrive, executado em 2026-08-21

Escopo: `docs/architecture/m3.5-runtime-design.md` §"Testes em 3 camadas" (Camada 3) — "poison
message até DLQ real, redrive real". Executado contra a fila real `exptrk-dev-reminder-dispatch`
(conta `dev`, `975707451904`/`us-east-1`), com controle rigoroso para nunca deixar a mensagem
sintética ser reprocessada de verdade ou criar um loop.

## Baseline confirmado antes do teste

- `exptrk-dev-reminder-dispatch`: 0 mensagens visíveis, 0 em voo.
- `exptrk-dev-reminder-dispatch-dlq`: 0 mensagens.
- Event source mapping (`49175f81-7d1a-4a84-b789-cf874c4c2558`): `Enabled`.

## Passo 1 — poison message real até a DLQ real

1. Enviada 1 mensagem sintética via `aws sqs send-message`, corpo claramente marcado
   (`"purpose":"CAMADA3_POISON_MESSAGE_TEST_2026-08-21_DO_NOT_PROCESS"`, `commandType` inválido
   de propósito) — nunca um `DispatchCommand` real, garantindo que nenhuma falha de schema real
   fosse confundida com esta.
2. `VisibilityTimeout=60s`, `maxReceiveCount=5` (configuração real da fila). Monitorado via
   polling a cada 30s: a mensagem esgotou os 5 receives e apareceu na DLQ real em ~270s (4.5min).
3. Confirmado via `receive-message` na DLQ: mesmo `MessageId`, mesmo `MD5OfBody`,
   `ApproximateReceiveCount: 6`, `DeadLetterQueueSourceArn` correto — é de fato a nossa mensagem
   sintética, não uma mensagem real de produção.

## Passo 2 — redrive real, sem deixar reprocessar

Para testar `StartMessageMoveTask` (mecanismo de redrive gerenciado real) sem risco de a mensagem
poison ser reprocessada pelo handler real e criar um ciclo indefinido entre fila e DLQ:

1. Event source mapping da `reminder-dispatch` Lambda desabilitado (`update-event-source-mapping
   --no-enabled`) — pausa deliberada e temporária do consumo real da fila.
2. Confirmado `State: Disabled` via polling antes de prosseguir.
3. `aws sqs start-message-move-task` real contra a DLQ (`--max-number-of-messages-per-second 1`).
   Task completou, `ApproximateNumberOfMessagesMoved: 1` — mensagem real movida de volta à fila
   de origem via o mecanismo gerenciado real da AWS.
4. Como o event source mapping estava desabilitado, nada consumiu a mensagem automaticamente.
   Recebida manualmente (`MD5OfBody` confirmado idêntico ao original) e apagada
   (`delete-message`) — nunca chegou a ser processada pelo handler real.
5. Confirmado fila de origem e DLQ ambas em 0 mensagens (visíveis e em voo) após um breve delay
   de consistência eventual do SQS.
6. Event source mapping reabilitado (`update-event-source-mapping --enabled`), confirmado
   `State: Enabled` — estado idêntico ao baseline anterior ao teste.

## Verificação final de limpeza

| Recurso | Antes do teste | Depois do teste |
|---|---|---|
| `exptrk-dev-reminder-dispatch` (visível/em voo) | 0 / 0 | 0 / 0 |
| `exptrk-dev-reminder-dispatch-dlq` | 0 | 0 |
| Event source mapping | `Enabled` | `Enabled` (mesmo UUID) |

Nenhum recurso novo foi criado (nem fila, nem role, nem função) — só uma mensagem transitória,
criada e depois apagada por nós mesmos, nunca processada pelo handler real. Nada ficou órfão.

## Achado colateral real, não relacionado a este teste — ver documento próprio

Durante a preparação deste teste, ao investigar a métrica `Invocations` de
`exptrk-dev-reminder-producer` para contexto, foi descoberto que o produtor real está falhando em
100% das invocações desde 2026-08-20T14:41:39Z (bug real de escaping de `jsonencode()` no input do
EventBridge Scheduler). Corrigido e documentado separadamente em
`docs/architecture/reviews/camada3-eventbridge-scheduler-escaping-bug-2026-08-21.md` — não é
resultado deste teste de DLQ/redrive, é um achado real e não relacionado encontrado ao usar
telemetria real durante a mesma sessão de trabalho de Camada 3.
