# Proposta independente — M4 Notification Engine Runtime Design

Status proposto: **PROPOSTA — Rodada 1 do protocolo de nota cega**  
Escopo: M4 do `implementation-blueprint.md` §19, respeitando ADR-0008 e os padrões operacionais aprovados em `m3.5-runtime-design.md`.

## 1. Decisões centrais

1. O evento `notification.intent-created.v1` chega ao router por uma fila interna durável, `NotificationRouterQueue`, alimentada pelo EventBridge a partir do outbox já criado em M3.
2. O router não envia diretamente para a fila de e-mail. Na mesma transação que muda o `NotificationIntent`, ele grava um novo `OutboxEvent` com `destination: "SQS_NOTIFICATION_EMAIL_V1"`.
3. `NotificationEmailOutboxRelay`, via DynamoDB Streams, publica esse outbox em `NotificationEmailQueue`. O sweeper de GSI6 cobre perda ou expiração do Stream.
4. O `EmailDeliveryWorker` faz a última revalidação consistente do item imediatamente antes do limite externo, cria uma tentativa durável e chama o SES.
5. Como SES não oferece idempotency key para `SendEmail`, M4 não promete exactly-once no efeito externo. Timeout ou desconexão após o início da chamada produz estado `UNKNOWN`, nunca retry automático cego.
6. Eventos de delivery, bounce e complaint saem do SES por Configuration Set → SNS → `SesCallbackQueue` → `SesCallbackWorker`.
7. A correlação primária do callback usa tags SES opacas com `attemptId`, `intentId` e `tenantId`; `providerMessageId` e GSI5 são confirmação/fallback tenant-scoped, nunca autoridade isolada.
8. E-mail permanece o único canal externo completo de M4. WhatsApp continua submilestone posterior, conforme o blueprint.

---

## 2. Fluxo ponta a ponta

```text
ReminderDispatchWorker
  └─ TransactWriteItems
       ├─ ReminderOccurrence CLAIMED → TRIGGERED
       ├─ cria NotificationIntent PENDING
       └─ cria OutboxEvent notification.intent-created.v1
              destination ausente, portanto rota EventBridge padrão

OutboxPublisher
  └─ EventBridge: notification.intent-created.v1
       └─ regra → NotificationRouterQueue
            └─ NotificationRouterWorker
                 ├─ lê intent/item/policy/user/settings consistentemente
                 ├─ revalida versão e estados
                 ├─ aplica recipient, entitlement, opt-out e quiet hours
                 └─ TransactWriteItems
                      ├─ atualiza NotificationIntent
                      └─ cria OutboxEvent
                           destination=SQS_NOTIFICATION_EMAIL_V1

DynamoDB Stream
  └─ NotificationEmailOutboxRelay
       └─ NotificationEmailQueue
            └─ EmailDeliveryWorker
                 ├─ valida schema/idempotência
                 ├─ aguarda deliverNotBefore, se necessário
                 ├─ revalida intent/item/configuração
                 ├─ cria NotificationAttempt
                 ├─ chama SES SendEmail
                 └─ registra ACCEPTED, FAILED_* ou UNKNOWN

SES Configuration Set
  └─ SNS topic
       └─ SesCallbackQueue
            └─ SesCallbackWorker
                 ├─ valida envelope SNS/SQS
                 ├─ correlaciona attempt
                 ├─ aplica transição monotônica
                 └─ grava AuditEvent + callback inbox processado
```

O exit criterion é uma execução rastreável:

```text
occurrenceId
  → intentId
  → email command messageId
  → attemptId
  → SES MessageId
  → SNS event id
  → delivery/bounce/complaint
```

Cada elo fica persistido ou reconstruível por chave, sem depender de busca em logs.

---

## 3. Novos componentes de domínio e persistência

### 3.1 `NotificationIntent`

Permanece em:

```text
PK = TENANT#<tenantId>#INTENT#<intentId>
SK = META
```

Além dos campos atuais, M4 deve persistir:

```ts
interface NotificationIntent {
  recipientUserId?: string;
  routedChannels?: ("EMAIL" | "WHATSAPP")[];
  cancelledChannels?: Array<{
    channel: "EMAIL" | "WHATSAPP";
    reason:
      | "ITEM_INACTIVE"
      | "STALE_ITEM_VERSION"
      | "POLICY_DISABLED"
      | "POLICY_VERSION_CHANGED"
      | "RECIPIENT_INACTIVE"
      | "OPTED_OUT"
      | "NOT_ENTITLED"
      | "CHANNEL_UNAVAILABLE";
  }>;
  routedAt?: string;
}
```

O status agregado continua limitado aos estados já contratados:

```text
PENDING | CANCELLED | DISPATCHED | CORRECTIVE
```

Detalhes por canal ficam em `routedChannels` e `cancelledChannels`, sem multiplicar estados agregados.

### 3.2 Destinatário lógico

O intent atual não contém destinatário. No MVP:

```text
recipientUserId = item.assigneeUserId ?? tenantId
```

O fallback `tenantId` só é válido porque o estágio atual define `tenantId=userId`. A resolução deve ficar atrás de uma porta:

