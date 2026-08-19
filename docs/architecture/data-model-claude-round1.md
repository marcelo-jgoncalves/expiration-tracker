# Domain Model + Data Model — Claude, Rodada 1 (Proposta Independente)

Status: proposta independente do Claude, antes de ver a do Codex.
Base: `docs/architecture/requirements.md`, `docs/architecture/architecture-fase3-consolidada.md` §5 (DynamoDB on-demand single-table já aprovado), seção 25 do prompt mestre.

## Princípios
- Modelo canônico independente de provider primeiro (seção 25); mapeamento físico para DynamoDB single-table depois.
- Toda entidade carrega `tenantId` (SCALE-004), `version` (optimistic concurrency, decisão do Red Team), `createdAt`/`updatedAt`, e soft-delete via `status`/`deletedAt` (nunca DELETE físico imediato, exceto quando exigido por PRIV-003/006).

## Modelo canônico (entidades, seção 25 exige no mínimo estas)

### User
`id` (ULID), `email`, `passwordHash`/`cognitoSub` (desacoplado, decisão §4), `timezone` (IANA), `notificationPreferences`, `status` (ACTIVE/SUSPENDED/DELETED), `version`, `createdAt`, `updatedAt`.
Nota: `tenantId` de um User **é o próprio `id`** enquanto Organization não existir (SCALE-004).

### Organization (futuro, FUT-001 — schema previsto, não implementado)
`id`, `name`, `ownerId` (User), `plan`, `status`, `version`, `createdAt`.

### Membership (futuro, FUT-001)
`id`, `organizationId`, `userId`, `role`, `status`, `version`.

### ExpirationItem
`id` (ULID), `tenantId`, `name`, `category`, `description`, `issueDate`, `dueDate`, `periodicity` (nullable — enum: NONE/MONTHLY/ANNUAL/CUSTOM), `issuer`, `documentNumber`, `responsibleUserId`, `tags` (list), `priority`, `status` (ACTIVE/RENEWED/ARCHIVED/DELETED), `alertPolicyId`, `version`, `createdAt`, `updatedAt`.
Unicidade: nenhuma imposta por natureza (usuário pode ter itens com mesmo nome) — unicidade é só de `id`.

### ReminderPolicy
`id`, `tenantId`, `name` (reutilizável entre itens, FR-021), `triggers` (lista de offsets: `{days_before: N}` ou `{days_after: N}` para pós-vencimento), `channels` (lista de canais habilitados), `quietHours`, `version`.

### ReminderOccurrence
`id`, `tenantId`, `itemId`, `itemVersion` (snapshot da versão do item no momento da materialização — chave para optimistic concurrency do Red Team), `triggerOffset`, `dueAtUtc`, `originalTimezone` (IANA), `recurrenceRule` (para revalidação de DST, decisão da Rodada 4 da Fase 3), `shardKey` (`DUE#yyyyMMddHHmm#NN`, decisão §8), `status` (PENDING/DISPATCHED/CANCELLED/SUPERSEDED), `idempotencyKey`, `version`.
**Idempotency key** = hash determinístico de `(itemId, triggerOffset, dueAtUtc)` — reprocessar a mesma materialização nunca cria duplicata.

### Document
`id`, `tenantId`, `itemId` (nullable até associação), `s3KeyQuarantine`, `s3KeyClean` (nullable até promoção), `status` (SCANNING/CLEAN/REJECTED/UNSUPPORTED/TIMEOUT — decisão §7), `sizeBytes`, `mimeType`, `checksum`, `uploadSlotId` (referência ao slot de quota reservado, decisão do Red Team), `version`, `createdAt`, `deletedAt` (soft delete).

### ExtractedField
`id`, `tenantId`, `documentId`, `documentVersion` (para o version-check da Step Function, decisão do Red Team cenário 14), `fieldName`, `value`, `confidence`, `source` (DETERMINISTIC/LLM/MANUAL), `status` (CONFIRMED/PENDING_CONFIRMATION — gate G4/FR-043), `extractionPipelineVersion`, `confirmedByUserId` (nullable), `confirmedAt` (nullable), `previousValue` (para trilha de FR-044), `createdAt`.

### NotificationIntent
`id`, `tenantId`, `reminderOccurrenceId`, `channels` (lista — fan-out), `status` (PENDING/SENT/CANCELLED/SUPERSEDED), `version`, `createdAt`.

### NotificationAttempt
`id`, `tenantId`, `notificationIntentId`, `channel`, `provider`, `status` (QUEUED/SENT/DELIVERED/FAILED/BOUNCED), `attemptNumber`, `providerMessageId` (nullable), `errorReason` (nullable), `createdAt`, `deliveredAt` (nullable).

### Channel (configuração do usuário)
`id`, `tenantId`, `userId`, `type` (EMAIL/TELEGRAM/WHATSAPP), `destination` (e-mail/chatId/phone), `verified` (bool), `optedOut` (bool), `version`.

### Provider (configuração de sistema, não por usuário)
`id`, `type`, `config` (referência a Secrets Manager, nunca segredo em claro), `status` (ACTIVE/DEGRADED/DISABLED — reflete kill switch), `version`.

