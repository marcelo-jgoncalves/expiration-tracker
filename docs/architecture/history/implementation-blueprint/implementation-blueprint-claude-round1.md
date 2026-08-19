# Implementation Blueprint — Proposta Independente (Claude, Rodada 1)

> Proposta independente, produzida sem visibilidade da proposta do Codex, para `docs/architecture/implementation-blueprint.md` (seção 60 do prompt mestre). Base: `architecture-fase3-consolidada.md`, `data-model.md`, `threat-model.md`, `disaster-recovery.md`, `decisions-log.md`.

## 0. Escopo e princípios de implementação

- Monólito modular Lambda em TypeScript/Node.js. Módulos de domínio isolados por pasta/pacote (`src/modules/{identity,expiration,reminder,notification,document,audit}`), cada um expondo uma fachada explícita (`*.api.ts`) — nenhum módulo acessa a tabela DynamoDB de outro módulo diretamente, nem estado interno de outro módulo, mesmo rodando no mesmo processo/pacote. Isso preserva a opção de extração futura em serviços separados sem reescrita.
- Todo acesso a dado passa por um Data Access Layer (DAL) por módulo. Nenhum handler Lambda monta uma query DynamoDB "crua" fora do DAL — isto é o mecanismo concreto pelo qual a regra de governança do single-table (`data-model.md` §Governança) é aplicada em código, não só em processo.
- `tenantId` é derivado uma única vez, no middleware de autenticação/autorização (módulo Identity), nunca lido de novo do request em nenhum outro módulo — fecha a lacuna #3 do threat model (matriz de autorização + tenantId nunca do request).

## 1. Módulos — responsabilidades, interfaces, critérios de aceite