```ts
interface NotificationRecipientResolver {
  resolve(input: {
    tenantId: string;
    itemId: string;
    assigneeUserId?: string;
  }): Promise<ResolvedRecipient | undefined>;
}
```

Isso impede que a futura organização multiusuário fique acoplada ao fallback do MVP.

O router persiste apenas `recipientUserId`. O endereço de e-mail é obtido novamente pelo delivery worker e nunca entra no evento de domínio ou no outbox.

### 3.3 Preferências

Novo item:

```text
PK = TENANT#<tenantId>#USER#<userId>
SK = NOTIFICATION_PREFERENCES
entityType = NotificationPreferences
```

Campos mínimos:

```ts
interface NotificationPreferences {
  tenantId: string;
  userId: string;
  emailEnabled: boolean;
  expirationReminderEmailEnabled: boolean;
  locale: string;
  timeZone: string;
  quietHours?: {
    enabled: boolean;
    startLocal: string; // HH:mm
    endLocal: string;   // HH:mm
    timeZone: string;   // IANA
  };
  consentSource: "ONBOARDING" | "USER_SETTINGS" | "MIGRATED_DEFAULT";
  version: number;
}
```

A ausência do item não deve ser interpretada silenciosamente como consentimento. Migração/onboarding precisa criar explicitamente o default adotado pelo produto.

### 3.4 Entitlement do canal

Novo item tenant-scoped:

```text
PK = TENANT#<tenantId>#NOTIFICATION
SK = ENTITLEMENTS
entityType = NotificationEntitlements
```

Campos:

```ts
interface NotificationEntitlements {
  email: {
    enabled: boolean;
    monthlyLimit?: number;
  };
  whatsapp: {
    enabled: boolean;
  };
  planVersion: number;
  validUntil?: string;
  version: number;
}
```

Entitlement não é o mesmo conceito que consumo. O primeiro determina se o plano permite o canal; o segundo pode reutilizar o padrão CAS de `TenantQuotaService`.

Para contabilização de e-mail, adicionar um tipo explícito, por exemplo:

```ts
type QuotaType =
  | "API_REQUEST"
  | "UPLOAD_BYTES"
  | "UPLOAD_COUNT"
  | "AI_CALL"
  | "NOTIFICATION_EMAIL";
```

O consumo da quota ocorre no delivery worker pouco antes do envio, e não no router: mensagens adiadas ou canceladas não devem consumir cota.

### 3.5 `NotificationAttempt`

Chave:

```text
PK = TENANT#<tenantId>#INTENT#<intentId>
SK = ATTEMPT#<attemptNumber padded>#<attemptId>
```

Estados propostos:

```text
PREPARED
SUBMITTING
ACCEPTED
DELIVERED
BOUNCED
COMPLAINED
FAILED_RETRYABLE
FAILED_TERMINAL
UNKNOWN
NOT_SENT_STALE
```

`SUBMITTING` é necessário para representar que o limite externo pode ter sido atravessado sem confirmação local.

Campos mínimos:

```ts
interface NotificationAttempt {
  entityType: "NotificationAttempt";
  tenantId: string;
  intentId: string;
  attemptId: string;
  attemptNumber: number;
  redriveGeneration: number;
  channel: "EMAIL";
  provider: "SES";
  providerAccountId: string;
  providerMessageId?: string;
  status: NotificationAttemptStatus;
  expectedItemVersion: number;
  commandMessageId: string;
  destinationHash: string;
  templateId: string;
  templateVersion: number;
  submitStartedAt?: string;
  acceptedAt?: string;
  completedAt?: string;
  lastProviderEventAt?: string;
  normalizedFailureCode?: string;
  version: number;
}
```

`destinationHash` usa HMAC com chave própria, não SHA simples, para permitir diagnóstico sem persistir o e-mail em claro nem viabilizar enumeração.

Quando o SES retorna `MessageId`, a tentativa recebe:

```text
GSI5PK = TENANT#<tenantId>#PROVIDER#SES#ACCOUNT#<accountAlias>
GSI5SK = MSG#<sesMessageId>
```

O callback nunca aceita o resultado do GSI5 sem reler a tentativa base e confirmar `tenantId`, provider, account e `providerMessageId`.

---

## 4. Entrada do router

O `OutboxPublisher` existente publica `notification.intent-created.v1` no EventBridge. Uma regra com filtro exato:

```json
{
  "detail-type": ["notification.intent-created.v1"],
  "source": ["expiration-tracker.reminder"]
}
```

envia para `NotificationRouterQueue`.

A fila é Standard, porque duplicação e reordenação já precisam ser suportadas. Configuração:

```text
NotificationRouterQueue
NotificationRouterQueue-dlq
maxReceiveCount = 5
retention = 4 dias
DLQ retention = 14 dias
visibility timeout >= 6 × timeout da Lambda
batch size = 10
reportBatchItemFailures = true
long polling = 20 s
SSE habilitado
```

A policy da fila só aceita `sqs:SendMessage` do ARN da regra EventBridge correspondente.

