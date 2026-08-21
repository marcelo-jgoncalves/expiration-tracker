# M5 — Observabilidade world-class (design)

Status: **APPROVED** pelo protocolo Claude↔Codex (`AGENTS.md` §4), nota final Claude 9,1/10 /
Codex 9,3/10 (`docs/architecture/reviews/m5-observability-design/codex-round4.txt`), 4 rondas
reais (nota cega 6,8 → 8,6 → 8,9 → 9,3 do lado Codex, achados reais corrigidos a cada rodada,
nenhum arredondamento). Histórico completo das 4 rondas em
`docs/architecture/reviews/m5-observability-design/codex-round{1,2,3,4}.txt`. Design de
implementação — ainda não codado (ver `NEXT_SESSION_PROMPT.md` para status de implementação).

## 1. Escopo e motivação

Decisão do usuário (`NEXT_SESSION_PROMPT.md`, 2026-08-20): milestone dedicado, pós-M4, cobrindo os
3 achados reais que o full-audit round1 fatiou em eixos diferentes sem dono único:

1. `SecureLogger` não propaga `correlationId`/`tenantId` automaticamente ao contexto de log —
   cada `logger.info(...)` precisa que o chamador passe o contexto manualmente, e nada garante
   que dois handlers do mesmo pipeline (ex. `notification-router-handler` → SQS →
   `email-delivery-handler`) usem o mesmo `correlationId`.
2. Nenhum tracing distribuído ponta a ponta — sem X-Ray/OpenTelemetry, não há span cobrindo
   API Gateway → SQS → Lambda → DynamoDB.
3. Alarmes existem (`infra/modules/reminder-observability/`) mas sem destino de notificação real
   — `aws_cloudwatch_metric_alarm` sem `alarm_actions`.