### 1.1 Identity/Tenancy
- Responsabilidade: validação de JWT Cognito, resolução de `User`/`tenantId`/`identitySubject`→`userId`, matriz de autorização por ação/recurso, emissão do contexto de autorização (`AuthContext { tenantId, userId, roles, scopes }`) usado por todos os outros módulos.
- Interface pública: `authenticate(rawEvent) -> AuthContext | AuthError`, `authorize(ctx, action, resourceRef) -> boolean` (matriz explícita `action × resourceType`, tabela versionada em código, não regra implícita por handler — fecha lacuna #3 do threat model).
- Matriz de autorização (mínimo MVP): ações `{read, create, update, delete, confirm_extraction, manage_channel, manage_provider}` × recursos `{ExpirationItem, Document, ReminderPolicy, Channel, Provider, AuditEvent}`. Cada handler declara estaticamente quais (action, resource) requer; middleware comum de autorização recusa por padrão (fail-closed) se a combinação não estiver na matriz.
- Critério de aceite: teste negativo de autorização cobrindo toda combinação ausente da matriz retorna 403; teste de isolamento de tenant (SCALE-004) cobre API, cada worker assíncrono e storage.

### 1.2 Expiration
- Responsabilidade: CRUD de `ExpirationItem`, `ReminderPolicy`; orquestra materialização de `ReminderOccurrence` (delega ao Reminder); aplica OCC (`version` + `ConditionExpression`) em toda escrita; publica evento `ItemDueDateChanged` via outbox transacional quando `dueDate` muda.
- Interface: `createItem`, `updateItem(itemId, expectedVersion, patch)`, `archiveItem`, `deleteItem` (soft delete), `applyExtractionResult(documentId, runId, fields)` (consome `ExtractedField` do módulo Document, revalida versão do item — fecha cenário 14 do Red Team).
- Evento publicado: `ItemDueDateChanged` (ver §3).
- Critério de aceite: escrita concorrente com `version` divergente falha com erro tipado `ConcurrencyConflict`, nunca sobrescreve silenciosamente; `ItemDueDateChanged` e o cancelamento de `ReminderOccurrence` associadas ocorrem na mesma `TransactWriteItems` (fecha corrida do cenário 13 do Red Team).

### 1.3 Reminder
- Responsabilidade: materialização de `ReminderOccurrence` a partir de `ReminderPolicy` + `ExpirationItem`; producer Lambda (tick EventBridge 1min) consultando shard do minuto corrente via GSI3; publicação em SQS `reminder-trigger-queue`; reconciliação diária (job separado) por janela de 7 dias revalidando DST/timezone (fecha item aberto #4 da Fase 3).
- Interface: `materializeOccurrences(itemId, itemVersion, policyId, policyVersion)` (idempotente via chave composta, `data-model.md` §4), `claimShard(shardKey) -> Occurrence[]` (producer), `reconcileWindow(days=7)`.
- Shards: 4 shards/minuto inicial (`GSI3 PK=TENANT#t#DUE#yyyyMMddHHmm#NN`), alarme CloudWatch em `ConsumedReadCapacity` do shard como gatilho de duplicação manual via runbook (não auto-scaling automático no MVP).
- Critério de aceite: teste de carga sintético do pico extremo modelado (`capacity-model.md`) sem perda de ocorrência (medido via reconciliação); DST test fixture cobrindo transição de horário de verão com ocorrência já materializada corrigida corretamente.

### 1.4 Notification
- Responsabilidade: consome `ReminderTriggered` (SQS `reminder-trigger-queue`), cria `NotificationIntent`, checa entitlement/quiet-hours/opt-out, publica em fila SQS por canal (`notify-email-queue`, `notify-telegram-queue`, `notify-whatsapp-queue`), adapters por canal chamam provider, grava `NotificationAttempt`.
- Interface de adapter (contrato comum, FR-033): `send(envelope: NotificationEnvelope) -> AttemptResult`, `NotificationEnvelope { intentId, tenantId, channel, recipient, templateKey, variables, correlationId }` — payload/particularidades de canal (ex. WhatsApp template pré-aprovado + janela de sessão 24h) ficam num campo `channelPayload` tipado por canal, nunca vazando no envelope comum.
- Antes de enviar: revalida versão do `ExpirationItem`/`intentId`; se obsoleto, gera `NotificationIntent` corretivo (status `CORRECTIVE`, FR-014) em vez de suprimir.
- Critério de aceite: contract test por adapter (mock de provider) cobrindo sucesso, falha permanente (não redrive), falha transitória (redrive), resposta desconhecida (`UNKNOWN` — nunca assume sucesso); DLQ com `maxReceiveCount=5`, alarme de idade em 1h/escalonamento em 4h (Red Team cenário 11/12).

### 1.5 Document
- Responsabilidade: gera `UploadSlot` + URL presigned (reserva atômica de quota, Red Team cenário 9); processa evento de scan (GuardDuty Malware Protection assíncrono, S3 EventBridge notification) transicionando estado `PENDING_UPLOAD→SCANNING→CLEAN|REJECTED|UNSUPPORTED|TIMEOUT`; dispara Step Functions de extração (Textract→parser determinístico→Bedrock condicional→validação de schema) só sobre objeto `CLEAN`.
- Sandbox de parsing de PDF (fecha lacuna #2 do threat model): parser determinístico roda em container Lambda dedicado, sem policy de egress de rede (VPC sem NAT, ou Lambda sem VPC com IAM sem permissão de rede externa), com `--memory`/timeout/limite de páginas explícitos (rejeita >N páginas, >M MB expandido, timeout curto) — antimalware genérico (GuardDuty) cobre malware binário, não substitui limites de recursos do parser. Nenhuma biblioteca de PDF com plugin/JS embutido habilitado.
- Interface: `requestUploadSlot(itemId, contentType, maxBytes) -> {url, slotId}`, `onScanResult(objectKey, verdict)`, `startExtraction(documentId)`, `applyExtractionResult` (delega escrita final ao módulo Expiration, ver 1.2).
- Critério de aceite: teste de reconciliador de `UploadSlot` (Red Team cenário 9, refinamento Codex) confirmando restituição de slot apenas via job periódico, nunca só TTL; teste de sandbox de PDF com arquivo malicioso de expansão (zip bomb equivalente em PDF) rejeitado antes de exaurir memória do container.

### 1.6 Audit
- Responsabilidade: consumidor único de eventos de domínio relevantes a auditoria (via EventBridge, não escrita direta pelos outros módulos) grava `AuditEvent` append-only; nenhum módulo grava `AuditEvent` diretamente — preserva a garantia de append-only mesmo sob bug em outro módulo.
- Redactor central de logs (fecha lacuna #5 do threat model): módulo `logging/redactor.ts` compartilhado por toda a Lambda (importado, não reimplementado por módulo), schema explícito de campos sensíveis (email, telefone, `identitySubject`, secrets, payload de documento) aplicado antes de qualquer `console.log`/EMF/trace; testado com fixtures cobrindo logs, X-Ray traces, corpo de mensagem DLQ e payload de evento.
- Critério de aceite: teste que injeta PII conhecida em cada canal de log/trace/DLQ e verifica ausência no output; nenhuma escrita em `AuditEvent` fora do consumidor único (lint/regra estrutural + teste).

## 2. Workers assíncronos (handlers Lambda dedicados, mesmo código de domínio)
| Worker | Gatilho | Módulo | Concorrência/DLQ |
|---|---|---|---|
| `reminder-producer` | EventBridge tick 1min | Reminder | reserved concurrency baixa, sem DLQ (idempotente, próximo tick reprocessa) |
| `reminder-consumer` | SQS `reminder-trigger-queue` | Notification | DLQ + redrive, maxReceiveCount=5 |
| `notify-{email,telegram,whatsapp}-worker` | SQS por canal | Notification (adapter) | DLQ por canal, token bucket próprio |
| `document-scan-result` | S3 EventBridge notification (GuardDuty) | Document | DLQ, idempotente por `objectKey` |
| `extraction-orchestrator` | Step Functions | Document/Expiration | timeout por step, fail-closed para `PENDING_CONFIRMATION` |
| `outbox-sweeper` | EventBridge schedule (ex. 5min) | Expiration/Document/Notification | reenfileira `PENDING` vencidos |
| `upload-slot-reconciler` | EventBridge schedule | Document | idempotente, restitui slots vencidos |
| `webhook-inbox-processor` | SQS a partir de API Gateway webhook endpoint | Notification | grava inbox antes de processar (Red Team cenário 15) |
| `audit-consumer` | EventBridge (todos os domain events relevantes) | Audit | sem DLQ perdível — falha aqui é crítica, alarme direto |
| `retention-purge` | EventBridge schedule diário | todos (via DAL) | consulta GSI6, aplica `purgeAfter` |
| `dst-reconciler` | EventBridge schedule diário | Reminder | janela de 7 dias |

## 3. Eventos e schemas (EventBridge + outbox)

Envelope comum a todo evento de domínio:
```json
{
  "specversion": "eventbridge-v1",
  "eventType": "ItemDueDateChanged",
  "eventId": "uuidv7",
  "schemaVersion": 1,
  "tenantId": "t_...",
  "correlationId": "uuid",
  "causationId": "uuid|null",
  "occurredAt": "2026-08-19T12:00:00Z",
  "payload": { }
}
```

Eventos críticos (via outbox transacional, `data-model.md` §Idempotência/Governança):
- `ItemDueDateChanged { itemId, itemVersion, previousDueDate, newDueDate, cancelledOccurrenceIds[] }`
- `DocumentExtractionCompleted { documentId, runId, itemId, fields: [{fieldName, value, confidence, origin}], requiresConfirmation: bool }`
- `NotificationIntentCorrective { originalIntentId, newIntentId, reason }`

Eventos reconstruíveis (EventBridge direto, sem outbox):
- `ReminderTriggered { occurrenceId, itemId, itemVersion, policyId, scheduledAtUtc, channel }`
- `NotificationAttemptRecorded { intentId, attemptId, status, providerMessageId? }`
- `DocumentStateChanged { documentId, previousState, newState }`

`NotificationIntent` payload (persistido, não só em trânsito):
```json
{
  "intentId": "uuidv7",
  "tenantId": "t_...",
  "occurrenceId": "...",
  "itemId": "...",
  "itemVersion": 3,
  "channel": "WHATSAPP",
  "recipient": { "type": "phone", "value_ref": "channel:c_123" },
  "status": "PENDING",
  "supersedesIntentId": null,
  "channelPayload": { "templateKey": "reminder_v2", "variables": { "itemName": "...", "dueDate": "..." } },
  "correlationId": "uuid"
}
```

`WebhookInbox` payload:
```json
{
  "pk": "TENANT#t#WEBHOOK#<provider>#<account>",
  "sk": "EVENT#<providerEventId>",
  "provider": "whatsapp_bsp_x",
  "receivedAt": "...",
  "signatureValid": true,
  "rawPayloadRef": "s3://.../hash",
  "processedAt": null,
  "ttl": 1234567890
}
```

## 4. Requisitos técnicos incorporados desde o início (7 lacunas do threat model)
1. **CSP**: definida no CloudFront response headers policy do frontend S3+CloudFront (§1.0 não repetir por handler); `default-src 'self'`, sem `unsafe-inline` para script, nonce para estilos inline necessários; aplicada desde o primeiro deploy de frontend, não retrofit.
2. **Sandbox de parsing de PDF**: ver §1.5 Document — container isolado, sem egress, limites de página/memória/CPU explícitos, timeout curto.
3. **Matriz de autorização por ação/recurso**: ver §1.1 Identity — tabela estática versionada em código, fail-closed por padrão.
4. **Política de egress/allowlist**: toda Lambda que não precisa de rede externa não tem rota de saída (sem NAT/sem VPC); as que precisam (webhooks de provider, futuro FUT-002) usam um único proxy de egress com allowlist de domínio, bloqueio de metadata endpoint (`169.254.169.254`) e ranges privados — pré-requisito de design antes de qualquer fetch arbitrário existir no código.
5. **Redactor central de logs**: ver §1.6 Audit — módulo compartilhado, testado contra logs/traces/DLQ/eventos.
6. **Supply-chain hardening**: GitHub Actions fixadas por SHA (não tag), imagens de container Lambda por digest (não `:latest`), SBOM gerado no pipeline (ex. CycloneDX), verificação de assinatura/proveniência antes de deploy de produção.
7. **Gestão formal de dependências**: lockfile obrigatório (`package-lock.json` commitado), `npm ci` no pipeline (nunca `npm install`), scripts de instalação de pacote desabilitados por padrão (`ignore-scripts`) exceto allowlist explícita, SLA de resposta a CVE crítico (ex. 48h) via Dependabot/`npm audit` no CI bloqueando merge.

## 5. Ordem de deploy (dependências de recurso)
1. IAM boundary policies + KMS CMK (base para tudo abaixo).
2. DynamoDB single-table + GSIs + PITR habilitado.
3. S3 buckets (quarantine + clean) com SSE-KMS, Block Public Access, versionamento; sem consumidor ainda.
4. Cognito User Pool (independente de API/Lambda).
5. Secrets Manager entries (providers) — placeholders, sem app ainda.
6. `ScopedLambdaFunction` CDK construct compartilhado (base de todos os roles seguintes).
7. Módulo Identity (Lambda de autenticação/autorização) — depende de 1,2,4.
8. API Gateway HTTP API + autorizador Cognito — depende de 4,7.
9. Módulos Expiration/Document/Notification (Lambdas CRUD) — depende de 2,3,6,7,8.
10. SQS filas por canal + DLQs — depende de 6.
11. EventBridge event bus + regras — depende de 6,9.
12. Outbox sweeper + reconciliadores — depende de 2,9,11.
13. Reminder producer/consumer + GSI3 shards — depende de 2,9,10,11.
14. Step Functions extração (Textract/Bedrock) — depende de 3,6,9.
15. GuardDuty Malware Protection habilitado no bucket quarantine — depende de 3.
16. CloudFront + S3 frontend privado (CSP headers policy) — independente do backend, pode paralelizar desde o início.
17. WAF (condicional, antes de exposição pública) — depende de 8.
18. AppConfig kill switches — depende de 6, consumido por 9/13/14.
19. Observabilidade (dashboards/alarmes CloudWatch/X-Ray) — depende de todos os recursos acima existirem para ter métrica.

## 6. Milestones e sequenciamento
- **M0 — Fundação**: itens 1-8 da ordem de deploy. Critério de saída: login Cognito funcional, item CRUD básico sem lembrete/notificação/documento.
- **M1 — Reminder + Notification (canal único, email)**: itens 9-13 (só fila email). Critério de saída: lembrete E2E de item até e-mail recebido, com idempotência testada (reenvio de tick não duplica).
- **M2 — Documentos + extração**: itens 3,14,15 completos. Critério de saída: upload→scan→extração→`PENDING_CONFIRMATION`→confirmação manual funcionando E2E, sandbox de PDF testado com arquivo adversarial.
- **M3 — Canais adicionais (Telegram, WhatsApp) + hardening de segurança**: adapters restantes + itens 4 (7 lacunas do threat model) todos fechados e testados.
- **M4 — Observabilidade + DR real**: dashboards, teste de restore real (`disaster-recovery.md` §6), runbook de credencial comprometida exercitado.
- **M5 — Carga real**: load test progressivo validando shards/quotas sob carga real (Red Team cenários 1/2), só possível após M1-M3.

Dependência crítica: M2 (documentos) não pode iniciar sandbox de PDF sem M0 completo (IAM boundary); M5 não é significativo sem M1-M3 completos (não há canal/volume real para testar).

## 7. Pontos abertos para a próxima rodada (auto-crítica, anti-sycophancy)
- Não defini precisamente o mecanismo de "proxy de egress único" (item 4 do §4) — nome de serviço AWS concreto (ex. NAT + VPC endpoint policies vs. terceiro como Squid em Fargate) não escolhido, fica como ADR de implementação.
- Ordem de deploy não trata explicitamente rollback entre milestones (só dentro de deploy individual via CDK). Falta critério explícito de "M(n) pode reabrir M(n-1)".
- Critérios de aceite ainda não são todos automatizáveis sem infraestrutura de teste (ex. teste de carga real do §M5) — nomeados como critério, não como script pronto.