O worker valida `notification.intent-created.v1` antes de qualquer leitura ou mutação. `tenantId` do envelope é usado somente para construir a chave; o item base lido deve confirmar o mesmo `tenantId`, `intentId` e aggregate version.

---

## 5. Algoritmo do `NotificationRouterWorker`

Para cada mensagem:

1. Validar o schema.
2. Adquirir idempotência lógica:

```text
tenantId|intentId|notification-router|routerContractVersion
```

3. Fazer leitura fortemente consistente de:

```text
TENANT#t#INTENT#intentId / META
TENANT#t#ITEM#itemId / META
TENANT#t#POLICY#policyId / META
TENANT#t#USER#recipientUserId / PROFILE
TENANT#t#USER#recipientUserId / NOTIFICATION_PREFERENCES
TENANT#t#NOTIFICATION / ENTITLEMENTS
TENANT#t#CHANNEL#emailChannelId / META
```

4. Confirmar que todas as entidades pertencem ao mesmo tenant.
5. Revalidar item e policy.
6. Resolver entitlement e opt-out.
7. Calcular `deliverNotBefore`.
8. Para cada canal aprovado, criar comando e outbox.
9. Atualizar o intent por OCC na mesma transação.

### 5.1 Ordem das decisões

A ordem é deliberada:

```text
tenant/resource validation
  → item status/version
  → policy status/version
  → recipient status
  → entitlement
  → opt-out
  → channel/provider configuration
  → quiet hours
  → transactional route
```

Quiet hours não devem esconder uma condição de cancelamento definitiva.

### 5.2 Matriz fail-closed/fail-open

| Condição | Decisão | Resultado |
|---|---|---|
| Intent inexistente ou tenant divergente | Fail-closed terminal | Mensagem rejeitada; evento de segurança; nenhuma entrega |
| Item inexistente/inativo | Fail-closed | Canal cancelado com `ITEM_INACTIVE` |
| `item.version != intent.itemVersion` | Fail-closed para conteúdo antigo | Não enfileira comando antigo; aplica fluxo corretivo |
| Policy inexistente/desabilitada | Fail-closed | `POLICY_DISABLED` |
| `policy.version != intent.policyVersion` | Fail-closed | `POLICY_VERSION_CHANGED`; reavaliação exige novo intent |
| User suspenso/inexistente | Fail-closed | `RECIPIENT_INACTIVE` |
| Preferência registra opt-out | Fail-closed | `OPTED_OUT` |
| Preferência ausente | Fail-closed | Configuração incompleta; retry não resolve por si só; após classificação, cancelar ou DLQ conforme causa |
| Entitlement nega canal | Fail-closed | `NOT_ENTITLED` |
| Serviço/storage de entitlement indisponível | Fail-closed com retry | Não converte falha técnica em cancelamento; mensagem retorna à fila |
| Configuração do canal/provider indisponível | Fail-closed com retry | Nenhuma chamada externa |
| Timezone/quiet-hours inválido | Fail-closed com retry/alarme | Não assume que “agora pode enviar” |
| Quiet hours ativas | Adiar, não cancelar | `deliverNotBefore` aponta para o fim da janela |
| Falha ao avaliar quiet hours por indisponibilidade transitória | Fail-closed temporal | Retry; nunca envia fora da janela por ausência de informação |
| Falha de telemetria não crítica | Fail-open | Processamento continua; métrica/log não participa da correção funcional |

A opção fail-open é aceitável somente para observabilidade não essencial. Versão, status, consentimento, entitlement e horário de silêncio participam diretamente da autorização do efeito externo e, portanto, são fail-closed.

### 5.3 Quiet hours

O cálculo usa timezone IANA das preferências. Se não houver override do usuário, usa a timezone da policy. Não usa timezone da Lambda nem offset fixo.

Casos de DST seguem o mesmo tratamento do Reminder Engine:

- horário inexistente: mover para o primeiro instante local válido após a lacuna;
- horário ambíguo: escolher o instante mais tardio para evitar envio prematuro;
- janela cruzando meia-noite: tratar como intervalo contínuo;
- `deliverNotBefore` sempre persistido em UTC.

O router não mantém mensagem invisível na SQS por horas. Ele publica normalmente o comando contendo `deliverNotBefore`. O delivery worker, se receber cedo, não usa visibility timeout longo: grava um agendamento one-shot no EventBridge Scheduler ou reencaminha por uma fila de delay apenas quando o atraso couber no limite de 15 minutos do SQS.

Para M4, proponho EventBridge Scheduler one-shot:

```text
notification-email-<hash(tenantId|intentId|channel)>
```

O payload continua sendo o mesmo comando versionado. A criação do schedule precisa ser idempotente pelo nome determinístico. Uma alternativa mais simples seria limitar quiet hours a até 15 minutos, mas isso não satisfaz o caso real.

---

## 6. FR-014 e intenções corretivas

A versão é validada em dois limites:

1. no router, antes de produzir o comando;
2. no delivery worker, imediatamente antes de renderizar e iniciar o efeito externo.

### 6.1 Stale detectado no router

Se o item mudou:

- o intent antigo não é roteado;
- ele é atualizado para `CANCELLED`, com razão `STALE_ITEM_VERSION`;
- se o item atual estiver `ACTIVE` e a policy ainda exigir comunicação, cria-se deterministicamente um novo intent:

```text
kind = CORRECTIVE
itemVersion = currentItem.version
supersedesIntentId = staleIntent.intentId
correctionReason = ITEM_VERSION_CHANGED_BEFORE_SEND
```

A chave idempotente inclui a versão nova:

```text
tenantId|supersededIntentId|currentItemVersion|CORRECTIVE
```

O intent corretivo e o cancelamento do intent antigo entram na mesma `TransactWriteItems`.

Se o item foi arquivado, renovado ou deletado, não se envia conteúdo antigo. Uma correção externa só é criada se já existir tentativa anterior `ACCEPTED`, `DELIVERED` ou `UNKNOWN` cuja mensagem possa ter alcançado o destinatário. Caso contrário, cancelar é suficiente.

### 6.2 Stale detectado no delivery worker

Se nenhuma chamada SES começou:

- cria ou atualiza uma tentativa para `NOT_SENT_STALE`;
- não renderiza nem chama SES;
- cria o intent corretivo, quando aplicável, pelo mesmo algoritmo determinístico.

Se já existir tentativa `SUBMITTING`, `ACCEPTED` ou `UNKNOWN`, o sistema assume conservadoramente que a mensagem pode ter sido enviada. Nesse caso, a correção é obrigatória enquanto item/policy atuais permitirem comunicação.

Isso evita tanto enviar conteúdo stale quanto ocultar uma possível entrega stale causada pela janela de concorrência.

---

## 7. Outbox e sweeper

### 7.1 Por que o outbox continua necessário

Sem outbox, esta sequência perderia notificações:

```text
router marca intent DISPATCHED
→ processo cai
→ SendMessage para NotificationEmailQueue não acontece
```

A inversão também é incorreta:

```text
SendMessage acontece
→ atualização do intent falha
→ estado de domínio não registra que o canal foi roteado
```

Portanto, o router faz uma única transação:

```text
ConditionCheck item.version = expected
ConditionCheck policy.version = expected
Update NotificationIntent PENDING/CORRECTIVE → DISPATCHED
Put OutboxEvent destination=SQS_NOTIFICATION_EMAIL_V1
Put/ConditionCheck idempotency record
```

### 7.2 Novo destination

Expandir o union compartilhado:

```ts
type OutboxDestination =
  | "SQS_REMINDER_DISPATCH_V1"
  | "SQS_NOTIFICATION_EMAIL_V1";
```

O payload do outbox é o comando completo `notification.email-deliver.v1`, sem endereço de e-mail.

O `OutboxPublisher` genérico continua ignorando explicitamente todo destination desconhecido para sua rota EventBridge.

### 7.3 Relay

`NotificationEmailOutboxRelay`:

- gatilho DynamoDB Streams `NEW_IMAGE`;
- filtro por `destination = SQS_NOTIFICATION_EMAIL_V1`;
- `reportBatchItemFailures`;
- lease condicional no item;
- `SendMessage` para `NotificationEmailQueue`;
- `PENDING → PUBLISHED` somente após confirmação do SQS.

Falha após `SendMessage` e antes de `PUBLISHED` pode duplicar a mensagem. Isso é esperado e absorvido pela idempotência do worker.

### 7.4 Sweeper

O padrão atual de GSI6 é mantido:

```text
GSI6PK = RECON#OUTBOX#PENDING
GSI6SK = <occurredAt>#<eventId>
```

Não proponho outro GSI nem scan.

O sweeper existente deve evoluir para um roteador explícito por destination, em vez de criar um segundo sweeper que consulte a mesma partição global:

```ts
switch (record.destination) {
  case "SQS_REMINDER_DISPATCH_V1":
    return reminderRelay.publish(record);
  case "SQS_NOTIFICATION_EMAIL_V1":
    return emailRelay.publish(record);
  default:
    return unsupportedDestination(record);
}
```

Ele consulta itens anteriores a dois minutos, adquire o mesmo lease do relay e chama a implementação compartilhada de publicação.

A role do sweeper já é privilegiada para GSI6. `NotificationEmailOutboxRelay`, acionado por Stream, não precisa de `Query` em GSI6; precisa apenas de acesso mínimo ao item base, Stream e fila de e-mail.

O alarme deve distinguir:

```text
OutboxPendingAge{destination=SQS_NOTIFICATION_EMAIL_V1}
OutboxPublishFailure{destination=SQS_NOTIFICATION_EMAIL_V1}
```

---

## 8. Contrato da fila de e-mail

Manter `notification.email-deliver.v1`, adicionando somente por nova versão se forem necessários campos incompatíveis.

O comando não contém e-mail, nome do item ou corpo renderizado:

```json
{
  "messageVersion": 1,
  "messageId": "msg_01",
  "commandType": "notification.email-deliver.v1",
  "createdAt": "2026-09-10T12:00:01Z",
  "correlationId": "cor_01",
  "causationId": "int_01",
  "tenantId": "t_01",
  "deduplicationKey": "t_01|int_01|EMAIL|template.expiration-reminder|1",
  "data": {
    "intentId": "int_01",
    "itemId": "item_01",
    "expectedItemVersion": 8,
    "channelId": "channel_email_01",
    "templateId": "template.expiration-reminder",
    "templateVersion": 1,
    "locale": "pt-BR",
    "deliverNotBefore": "2026-09-10T12:00:00Z",
    "renderContextRef": {
      "type": "EXPIRATION_ITEM",
      "id": "item_01"
    }
  }
}
```

O endereço é resolvido no worker a partir do `recipientUserId` persistido no intent e do `UserProfile`.

A fila:

```text
NotificationEmailQueue
NotificationEmailQueue-dlq
Standard
maxReceiveCount = 5
retention = 4 dias
DLQ retention = 14 dias
visibility timeout >= 6 × Lambda timeout
batch size = 10
maximum concurrency configurada
reportBatchItemFailures = true
SSE habilitado
```

Não é FIFO: FIFO não resolve timeout ambíguo no provider e não elimina a necessidade de idempotência.

---

## 9. `EmailDeliveryWorker`

### 9.1 Sequência

1. Validar schema.
2. Verificar `deliverNotBefore`.
3. Carregar intent, item, user, preference, channel e provider por leitura consistente.
4. Confirmar tenant em todas as entidades.
5. Confirmar intent `DISPATCHED` ou `CORRECTIVE`.
6. Confirmar item ativo e `item.version == expectedItemVersion`.
7. Revalidar opt-out e entitlement.
8. Aplicar quota do tenant e rate limit do provider.
9. Renderizar template versionado usando allowlist.
10. Criar/adquirir `NotificationAttempt`.
11. Mudar tentativa `PREPARED → SUBMITTING` por OCC.
12. Chamar SES.
13. Persistir o resultado.

A revalidação de opt-out no worker é intencional: o usuário pode revogar consentimento depois do router e antes do envio.

### 9.2 Templates

O renderer recebe somente um DTO allowlisted:

```ts
interface ExpirationEmailRenderContext {
  itemDisplayName: string;
  dueDateLocal: string;
  category?: string;
  applicationUrl: string;
}
```

Campos como `description`, `number`, documentos e tags não entram por default.

`templateId + templateVersion + locale` selecionam um artefato imutável empacotado com a Lambda ou armazenado em repositório versionado. Alterar conteúdo sem incrementar versão é proibido por contract/golden test.

### 9.3 SES sandbox

M4 usa uma identidade verificada e destinatários de teste permitidos pelo SES sandbox. Configuração:

```text
SES_FROM_ADDRESS
SES_CONFIGURATION_SET
SES_ACCOUNT_ALIAS
SES_REGION
```

Secrets ou credenciais não são armazenados: a Lambda usa IAM role. O remetente e Configuration Set são configuração fail-fast.

A role recebe apenas:

```text
ses:SendEmail
```

para a identidade remetente aprovada, quando a granularidade IAM permitir, sem permissões administrativas de SES.

---

## 10. Idempotência no limite do SES

### 10.1 Limitação técnica

SES `SendEmail` não aceita uma chave idempotente controlada pelo cliente. O `MessageId` só é conhecido depois que o SES aceita a requisição.

Assim, esta falha é inerentemente ambígua:

```text
SES aceita a mensagem
→ resposta se perde por timeout/rede
→ aplicação não recebe MessageId
```

Repetir automaticamente pode enviar duas mensagens. Não repetir pode perder uma mensagem que o SES de fato não aceitou. DynamoDB, FIFO e outbox não eliminam essa incerteza.

### 10.2 Política proposta

A idempotência lógica da tentativa é:

```text
tenantId|intentId|SES|attemptNumber|redriveGeneration
```

O worker cria uma tentativa determinística antes da chamada. Duplicatas SQS encontram a mesma tentativa.

Estados:

- `PREPARED`: nenhuma chamada começou; pode ser retomada.
- `SUBMITTING`: a chamada começou; não pode ser repetida cegamente.
- `ACCEPTED`: SES confirmou e devolveu `MessageId`.
- `UNKNOWN`: resultado ambíguo; sem retry automático.
- `FAILED_RETRYABLE`: erro explicitamente conhecido como anterior à aceitação.
- `FAILED_TERMINAL`: erro definitivo de configuração/conteúdo/destinatário.

### 10.3 Classificação

Retry automático é permitido somente quando há evidência de que o SES não aceitou a solicitação, por exemplo rejeição síncrona estruturada anterior à aceitação e classificada como transitória.

Os seguintes casos viram `UNKNOWN`:

- timeout depois do envio do request;
- conexão encerrada sem resposta conclusiva;
- processo encerrado enquanto a tentativa estava `SUBMITTING`;
- falha ao persistir o `MessageId` depois de uma resposta de sucesso.

Uma duplicata que encontra `SUBMITTING` com lease expirado não chama SES novamente. Ela marca/reconcilia como `UNKNOWN`.