Fora de escopo desta ronda (registrar como não-decidido, não esquecer): dashboard CloudWatch
consolidado por tenant (`joint-review-criteria.md` critério "Observabilidade Operacional & Visão
por Tenant", 11%) fica para uma sessão de produto — este design cobre o **mecanismo**
(propagação/tracing/alerta), não a UI de operação. Trilha de segurança dedicada para eventos de
auth negada (achado do eixo Segurança) também fica fora — depende de M5 estar pronto primeiro
(precisa de `correlationId` consistente para ser útil), tratar como follow-up.

## 2. Decisão 1 — correlationId/tenantId contextual via `AsyncLocalStorage`

### Proposta

Adicionar `src/shared/observability/context.ts`:

```ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  requestId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}
```

`SecureLogger.write` (src/shared/observability/logger.ts:78) passa a mesclar `getContext()` antes
do `baseContext`/`context` explícito (explícito sempre vence — não regressa o comportamento atual
onde `logger.child({...})` já funciona sem ALS). Nenhuma mudança de assinatura pública: código
existente que já passa `correlationId` manualmente continua funcionando idêntico; o ganho é que
handlers que **esquecem** de propagar (o bug real encontrado no full-audit) passam a herdar
automaticamente.

### Onde `runWithContext` é chamado — granularidade por record, não por invocação `[R1-Codex #3]`

O Codex apontou corretamente que "uma chamada no topo do handler" está errado para os handlers
batch: `reminder-dispatch`, `email-delivery-handler`, `ses-callback-handler` e os dois outbox
handlers processam um `SQSEvent.Records[]` com potencialmente vários tenants/correlations no
mesmo lote (o Lambda entrega batches de até 10 por padrão), e DynamoDB Streams
(`dispatch-outbox-relay-handler`, `notification-router` quando disparado por Streams) tem a
mesma forma. Correção: `runWithContext` é chamado **uma vez por record**, dentro do loop que já
existe em cada handler batch para processamento item-a-item com partial batch failure — o corpo
inteiro do processamento daquele record (parse → workflow → log) roda dentro do `run()`. Handlers
de invocação única (API Gateway, EventBridge Scheduler) continuam com uma chamada no topo, sem
mudança.

Isso também resolve `[R1-Codex #4]` (atualização tardia de `tenantId`): em vez de
`getContext()` + merge mutando o store, o `tenantId` — assim que resolvido dentro do processamento
de um record — entra via `runWithContext` **aninhado** (`storage.run` dentro de `storage.run`,
semântica padrão do `AsyncLocalStorage` do Node: o contexto interno sobrepõe o externo só para a
duração da chamada e não vaza para outros records do mesmo loop, porque cada record já está no
seu próprio `run()` de nível superior). Nenhuma API de mutação nova (`enterWith`/merge direto no
objeto) — só composição de `runWithContext`.

### Fonte do `correlationId` por tipo de evento

- **API Gateway (HTTP API)**: `event.requestContext.requestId`.
- **SQS, por record**: ler do payload do próprio evento/comando (`record.body`, campo
  `correlationId` do envelope — ver "Propagação via outbox" abaixo), não de
  `messageAttributes` isolado do conteúdo. Fallback (`correlationId` ausente — mensagens
  produzidas antes do M5): `record.messageId`.
- **DynamoDB Streams (outbox relay)**: ler do próprio `OutboxRecord` persistido (campo
  `correlationId` — ver abaixo). Fallback: `record.dynamodb.SequenceNumber`.
- **Outbox sweeper (EventBridge Scheduler, mas processa N `OutboxRecord`s por invocação)**:
  `runWithContext` **por item** dentro do loop de `sweepPendingDispatch` (`src/workers/
  dispatch-outbox-relay/relay.ts:121`), não uma vez no topo do handler — o sweeper não é uma
  invocação de request único, é estruturalmente um batch, mesma correção de granularidade da
  seção anterior aplicada aqui. Correlação: `OutboxRecord.correlationId`; fallback (sem
  `SequenceNumber` disponível neste caminho): `OutboxRecord.eventId` (campo já existente no
  envelope outbox, PK do próprio evento — sempre presente, nunca precisa de novo campo).
- **EventBridge Scheduler (produtores, sem outbox de origem: `reminder-producer`,
  `reminder-reconciliation`)**: novo UUID por invocação — sem request upstream a herdar.

### Propagação real através do outbox: copiar do envelope, não reencaminhar do contexto ambiente `[R1-Codex #5]`

O Codex identificou o erro conceitual central da ronda 1: o `SendMessageCommand` real de um
evento outbox acontece numa invocação **posterior** (relay ou sweeper, disparados por Streams/
EventBridge), com seu próprio contexto ambiente — não o do handler que originalmente criou o
`OutboxRecord` dentro do `TransactWriteItems`. Ler `getContext()` no momento do envio captura a
correlação errada (a do relay, não a da operação de negócio original) e quebra a causalidade
ponta a ponta que é o objetivo do milestone.

Correção (revisada na ronda 3 — a ronda 2 ainda lia `getContext()` implicitamente dentro do
builder, achado real apontado pelo Codex): `src/shared/contracts/events.ts` já define
`correlationId: string` como campo **obrigatório** do envelope `DomainEvent` (linha 22) — nenhum
schema novo é necessário, o dado já existe em todo evento de domínio produzido hoje.
`buildOutboxRecord(event, destination)` (`src/shared/outbox/outbox.ts:48`) passa a copiar
**explicitamente** `event.correlationId` para o campo `correlationId` do `OutboxRecord` — nunca
consulta `getContext()`/ALS dentro do helper transacional, que continua puro e testável sem mock
de contexto ambiente. Isso torna a garantia estática: todo `OutboxRecord` novo tem
`correlationId` não-vazio porque `DomainEvent.correlationId` já é obrigatório no tipo — não é
"campo opcional novo com fallback", é "campo já obrigatório, agora também copiado para o
outbox". O `correlationId` opcional/fallback (`eventId`/`SequenceNumber`/`messageId`) existe
apenas para `OutboxRecord`s já persistidos **antes** deste milestone (dado histórico na tabela,
não escrita nova) — nunca para escritas pós-M5.

O relay/sweeper, ao processar cada `OutboxRecord`, lê `correlationId` do próprio payload (não do
seu contexto ambiente) e usa esse valor tanto para `runWithContext` do seu próprio processamento
quanto para `MessageAttributes.correlationId` no `SendMessageCommand` real — a mensagem SQS
carrega a correlação original de ponta a ponta. Isso fecha `[R1-Codex #5]` e `[R1-Codex #6]`
(Streams e sweeper como fontes, tratados acima).

## 3. Decisão 2 — Tracing distribuído: X-Ray como backend (D-022), ADOT como instrumentação

### Baseline real já existente — não é trabalho novo de M5 `[R1-Codex #2]`

A ronda 1 apresentou tracing ativo como implementação nova. É falso: `infra/modules/lambda-function/`
já tem `var.tracing_active` (default `true`) ligando `tracing_config { mode = "Active" }` +
`aws_iam_role_policy_attachment.xray` (`AWSXRayDaemonWriteAccess`, condicional ao mesmo flag) —
código existente desde M4, todas as funções já emitem um segment de invocação para X-Ray. O
delta real de M5 é: instrumentação de cliente (spans dentro da invocação, não só o segment da
invocação) e correção da propagação através de SQS — não "ligar X-Ray", que já está ligado.

**Limite real da cobertura, não uma promessa maior do que a plataforma entrega (achado novo,
ronda 2)**: as APIs deste projeto são **HTTP API** do API Gateway (D-011), não REST API — e a
integração nativa de X-Ray active tracing do API Gateway (segment automático no lado do gateway,
antes de invocar a Lambda) só existe para REST API. Com HTTP API, o primeiro segment do trace
técnico começa **dentro da Lambda** (via ADOT); o trecho cliente→API Gateway→Lambda não vira um
span X-Ray — fica correlacionado operacionalmente pelo `correlationId` de aplicação (§2, já
presente nos logs desde a primeira linha do handler via `event.requestContext.requestId`), não
por um span de tracing. Migrar de HTTP API para REST API só para ganhar esse segmento seria
desproporcional nesta escala (perderia o menor custo/latência de HTTP API por um span a mais) —
não proposto neste design. O tracing distribuído deste milestone cobre Lambda→SQS→Lambda→
DynamoDB de ponta a ponta; a borda HTTP de entrada é observável por log correlacionado, não por
span.

### Instrumentação: AWS Distro for OpenTelemetry (ADOT) Lambda layer, não `aws-xray-sdk-core` `[R1-Codex #7]`

Ronda 1 propôs `aws-xray-sdk-core` com `captureAWSv3Client`. Achado real do Codex, verificado:
o SDK X-Ray legado está em modo de manutenção e a própria AWS recomenda migração para
OpenTelemetry; a alegação da ronda 1 de que OTel exige operar um Collector em ECS/Fargate é
falsa no caso Lambda — a **ADOT Lambda layer** exporta direto para X-Ray sem infraestrutura de
Collector separada, com o `aws-xray` exporter da própria AWS. D-022 aprovou X-Ray como
**backend** (onde os traces aparecem/são consultados), não o SDK específico — usar ADOT mantém
D-022 intacto e evita adotar uma dependência já obsolescente no momento em que o milestone é
implementado.

Mecânica revisada:
- ADOT Lambda layer (Node.js) anexada a cada função via `infra/modules/lambda-function/` — novo
  campo `adot_layer_arn`, **sem default** (mesmo padrão de `ses_from_address`: falha rápido em
  vez de assumir uma região/versão implícita). O ARN é pinado explicitamente por
  região+arquitetura (`x86_64`/`arm64`) na configuração raiz do ambiente (`infra/main.tf` ou
  equivalente), lido da tabela de versões publicada pela AWS para a layer
  `aws-otel-nodejs-<arch>-ver-<versão>` no momento da implementação — nunca "última versão"
  resolvida implicitamente, para manter `terraform plan` determinístico (mesmo racional de
  actions pinadas por SHA no CI, `AGENTS.md` §7).
- `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler` (env var padrão da ADOT layer) — instrumentação
  automática de `@aws-sdk/client-dynamodb`, `@aws-sdk/client-sqs`, `@aws-sdk/client-sesv2` via
  `aws-sdk` OTel auto-instrumentation, sem `captureAWSv3Client` manual em cada adapter.
- IAM: já coberto pelo `AWSXRayDaemonWriteAccess` existente — ADOT exporta para X-Ray usando a
  mesma permissão, nenhuma policy nova.

### Propagação SQS→Lambda: automática via `AWSTraceHeader`, sem código manual `[R1-Codex #1]`

Ronda 1 propôs gravar `trace_id` em `MessageAttributes` e reconstruir o segment manualmente no
consumer (`AWSXRay.setSegment(new Segment(...))`). Achado real: isso está tecnicamente errado —
com o produtor instrumentado (SDK SQS auto-instrumentado pela ADOT layer) e o consumer Lambda com
tracing ativo, a AWS já propaga o contexto de trace automaticamente através do atributo de
sistema reservado `AWSTraceHeader` no envio da mensagem SQS; reconstruir o segment manualmente
descarta o parent ID e a decisão de sampling corretos e pode produzir traces órfãos. Correção:
**nenhum código de propagação de trace é necessário** — é comportamento nativo do par
SDK-instrumentado + Lambda tracing ativo. O único código de propagação manual que este design
mantém é o `correlationId` de negócio via envelope outbox (§2) — que é um conceito de log/
correlação de aplicação, deliberadamente distinto e não substituível pelo trace ID do X-Ray (o
`correlationId` sobrevive em texto legível nos logs CloudWatch mesmo sem abrir o console X-Ray).

### Rejeitado nesta ronda

Operar um Collector OTel dedicado (ECS/Fargate) — desnecessário com Lambda + ADOT layer
exportando direto para X-Ray; reconsiderar só se o backend de tracing mudar de X-Ray para algo
que exija Collector (não hipotético agora).

## 4. Decisão 3 — Destino real de alerta: SNS → e-mail

### Proposta

Novo módulo `infra/modules/alert-topic/`: um `aws_sns_topic` por ambiente + um
`aws_sns_topic_subscription` do tipo `email` apontando para o endereço de operação do usuário
(mesmo padrão de variável sem default que `ses_from_address` já usa em `ses-notifications` —
falha rápido até o valor real ser fornecido, nunca um placeholder). Todos os
`aws_cloudwatch_metric_alarm` existentes (`reminder-observability`, e os alarmes de DLQ dos 4
novos módulos `sqs-worker-queue` de M4) ganham `alarm_actions = [var.alert_topic_arn]` — mudança
mecânica de wiring, nenhum alarme novo criado nesta ronda além do que M4 já tem.

Rejeitado: Slack/PagerDuty — exigiriam decisão de vendor/webhook fora do escopo desta sessão
(nenhum dos dois está contratado); e-mail via SNS é a menor superfície que fecha o achado real
("alarmes existem mas ninguém é avisado") sem introduzir uma dependência de terceiro nova. Migrar
para Slack/PagerDuty depois é aditivo (outra subscription no mesmo tópico), não bloqueia este
design.

### Confirmação da subscription é um passo manual real, não fechado pelo Terraform `[R1-Codex #8]`

Achado real: `aws_sns_topic_subscription` do tipo `email` fica em `PendingConfirmation` até o
destinatário clicar no link do e-mail de confirmação da AWS — o Terraform não pode confirmar por
ele, e um `terraform apply` verde **não** implica que o alerta será entregue. Este design registra
explicitamente esse passo como parte do critério de aceite do milestone, não como detalhe
operacional implícito:

- Owner: usuário (endereço já usado para `ses_from_address`/operação, a confirmar no início da
  implementação).
- Critério de aceite: depois do `apply`, confirmar a subscription (clique no e-mail) e então
  disparar um alarme de teste real (`aws cloudwatch set-alarm-state` manual, via pipeline com
  permissão, não escopo do Terraform) e verificar o e-mail chegar — mesmo padrão de "prova real,
  não intenção documentada" já usado nas Camadas 2/3 de teste de M3.5/M4.
- Enquanto a subscription não for confirmada, o milestone não pode ser considerado "fechado" —
  registrar isso como pendência explícita se a sessão de implementação terminar antes desse passo
  manual acontecer (mesmo padrão do spike SES pendente de M4).

## 5. Plano de testes `[R1-Codex #9]`

Ronda 1 não tinha plano de testes — lacuna real, já que os achados #1/#3/#5 (propagação SQS,
escopo ALS, causalidade via outbox) são exatamente o tipo de erro que só aparece em produção sem
teste dedicado. Camada 1 (unit, sem AWS real, já roda em CI):

