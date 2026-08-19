# Implementation Blueprint — Expiration Tracker

**Status:** **APPROVED** (Design Maturity, `requirements.md` §13.1) — Claude 9.20 / Codex 9.2 (exato), ambos ≥9.0 sem arredondar. 8 rodadas de nota cega até convergência (proposta independente → crítica cruzada → convergência → 5 rodadas de nota cega/correção pontual, cada uma fechando exatamente o achado da rodada anterior). Histórico completo em `docs/architecture/history/implementation-blueprint/`.
**Estágio:** Design Maturity APPROVED (arquitetura conceitual) → Implementation Blueprint **APPROVED** (este documento) → próxima etapa é implementação real (código/infra/testes), sujeita à rubrica (B) Operational Evidence, não mais design.
**Escopo:** Stage 0–2, região única, AWS serverless, sem DR cross-region.
**Stack principal:** TypeScript/Node.js, AWS CDK, API Gateway HTTP API, Lambda, DynamoDB, EventBridge, SQS, S3, CloudFront, Cognito, Step Functions Standard, Textract, Bedrock, AppConfig e CloudWatch.

**Base do documento**: consolidação de duas propostas independentes (`docs/architecture/history/implementation-blueprint/implementation-blueprint-claude-round1.md`, `implementation-blueprint-codex-round1.md`), crítica cruzada (`round2-claude-critique-of-codex.md`, `round2-codex-critique-of-claude.md`) e convergência (`round3-convergence.md`). A estrutura segue predominantemente a proposta Codex Rodada 1 (avaliada como mais rigorosa na crítica cruzada), com correções e adições explícitas descritas nesta introdução e aplicadas inline no restante do documento.

**Correções materiais aplicadas na convergência (não presentes, ou incorretas, em ambas as propostas Rodada 1):**
1. **Scheduler GSI3 corrigido** — erro técnico real presente nas duas propostas independentes: uma partition key `TENANT#t#DUE#yyyyMMddHHmm#NN` não é consultável pelo producer do minuto sem já saber quais tenants têm ocorrência naquele minuto (`Query` exige PK exata). Corrigido em todo o documento para `GSI3PK=DUE#yyyyMMddHHmm#NN` / `GSI3SK=TENANT#tenantId#OCCURRENCE#occurrenceId` — exceção documentada e justificada à regra "toda chave começa com `TENANT#tenantId`" de `data-model.md` §3, com as salvaguardas da §9.2 abaixo. Esta é uma mudança Type 1 sobre `data-model.md` e deve ser ratificada lá (ver `decisions-log.md`).
2. **CSP MVP usa hashes estáticos, não nonce dinâmico** — o frontend é SPA estática servida por CloudFront sem compute de borda no Day 0; nonce por resposta exigiria geração dinâmica de HTML, não disponível nesse desenho. Decisão explícita: eliminar inline scripts/styles ou usar CSP hash-based estático.
3. **E-mail não é sujeito a kill switch** — decisão explícita (ausente nas duas propostas Rodada 1): `AppConfig` cobre `AI`, `OCR`, `WHATSAPP` (`architecture-fase3-consolidada.md` §14); e-mail é o canal padrão, sempre ativo, sem toggle de emergência dedicado.
4. **Critério de aceite do Reminder Engine amarrado quantitativamente** aos três cenários de drenagem do pico extremo já modelados em `capacity-model.md` (16.667/3.333/278 agendamentos/s), não apenas "teste de carga" genérico.
5. **Mapeamento para requisitos/capacity-model** adicionado como §25 (ausente nas duas propostas Rodada 1).
6. **Apêndice de referência rápida de Lambdas** (tabela função×gatilho×concorrência/DLQ) adicionado como §26, complementando o detalhamento por seção.

---

## 1. Objetivo e princípios de implementação

Este blueprint transforma a arquitetura conceitual aprovada em limites executáveis, contratos versionados, padrões de persistência, ordem de deploy e critérios técnicos de aceite.

Princípios obrigatórios:

1. `tenantId` nunca é aceito do corpo, query string, path ou header de negócio. Ele é derivado exclusivamente da identidade validada por um componente central.
2. Toda entidade mutável usa optimistic concurrency control com `version` e `ConditionExpression`.
3. Leituras críticas de autorização, alteração, cancelamento, disparo e aplicação de extração usam leitura fortemente consistente na chave base. GSI nunca é autoridade para decisão crítica.
4. Eventos e comandos assíncronos usam envelope comum versionado; payloads permanecem específicos por evento/canal.
5. Operações críticas que alteram estado e exigem publicação usam outbox transacional.
6. Consumidores assíncronos são idempotentes e toleram duplicação, reordenação e entrega tardia.
7. Mudanças de schema, evento e workflow Step Functions usam expand/contract.
8. Dados sensíveis são redigidos antes de logs, traces, eventos operacionais e mensagens de DLQ.
9. Processamento de documentos e IA é fail-closed.
10. Todo recurso caro ou externo consulta kill switch antes da operação, inclusive para mensagens já enfileiradas.
11. A aplicação não oferece mecanismo genérico de HTTP fetch. Qualquer egress futuro exige política explícita.
12. Infraestrutura, artefatos e dependências são verificáveis e reproduzíveis.

---

## 2. Organização proposta do repositório

```text
src/
  api/
    handler.ts
    router.ts
    middleware/
      authenticate.ts
      resolve-request-context.ts
      authorize.ts
      quota.ts
      validate-request.ts
      error-mapper.ts
  modules/
    identity/
      application/
      domain/
      ports/
      persistence/
    expiration/
      application/
      domain/
      ports/
      persistence/
    reminder/
      application/
      domain/
      ports/
      persistence/
    notification/
      application/
      domain/
      ports/
      persistence/
      channels/
    document/
      application/
      domain/
      ports/
      persistence/
    audit/
      application/
      ports/
      persistence/
  shared/
    contracts/
      events/
      queues/
      api/
    dynamodb/
    idempotency/
    outbox/
    observability/
    security/
    config/
    errors/
  workers/
    outbox-publisher/
    reminder-producer/
    reminder-dispatch/
    reminder-reconciliation/
    notification-router/
    email-delivery/
    whatsapp-delivery/
    webhook-ingress/
    webhook-processor/
    upload-finalizer/
    malware-result/
    extraction-start/
    extraction-tasks/
    upload-slot-reconciliation/
    retention-reconciliation/
    dlq-redrive/
  step-functions/
    document-extraction.asl.json

infra/
  app.ts
  constructs/
    scoped-lambda-function.ts
    encrypted-queue.ts
    event-contract-rule.ts
  stacks/
    foundation-stack.ts
    identity-edge-stack.ts
    data-stack.ts
    document-storage-stack.ts
    eventing-stack.ts
    application-stack.ts
    document-processing-stack.ts
    observability-stack.ts
    frontend-stack.ts

test/
  unit/
  integration/
  contract/
  authz-negative/
  infrastructure/
  smoke/

schemas/
  events/
  queues/
  api/
  sensitive-fields.json
```

O monólito Lambda de API compartilha código de domínio com handlers assíncronos, mas nenhum worker importa router, middleware HTTP ou adaptadores de outro worker. Dependências entre módulos passam por interfaces de aplicação ou contratos publicados em `shared/contracts`.

---

## 3. Limites executáveis

### 3.1 Funções Lambda

| Função | Gatilho | Responsabilidade |
|---|---|---|
| `ApiHandler` | API Gateway HTTP API | Rotas síncronas dos módulos Identity, Expiration, Reminder, Notification, Document e Audit |
| `OutboxPublisher` | DynamoDB Streams + agendamento | Publicar outbox no EventBridge e confirmar publicação |
| `ReminderProducer` | EventBridge Scheduler, 1 minuto | Consultar GSI3 nos shards do minuto e enviar comandos para SQS |
| `ReminderDispatchWorker` | `ReminderDispatchQueue` | Revalidar ocorrência/item e produzir `NotificationIntent` |
| `ReminderReconciliationWorker` | EventBridge diário | Recalcular janela de sete dias e reparar ocorrências |
| `NotificationRouterWorker` | EventBridge/SQS | Aplicar entitlement, quiet hours e opt-out; rotear por canal |
| `EmailDeliveryWorker` | `EmailDeliveryQueue` | Enviar e-mail e registrar tentativa |
| `WhatsAppDeliveryWorker` | `WhatsAppDeliveryQueue` | Enviar WhatsApp e registrar tentativa |
| `WebhookIngressHandler` | API Gateway rota pública | Validar assinatura, janela temporal e nonce; persistir `WebhookInbox` |
| `WebhookProcessorWorker` | `WebhookProcessingQueue` | Aplicar callbacks de provedor idempotentemente |
| `UploadFinalizerWorker` | eventos S3 da quarentena | Confirmar upload, validar metadados e iniciar scanning |
| `MalwareResultWorker` | EventBridge/GuardDuty | Aplicar resultado de malware e promover somente objetos CLEAN |
| `ExtractionStarterWorker` | evento S3 do bucket limpo | Criar `ExtractionRun` e iniciar Step Functions Standard |
| `TextractTaskHandler` | Step Functions | Detecção de tipo e OCR via Textract |
| `PdfParserTaskHandler` | Step Functions | Parsing determinístico em sandbox isolado (§12.4) |
| `BedrockExtractionTaskHandler` | Step Functions | Extração via LLM, condicionada a kill switch `AI`/`OCR` |
| `ExtractionValidationTaskHandler` | Step Functions | Validação de schema, comparação entre extratores, persistência de `ExtractedField` |
| `UploadSlotReconciliationWorker` | EventBridge agendado | Restituir slots abandonados com transação idempotente |
| `RetentionReconciliationWorker` | EventBridge agendado | Processar GSI6 para retenção, purga e pendências |
| `DlqRedriveWorker` | invocação manual/runbook | Redrive controlado, auditado e limitado |

