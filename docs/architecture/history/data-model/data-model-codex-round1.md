> **Status: histórico/supersedido.** Artefato de rodada do processo Claude↔Codex; não é normativo. Documento sucessor: `../../data-model.md`.

# Domain Model + Data Model — Codex, Rodada 1 (Proposta Independente)

Status: proposta independente do Codex, sem acesso à proposta do Claude.
Base: `docs/architecture/requirements.md`, `docs/architecture/architecture-fase3-consolidada.md` §5/§8/Rodada 6.

## 1. Princípios e agregados
`tenantId` obrigatório em toda chave DynamoDB, idempotency key, objeto S3, evento e mensagem. MVP: `tenantId=userId`; futuro: `tenantId=organizationId`. Identidade autenticável global no IdP; `User` representa o perfil dentro do tenant.

Agregados: **Tenant/Access** (Organization, User, Membership) · **Expiration** (ExpirationItem raiz; ReminderPolicy, ReminderOccurrence, Document, ExtractedField referenciam item e sua versão) · **Notification** (NotificationIntent como efeito lógico único; NotificationAttempt por interação) · **Integration** (Channel, Provider, WebhookInbox, UploadSlot) · **Compliance** (AuditEvent, append-only).

Convenção física: `PK = TENANT#<tenantId>#<aggregate>`, `SK = <entityType>#<id>[#...]`. IDs UUIDv7/ULID. Datas ISO-8601 UTC; timezones IANA. Atributos comuns: `entityType`, `schemaVersion`, `createdAt`, `updatedAt`, `version`, `deletedAt?`, `retentionClass`, `purgeAfter?`.

## 2. Entidades e armazenamento
| Entidade | Atributos principais | PK / SK |
|---|---|---|
| User | userId, identitySubject, emailNormalized, name, timezone, locale, preferências, status | `TENANT#t#USER#u` / `PROFILE` |
| Organization | organizationId, name, timezone, quiet hours padrão, status, plano/entitlements | `TENANT#t#ORG#o` / `META` |
| Membership | membershipId, userId, organizationId, role, permissões, status, joinedAt | `TENANT#t#ORG#o` / `MEMBER#u` |
| ExpirationItem | itemId, nome, categoria, descrição, dueDate, issueDate, periodicidade, emissor, número, responsável, tags, prioridade, status (ACTIVE/ARCHIVED/RENEWED/DELETED), renewedFromId?, version | `TENANT#t#ITEM#i` / `META` |
| ReminderPolicy | policyId, scope (TEMPLATE/ITEM), itemId?, nome, gatilhos relativos, recorrência, timezone, quiet hours, canais, opt-outs, enabled, version | `TENANT#t#POLICY#p` / `META` |
| ReminderOccurrence | occurrenceId, itemId, policyId, triggerId, scheduledAtUtc, timezone IANA, regra original, itemVersion, policyVersion, shard, status (SCHEDULED/CLAIMED/CANCELLED/TRIGGERED/ACKED), claimedAt?, version | `TENANT#t#ITEM#i` / `OCC#<scheduledAt>#<occurrenceId>` |
| Document | documentId, itemId, objectKey, bucket/versão S3, nome, MIME, tamanho, hash, estado (PENDING_UPLOAD/SCANNING/CLEAN/REJECTED/UNSUPPORTED/TIMEOUT/DELETED), uploadSlotId, extractionRunId?, version | `TENANT#t#ITEM#i` / `DOC#d` |
| ExtractedField | documentId, fieldName, valor proposto/final, tipo, origem (DETERMINISTIC/AI/MANUAL), confidence, estado (PENDING_CONFIRMATION/CONFIRMED/REJECTED), extractor/prompt/model/schema versions, runId, ator e valores de correção | `TENANT#t#DOC#d` / `FIELD#<fieldName>#<runId>` |
| NotificationIntent | intentId, occurrenceId, itemId, itemVersion, destinatário lógico, canal, payload versionado, status (PENDING/CANCELLED/DISPATCHED/CORRECTIVE), supersedesIntentId?, correlation ID | `TENANT#t#INTENT#n` / `META` |
| NotificationAttempt | attemptId, intentId, canal, provider, número da tentativa/redrive, status (QUEUED/SENT/DELIVERED/FAILED/UNKNOWN), providerMessageId?, erro normalizado, timestamps | `TENANT#t#INTENT#n` / `ATTEMPT#<number>#a` |
| Channel | channelId, tipo (EMAIL/TELEGRAM/WHATSAPP/...), configuração não secreta, capabilities, limites, opt-in/status, adapter contract version | `TENANT#t#CHANNEL#c` / `META` |
| Provider | providerId, tipo/canal, account reference, secret reference, webhook configuration, rate-limit policy, status, adapter version | `TENANT#t#PROVIDER#p` / `META` |
| AuditEvent | auditEventId, tipo, ator, ação, recurso, itemId?, versões anterior/nova, mudanças redigidas, timestamp, correlation/causation IDs | `TENANT#t#AUDIT#<yyyyMM>` / `EVT#<timestamp>#<id>` |