- **Isolamento de ALS entre records do mesmo batch**: processar um `SQSEvent` fake com 2 records
  de tenants/correlations diferentes através do handler; capturar o `sink` do `SecureLogger`
  (já injetável, `SecureLoggerOptions.sink`) e provar que cada linha de log carrega o
  `correlationId`/`tenantId` do record correto, nunca vazando entre eles.
- **Contexto não sobrevive a exceção**: um record que lança no meio do processamento não deixa
  `getContext()` "preso" para o próximo record do mesmo loop (propriedade de
  `AsyncLocalStorage.run`, mas vale um teste de regressão explícito dado o histórico de bug real
  encontrado no full-audit).
- **Causalidade outbox→relay→SQS**: criar um `OutboxRecord` com `correlationId` conhecido,
  processar via relay fake, e provar que o `SendMessageCommand` resultante carrega o mesmo
  `correlationId` em `MessageAttributes` — não um novo gerado pelo relay.
- **Fallback sem contexto** (mensagens/`OutboxRecord`s pré-M5 sem `correlationId`): não deve
  lançar, deve cair no fallback (`messageId`/`SequenceNumber`/`eventId`, conforme a fonte)
  documentado acima.
- **Partial batch failure preserva isolamento** (reposto na ronda 3 — havia desaparecido da
  ronda 2, achado real do Codex): um `SQSEvent` fake com 3 records onde o segundo lança durante o
  processamento deve provar, num único teste, as três propriedades juntas: (1) o `messageId` do
  record que falhou aparece em `batchItemFailures` da resposta; (2) o terceiro record é
  processado normalmente (não é abortado pela falha do segundo); (3) o `correlationId`/`tenantId`
  logado para o terceiro record é o dele, não vazado do segundo (mesma propriedade de isolamento
  de ALS acima, mas especificamente sob falha no meio do batch — caso não coberto pelo teste de
  "contexto não sobrevive a exceção" isolado).