### 10.4 Tags de correlação

A chamada SES inclui tags opacas:

```text
et_attempt_id = <attemptId>
et_intent_id  = <intentId>
et_tenant_id  = <tenantId>
et_correlation_id = <correlationId>
```

Não incluem e-mail, nome do item ou conteúdo.

Essas tags permitem que um callback posterior resolva uma tentativa `UNKNOWN` mesmo quando o `MessageId` não foi persistido localmente.

### 10.5 Rate limiting

Dois controles complementares:

- quota tenant-scoped usando o padrão CAS de `TenantQuotaService`;
- limite agregado da conta SES por reserved/max concurrency do event source mapping.

Se o rate limit exato do SES exigir coordenação distribuída além da concurrency, usar um bucket de controle:

```text
PK = TENANT#__SYSTEM__#PROVIDER#SES#<accountAlias>
SK = RATE#<window>
```

Somente o `EmailDeliveryWorker` pode ler/escrever esse item. O namespace `__SYSTEM__` não representa um tenant de cliente e deve ser bloqueado na validação de IDs externos.

---

## 11. Callbacks SES/SNS

### 11.1 Topologia

SES Configuration Set publica eventos em SNS:

```text
ExpirationTrackerSesEventsTopic
  └─ subscription SQS
       └─ SesCallbackQueue
            └─ SesCallbackWorker
```

Eventos habilitados em M4:

```text
DELIVERY
BOUNCE
COMPLAINT
```

Opcionalmente `REJECT` e `RENDERING_FAILURE` podem ser normalizados como falha terminal.

A subscription SNS→SQS deve ter policy restrita ao topic ARN. A fila usa DLQ e `maxReceiveCount=5`.

Como o produtor é SNS gerenciado pela própria conta, não se usa o endpoint HTTP público genérico de webhook para SES. O boundary autenticado é a queue policy SNS→SQS. O worker ainda valida estritamente o envelope, topic ARN, event type, account/configuration set e schema.

### 11.2 Inbox idempotente

Cada evento cria:

```text
PK = TENANT#<tenantId>#WEBHOOK#SES#<accountAlias>
SK = EVENT#<snsMessageId>
entityType = WebhookInbox
```

Se o evento SES tiver um identificador próprio estável, ele pode compor a SK; `snsMessageId` é suficiente para deduplicar a entrega SNS específica.

Campos normalizados:

```ts
interface SesCallbackInbox {
  provider: "SES";
  providerAccountId: string;
  providerEventId: string;
  providerMessageId: string;
  eventKind: "DELIVERY" | "BOUNCE" | "COMPLAINT";
  attemptId: string;
  intentId: string;
  occurredAt: string;
  processingStatus: "PENDING" | "PROCESSED" | "UNMATCHED";
  version: number;
}
```

O payload bruto não vai para logs nem DLQ de aplicação. A mensagem SQS naturalmente contém o evento SES; a fila é criptografada, acesso é mínimo e a retenção é limitada.

### 11.3 Correlação

Ordem:

1. Extrair tags SES.
2. Validar formato de `tenantId`, `intentId` e `attemptId`.
3. Ler diretamente:

```text
PK = TENANT#tenantId#INTENT#intentId
SK = ATTEMPT#...#attemptId
```

Como a SK contém attempt number, o comando deve persistir ou permitir derivá-lo. Alternativamente, adicionar um item ponteiro:

```text
PK = TENANT#t#ATTEMPT#attemptId
SK = LOOKUP
→ intentId, attemptSk
```

Minha preferência é o ponteiro tenant-scoped, criado na mesma transação da tentativa, porque evita query e não exige que o callback conheça `attemptNumber`.

4. Confirmar que tags, tentativa, provider e account coincidem.
5. Confirmar `providerMessageId`, se já persistido.
6. Se a tentativa estava `UNKNOWN` e o callback traz o `MessageId`, persistir o ID e as chaves GSI5.
7. Se tags estiverem ausentes, mas houver tenant confiável já resolvido e `providerMessageId`, consultar GSI5.
8. Sem tenant confiável e sem tags válidas, marcar como `UNMATCHED`, alarmar e não fazer scan global.

Não se confia em `tenantId` arbitrário do payload. Neste caso ele é uma tag emitida por uma chamada autenticada da própria Lambda, mas ainda é confirmado contra a tentativa base.

### 11.4 Transições monotônicas

Precedência terminal:

```text
COMPLAINED > BOUNCED > DELIVERED > ACCEPTED > SUBMITTING
```

Regras:

- `ACCEPTED → DELIVERED`;
- `ACCEPTED/DELIVERED → BOUNCED`, pois bounce pode chegar depois;
- `ACCEPTED/DELIVERED/BOUNCED → COMPLAINED`;
- nunca regredir `DELIVERED → ACCEPTED`;
- callback duplicado é no-op idempotente;
- callback fora de ordem aplica somente transição de maior precedência.

A atualização da tentativa, criação de `AuditEvent` e marcação do inbox como `PROCESSED` entram na mesma transação.