**Decidido (§23.1): Textract, parser determinístico e Bedrock são Lambdas separadas desde o primeiro release**, não um `ExtractionTaskHandler` único consolidado depois. Justificativa: o sandbox de PDF (lacuna #2 do threat model, limites em §12.4/§23.1) exige isolamento de IAM/rede que uma função combinada dilui — separar desde o dia 1 é mais simples de auditar do que consolidar e depois desmembrar sob pressão de produção. Cada uma das três superfícies de risco isoladas (OCR gerenciado, parsing não confiável em sandbox, chamada a LLM) tem sua própria função nomeada com `ScopedLambdaFunction` (§17.1) — não é "um estado, uma função": estados de orquestração pura (`NeedsBedrock?`) são Choice states nativos sem Lambda, e estados que compartilham a mesma superfície de IAM/dados (validação de schema, comparação entre extratores, persistência, fail-closed) compartilham `ExtractionValidationTaskHandler`. O mapeamento estado→handler completo está em §12.5.

### 3.2 Ausência deliberada de funções

Não haverá:

- Lambda genérica de “executar webhook”;
- cliente HTTP arbitrário compartilhado;
- consumer genérico que interprete payload sem discriminador;
- acesso dos handlers de negócio ao bucket de quarentena;
- escrita direta em `AuditEvent` por módulos por meio de DynamoDB SDK;
- publicação direta de evento crítico fora do `OutboxPort`.

---

## 4. Contexto de requisição, sessão e autorização

### 4.1 `RequestContext`

```ts
export interface RequestContext {
  requestId: string;
  correlationId: string;
  principal: {
    userId: string;          // ID interno
    cognitoSubject: string;  // somente em memória; não logar
    sessionId: string;
    deviceId?: string;
  };
  tenant: {
    tenantId: string;
    membershipId?: string;
    roles: string[];
  };
  auth: {
    issuedAt: string;
    expiresAt: string;
    tokenId: string;
  };
}
```

`resolveRequestContext(claims)` executa:

1. validação já realizada pelo authorizer do API Gateway;
2. lookup consistente do vínculo `cognitoSub → userId`;
3. resolução da sessão/dispositivo;
4. resolução do tenant ativo e membership;
5. rejeição de token anterior a `globalLogoutAfter` ou `deviceLogoutAfter`;
6. criação do contexto imutável.

O router remove ou rejeita `tenantId`, `userId`, `roles` e `membershipId` fornecidos pelo cliente em campos onde não pertencem ao contrato.

### 4.2 Arquitetura de sessão do navegador

- Access token: vida curta, alvo inicial de 5–15 minutos.
- Refresh token: rotação obrigatória e detecção de reutilização.
- Tokens não ficam em `localStorage` ou `sessionStorage`.
- **Decidido (§23.1): sessão BFF** com cookie `HttpOnly`, `Secure`, `SameSite=Lax`, via endpoint de sessão dedicado (`/session/refresh`, `/session/logout`) — não Cognito diretamente no browser. Alternativa descartada explicitamente para eliminar a ambiguidade "BFF ou Cognito direto" presente nas propostas Rodada 1.
- Logout por dispositivo atualiza `deviceLogoutAfter`/revoga a família de refresh.
- Logout global atualiza `globalLogoutAfter` e revoga tokens suportados pelo Cognito.
- Sessões têm `sessionId`, `deviceId`, `refreshFamilyId`, `createdAt`, `lastSeenAt`, `expiresAt` e status.
- CSP inicial: `default-src 'self'`; sem `unsafe-inline`; `connect-src` limitado ao domínio da API e endpoints Cognito necessários; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`. **Mecanismo (decisão de convergência, Rodada 3)**: o frontend é SPA estática servida por CloudFront sem compute de borda no Day 0 — uma CloudFront Response Headers Policy define CSP estática, mas não pode gerar um nonce por resposta e injetá-lo no HTML dinamicamente. Portanto o MVP usa **hashes CSP estáticos** (`script-src 'sha256-...'` calculados no build, um por bundle/versão de deploy) em vez de nonce — compatível com deploy imutável por hash já decidido em `architecture-fase3-consolidada.md` §3. Nonce dinâmico fica como evolução condicionada à introdução de compute de borda (Lambda@Edge/CloudFront Functions gerando HTML por request), não necessária no MVP.
- CloudFront adiciona CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` e `Permissions-Policy`.

### 4.3 Matriz de autorização

A matriz é código versionado e testado, não documentação informal:

```ts
type Action =
  | "item:create" | "item:read" | "item:update" | "item:delete"
  | "reminder:manage"
  | "document:reserve-upload" | "document:read" | "document:delete"
  | "extraction:confirm"
  | "notification:configure"
  | "audit:read";

interface AuthorizationInput {
  context: RequestContext;
  action: Action;
  resource?: {
    tenantId: string;
    ownerUserId?: string;
    assigneeUserId?: string;
    status?: string;
  };
}
```

Cada rota declara sua ação. `authorize()` verifica primeiro igualdade de tenant, depois papel e vínculo por recurso. O repositório recebe `tenantId` do contexto, jamais do DTO.

Testes negativos cobrem, no mínimo:

- troca de ID para recurso de outro tenant;
- payload contendo `tenantId` malicioso;
- usuário autenticado sem membership;
- membership revogada com token ainda válido;
- papel insuficiente;
- leitura por GSI seguida de tentativa de agir sobre recurso alheio;
- acesso a documento limpo ou extração pertencente a outro item/tenant.

---

## 5. Persistência e padrões DynamoDB

### 5.1 Portas comuns

```ts
interface VersionedWrite {
  expectedVersion: number;
}

interface IdempotencyPort {
  begin(input: {
    tenantId: string;
    operation: string;
    key: string;
    requestHash: string;
    expiresAt: string;
  }): Promise<"ACQUIRED" | "COMPLETED_SAME_REQUEST">;

  complete(input: {
    tenantId: string;
    operation: string;
    key: string;
    responseRef?: string;
  }): Promise<void>;
}

interface OutboxPort {
  append(tx: DynamoTransaction, event: DomainEvent): void;
}

interface AuditPort {
  record(event: AuditCommand): Promise<void>;
}
```

### 5.2 Regras de escrita

Atualização mutável:

```text
ConditionExpression:
  attribute_exists(PK)
  AND attribute_exists(SK)
  AND #version = :expectedVersion
  AND #tenantId = :tenantId

UpdateExpression:
  SET ...,
      #version = #version + :one,
      updatedAt = :now
```

Criação:

```text
ConditionExpression:
  attribute_not_exists(PK) AND attribute_not_exists(SK)
```

Soft delete preserva registro e incrementa `version`. Exclusão física ocorre apenas por política de retenção, com auditoria e verificação de dependências.

### 5.3 Outbox

Registro:

```json
{
  "PK": "TENANT#t_01#OUTBOX#202608",
  "SK": "EVENT#2026-08-19T14:03:22.481Z#evt_01",
  "entityType": "OutboxEvent",
  "eventId": "evt_01",
  "eventType": "expiration.item-due-date-changed.v1",
  "aggregateType": "ExpirationItem",
  "aggregateId": "item_01",
  "aggregateVersion": 8,
  "status": "PENDING",
  "occurredAt": "2026-08-19T14:03:22.481Z",
  "payload": {},
  "publishAttempts": 0,
  "nextAttemptAt": "2026-08-19T14:03:22.481Z",
  "createdAt": "2026-08-19T14:03:22.481Z",
  "GSI6PK": "RECON#OUTBOX#PENDING",
  "GSI6SK": "2026-08-19T14:03:22.481Z#evt_01"
}
```

`OutboxPublisher`:

1. recebe stream ou busca pendências em GSI6;
2. adquire lease condicional por `eventId`;
3. publica uma entrada por `PutEvents`;
4. considera falha individual de `PutEvents`;
5. ao sucesso, muda para `PUBLISHED`, grava `publishedAt` e incrementa versão;
6. ao erro, mantém `PENDING`, incrementa tentativas e aplica backoff;
7. não assume exactly-once; consumidores deduplicam por `eventId`.

O sweeper periódico consulta GSI6 e cobre eventos perdidos após a retenção do Streams.

---

## 6. Envelope e compatibilidade de contratos

### 6.1 Envelope de evento de domínio

```json
{
  "specVersion": "1.0",
  "eventId": "evt_01J...",
  "eventType": "expiration.item-due-date-changed.v1",
  "source": "expiration-tracker.expiration",
  "occurredAt": "2026-08-19T14:03:22.481Z",
  "correlationId": "cor_01J...",
  "causationId": "cmd_01J...",
  "tenantId": "t_01J...",
  "actor": {
    "type": "USER",
    "userId": "usr_01J..."
  },
  "aggregate": {
    "type": "ExpirationItem",
    "id": "item_01J...",
    "version": 8
  },
  "data": {}
}
```

`tenantId` integra roteamento e isolamento, mas nunca vira dimensão de métrica. Eventos não carregam documento, texto OCR, endereço completo, token, assinatura de webhook ou conteúdo livre sensível.

### 6.2 Envelope de comando SQS

```json
{
  "messageVersion": 1,
  "messageId": "msg_01J...",
  "commandType": "reminder.dispatch.v1",
  "createdAt": "2026-08-19T14:04:00.000Z",
  "correlationId": "cor_01J...",
  "causationId": "evt_01J...",
  "tenantId": "t_01J...",
  "deduplicationKey": "t_01J...|occ_01J...|3",
  "data": {}
}
```

SQS Standard pode duplicar e reordenar. Cada consumer:

- valida schema antes do uso;
- registra idempotência antes do efeito externo;
- não confirma mensagem enquanto o estado persistente não estiver consistente;
- classifica erro como retryable ou terminal;
- envia falha terminal para DLQ com metadados redigidos;
- usa `maxReceiveCount=5`.

### 6.3 Evolução

- Alterações aditivas opcionais permanecem na mesma versão.
- Campo obrigatório novo, mudança semântica ou remoção cria `.v2`.
- Producers publicam v1+v2 durante expansão.
- Consumers aceitam ambas durante migração.
- Métricas comprovam ausência de consumidores v1 antes da contração.
- Schemas JSON ficam em `schemas/`, com testes de exemplos válidos e inválidos.

---

## 7. Módulo Identity/Tenancy

### 7.1 Responsabilidades

- mapear Cognito `sub` para ID interno;
- administrar sessões e revogações;
- resolver tenant/membership;
- fornecer matriz de autorização;
- impedir confiança em tenant informado pelo cliente;
- expor preferências de canal, timezone e consentimentos necessários.

### 7.2 Interfaces

```ts
interface IdentityService {
  resolveContext(jwtClaims: ValidatedClaims): Promise<RequestContext>;
  logoutDevice(ctx: RequestContext): Promise<void>;
  logoutAll(ctx: RequestContext): Promise<void>;
}

interface AuthorizationService {
  assertAllowed(
    ctx: RequestContext,
    action: Action,
    resource?: AuthorizedResource
  ): Promise<void>;
}
```

### 7.3 Acessos DynamoDB

- usuário interno: chave canônica de `User`;
- lookup Cognito: **decidido (§23.1)** — item de mapeamento dedicado `PK=IDENTITY#cognitoSub#<sub>` / `SK=MAP`, criado atomicamente no primeiro login, sem usar e-mail;
- membership futura: GSI4 por usuário/organização;
- sessão/revogação: chave base consistentemente lida para operações sensíveis.

No MVP, `tenantId=userId`, mas o código recebe ambos como conceitos separados. Nenhum repositório deriva um do outro fora do resolver.

### 7.4 Aceite

- 100% das rotas autenticadas recebem `RequestContext`;
- nenhuma assinatura pública de serviço aceita `tenantId` vindo de DTO;
- revogação global e por dispositivo comprovada em integração;
- refresh reuse invalida a família correspondente;
- matriz cobre toda rota e toda ação assíncrona privilegiada;
- CSP passa teste automatizado e frontend não depende de armazenamento Web Storage para tokens;
- testes cross-tenant falham antes de qualquer mutação.

---

## 8. Módulo Expiration

### 8.1 Serviços

```ts
interface ExpirationService {
  createItem(ctx: RequestContext, input: CreateItemInput): Promise<ExpirationItem>;
  getItem(ctx: RequestContext, itemId: string): Promise<ExpirationItem>;
  updateItem(
    ctx: RequestContext,
    itemId: string,
    input: UpdateItemInput,
    expectedVersion: number
  ): Promise<ExpirationItem>;
  archiveItem(ctx: RequestContext, itemId: string, expectedVersion: number): Promise<void>;
  renewItem(
    ctx: RequestContext,
    itemId: string,
    input: RenewItemInput,
    expectedVersion: number,
    idempotencyKey: string
  ): Promise<ExpirationItem>;
  deleteItem(ctx: RequestContext, itemId: string, expectedVersion: number): Promise<void>;
}
```

### 8.2 Acessos

- leitura/edição: `PK=TENANT#t#ITEM#i`, `SK=META`, consistente;
- dashboard: GSI1 por status/dueDate, seguido de verificação base quando houver ação;
- filtro: GSI2 por assignee/category;
- políticas/ocorrências/documentos: mesmo agregado do item;
- renovação: transação entre item, idempotência, auditoria/outbox quando aplicável.

### 8.3 Mudança de vencimento

`updateItem` com mudança de `dueDate`:

1. lê item consistentemente;
2. autoriza;
3. valida `expectedVersion`;
4. em `TransactWriteItems`, atualiza item e cria outbox `ItemDueDateChanged`;
5. não tenta alterar ocorrências diretamente na requisição HTTP.

Evento:

```json
{
  "eventType": "expiration.item-due-date-changed.v1",
  "aggregate": {
    "type": "ExpirationItem",
    "id": "item_01",
    "version": 8
  },
  "data": {
    "previousDueDate": "2026-09-10",
    "newDueDate": "2026-09-17",
    "timeZone": "America/Sao_Paulo",
    "reminderPolicyId": "policy_01",
    "reminderPolicyVersion": 4,
    "changeReason": "USER_EDIT"
  }
}
```

Consumer do Reminder cancela ocorrências antigas por condição de versão (`itemVersion` divergente da atual invalida a ocorrência — nenhuma transação tenta cancelar um número ilimitado de ocorrências de uma só vez, o que estouraria os limites de `TransactWriteItems`, 100 itens/4 MB) e materializa as novas em lotes idempotentes. Evento repetido produz o mesmo resultado.

### 8.4 Aceite

- concorrência de duas edições produz um sucesso e um `409 VERSION_CONFLICT`;
- mudança de data e exclusão concorrentes não deixam ocorrência válida para item deletado;
- evento crítico e alteração são atômicos;
- renovação repetida com mesma idempotency key não duplica item/evento;
- listagem eventual nunca autoriza mutação sem leitura base.

---

## 9. Módulo Reminder

### 9.1 Serviços

```ts
interface ReminderPolicyService {
  putPolicy(
    ctx: RequestContext,
    itemId: string,
    policy: ReminderRule,
    expectedItemVersion: number
  ): Promise<ReminderPolicy>;
}

interface ReminderMaterializer {
  materialize(input: {
    tenantId: string;
    itemId: string;
    itemVersion: number;
    policyId: string;
    policyVersion: number;
    windowStart: string;
    windowEnd: string;
    causeEventId: string;
  }): Promise<void>;
}
```

### 9.2 Materialização

Cada `ReminderOccurrence` persiste:

```json
{
  "occurrenceId": "occ_01",
  "scheduledAt": "2026-09-10T12:00:00.000Z",
  "localScheduledAt": "2026-09-10T09:00:00",
  "timeZone": "America/Sao_Paulo",
  "originalRule": {
    "offset": "-P7D",
    "localTime": "09:00"
  },
  "itemVersion": 8,
  "policyVersion": 4,
  "status": "SCHEDULED",
  "version": 1,
  "GSI3PK": "DUE#202609101200#02",
  "GSI3SK": "TENANT#t_01#OCCURRENCE#occ_01"
}
```

**Correção de convergência (Rodada 3)**: a chave original avaliada em ambas as propostas independentes (`GSI3PK=TENANT#t#DUE#...`) não é consultável pelo producer do minuto — `Query` no DynamoDB exige a partition key exata, e o producer não sabe a priori quais tenants têm ocorrência em `M`. Corrigido para uma **chave global** (`GSI3PK=DUE#yyyyMMddHHmm#NN`, sem `tenantId`), com `tenantId` preservado no `GSI3SK` e no item base para reconstrução segura do contexto. Esta é uma **exceção explícita e documentada** à regra "toda chave começa com `TENANT#tenantId`" de `data-model.md` §3 — Type 1, deve ser ratificada em `data-model.md`/`decisions-log.md`, não apenas aqui. Salvaguardas obrigatórias:
- IAM do índice restrito exclusivamente ao `ReminderProducer` — nenhuma rota tenant-facing tem permissão de `Query` no GSI3;
- projeção do GSI mínima (sem conteúdo de negócio sensível, só o necessário para produzir o comando de dispatch);
- teste de isolamento automatizado provando que nenhuma API tenant-facing consegue consultar este índice, mesmo indiretamente;
- dimensionamento de shards por pico **global** (todos os tenants), não por tenant.

Shard:

```text
shard = stableHash(occurrenceId) mod N
```

Cálculo do shard não depende mais de `tenantId` (a distribuição de carga é entre todos os tenants, não por tenant). `N` é configuração versionada (4 shards inicial). **Reshard versionado**: dobrar `N` não pode tornar ocorrências já materializadas nos shards antigos invisíveis — a função de particionamento é versionada (`shardFnVersion`), e o producer consulta simultaneamente a geração antiga (até a janela de materialização antiga expirar, ~7 dias à frente no pior caso) e a nova durante o período de transição, documentado no runbook de expansão de shards (§22.1).

### 9.3 Producer por minuto

Para minuto `M`, `ReminderProducer`:

1. obtém configuração de shards (`N`, `shardFnVersion` ativo(s));
2. consulta GSI3 pelos `N` shards globais de `M` **e de uma janela de lookback** (ex. `[M-5min, M]`) para cobrir minutos cuja publicação falhou — sem lookback, "o próximo tick reprocessa" é falso, pois o próximo tick consulta uma chave diferente (`M+1`), deixando `M` definitivamente para trás em caso de falha;
3. envia uma mensagem de comando por ocorrência elegível, com transição condicional `SCHEDULED → CLAIMED` (não `TRIGGERED` — esse estado pertence ao dispatch worker, §9.4) e `expiresAt` de claim curto;
4. claims expirados sem confirmação de dispatch voltam a `SCHEDULED` via reconciliação (mesmo job da §9.5, não um mecanismo separado);
5. em falha parcial de batch, reenvia somente entradas falhas;
6. emite `scheduler_lag_seconds`, quantidade por shard e idade do lookback consumido.

Comando:

```json
{
  "commandType": "reminder.dispatch.v1",
  "tenantId": "t_01",
  "deduplicationKey": "t_01|occ_01|1",
  "data": {
    "itemId": "item_01",
    "occurrenceId": "occ_01",
    "occurrenceVersion": 1,
    "scheduledAt": "2026-09-10T12:00:00.000Z",
    "itemVersion": 8,
    "policyVersion": 4
  }
}
```

### 9.4 Dispatch

O worker lê consistentemente ocorrência e item:

- ocorrência deve estar `CLAIMED` (produzida pelo producer, §9.3 — não mais `SCHEDULED` diretamente, o claim evita processamento duplo por dois dispatch workers concorrentes);
- item deve estar `ACTIVE`;
- versões devem coincidir;
- horário deve estar dentro da tolerância;
- política ainda deve existir.

Se válido, transação atômica (`TransactWriteItems`, corrige a lacuna de durabilidade apontada na crítica cruzada — antes o evento `ReminderTriggered` era tratado como "reconstruível" sem outbox, o que podia perder ou duplicar o disparo):

- cria `NotificationIntent`;
- muda ocorrência para `TRIGGERED`;
- registra idempotência (`tenantId|occurrenceId` — consumidores de `NotificationIntentCreated` deduplicam por esta chave);
- cria outbox `NotificationIntentCreated` na mesma transação.

O dispatcher só publica no EventBridge após a transação persistir com sucesso; falha de publicação (não de persistência) é recuperada pelo `OutboxPublisher`/sweeper (§5.3), nunca reprocessada como se a ocorrência não tivesse sido tratada.

Se item/política estiver stale:

- cancela a ocorrência condicionalmente (transição `CLAIMED → CANCELLED`, sem tentar cancelar em lote todas as ocorrências futuras da mesma vez — ver §8.3 sobre invalidação por versão em vez de cancelamento transacional ilimitado);
- se ainda existir intenção legítima para a regra atual, agenda reparo via reconciliação (§9.5), não via nova materialização ad-hoc dentro do dispatch;
- não envia notificação com conteúdo antigo.

### 9.5 Reconciliação DST

Diariamente:

1. calcula janela `[agora, agora+7d]` por timezone IANA;
2. compara conjunto esperado com materializado;
3. cancela ocorrências divergentes;
4. cria ausentes idempotentemente;
5. preserva histórico `TRIGGERED/ACKED`;
6. publica métrica de reparos e divergência DST.

### 9.6 Aceite

- duplicação de tick ou mensagem cria no máximo uma intenção lógica;
- teste de transição DST cobre horário inexistente e ambíguo;
- alteração de item invalida ocorrência antiga;
- reconciliação repara ocorrência ausente e cancela excedente;
- quatro shards globais são consultados e monitorados (métrica própria do producer, já que CloudWatch não expõe consumo por valor individual de partition key — `ConsumedReadCapacity` é por tabela/índice, não por shard lógico; a granularidade por shard vem de EMF/custom metrics emitidas pelo próprio `ReminderProducer`);
- runbook de expansão de shards testado, incluindo leitura simultânea de gerações antigas e novas de `shardFnVersion` sem tornar ocorrências já materializadas invisíveis;
- atraso do scheduler tem SLO e alarme;
- **critério de aceite quantitativo (convergência Rodada 3)**: teste de carga sintético cobrindo os três cenários de drenagem do pico extremo já modelados em `capacity-model.md` — drenar 1.000.000 de ocorrências em 1 min (~16.667 agendamentos/s), 5 min (~3.333/s) e 60 min (~278/s) — sem perda de ocorrência (medida por reconciliação) em pelo menos um dos três cenários, com o SLO de drenagem aceitável formalizado em `slo.md` (UNK-CAP-006) antes deste teste ser executado como gate de M7.

---

## 10. Módulo Notification

### 10.1 Entidade e payload de intenção

Persistência:

```json
{
  "PK": "TENANT#t_01#INTENT#int_01",
  "SK": "META",
  "entityType": "NotificationIntent",
  "intentId": "int_01",
  "itemId": "item_01",
  "occurrenceId": "occ_01",
  "itemVersion": 8,
  "policyVersion": 4,
  "kind": "EXPIRATION_REMINDER",
  "status": "PENDING",
  "correctionReason": null,
  "supersedesIntentId": null,
  "requestedChannels": ["EMAIL"],
  "scheduledAt": "2026-09-10T12:00:00.000Z",
  "version": 1
}
```

Evento real:

```json
{
  "specVersion": "1.0",
  "eventId": "evt_int_01",
  "eventType": "notification.intent-created.v1",
  "source": "expiration-tracker.reminder",
  "occurredAt": "2026-09-10T12:00:01.120Z",
  "correlationId": "cor_01",
  "causationId": "occ_01",
  "tenantId": "t_01",
  "actor": {
    "type": "SYSTEM"
  },
  "aggregate": {
    "type": "NotificationIntent",
    "id": "int_01",
    "version": 1
  },
  "data": {
    "intentId": "int_01",
    "kind": "EXPIRATION_REMINDER",
    "itemId": "item_01",
    "occurrenceId": "occ_01",
    "itemVersion": 8,
    "policyId": "policy_01",
    "policyVersion": 4,
    "scheduledAt": "2026-09-10T12:00:00.000Z",
    "requestedChannels": ["EMAIL"],
    "status": "PENDING",
    "supersedesIntentId": null,
    "correctionReason": null
  }
}
```

A intenção referencia dados de negócio; não inclui e-mail, telefone, nome de documento ou conteúdo renderizado.

### 10.2 Router

O `NotificationRouterWorker` lê consistentemente:

- intenção;
- item;
- preferências/opt-out;
- entitlement;
- configuração do canal;
- versão corrente.

Em seguida:

- `CANCELLED`: opt-out, item inativo, sem entitlement ou regra revogada;
- adiado: quiet hours, com `deliverNotBefore`;
- roteado: um comando específico por canal;
- `CORRECTIVE`: quando uma mensagem anterior ficou stale e a política determina correção.

Payload de e-mail:

```json
{
  "commandType": "notification.email-deliver.v1",
  "tenantId": "t_01",
  "deduplicationKey": "t_01|int_01|EMAIL|template.expiration-reminder.v1",
  "data": {
    "intentId": "int_01",
    "itemId": "item_01",
    "expectedItemVersion": 8,
    "channelId": "channel_01",
    "templateId": "template.expiration-reminder",
    "templateVersion": 1,
    "locale": "pt-BR",
    "deliverNotBefore": "2026-09-10T12:00:00.000Z",
    "renderContextRef": {
      "type": "EXPIRATION_ITEM",
      "id": "item_01"
    }
  }
}
```

Payload WhatsApp é outro schema, com `approvedTemplateName`, `templateLanguage` e parâmetros tipados. Não existe campo genérico `channelPayload`.

### 10.3 Delivery worker

Antes de enviar:

1. verifica kill switch do canal **quando aplicável** — `AI`, `OCR` e `WHATSAPP` têm toggle em AppConfig (§17.3); e-mail não tem kill switch dedicado (é o canal essencial, sempre ativo) e este passo é pulado para `EmailDeliveryWorker` — degradação de e-mail é tratada por retry/DLQ/alarme, não por desligamento manual;
2. lê intenção e item consistentemente;
3. valida `expectedItemVersion`;
4. aplica token bucket do provider/canal;
5. adquire idempotência de tentativa;
6. cria `NotificationAttempt` em estado `SENDING`;
7. chama provider com chave idempotente quando suportada;
8. persiste `ACCEPTED`, `FAILED_RETRYABLE` ou `FAILED_TERMINAL`.

Se stale antes do envio:

- marca tentativa como não enviada;
- cria intenção `CORRECTIVE` quando uma entrega anterior exige correção;
- caso contrário cancela a intenção;
- nunca envia conteúdo construído com estado antigo.

A renderização ocorre após a revalidação, usando dados minimizados. Endereço/telefone é obtido do `Channel` apenas no worker autorizado e nunca entra no evento de domínio.

### 10.4 Tentativas

```json
{
  "PK": "TENANT#t_01#INTENT#int_01",
  "SK": "ATTEMPT#0001#att_01",
  "attemptId": "att_01",
  "channel": "EMAIL",
  "provider": "provider_a",
  "providerMessageId": "pm_01",
  "status": "ACCEPTED",
  "attemptNumber": 1,
  "startedAt": "2026-09-10T12:00:02Z",
  "completedAt": "2026-09-10T12:00:03Z",
  "version": 2,
  "GSI5PK": "PROVIDER#provider_a#ACCOUNT#acct_01#MESSAGE#pm_01",
  "GSI5SK": "TENANT#t_01#INTENT#int_01"
}
```

### 10.5 Aceite

- opt-out e quiet hours são aplicados antes de enfileirar canal;
- worker revalida versão imediatamente antes do efeito externo;
- duplicação não gera segunda tentativa lógica;
- retry só ocorre para erros classificados;
- kill switch impede chamadas novas mesmo com backlog;
- token bucket e reserved concurrency limitam provider;
- DLQ alarma com idade de uma hora e escala com quatro horas;
- nenhuma mensagem contém endereço ou telefone fora da fila específica criptografada;
- correção referencia `supersedesIntentId`.

---

## 11. Webhooks de provider

### 11.1 Ingress

A rota `/webhooks/{provider}/{accountAlias}` não confia em tenant enviado no payload. `accountAlias` resolve internamente provider account e tenant.

Ordem obrigatória:

1. limite de tamanho do corpo;
2. captura do corpo bruto;
3. resolução de conta conhecida;
4. validação de assinatura em tempo constante;
5. validação de timestamp;
6. janela de replay;
7. validação de nonce quando disponível;
8. normalização mínima do identificador;
9. `PutItem` condicional no inbox;
10. envio de referência para fila;
11. resposta conforme contrato do provider.

`WebhookInbox`:

```json
{
  "PK": "TENANT#t_01#WEBHOOK#provider_a#acct_01",
  "SK": "EVENT#provider_event_987",
  "entityType": "WebhookInbox",
  "provider": "provider_a",
  "providerAccountId": "acct_01",
  "providerEventId": "provider_event_987",
  "eventKind": "DELIVERY_STATUS",
  "signatureVerified": true,
  "signatureTimestamp": "2026-09-10T12:01:00Z",
  "nonceHash": "sha256:...",
  "receivedAt": "2026-09-10T12:01:02Z",
  "payloadObjectKey": null,
  "normalizedPayload": {
    "providerMessageId": "pm_01",
    "status": "DELIVERED",
    "occurredAt": "2026-09-10T12:00:58Z",
    "failureCode": null
  },
  "processingStatus": "PENDING",
  "version": 1,
  "GSI6PK": "RECON#WEBHOOK#PENDING",
  "GSI6SK": "2026-09-10T12:01:02Z#provider_event_987"
}
```

O payload normalizado é allowlisted. Se auditoria exigir corpo bruto, ele vai para S3 criptografado, com retenção curta, chave opaca e acesso isolado; nunca para DynamoDB, log ou DLQ.

Comando para processamento:

```json
{
  "commandType": "notification.webhook-process.v1",
  "tenantId": "t_01",
  "deduplicationKey": "provider_a|t_01|acct_01|provider_event_987",
  "data": {
    "provider": "provider_a",
    "providerAccountId": "acct_01",
    "providerEventId": "provider_event_987",
    "inboxPk": "TENANT#t_01#WEBHOOK#provider_a#acct_01",
    "inboxSk": "EVENT#provider_event_987"
  }
}
```

### 11.2 Processor

- lê inbox consistentemente;
- resolve tentativa via GSI5;
- confirma tenant/provider/account na chave base;
- aplica transição monotônica de status;
- rejeita regressão, por exemplo `DELIVERED → ACCEPTED`;
- grava auditoria;
- marca inbox `PROCESSED`.

### 11.3 Aceite

- assinatura inválida não cria inbox;
- evento repetido falha no `ConditionExpression`, mas recebe resposta idempotente apropriada;
- mesmo `providerEventId` em outra conta/tenant não colide;
- evento fora da janela é rejeitado;
- GSI5 nunca é usado sem confirmação base;
- payload bruto não aparece em logs, traces ou DLQ.

---

## 12. Módulo Document

### 12.1 Reserva de upload

```ts
interface DocumentService {
  reserveUpload(
    ctx: RequestContext,
    itemId: string,
    input: {
      fileName: string;
      mediaType: string;
      contentLength: number;
      checksumSha256: string;
    },
    idempotencyKey: string
  ): Promise<{
    documentId: string;
    uploadSlotId: string;
    uploadUrl: string;
    requiredHeaders: Record<string, string>;
    expiresAt: string;
  }>;
}
```

Transação:

- lê/condiciona quota;
- decrementa token disponível;
- cria `UploadSlot(PENDING)`;
- cria `Document(PENDING_UPLOAD)`;
- associa slot, item, tenant, tamanho, tipo e checksum.

A presigned URL:

- aponta somente para chave aleatória da quarentena;
- tem TTL curto;
- restringe tamanho/tipo/checksum quando suportado;
- não permite overwrite;
- inclui `uploadSlotId`, `documentId` e tenant em metadata assinada;
- não concede leitura.

### 12.2 Estado

Transições válidas:

```text
PENDING_UPLOAD -> SCANNING
SCANNING -> CLEAN
SCANNING -> REJECTED
SCANNING -> UNSUPPORTED
SCANNING -> TIMEOUT
```

`CLEAN` significa objeto promovido com sucesso ao bucket limpo. Resultado GuardDuty “limpo” antes da cópia pode usar estado interno transitório, não exposto como `CLEAN`.

Todas as transições usam versão e estado esperado. Evento duplicado do S3 ou GuardDuty não repete promoção.

### 12.3 Finalização e scanning

`UploadFinalizerWorker` valida:

- bucket e key esperados;
- slot `PENDING`;
- tamanho, checksum e media type declarados;
- vínculo tenant/document/slot;
- documento ainda não excluído.

Então muda slot para `CONFIRMED` e documento para `SCANNING`. Slots não confirmados só são restituídos pelo reconciler periódico, nunca pelo TTL.

`MalwareResultWorker`:

- `NO_THREATS_FOUND`: copia com role dedicada para bucket limpo; confirma checksum; só então `CLEAN`;
- ameaça: `REJECTED`;
- não suportado: `UNSUPPORTED`;
- timeout/ausência além do prazo: `TIMEOUT`.

O handler de negócio não possui `s3:GetObject` na quarentena.

### 12.4 Sandbox de PDF

GuardDuty não substitui isolamento do parser. O parsing ocorre em função/container dedicado com:

- sem VPC egress ou com egress negado;
- nenhuma credencial além do objeto de entrada e resultado estritamente necessários;
- limite de páginas;
- limite de tamanho descompactado;
- limite de memória;
- timeout de CPU/parede;
- profundidade e quantidade máximas de objetos;
- bloqueio de arquivos anexos, JavaScript, ações, referências externas e conteúdo ativo;
- detecção de zip/decompression bomb;
- biblioteca fixada e atualizada conforme SLA;
- diretório temporário efêmero e limpeza por término da execução.

Falha de limite resulta em `PENDING_CONFIRMATION`/estado técnico de falha da execução; nunca aplica vencimento.

### 12.5 Extração

`ExtractionStarterWorker` cria idempotentemente:

```text
tenantId|documentId|documentVersion|pipelineVersion
```

e inicia Step Functions Standard com referência ao objeto limpo.

Estados e mapeamento explícito para as 4 funções Lambda decididas em §23.1/§3.1 (nenhum estado compartilha handler com um estado de responsabilidade/IAM distinta — mapeamento fechado, não "a definir"):

| # | Estado | Lambda (`ScopedLambdaFunction` próprio) |
|---|---|---|
| 1 | `LoadMetadata` | `ExtractionStarterWorker` (já inicia a execução com os metadados carregados) |
| 2 | `DetectDocumentType` | `TextractTaskHandler` |
| 3 | `RunTextract` | `TextractTaskHandler` |
| 4 | `RunDeterministicParser` | `PdfParserTaskHandler` (sandbox isolado, §12.4) |
| 5 | `NeedsBedrock?` | Choice state nativo da Step Functions (sem Lambda própria) |
| 6 | `CheckAiKillSwitch` | `BedrockExtractionTaskHandler` (primeira ação da função, antes de qualquer chamada ao modelo) |
| 7 | `RunBedrock` | `BedrockExtractionTaskHandler` |
| 8 | `ValidateSchema` | `ExtractionValidationTaskHandler` |
| 9 | `CompareExtractors` | `ExtractionValidationTaskHandler` |
| 10 | `PersistExtractedFields` | `ExtractionValidationTaskHandler` |
| 11 | `MarkPendingConfirmation` | `ExtractionValidationTaskHandler` (ramo de falha/baixa confiança/divergência) |
| 12 | `CompleteRun` | `ExtractionValidationTaskHandler` (ramo de sucesso) |

`ExtractionValidationTaskHandler` concentra os estados 8-12 porque compartilham a mesma superfície de IAM (leitura/escrita de `ExtractedField`/`ExtractionRun`, sem acesso a Textract/Bedrock/rede do parser) — a separação em §23.1 isola exatamente as três superfícies de risco distintas (OCR gerenciado, parsing não confiável em sandbox, chamada a modelo de LLM), não fragmenta cada estado individual em uma função própria.

Input:

```json
{
  "workflowVersion": 1,
  "tenantId": "t_01",
  "itemId": "item_01",
  "documentId": "doc_01",
  "documentVersion": 3,
  "extractionRunId": "run_01",
  "pipelineVersion": "2026-08-01",
  "cleanObject": {
    "bucketRef": "clean-documents",
    "key": "tenant-hash/doc_01/version-3"
  },
  "correlationId": "cor_01"
}
```

Saídas grandes ficam em S3; o estado carrega referências. Conteúdo OCR não entra em logs ou eventos.

`ExtractedField`:

```json
{
  "fieldName": "expirationDate",
  "runId": "run_01",
  "valueType": "DATE",
  "candidateValue": "2027-03-31",
  "confidence": 0.91,
  "sources": ["TEXTRACT", "DETERMINISTIC_PARSER"],
  "agreement": "MATCH",
  "state": "PENDING_CONFIRMATION",
  "documentVersion": 3,
  "pipelineVersion": "2026-08-01"
}
```

Confirmação humana:

1. lê item, documento, run e campo consistentemente;
2. autoriza;
3. exige `expectedItemVersion`, `expectedDocumentVersion` e `expectedFieldVersion`;
4. em transação, marca campo confirmado e altera item;
5. se alterar vencimento, cria outbox `ItemDueDateChanged`.

### 12.6 Exclusão concorrente

Exclusão de documento:

- muda estado lógico com condição de versão;
- invalida novas aplicações de extração;
- workflow em andamento verifica versão/estado antes de persistir;
- purga física posterior usa GSI6;
- cópia ou resultado tardio não ressuscita documento.

### 12.7 Aceite

- upload sem slot válido é rejeitado/quarentenado;
- quota é decrementada atomicamente;
- TTL sozinho nunca restitui slot;
- somente CLEAN é legível pelo pipeline;
- worker de negócio não consegue ler quarentena em teste IAM;
- ameaça, unsupported e timeout falham fechados;
- parser prova ausência de rede e encerra em cada limite;
- Bedrock desligado via AppConfig impede chamada já enfileirada;
- nenhuma extração altera item sem confirmação;
- corrida entre confirmação e edição/exclusão produz conflito seguro;
- reexecução com mesma chave não cria segundo run.

---

## 13. Módulo Audit

### 13.1 Contrato

```ts
interface AuditCommand {
  tenantId: string;
  actor: {
    type: "USER" | "SYSTEM" | "PROVIDER";
    userId?: string;
  };
  action: string;
  resource: {
    type: string;
    id: string;
  };
  outcome: "SUCCEEDED" | "DENIED" | "FAILED";
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  changes?: Array<{
    field: string;
    beforeHash?: string;
    afterHash?: string;
  }>;
  reasonCode?: string;
}
```

Não registrar valores sensíveis em `changes`; apenas nomes de campos e hashes quando indispensáveis.

Chave:

```text
PK=TENANT#t#AUDIT#yyyyMM
SK=EVT#timestamp#eventId
```

Eventos são append-only. A role de aplicação possui `PutItem` condicional, não `UpdateItem`/`DeleteItem`, para itens de auditoria — mas essa restrição de IAM garante só a imutabilidade, não a durabilidade da chegada do evento.

**Correção de convergência (Rodada 3)**: "consumidor único, alarme direto, sem DLQ" não é estratégia de recuperação — alarmar não recupera eventos perdidos após o período de retry do EventBridge. O `audit-consumer` tem DLQ dedicada (mensagens de auditoria nunca são descartadas silenciosamente), com: retry documentado, redrive controlado (mesmo runbook de DLQ das demais filas, §22.2), e reconciliação periódica que compara a contagem/hash de eventos de domínio críticos publicados no outbox contra os `AuditEvent` correspondentes gravados, alertando divergência.

Ações críticas incluem login/logout, negativa de autorização, item create/update/delete/renew, mudança de vencimento, upload, malware, extração confirmada/rejeitada, configuração de canal, envio, webhook aplicado e redrive.

### 13.2 Aceite

- tentativa de update/delete em AuditEvent falha por IAM;
- toda mutação crítica tem evento correlacionável;
- auditoria não contém PII bruta;
- acesso ao audit exige ação `audit:read`;
- paginação mensal funciona sem scan global;
- DLQ do `audit-consumer` tem alarme de idade e runbook de redrive próprios;
- reconciliação periódica detecta e alerta divergência entre eventos críticos publicados e `AuditEvent` gravados.

---

## 14. Observabilidade e redaction central

### 14.1 Logger único

Todos os handlers usam `SecureLogger`. Chamadas diretas a `console.*` falham no lint.

```ts
logger.info("notification_attempt_accepted", {
  correlationId,
  tenantId,
  intentId,
  attemptId,
  channel,
  provider,
  durationMs
});
```

O redactor:

- usa `schemas/sensitive-fields.json`;
- remove tokens, cookies, authorization, assinatura, e-mail, telefone, nome de arquivo, texto OCR, prompt/resposta LLM, documento e corpo bruto de webhook;
- percorre objetos aninhados;
- limita profundidade, tamanho e cardinalidade;
- sanitiza mensagens de exceção de SDK/provider;
- é usado antes de log, trace annotation, DLQ diagnostic metadata e evento operacional.

`tenantId` pode existir em log estruturado para investigação, mas nunca em dimensão EMF.

### 14.2 Métricas e alarmes

- API: latência, 4xx/5xx, auth denied, quota denied;
- Reminder: producer lag, ocorrências por shard, stale occurrences;
- SQS: oldest message age, visible count, DLQ age;
- Notification: attempts, acceptance, bounce, provider throttling;
- Document: malware timeout, unsupported, extraction duration/confidence/divergence;
- Outbox: oldest pending, publish failures;
- Custo: por tenant em logs/análise, mas dimensão agregada em métricas; custo por unidade;
- AppConfig: operações bloqueadas por kill switch.

DLQ:

- alarme quando idade ≥1 hora;
- escalonamento operacional quando ≥4 horas;
- redrive somente após classificação da causa;
- lote limitado e auditado.

### 14.3 Aceite

Corpus de testes injeta segredos e PII em:

- log normal;
- exceção;
- trace;
- mensagem inválida;
- DLQ;
- evento;
- resposta de provider.

Nenhum valor canário pode aparecer no output capturado.

---

## 15. Egress e integrações externas

Não existe utilitário como `fetch(url)` disponível aos módulos de domínio.

Clients externos são adapters nomeados:

```ts
interface EmailProviderClient {
  send(request: ProviderEmailRequest): Promise<ProviderSendResult>;
}

interface BedrockExtractionClient {
  extract(request: BedrockExtractionRequest): Promise<ExtractionCandidate>;
}
```

Cada adapter tem:

- hostname/region fixos;
- timeout;
- limite de resposta;
- TLS obrigatório;
- sem redirects ou com redirects estritamente validados;
- métricas;
- redaction;
- credenciais específicas.

Pré-requisitos para webhook de saída futuro:

- allowlist por tenant e endpoint verificado;
- DNS resolution protegida contra rebinding;
- bloqueio de loopback, link-local, metadata e ranges privados IPv4/IPv6;
- revalidação do IP após redirect;
- limite de redirects;
- assinatura do payload;
- secret por endpoint;
- circuit breaker, rate limit e kill switch.

Sem esses controles, outbound webhooks permanecem desabilitados.

---

## 16. Supply chain e dependências

### 16.1 Pipeline

Obrigatório:

- lockfile versionado e instalação imutável (`npm ci`);
- versão de Node fixada;
- GitHub Actions pinadas por commit SHA;
- imagens pinadas por digest;
- permissões mínimas em `GITHUB_TOKEN`;
- OIDC sem credenciais AWS persistentes;
- SBOM CycloneDX/SPDX;
- SAST, dependency scan e IaC scan;
- assinatura do artefato;
- provenance/SLSA quando suportado;
- verificação de assinatura e digest antes do deploy;
- registro do digest implantado.

### 16.2 Política de dependências

- scripts de instalação desabilitados por padrão;
- exceções explícitas e revisadas;
- allowlist para pacotes críticos de auth, crypto, PDF, schema e HTTP;
- dependência nova exige justificativa, licença e avaliação de manutenção;
- sem ranges flutuantes para ferramentas de build;
- SLA proposto:
  - CVE crítica explorável: triagem em 24h, mitigação em 48h;
  - alta: triagem em 3 dias, correção em 7 dias;
  - média: ciclo planejado em até 30 dias.
- pacote crítico abandonado abre decisão de substituição.

### 16.3 Aceite

- build reproduz digest idêntico sob mesmas entradas;
- pipeline rejeita action sem SHA, imagem sem digest e lockfile divergente;
- artefato não assinado não chega a produção;
- SBOM é anexado ao release;
- pacote com install script não allowlisted falha na instalação;
- CVE policy bloqueia conforme severidade e exceção documentada com expiração.

---

## 17. Infraestrutura, IAM e configuração

### 17.1 `ScopedLambdaFunction`

Cada função declara:

```ts
new ScopedLambdaFunction(this, "ReminderDispatch", {
  handler: "...",
  access: [
    tableAccess.readWriteKeys("ReminderOccurrence", "ExpirationItem"),
    tableAccess.create("NotificationIntent"),
    tableAccess.create("Idempotency"),
    tableAccess.create("OutboxEvent"),
    queueAccess.consume(reminderDispatchQueue),
    appConfigAccess.read("notification-kill-switches")
  ]
});
```

O construct gera grants específicos e falha synth quando o recurso solicitado não corresponde a uma capability conhecida.

### 17.2 Criptografia

- DynamoDB PITR e CMK;
- buckets com CMKs separadas quando o isolamento exigir;
- filas e DLQs criptografadas;
- Secrets Manager para provider secrets;
- rotação onde suportada;
- key policies restritas por role;
- CloudTrail habilitado para mudanças administrativas relevantes.

### 17.3 Configuração

AppConfig:

```json
{
  "schemaVersion": 1,
  "features": {
    "AI_EXTRACTION": true,
    "OCR": true,
    "WHATSAPP": false
  }
}
```

Workers usam cache curto, mas devem refrescar antes de cada operação cara. Falha em obter configuração usa valor seguro:

- AI/OCR/WhatsApp: desligado (fail-closed).
- **E-mail não é sujeito a kill switch** (decisão explícita de convergência, ausente nas duas propostas Rodada 1): `AppConfig` cobre apenas os toggles de emergência `AI`, `OCR`, `WHATSAPP` conforme `architecture-fase3-consolidada.md` §14. E-mail é o canal padrão do produto — sempre ativo, sem toggle de emergência dedicado; degradação de e-mail é tratada por DLQ/retry/alarme (§14.2), não por kill switch.

---

## 18. Grafo e ordem de deploy

```text
Bootstrap/OIDC
    |
    v
Foundation
(KMS, logs, AppConfig, budgets, CloudTrail)
    |
    +------------------+
    v                  v
Data               Identity/Edge
(DynamoDB, PITR)   (Cognito, API domain, WAF-ready)
    |                  |
    +--------+---------+
             v
Document Storage
(quarantine, clean, OAC policies, GuardDuty)
             |
             v
Eventing
(EventBridge, queues, DLQs, schedules)
             |
             v
Application
(API monolith, outbox, reminder, notification, webhook)
             |
             v
Document Processing
(GuardDuty handlers, Step Functions, Textract, Bedrock)
             |
             v
Observability
(dashboards, alarms, SLOs, runbooks)
             |
             v
Frontend
(S3 private, CloudFront, immutable hash deploy)
```

Ordem concreta:

1. CDK bootstrap e trust OIDC.
2. CMKs, log groups, AppConfig, budgets, anomaly detection e CloudTrail.
3. DynamoDB com GSIs, Streams e PITR.
4. Cognito, domínios, certificados e esqueleto do HTTP API.
5. Buckets de quarentena/limpo e políticas físicas.
6. Event bus, filas por canal, DLQs e schedules inicialmente desabilitados.
7. API e workers com aliases, sem tráfego agendado.
8. EventBridge rules e event source mappings desabilitados.
9. Step Functions e tarefas de documento.
10. dashboards, alarmes e canários.
11. smoke tests com eventos sintéticos.
12. habilitação gradual: outbox → webhook → reminder → notification → documento.
13. frontend por diretório/hash imutável e troca atômica de origem/manifest.
14. WAF antes do lançamento público de produção.

Recursos de consumo não são habilitados antes de:

- schema publicado;
- DLQ existente;
- alarmes existentes;
- idempotência testada;
- runbook de recuperação disponível.

Rollback de código usa aliases Lambda. Rollback de schema não remove campos; usa compatibilidade expand/contract.

---

## 19. Milestones e dependências

### M0 — Guardrails e contratos

Entregas:

- estrutura TypeScript;
- schemas JSON;
- logger/redactor;
- configuração;
- padrão de erros;
- idempotência;
- OCC;
- outbox;
- pipeline supply-chain.

Dependência: nenhuma.

Saída: biblioteca comum e pipeline aprovados antes de funcionalidades.

### M1 — Foundation, Identity e isolamento

Entregas:

- Cognito;
- sessões;
- resolver central;
- matriz de autorização;
- DynamoDB;
- `ScopedLambdaFunction`;
- API skeleton;
- quotas.

Depende de M0.

Saída: rota autenticada de teste e suíte cross-tenant negativa.

### M2 — Expiration core e Audit

Entregas:

- CRUD/renew;
- dashboard GSI1;
- OCC;
- audit append-only;
- `ItemDueDateChanged` por outbox.

Depende de M1.

Saída: item gerenciado end-to-end sem reminders.

### M3 — Reminder Engine

Entregas:

- policies;
- materialização;
- GSI3;
- producer;
- dispatch;
- reconciliação DST;
- runbook de shards.

Depende de M2 e outbox de M0.

Saída: `NotificationIntent` criado deterministicamente, sem delivery externo.

### M4 — Notification Engine

Entregas:

- router;
- preferências, entitlement e quiet hours;
- fila de e-mail (sem kill switch — canal essencial, §17.3/§10.3);
- provider sandbox/test account;
- attempts;
- callbacks;
- DLQs.

Depende de M3 e M1.

Saída: notificação de teste rastreável do occurrence ao callback.

WhatsApp é submilestone posterior, inclui o toggle AppConfig `WHATSAPP` (kill switch), e não bloqueia e-mail.

### M5 — Document upload e malware boundary

Entregas:

- UploadSlot/quota;
- presigned upload;
- quarentena;
- GuardDuty;
- promoção CLEAN;
- reconciliação de slot;
- exclusão segura.

Depende de M1, M2 e infraestrutura M0.

Saída: documento limpo promovido; todos os demais fail-closed.

### M6 — Extraction e confirmação

Entregas:

- sandbox PDF;
- Step Functions;
- Textract/parser;
- Bedrock condicional;
- fields;
- confirmação transacional;
- kill switch.

Depende de M5 e outbox/M2.

Saída: candidato extraído nunca altera item sem ação confirmatória.

### M7 — Hardening operacional

Entregas:

- SLOs;
- alarmes;
- DLQ/redrive;
- load tests;
- chaos/failure injection;
- canary;
- WAF;
- retenção;
- runbooks RTO/RPO;
- auditoria de IAM.

Depende de M1–M6.

Saída: condição para produção pública.

---

## 20. Critérios de aceite transversais

### 20.1 Segurança e tenancy

- zero ocorrência de `tenantId` aceito como autoridade a partir do request;
- toda rota tem ação explícita na matriz;
- toda mutação assíncrona revalida tenant e recurso;
- testes negativos cobrem API, workers e callbacks;
- roles não possuem acesso fora dos recursos declarados;
- handlers comuns não leem quarentena.

### 20.2 Concorrência e idempotência

- toda entidade mutável contém `version`;
- toda mutação exige versão esperada;
- consumers são testados com duplicação, reordenação e retry;
- efeitos externos têm chave idempotente;
- operações críticas usam outbox na mesma transação;
- sweeper recupera outbox após simulação de perda do Stream.

### 20.3 Contratos

- todos os eventos/comandos validam contra JSON Schema;
- exemplos golden participam do CI;
- compatibilidade backward é testada;
- nenhum deploy remove campo/estado consumido;
- Step Functions suporta execução iniciada na versão anterior durante rollout.

### 20.4 Resiliência

- filas têm DLQ e `maxReceiveCount=5`;
- oldest-message-age é alarmado;
- throttling e falha de provider não derrubam API;
- kill switches funcionam sobre backlog;
- reserved concurrency protege conta e custos;
- RTO ≤4h é exercitado em game day;
- procedimentos de restore demonstram RPO DynamoDB ≤5min e documentos ≤24h.

### 20.5 Privacidade

- logs, traces, eventos e DLQs passam pelo redactor;
- documento/OCR/LLM não aparece em telemetria;
- retenções são codificadas e reconciliadas;
- acesso a payload bruto de webhook, quando inevitável, é isolado e auditado;
- dados enviados a Textract/Bedrock são minimizados e documentados.

### 20.6 Performance e custo

Metas iniciais devem ser calibradas por teste, mas o gate exige:

- API sem dependência síncrona de provider;
- nenhuma operação crítica baseada em scan;
- distribuição de shards sem hot partition relevante;
- backlog de reminder absorvido dentro do SLO;
- custo por item, reminder, delivery e extraction visível;
- budget 80% notifica e 100% escala;
- Cost Anomaly Detection ativa.

---

## 21. Estratégia de testes

### Unitários

- regras de autorização;
- transições de estado;
- cálculo de timezone/DST;
- classificação de retry;
- redaction;
- shards;
- validação de schema;
- política de correção.

### Integração

- DynamoDB Local ou ambiente AWS efêmero para condições/transações/GSIs;
- SQS duplicada e fora de ordem;
- EventBridge com falha parcial;
- Cognito/session revocation;
- AppConfig indisponível;
- callbacks assinados.

Semântica AWS que diverge de emuladores deve ser validada em conta efêmera real antes do merge.

### Contrato

- producer/consumer por versão;
- provider request/response;
- webhook fixtures assinadas;
- Step Functions input/output;
- expand/contract.

### Segurança negativa

- cross-tenant;
- IDOR;
- token revogado;
- membership revogada;
- assinatura inválida/replay;
- arquivo malicioso/unsupported/bomb;
- SSRF em qualquer URL futura;
- vazamento canário em telemetria;
- IAM denied esperado.

### Carga e falhas

- concentração de ocorrências no mesmo minuto;
- duplicação massiva;
- throttling DynamoDB/provider;
- EventBridge indisponível;
- worker interrompido após chamada externa e antes da persistência;
- callback antes da confirmação local;
- execução Step Functions atravessando deploy;
- backlog com kill switch.

---

## 22. Runbooks obrigatórios antes de produção

1. Aumentar shards do scheduler de 4 para 8.
2. Investigar e redrive de DLQ.
3. Outbox pendente ou EventBridge degradado.
4. Provider com throttle/bounce anormal.
5. Desligar AI/OCR/WhatsApp.
6. Malware scan sem resultado.
7. Restaurar DynamoDB por PITR.
8. Restaurar documentos conforme backup/versionamento definido.
9. Revogar sessões globais.
10. Rotacionar secret de provider/webhook.
11. Rollback por alias Lambda.
12. Migração expand/contract abortada.
13. Resposta a dependência crítica/CVE.
14. Vazamento potencial em logs e contenção.

Cada runbook contém sinais, queries, limites de decisão, comandos aprovados, validação posterior e registro de auditoria.

---

## 23. Decisões de implementação Type 1

Distinção exigida pela rubrica de Design Maturity (`requirements.md` §13.1: nota ≥9 exige ADRs *materialmente relevantes* fechados, não ausência de todo item aberto). Itens abaixo classificados e, quando materialmente relevantes e decidíveis sem pesquisa externa, **fechados nesta rodada de convergência** (Rodada 4) em vez de deixados como lacuna.

### 23.1 Fechados nesta rodada (materialmente relevantes, decidíveis sem dado externo)

1. **BFF de sessão vs. Cognito direto no browser**: **decidido — sessão BFF com cookie `HttpOnly`/`Secure`/`SameSite=Lax`**. Justificativa: é a única opção que satisfaz de forma direta "tokens não ficam em Web Storage" (§4.2) sem depender de comportamento de terceiros (SDK Cognito no browser); um pequeno endpoint de sessão (`/session/refresh`, `/session/logout`) troca refresh token por access token novo, mantendo o token fora do JS do cliente. Afeta segurança diretamente (mitigação de XSS/session theft, lacuna #1 do threat model) — materialmente relevante.
2. **Lookup `cognitoSub → userId`**: **decidido — item de mapeamento dedicado** `PK=IDENTITY#cognitoSub#<sub>` / `SK=MAP`, criado atomicamente (`ConditionExpression attribute_not_exists`) no primeiro login, apontando para `userId`/`tenantId` internos. Fora do agregado `TENANT#...` porque a busca ocorre *antes* de `tenantId` ser conhecido — única exceção adicional de particionamento além do GSI3 (§9.2), pelo mesmo motivo estrutural (chave não pode depender de um dado ainda não resolvido).
3. **Limites numéricos do sandbox de PDF**: **decidido — valores iniciais**: máx. 50 páginas, máx. 25 MB de conteúdo descomprimido, 512 MB de memória de função, timeout de 30s de parede. Calibráveis por estágio (registrar em `capacity-model.md` na próxima revisão), mas um valor inicial explícito é exigido pela lacuna #2 do threat model — "sem limite definido" não é uma opção válida, mesmo que o valor mude depois.
4. **Política de DST ambíguo/inexistente**: **decidido** — horário local inexistente (salto de primavera): desloca para o próximo horário local válido; horário local ambíguo (recuo de outono): usa a primeira ocorrência (UTC mais cedo). Regra simples, testável, documentada como comportamento esperado (não como "a definir").
5. **Textract/parser/Bedrock como Lambdas separadas desde o primeiro release**: **decidido — sim, desde o dia 1**, não como evolução futura. Justificativa: o sandbox de PDF (lacuna #2) exige isolamento de permissões que uma função combinada dilui — separar já no primeiro release é mais simples de auditar do que consolidar depois.

### 23.2 Fechados por referência (já normativos em outro documento, não pertencem à decisão do blueprint)

6. **Retenção por entidade**: já coberta pelas 8 classes de retenção de `privacy-lgpd.md` — o blueprint aplica `retentionClass`/`purgeAfter` (já presentes no modelo de dados) sem redecidir a política.

### 23.3 Permanecem abertos (dependem de pesquisa externa ou de decisão de produto, não de mais debate arquitetural — consistente com os itens já listados como tal em `architecture-fase3-consolidada.md` §"Itens abertos" e `NEXT_SESSION_PROMPT.md")

7. **Provider inicial de e-mail**: adiado — não é decisão de arquitetura (a interface `EmailProviderClient`, §15, já é agnóstica de provider), é escolha de fornecedor/custo, mesma categoria de UNK-003 (BSP WhatsApp) e escolha de modelo Bedrock.
8. **Estratégia concreta de backup S3 para RPO≤24h**: mecanismo já apontado (versionamento + backup, `disaster-recovery.md`), mas a ferramenta exata (AWS Backup vaults vs. replicação para bucket same-region vs. export batch) depende de teste de restore real — pertence à Fase de implementação (rubrica B), não ao design.
9. **Forma exata de assinatura/provenance do pipeline** (cosign/SLSA vs. alternativa): decisão de ferramenta de CI, não de arquitetura — qualquer opção satisfaz o requisito de §16.1, a escolha fica para quando o pipeline for implementado.
10. **Ratificação formal em `data-model.md`/`decisions-log.md` da chave global do GSI3**: a *decisão* já está fechada aqui (§9.2, com justificativa completa e salvaguardas); o que resta é o registro mecânico no documento normativo — não uma lacuna de design, um passo de manutenção documental (AGENTS.md §5) a executar no fechamento desta sessão.

Itens Type 1 remanescentes (§23.3) não bloqueiam o início da implementação por partes independentes (§24).

---

## 24. Definição de pronto do Implementation Blueprint

O blueprint está pronto para implementação quando:

- cada módulo possui porta de aplicação e limite de persistência;
- cada Lambda possui gatilho, IAM e responsabilidade única documentados;
- schemas de eventos e filas estão aprovados;
- access patterns cobrem todas as decisões críticas sem scans;
- deploy graph não contém dependência circular;
- milestones têm gates verificáveis;
- os sete gaps do threat model aparecem em código planejado, testes e critérios de aceite;
- sessões, sandbox PDF, autorização, egress, redaction, supply chain e dependências não estão relegados a backlog pós-MVP;
- critérios de RTO/RPO, DLQ, kill switch, OCC, idempotência e expand/contract podem ser demonstrados;
- decisões ainda abertas estão isoladas em ADRs explícitos, sem bloquear partes independentes do trabalho.

---

## 25. Mapeamento para requisitos e capacity model

| Decisão do blueprint | Requisitos | Métrica do capacity model / gate |
|---|---|---|
| GSI3 global (scheduler) + shards versionados | NFR-002, NFR-011 | Pico extremo 16.667–278 agendamentos/s (`capacity-model.md`), SLO de drenagem UNK-CAP-006 (`slo.md`) |
| Outbox transacional no dispatch de reminder | FR-014, NFR-002 | Fecha a lacuna de durabilidade identificada na crítica cruzada Rodada 2 |
| Quarentena de 2 buckets + sandbox de PDF | SEC-003, SEC-003a | ~61 uploads/min Stage 5, ~1.667/s no cenário extremo |
| SES/Telegram/WhatsApp adapters com contract test | FR-030..034, COST-006 | ~200.000 notificações/dia Stage 5 |
| Step Functions + `PENDING_CONFIRMATION` fail-closed | FR-041..044, gate G4 | ~1.584 itens/dia exigindo revisão humana |
| Matriz de autorização + `RequestContext` central | SEC-007, SEC-010, gate G1 | Testes negativos cross-tenant (SCALE-004) |
| Redactor central de logs | PRIV-001..008, gate G2 | Corpus de testes de vazamento canário (§14.3) |
| Token bucket de quota (`TenantQuota`) + UploadSlot reconciliado | COST-004, COST-005, gate G6 | Restituição de slot só via reconciler, nunca TTL isolado |
| 7 lacunas do threat model incorporadas desde M0/M1 | `threat-model.md` "Lacunas novas" | Nenhuma tratada como apêndice pós-MVP — ver §24 |

## 26. Apêndice — referência rápida de funções Lambda

Complementa o detalhamento por seção (§3.1) com concorrência/DLQ resumidos por função, para consulta rápida durante implementação. `reserved concurrency` são valores iniciais de Stage 0-2 (baixo volume, `capacity-model.md`) — ponto de partida a recalibrar com telemetria real, não limite definitivo:

| Função | Gatilho | Módulo | Reserved concurrency (inicial) | DLQ / recuperação |
|---|---|---|---|---|
| `ApiHandler` | API Gateway HTTP API | Identity/Expiration/Reminder/Notification/Document/Audit | conta com limite de conta compartilhado; sem reserva dedicada no MVP, protegido por quota por tenant (§17.1) | N/A (síncrono, erro mapeado para resposta HTTP) |
| `OutboxPublisher` | DynamoDB Streams + agendamento (sweeper) | transversal (outbox) | 5 | sem DLQ — falha mantém `PENDING`, sweeper reenfileira além da retenção de 24h do Streams |
| `ReminderProducer` | EventBridge Scheduler, 1 minuto | Reminder | 2 (uma execução por minuto, folga para overlap) | sem DLQ — lookback `[M-5min, M]` cobre falha de tick; claims expirados voltam a `SCHEDULED` via reconciliação |
| `ReminderDispatchWorker` | `ReminderDispatchQueue` (comando do producer) | Reminder/Notification | 10 | DLQ, `maxReceiveCount=5` |
| `ReminderReconciliationWorker` | EventBridge diário | Reminder | 1 | sem DLQ (idempotente, roda diariamente) |
| `NotificationRouterWorker` | EventBridge/SQS | Notification | 10 | DLQ, `maxReceiveCount=5` |
| `EmailDeliveryWorker` | `EmailDeliveryQueue` | Notification | 10, token bucket próprio do provider | DLQ por canal, sem kill switch (e-mail é canal essencial, §10.3/§17.3) |
| `WhatsAppDeliveryWorker` | `WhatsAppDeliveryQueue` | Notification | 5, token bucket próprio do provider | DLQ por canal, kill switch AppConfig `WHATSAPP` |
| `WebhookIngressHandler` | API Gateway rota pública | Notification | conta com limite de conta compartilhado; rate-limit por assinatura/IP na borda | N/A (síncrono, valida e persiste inbox) |
| `WebhookProcessorWorker` | `WebhookProcessingQueue` | Notification | 5 | DLQ, `maxReceiveCount=5` |
| `UploadFinalizerWorker` | eventos S3 da quarentena | Document | 5 | DLQ, idempotente por `objectKey` |
| `MalwareResultWorker` | EventBridge/GuardDuty | Document | 5 | DLQ, idempotente por `objectKey` |
| `ExtractionStarterWorker` | evento S3 do bucket limpo | Document | 2 | DLQ, idempotente por `documentId+documentVersion+pipelineVersion` |
| `TextractTaskHandler` | Step Functions | Document | 2 | timeout por step, fail-closed para `PENDING_CONFIRMATION` |
| `PdfParserTaskHandler` (sandbox isolado, §12.4) | Step Functions | Document | 2, sem egress de rede | timeout/limite de recursos do sandbox, fail-closed |
| `BedrockExtractionTaskHandler` | Step Functions | Document | 2, respeita kill switch `AI`/`OCR` | timeout por step, fail-closed para `PENDING_CONFIRMATION` |
| `ExtractionValidationTaskHandler` (schema validation, cross-extractor compare, persist) | Step Functions | Document/Expiration | 2 | timeout por step, fail-closed para `PENDING_CONFIRMATION` |
| `UploadSlotReconciliationWorker` | EventBridge agendado | Document | 1 | sem DLQ (idempotente, restitui slots vencidos) |
| `RetentionReconciliationWorker` | EventBridge agendado | transversal (via DAL) | 1 | sem DLQ (idempotente, consulta GSI6) |
| `DlqRedriveWorker` | invocação manual/runbook | transversal | 1, execução manual controlada | N/A (operação de recuperação, auditada) |
| `audit-consumer` | EventBridge (eventos de domínio relevantes) | Audit | 5 | **DLQ dedicada + reconciliação periódica** (corrigido na convergência — auditoria não pode depender só de alarme, §13.1) |