- **Sweeper: contexto por item + fallback `eventId`**: mesmo par de testes acima
  (isolamento + fallback), aplicado especificamente a `sweepPendingDispatch` — não é coberto
  automaticamente pelos testes de handler SQS/Streams porque o sweeper tem sua própria estrutura
  de loop (consulta+envio, não consumo de `SQSEvent`).

Camada 2/3 (DynamoDB Local / sandbox AWS efêmero, mesma pendência estrutural que M3.5/M4 já
registram): trace real ligado SQS→Lambda visível no console X-Ray (prova de que a propagação
automática via `AWSTraceHeader` realmente funciona no ambiente real, não só na documentação AWS
citada acima) + o teste de entrega do alerta SNS→e-mail do §5. Registrar como a mesma pendência
estrutural de Camada 3 já aberta desde M3.5 — este design não promete fechá-la nesta sessão.

## 6. Fora de escopo / não decidido nesta ronda

- Dashboard CloudWatch por tenant (§1).
- Trilha de segurança dedicada para auth negada (§1) — depende de `correlationId` consistente.
- Métrica EMF (`shared/observability/metrics.ts`, mencionado como gap desde o comentário em
  `logger.ts`) — decisão adiada explicitamente: este design fecha logging/tracing/alerta: métricas
  customizadas (contadores de negócio, não infra) são um eixo separado, não bloqueante para os 3
  achados que motivaram o milestone.
