# M3.5 — Runtime real do Reminder Engine — Proposta Claude (Rodada 1)

Escopo (fixado por `NEXT_SESSION_PROMPT.md`/`ENGINEERING.md` "Decisão pendente: escopo de G8"):
1. Adapters DynamoDB reais para `ReminderStore`, `ExpirationStore`, `IdentityStore` (hoje só fakes em memória).
2. Handlers Lambda reais substituindo os placeholders `501` em `infra/lib/expiration-tracker-stack.ts`.
3. Filas SQS + DLQ com redrive policy para o pipeline producer→dispatch.
4. EventBridge Scheduled Rule disparando `ReminderProducer` (1 min) e `ReminderReconciliation` (diário).
5. Testes de fault injection contra esse runtime real.

Não-escopo (explicitamente adiado, não redescobrir): Notification/Document/Extraction (M4+), WhatsApp/e-mail providers, wiring real do GSI6 (item 4 da lista de pendências), backup/restore real.

## 1. Adapters DynamoDB reais

- Pacote: `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` (DocumentClient v3), já implícito pelo blueprint (`implementation-blueprint.md` linha 6 lista DynamoDB na stack; M0-M3 deliberadamente adiaram o SDK real).
- Um adapter por port, em `src/modules/<módulo>/persistence/dynamodb-<nome>.ts`, implementando a interface exata do port (`ReminderStore`, `ExpirationStore`, `IdentityStore`) — nenhuma mudança de shape nos ports, só nova implementação.
- `get`/`putIfAbsent`/`update`/`transactWrite`/`queryByItem`/`queryGsi1`/`queryGsi3` traduzem 1:1 para `GetCommand`/`PutCommand` com `ConditionExpression: attribute_not_exists(PK)`/`UpdateCommand`/`TransactWriteCommand`/`QueryCommand`. Os builders já existentes (`shared/dynamodb/occ.ts`, `shared/idempotency/idempotency.ts`, `shared/outbox/outbox.ts`) já produzem os parâmetros nesse formato — os adapters são uma camada fina de tradução para os `*Command` do SDK, não reimplementam lógica de OCC/idempotência.
- Erros do SDK (`ConditionalCheckFailedException`, `TransactionCanceledException`, `ProvisionedThroughputExceededException`, timeout/throttling) mapeados para a taxonomia de `shared/errors/app-error.ts` (`retryable` vs terminal) no próprio adapter — é o único lugar que vê exceções nativas do SDK; o resto do sistema já é SDK-agnóstico e deve continuar assim.
- Teste: suíte de integração contra **DynamoDB Local** (`amazon/dynamodb-local` via Docker, ou `dynamodb-local` npm binário) — não LocalStack (mais pesado, não necessário só para DynamoDB) e não mocks de SDK (não provaria nada sobre `ConditionExpression`/`TransactWriteItems` reais). As suítes de domínio existentes (`test/integration/*.test.ts`) rodam hoje contra as fakes em memória; adiciona-se um novo alvo `test/integration-dynamodb/` que roda os MESMOS testes de comportamento (reusar os casos, não duplicar lógica) contra o adapter real + DynamoDB Local, provando que a fake e o adapter real concordam. CI ganha um job novo que sobe o container antes da suíte.

## 2. Handlers Lambda reais

- Bundling: `esbuild` via `NodejsFunction` (aws-cdk-lib) substitui `lambda.Code.fromInline` em `ScopedLambdaFunction` quando um `entryFile` é passado — mantém compatibilidade com os testes existentes que passam `code:` inline. Escolha de `esbuild`/`NodejsFunction` porque já é dependência transitiva do CDK e é o caminho documentado padrão, sem tooling adicional.
- Cada handler é uma função fina em `src/handlers/<nome>.ts` que: (a) resolve tenant/identity do evento (API Gateway JWT authorizer context para os HTTP; nenhuma resolução de tenant para os workers assíncronos — eles operam cross-tenant por design, GSI3-scoped), (b) constrói os adapters DynamoDB reais injetando-os nos services/workers já existentes e testados (`ExpirationService`, `ReminderPolicyService`, `reminder-producer.ts`, `reminder-dispatch.ts`, `reminder-reconciliation.ts`), (c) traduz o resultado do worker para o formato de evento (API Gateway response / SQS batch response / EventBridge void).
- SQS: handlers de fila usam **partial batch response** (`functionResponseType: ReportBatchItemFailures`) — item individual falho não derruba o batch inteiro; mensagens não reportadas como falha são consideradas processadas.
- Testes: `test/handlers/*.test.ts` invocam o handler diretamente com eventos sintéticos (shape real de API Gateway/SQS/EventBridge) e adapters DynamoDB reais contra DynamoDB Local — prova a integração handler↔SDK↔worker que as suítes de M0-M3 (lógica pura) não cobriam. `test/infra/stack.test.ts` ganha asserts de que os handlers deixaram de ser `501`/inline.

## 3. SQS + DLQ