Complaint deve também produzir supressão local durável da identidade destinatária antes de qualquer envio futuro. Bounce permanente pode fazê-lo conforme política; bounce transitório não deve virar opt-out definitivo.

---

## 12. Componentes concretos do milestone

### 12.1 Código

```text
src/modules/notification/
  domain/
    notification-attempt.ts
    notification-preferences.ts
    notification-entitlements.ts
    provider-callback.ts
  application/
    notification-router.ts
    email-delivery.ts
    ses-callback-processor.ts
    corrective-intent-service.ts
    quiet-hours.ts
  ports/
    notification-store.ts
    recipient-resolver.ts
    entitlement-reader.ts
    email-provider.ts
    template-renderer.ts
    provider-rate-limiter.ts
  persistence/
    dynamodb-notification-store.ts
  providers/
    ses-email-adapter.ts
  templates/
    expiration-reminder/
      v1/
        pt-BR.*
  http/
    notification-settings-handler.ts // somente se edição de preferências entrar no M4
```

Workers puros:

```text
src/workers/
  notification-router/
  email-delivery/
  ses-callback/
  notification-email-outbox-relay/
```

Handlers AWS:

```text
src/runtime/aws/handlers/
  notification-router-handler.ts
  email-delivery-handler.ts
  ses-callback-handler.ts
  notification-email-outbox-relay-handler.ts
```

O sweeper existente recebe suporte ao novo destination; não é criado um segundo mecanismo de outbox.

### 12.2 Schemas

Existentes:

```text
schemas/events/notification-intent-created.v1.json
schemas/queues/notification-email-deliver.v1.json
```

Novos:

```text
schemas/queues/notification-ses-callback.v1.json
schemas/events/notification-attempt-accepted.v1.json
schemas/events/notification-delivered.v1.json
schemas/events/notification-bounced.v1.json
schemas/events/notification-complained.v1.json
```

Eventos de attempt só devem ser criados se houver consumidor real. Caso contrário, o estado durável e AuditEvent bastam; não se adiciona evento por simetria estética.

### 12.3 Infra Terraform

Novos módulos ou instâncias reutilizando módulos genéricos:

```text
NotificationRouterQueue + DLQ
NotificationEmailQueue + DLQ
SesCallbackQueue + DLQ
ExpirationTrackerSesEventsTopic
SES Configuration Set
SNS → SQS subscription
EventBridge rule intent-created → NotificationRouterQueue
Lambda NotificationRouter
Lambda NotificationEmailOutboxRelay
Lambda EmailDelivery
Lambda SesCallback
event source mappings
DLQ age alarms
oldest-message-age alarms
Lambda error/throttle alarms
outbox pending-age alarm por destination
reserved/max concurrency para EmailDelivery
```

O módulo atual `reminder-queue` não deve ser reutilizado nominalmente porque contém nomes, SIDs e descrições específicos de reminder. Deve ser extraído um módulo genérico `sqs-worker-queue` ou criado um módulo notification-specific sem copiar silenciosamente políticas erradas.

### 12.4 IAM

- `NotificationRouter`: leitura/escrita apenas das entidades base necessárias; `TransactWriteItems`; sem SES; sem GSI6.
- `NotificationEmailOutboxRelay`: DynamoDB Stream, update do outbox base e `sqs:SendMessage` somente em `NotificationEmailQueue`.
- `EmailDeliveryWorker`: consumo somente da fila de e-mail, leitura das entidades necessárias, escrita de attempts/quota e `ses:SendEmail`; sem GSI6.
- `SesCallbackWorker`: consumo somente da callback queue, leitura/escrita de inbox/attempt/audit e query de GSI5; sem SES send.
- sweeper existente: GSI6 + envio para a lista fechada de filas reconhecidas.

Nenhuma API tenant-facing recebe acesso ao GSI6. GSI5 continua tenant-scoped e acessível somente onde houver padrão de callback/consulta justificado.

---

## 13. Testes em três camadas

### Camada 1 — todo PR

Unitários, contract e Terraform assertions:

- matriz completa do router;
- opt-out, entitlement e quiet hours;
- DST inexistente e ambíguo;
- versão stale no router e no worker;
- criação determinística de intent corretivo;
- transação intent + outbox;
- exclusividade de destination;
- duplicata SQS não cria segunda tentativa lógica;
- tentativa `SUBMITTING` não chama SES novamente;
- timeout ambíguo vira `UNKNOWN`;
- erro conclusivo retryable pode ser retomado;
- callbacks duplicados e fora de ordem;
- tenant divergente no callback é rejeitado;
- tags ausentes não provocam scan;
- templates golden e redaction;
- IAM estrutural e queue policies;
- bundles reais dos handlers.

### Camada 2 — containers/emuladores

DynamoDB local e doubles controlados:

- OCC concorrente no intent;
- concorrência na criação de attempt;
- falha entre transação do router e relay;
- falha após `SendMessage` e antes de outbox `PUBLISHED`;
- sweeper recupera outbox perdido;
- callback chega antes da persistência local de `MessageId`;
- callback resolve tentativa `UNKNOWN` pelas tags;
- redrive preserva idempotência;
- partial batch failure não repete itens bem-sucedidos.