- Sampling rate do X-Ray (custo em produção com volume real) — usar o default do SDK
  (`Reservoir=1/s + 5% adicional`) nesta fase pré-produção; revisar quando houver tráfego real
  (mesmo racional dos thresholds de alarme em `reminder-observability/main.tf`).

## 7. Impacto em código existente

- `SecureLogger`: mudança aditiva, não quebra nenhum teste existente (contexto explícito
  continua vencendo).
- Handlers Lambda de invocação única (API Gateway, EventBridge Scheduler): 1 chamada
  `runWithContext` no topo — mecânico.
- Handlers batch (SQS, DynamoDB Streams): `runWithContext` por record dentro do loop existente
  de partial batch failure — mecânico, mas toca o corpo do loop, não só o topo do handler.
- `src/shared/outbox/outbox.ts`: **não é mudança de schema** — `DomainEvent.correlationId`
  (`src/shared/contracts/events.ts:22`) já é obrigatório hoje, nenhum `schemas/events/` muda.
  A mudança real é no tipo TypeScript **persistido** `OutboxRecord`: ganha
  `correlationId: string` obrigatório para escritas novas (`buildOutboxRecord` copia
  `event.correlationId`, nunca lê ALS). Compatibilidade com `OutboxRecord`s já gravados antes
  deste milestone é resolvida só na **leitura** — o tipo/parser do relay/sweeper trata o campo
  como `correlationId?: string` ao desserializar registros antigos da tabela (dado histórico,
  nunca escrito assim de novo) e cai no fallback (`eventId`/`SequenceNumber`) só nesse caso.
  Nenhum teste de contrato novo em `test/contract/` (não é um schema JSON versionado) — só
  testes unitários de `buildOutboxRecord`/relay/sweeper cobrindo a cópia e o fallback (§5).
- Relay/sweeper (`dispatch-outbox-relay`, `outbox-sweeper-handler`): ler `correlationId` do
  payload do `OutboxRecord`, propagar para `MessageAttributes` do `SendMessageCommand` real.
- `infra/modules/lambda-function/`: novo campo para a ADOT layer (ARN por região) — não
  `tracing_config`, que já existe (`var.tracing_active`, default `true`, ver §3).
- Novo módulo `infra/modules/alert-topic/`.
- `infra/modules/reminder-observability/` e os módulos `sqs-worker-queue`: adicionar
  `alarm_actions`.

Mudança de contrato de evento/API pública: nenhuma — `DomainEvent.correlationId` já existia e
já era obrigatório. A única mudança de tipo é interna (`OutboxRecord` persistido), sem schema
JSON novo em `schemas/`.