- Nova construct `infra/lib/reminder-queue.ts`: `ReminderDispatchQueue` (fila principal) + `ReminderDispatchDlq`, `maxReceiveCount=5` (valor já documentado em `implementation-blueprint.md` §26 para `ReminderDispatchWorker`), redrive policy padrão SQS, criptografia SSE-SQS (chave gerenciada, sem KMS customer-managed — não há requisito de compliance que exija CMK ainda, `implementation-blueprint.md` §16 não especifica; revisar se LGPD/região decidir diferente).
- `ReminderProducer` ganha `queueAccessFor().send(queue)`; `ReminderDispatchWorker` ganha `.consume(queue)`, event source mapping com batch size pequeno (10, `implementation-blueprint.md` §26 já fixa reserved concurrency 10) e `reportBatchItemFailures`.
- DLQ: alarme CloudWatch de idade (1h/4h já documentado em `implementation-blueprint.md` linha 879) — implementado como `cloudwatch.Alarm` na mesma construct; sem lambda de auto-redrive nesta fase (redrive manual via runbook, já existe `dlq-redrive/` referenciado na árvore do blueprint linha 114 — verificar se esse diretório já existe ou é follow-up).
- Teste de infra: `test/infra/reminder-queue.test.ts` sintetiza e afirma DLQ+redrive policy+maxReceiveCount+encryption via `Template.fromStack`.

## 4. EventBridge Scheduled Rule

- `infra/lib/reminder-schedule.ts`: duas `scheduler.CfnSchedule` (EventBridge Scheduler, não `events.Rule` legado — o blueprint linha 162 já nomeia "EventBridge Scheduler" especificamente para o producer, coerente com granularidade de minuto): `ReminderProducerSchedule` (`rate(1 minute)`) invocando `reminderProducer` via alvo Lambda; `ReminderReconciliationSchedule` (`rate(1 day)`, horário fixo off-peak) invocando `reminderReconciliation`.
- Ambos com `FlexibleTimeWindow: OFF` (precisão de minuto é o próprio mecanismo de correção do producer — jitter quebraria a janela de lookback `[M-5min, M]`).
- Kill switch: os dois schedules nascem `ENABLED`, mas a stack aceita uma prop `schedulesEnabled` (default `true`) para permitir desligar em deploy/teste sem destruir a construct — reusa o padrão de flag booleana já visto em `ExpirationTrackerStackProps.mfaPolicy`.
- Teste de infra: assert de `ScheduleExpression`, alvo correto, e que NENHUM outro schedule invoca essas duas funções (evita duplicidade de tick).

## 5. Fault injection

Contra o runtime real (DynamoDB Local + handlers reais, sem mocks de SDK):
- **Timeout de dependência**: adapter com hook de injeção de latência/erro (só em modo de teste, nunca em produção — flag de config, não código condicional em produção) simulando `ProvisionedThroughputExceededException`/timeout; prova que o handler retorna falha retryable (não `reportBatchItemFailures` de item que na verdade não falhou) e que o SQS reentrega.
- **Poison message**: mensagem SQS malformada (schema inválido) injetada diretamente na fila (via SDK real, não mock) → prova que vai para DLQ após `maxReceiveCount=5` sem derrubar o resto do batch, e que o erro é classificado terminal (não retryable) em `app-error.ts` para não desperdiçar as 5 tentativas em algo que nunca vai ter sucesso — ponto de risco identificado no P1 #2 do red team (idempotência no limite do efeito externo): mensagem poison não deve reter lock/claim indefinidamente.
- **Redrive**: mensagem manualmente movida para DLQ → redrive real (SQS `StartMessageMoveTask` ou CLI) → reprocessada com sucesso, provando que o caminho de recuperação documentado no runbook funciona de fato, não só em teoria.
- Local: usar **LocalStack** aqui (diferente do item 1) porque fault injection de SQS real (redrive, `StartMessageMoveTask`) não é bem suportado por simuladores mínimos — mas isolado num job de CI separado/opcional (mais pesado), não bloqueante do `npm test` rápido de todo dia.

## Itens que este milestone NÃO fecha (mas o red team apontou como P1 e merecem nota explícita)

- P1 #2 (idempotência no limite do efeito externo, "at-least-once clássico") e P1 #4 (fencing antes do efeito externo) são sobre a LÓGICA de dispatch, não sobre existir runtime — `reminder-dispatch.ts` já claim antes de disparar (M3), mas não há "efeito externo" real ainda nesta stack (isso é Notification/M4). Este milestone prova que o pipeline producer→dispatch SOBREVIVE e SE RECUPERA de falha de infraestrutura real; não resolve fencing contra um provedor de notificação externo, porque esse provedor ainda não existe no sistema. Deve ficar registrado explicitamente para não ser mal interpretado como "G8 fechado = idempotência ponta a ponta provada" quando K4 (Notification) ainda não existe.
- P1 #5 (blast radius cross-tenant do GSI3): este milestone adiciona o primeiro teste negativo contra o ADAPTER real (não só a fake), mas não muda o desenho de IAM já existente (M3 já corrigiu `grantGsi3ReadTo` explícito).

## Pergunta aberta para a rodada de crítica

Vale a pena, neste milestone, também escrever o adapter real de `ExpirationStore`/`IdentityStore` (que não têm worker assíncrono, só HTTP), ou o escopo deveria focar SÓ no pipeline Reminder (que é o que tem G8/async recovery em jogo) e tratar os outros dois adapters como possível milestone separado, já que `ENGINEERING.md` os lista mas o problema de G8 propriamente dito é só o pipeline assíncrono? Minha leitura: o texto da decisão do usuário lista os três explicitamente, então mantenho os três no escopo, mas a ORDEM de implementação deveria ser Reminder primeiro (é onde está o G8 real) e Expiration/Identity depois, já testados/estáveis (M1/M2), então adapters para eles são trabalho mais mecânico.