`AuditEvent` não admite update/delete normal — correções são novos eventos.

## 3. GSIs (todos com chave iniciando por `TENANT#tenantId`)
- **GSI1 — vencimentos/dashboard**: `GSI1PK=TENANT#t#ITEMSTATUS#<status>`, `GSI1SK=DUE#<dueDate>#ITEM#i`. Lista próximos/vencidos/arquivados.
- **GSI2 — responsável/categoria**: `GSI2PK=TENANT#t#ASSIGNEE#u` ou `TENANT#t#CATEGORY#c`, `GSI2SK=DUE#<dueDate>#ITEM#i`. Índices separados se ambos forem padrões frequentes.
- **GSI3 — scheduler**: `GSI3PK=TENANT#t#DUE#yyyyMMddHHmm#NN`, `GSI3SK=<scheduledAtUtc>#OCC#id`. 4 shards/minuto inicial; produtor condiciona por status/versão.
- **GSI4 — membership por usuário**: `GSI4PK=TENANT#t#USER#u`, `GSI4SK=ORG#o#MEMBERSHIP#m`.
- **GSI5 — provider callback**: `GSI5PK=TENANT#t#PROVIDER#p`, `GSI5SK=MSG#<providerMessageId>`. Localiza tentativa para delivery/bounce webhooks.
- **GSI6 — retenção/reconciliação**: `GSI6PK=TENANT#t#PURGE#yyyyMM` ou `...#WORKSTATE#<status>`, `GSI6SK=<purgeAfter/expiresAt>#<type>#<id>`. Suporta purge, upload slots vencidos, inbox/outbox, jobs pendentes. TTL é limpeza auxiliar, nunca gatilho operacional.

## 4. Idempotência e entidades operacionais
Chaves materializadas com `PutItem attribute_not_exists(PK)`:
- Ocorrência: `tenantId|itemId|itemVersion|policyId|policyVersion|triggerId|scheduledAtUtc`.
- Intent: `tenantId|occurrenceId|channel|recipient|intentKind`.
- Attempt: `tenantId|intentId|provider|attemptNumber|redriveGeneration`.
- Extração: `tenantId|documentId|documentVersion|pipelineVersion`.
- Renovação: `tenantId|sourceItemId|sourceVersion|cycle`.
- **WebhookInbox**: PK `TENANT#t#WEBHOOK#<provider>#<account>`, SK `EVENT#<providerEventId>`. Guarda hash, assinatura validada, timestamp/nonce, estado, TTL.
- **UploadSlot**: PK `TENANT#t#UPLOAD`, SK `SLOT#id`. Chave S3 exata, limite, `PENDING/CONFIRMED/REFUNDED`, `expiresAt`. Reserva/débito via `TransactWriteItems`; restituição condicional e idempotente pelo reconciliador.

## 5. Concorrência, exclusão e consistência
Toda entidade mutável usa `version`; updates exigem `version=:expected`. Alterar vencimento grava item, cancela ocorrências antigas e cria outbox crítico numa transação. Aplicação de extração verifica versões de `Document` e `ExpirationItem` simultaneamente; divergência/tombstone descarta o resultado.

Soft delete: `deletedAt` + status + nova versão; leituras normais excluem tombstones. Exclusão LGPD: workflow auditável, atendimento em até 30 dias, remoção de DynamoDB/S3/índices, propagação a backups em até 90 dias. `purgeAfter` deriva da tabela de retenção de PRIV-004; retenção legal suspende purge com justificativa.

Leitura da PK base pode ser fortemente consistente (autorização, edição, pré-envio). GSIs são eventualmente consistentes: dashboards podem atrasar brevemente; decisões críticas nunca dependem só deles. Scheduler, inbox, upload e outbox toleram duplicação por condições/idempotência, cobertos por reconciliação.