### WebhookInbox (decisão do Red Team, cenário 15)
`id` = `provider + tenantOrAccount + providerEventId` (chave composta), `payload`, `receivedAt`, `processedAt` (nullable), `ttl`.

### AuditEvent
`id`, `tenantId`, `actorUserId` (nullable — sistema também audita), `entityType`, `entityId`, `action`, `previousValue` (nullable), `newValue` (nullable), `correlationId`, `createdAt` — **append-only, nunca alterado após escrita**.

---

## Mapeamento físico — DynamoDB single-table

| Entidade | PK | SK | GSI1 (PK/SK) | GSI2 (PK/SK) | Propósito dos GSIs |
|---|---|---|---|---|---|
| User | `TENANT#<tenantId>` | `USER#<userId>` | `EMAIL#<email>` / — | — | Login por e-mail |
| ExpirationItem | `TENANT#<tenantId>` | `ITEM#<itemId>` | `TENANT#<tenantId>` / `DUEDATE#<dueDate>` | `TENANT#<tenantId>` / `STATUS#<status>#<updatedAt>` | Dashboard por vencimento; filtro por status |
| ReminderOccurrence | `TENANT#<tenantId>` | `OCC#<occurrenceId>` | `SHARD#<shardKey>` / `OCC#<occurrenceId>` | `ITEM#<itemId>` / `OCC#<occurrenceId>` | **Query do Reminder Scanner por shard (crítico, §8)**; listar ocorrências de um item |
| Document | `TENANT#<tenantId>` | `DOC#<documentId>` | `ITEM#<itemId>` / `DOC#<documentId>` | — | Documentos de um item |
| ExtractedField | `TENANT#<tenantId>` | `EXTR#<documentId>#<fieldName>` | `STATUS#PENDING_CONFIRMATION` / `TENANT#<tenantId>#<createdAt>` | — | **Fila de revisão humana (FR-043), a query mais operacionalmente crítica além do reminder scanner** |
| NotificationAttempt | `TENANT#<tenantId>` | `ATTEMPT#<attemptId>` | `INTENT#<intentId>` / `ATTEMPT#<attemptId>` | — | Tentativas de um intent |
| WebhookInbox | `PROVIDER#<provider>#<accountId>` | `EVENT#<providerEventId>` | — | — | Chave primária já é a chave de idempotência composta |
| AuditEvent | `TENANT#<tenantId>` | `AUDIT#<createdAt>#<eventId>` | `ENTITY#<entityType>#<entityId>` / `AUDIT#<createdAt>` | — | Trilha de auditoria de uma entidade específica |

**Nota de design**: `TENANT#<tenantId>` como PK principal em quase toda entidade garante que testes de isolamento multi-tenant (SCALE-004) sejam estruturalmente simples de verificar — nenhuma query legítima nunca cruza partições de tenant.

## Idempotência (mapeamento explícito para NFR-002)
| Operação | Chave de idempotência |
|---|---|
| Materialização de ReminderOccurrence | hash(`itemId`, `triggerOffset`, `dueAtUtc`) |
| Disparo de notificação | `reminderOccurrenceId` + `channel` |
| Upload de documento | `uploadSlotId` (1:1 com URL presigned, decisão do Red Team) |
| Webhook recebido | `provider + tenantOrAccount + providerEventId` |
| Renovação de item | `itemId` + `periodEndDate` (evita renovar o mesmo ciclo duas vezes) |

## Versionamento e concorrência otimista (decisão do Red Team, formalizada aqui)
Toda entidade mutável tem `version` (inteiro, incrementado a cada escrita). Escritas críticas usam `ConditionExpression: version = :expectedVersion`. Leitura-antes-de-escrita em qualquer worker assíncrono (Reminder Dispatcher, Step Function de extração) sempre carrega a versão atual antes de decidir a ação.

## Retenção e soft delete (PRIV-003/004/006)
- `ExpirationItem`, `Document`: soft delete (`status=DELETED`, `deletedAt` preenchido) — exclusão física em job assíncrono após o prazo de PRIV-003 (30 dias) e propagação a backups conforme PRIV-006 (90 dias).
- `AuditEvent`: nunca excluído por ação do usuário — apenas por política de retenção agregada (a definir em `privacy-lgpd.md`).
- `WebhookInbox`: TTL nativo do DynamoDB, sem soft delete (dado efêmero por natureza).

## Lacunas conscientes (para debate com o Codex)
1. GSI de `ExpirationItem` por `DUEDATE` pode ter hot partition se muitos itens vencem no mesmo dia (mesmo problema do Reminder Scanner, mas no domínio de Items, não Occurrences) — não resolvido aqui.
2. Não modelei explicitamente `Category` como entidade própria (tratei como atributo livre em `ExpirationItem`) — pode ser insuficiente se o produto quiser categorias padronizadas/multi-idioma no futuro.
3. `ExtractedField` por campo individual (um item por campo) vs. um documento JSON único por extração — escolhi por-campo para permitir status granular (`PENDING_CONFIRMATION` por campo, não por documento inteiro), mas isso multiplica o número de itens DynamoDB por documento.