### Camada 3 — sandbox AWS

Gate do milestone:

- envio SES real para endereço verificado no sandbox;
- evento real SES → SNS → SQS → Lambda;
- rastreabilidade occurrence→intent→attempt→callback;
- poison message chega à DLQ após cinco receives;
- policy SNS→SQS rejeita topic não autorizado;
- role sem SES recebe `AccessDenied`;
- role tenant-facing continua sem acesso a GSI6;
- perda simulada do relay é recuperada pelo sweeper;
- CloudWatch evidencia request IDs, ARNs e timestamps;
- nenhuma PII aparece em logs, métricas ou nomes de recursos.

---

## 14. Alarmes e operação mínima

Alarmes necessários em M4:

```text
NotificationRouterQueue oldest age
NotificationRouterQueue DLQ age
NotificationEmailQueue oldest age
NotificationEmailQueue DLQ age
SesCallbackQueue oldest age
SesCallbackQueue DLQ age
EmailDelivery Lambda errors/throttles
SES reject/bounce/complaint rates
NotificationAttempt UNKNOWN age/count
Unmatched callback count
Outbox pending age para SQS_NOTIFICATION_EMAIL_V1
```

`UNKNOWN` precisa de reconciliador operacional. O reconciliador não repete o envio; ele:

1. aguarda callbacks por uma janela configurável;
2. resolve por tags/provider message quando possível;
3. mantém `UNKNOWN` e alerta quando não há evidência;
4. exige decisão operacional para redrive com nova `redriveGeneration`.

Redrive de e-mail nunca é cego.

---

## 15. O que M4 explicitamente não fecha

- WhatsApp, Telegram ou outro canal além de e-mail.
- Contrato específico do BSP WhatsApp, template aprovado e janela de 24 horas.
- Saída do SES sandbox ou aprovação de produção.
- Garantia exactly-once no provider; SES não fornece a primitiva necessária.
- Frontend completo para edição de preferências, se a API mínima não fizer parte do corte.
- Organizações e múltiplos destinatários por item.
- Campanhas, digest, batching ou priorização de notificações.
- Supressão global entre múltiplos provedores externos.
- SLA final de bounce/complaint e política jurídica de consentimento.
- Observabilidade world-class transversal com tracing distribuído; o milestone posterior já foi decidido para isso.
- Purge/LGPD completo de attempts, inboxes e callbacks.
- Troca real de SES por outro provider; M4 entrega a porta e contract tests que tornam a troca possível.
- SLO de produção pública, game day completo e capacity validation de Stage 5.
- Eliminação absoluta de duplicatas em timeout ambíguo. O desenho prefere `UNKNOWN` a duplicação automática.

---

## 16. Pontos abertos para a rodada de crítica

1. **Ausência de preferências existentes:** confirmar se onboarding deve criar opt-in explícito ou se e-mail de reminder é considerado transacional por default. A proposta não presume consentimento quando o registro não existe.
2. **Destinatário do MVP:** validar `assigneeUserId ?? tenantId`; a regra precisa virar decisão de produto antes da implementação.
3. **Quiet hours:** confirmar EventBridge Scheduler one-shot por mensagem versus uma fila/índice de adiados. Scheduler é tecnicamente correto, mas aumenta quantidade de recursos efêmeros.
4. **Intent corretivo:** confirmar quando uma mudança antes do primeiro envio exige uma nova mensagem correta e quando basta cancelar. A proposta cria correção apenas se a policy atual ainda requer comunicação.
5. **Estado `UNKNOWN`:** validar a preferência por at-most-once automático. É a opção mais segura contra duplicação, mas aceita possível perda até reconciliação humana/providencial.
6. **Tags SES:** provar em sandbox que as tags configuradas em `SendEmail` aparecem consistentemente nos três tipos de evento habilitados. Se não aparecerem, será necessário outro correlator controlado pelo cliente.
7. **Lookup de attempt:** decidir entre item ponteiro `TENANT#t#ATTEMPT#a/LOOKUP` e uma nova forma de SK diretamente derivável. O ponteiro evita query, ao custo de uma escrita transacional adicional.
8. **GSI5:** reconciliar formalmente a forma tenant-scoped do `data-model.md` com o exemplo global do blueprint. Esta proposta preserva tenant scope e usa tags para descobrir o tenant.
9. **Token bucket SES:** validar se maximum concurrency mais quota tenant-scoped é suficiente no sandbox ou se o bucket agregado `TENANT#__SYSTEM__#PROVIDER#SES#account` deve entrar já no M4.
10. **Complaint/bounce:** definir se complaint sempre desabilita e-mail automaticamente e quais códigos de bounce permanente criam supressão local.
11. **Eventos de domínio de delivery:** criar apenas os eventos realmente consumidos; evitar uma família de eventos sem consumidor.
12. **Escopo da API de preferências:** o runtime depende das preferências, mas o milestone não explicita se a rota de configuração faz parte de M4. Sem rota, fixtures/migração precisam criar o estado necessário para o teste end-to-end.
