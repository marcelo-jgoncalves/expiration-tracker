# Domain Model + Data Model — Expiration Tracker (Consolidado)

Status: **APPROVED** (Design Maturity) — Claude ~9.05 / Codex 9.1, ambos ≥9.0, nenhum gate violado.

## Resultado da avaliação
- **Rodada 1 (nota inicial)**: Codex 8.4 (NOT APPROVED) — erro técnico real identificado: mitigação de hot partition do GSI1 propunha shard na SK, mas a partição física é determinada pela PK.
- **Rodada 2**: Claude corrigiu o erro (shard entra na PK, `GSI1PK=...#SHARD#NN`, com fan-out de leitura), adicionou `categoryNormalized`, adicionou entidade `ExtractionRun` como item-pai (corrigindo a chave de idempotência de `ExtractedField`), e adicionou a entidade `TenantQuota` (lacuna de rastreabilidade a G6/COST-005 identificada pelo próprio Claude). Codex reavaliou: **9.1** (exato). Claude: **~9.05**. **STATUS: APPROVED.**
Base: `docs/architecture/data-model-claude-round1.md`, `docs/architecture/data-model-codex-round1.md`, `docs/architecture/requirements.md`, `docs/architecture/architecture-fase3-consolidada.md`.

## Histórico do debate
- **Rodada 1** — propostas independentes. Convergência muito forte em entidades, idempotência, versionamento otimista e retenção. A proposta do Codex era estruturalmente mais refinada em 5 pontos, adotados aqui: (1) convenção de PK que co-localiza `ReminderOccurrence`/`Document` sob a partição do `ExpirationItem` pai (permite buscar item + suas ocorrências/documentos numa única query, em vez de exigir GSI); (2) `UploadSlot` como entidade de primeira classe, não atributo embutido; (3) `WebhookInbox` com PK `provider+account` e SK `providerEventId` (permite listar todos os eventos de um provider/conta, não só checar existência); (4) GSI consolidado de retenção/reconciliação (GSI6) cobrindo purge, upload slots vencidos e jobs pendentes num único índice em vez de vários; (5) distinção explícita entre leitura fortemente consistente (PK base, para autorização/edição/pré-envio) e eventualmente consistente (GSIs, aceitável para dashboards).
- **Rodada 2** — pendente: 3 pontos abertos pelo Claude na proposta original, ainda não reagidos pelo Codex (ver seção "Pontos abertos" abaixo).

---

## 1. Princípios e agregados
`tenantId` obrigatório em toda chave DynamoDB, idempotency key, objeto S3, evento e mensagem (SCALE-004). MVP: `tenantId=userId`; futuro: `tenantId=organizationId`. Identidade autenticável global no IdP (Cognito); `User` representa o perfil dentro do tenant, com `identitySubject` desacoplado do `sub` do Cognito (decisão §4 da arquitetura).

Agregados: **Tenant/Access** (Organization, User, Membership) · **Expiration** (ExpirationItem raiz; ReminderPolicy, ReminderOccurrence, Document, ExtractedField referenciam item e sua versão) · **Notification** (NotificationIntent como efeito lógico único; NotificationAttempt por interação) · **Integration** (Channel, Provider, WebhookInbox, UploadSlot) · **Compliance** (AuditEvent, append-only).

Convenção física: `PK = TENANT#<tenantId>#<aggregate>`, `SK = <entityType>#<id>[#...]`. IDs UUIDv7/ULID (ordenáveis por tempo, evitam hot-key sequencial de auto-incremento). Datas ISO-8601 UTC; timezones IANA. Atributos comuns a toda entidade: `entityType`, `schemaVersion`, `createdAt`, `updatedAt`, `version`, `deletedAt?`, `retentionClass`, `purgeAfter?`.

## 2. Entidades e armazenamento
| Entidade | Atributos principais | PK / SK |
|---|---|---|
| User | userId, identitySubject, emailNormalized, name, timezone, locale, preferências de notificação, status | `TENANT#t#USER#u` / `PROFILE` |
| Organization *(futuro, FUT-001)* | organizationId, name, timezone, quiet hours padrão, status, plano/entitlements | `TENANT#t#ORG#o` / `META` |
| Membership *(futuro, FUT-001)* | membershipId, userId, organizationId, role, permissões, status, joinedAt | `TENANT#t#ORG#o` / `MEMBER#u` |
| ExpirationItem | itemId, nome, categoria, descrição, dueDate, issueDate, periodicidade, emissor, número, responsável, tags, prioridade, status (ACTIVE/ARCHIVED/RENEWED/DELETED), renewedFromId?, version | `TENANT#t#ITEM#i` / `META` |
| ReminderPolicy | policyId, scope (TEMPLATE/ITEM), itemId?, nome, gatilhos relativos, recorrência, timezone, quiet hours, canais, opt-outs, enabled, version | `TENANT#t#POLICY#p` / `META` |
| ReminderOccurrence | occurrenceId, itemId, policyId, triggerId, scheduledAtUtc, timezone IANA, regra original, itemVersion, policyVersion, shard, status (SCHEDULED/CLAIMED/CANCELLED/TRIGGERED/ACKED), claimedAt?, version | `TENANT#t#ITEM#i` / `OCC#<scheduledAt>#<occurrenceId>` |
| Document | documentId, itemId, objectKey, bucket/versão S3, nome, MIME, tamanho, hash, estado (PENDING_UPLOAD/SCANNING/CLEAN/REJECTED/UNSUPPORTED/TIMEOUT/DELETED — decisão §7), uploadSlotId, extractionRunId?, version | `TENANT#t#ITEM#i` / `DOC#d` |
| ExtractedField | documentId, fieldName, valor proposto/final, tipo, origem (DETERMINISTIC/AI/MANUAL), confidence, estado (PENDING_CONFIRMATION/CONFIRMED/REJECTED — gate G4/FR-043), extractor/prompt/model/schema versions, runId, ator e valores de correção (FR-044) | `TENANT#t#DOC#d` / `FIELD#<fieldName>#<runId>` |
| NotificationIntent | intentId, occurrenceId, itemId, itemVersion, destinatário lógico, canal, payload versionado, status (PENDING/CANCELLED/DISPATCHED/CORRECTIVE — FR-014), supersedesIntentId?, correlation ID | `TENANT#t#INTENT#n` / `META` |
| NotificationAttempt | attemptId, intentId, canal, provider, número da tentativa/redrive, status (QUEUED/SENT/DELIVERED/FAILED/UNKNOWN), providerMessageId?, erro normalizado, timestamps | `TENANT#t#INTENT#n` / `ATTEMPT#<number>#a` |
| Channel | channelId, tipo (EMAIL/TELEGRAM/WHATSAPP/...), configuração não secreta, capabilities, limites, opt-in/status, adapter contract version (FR-033) | `TENANT#t#CHANNEL#c` / `META` |
| Provider | providerId, tipo/canal, account reference, secret reference (Secrets Manager, nunca segredo em claro — SEC-006), webhook configuration, rate-limit policy, status (reflete kill switch), adapter version | `TENANT#t#PROVIDER#p` / `META` |
| WebhookInbox | payload, hash, assinatura validada, timestamp/nonce, estado, TTL | `TENANT#t#WEBHOOK#<provider>#<account>` / `EVENT#<providerEventId>` |
| UploadSlot | objectKey exato, limite, status (PENDING/CONFIRMED/REFUNDED), expiresAt | `TENANT#t#UPLOAD` / `SLOT#<id>` |
| AuditEvent | auditEventId, tipo, ator, ação, recurso, itemId?, versões anterior/nova, mudanças redigidas, timestamp, correlation/causation IDs — **append-only, sem update/delete normal** | `TENANT#t#AUDIT#<yyyyMM>` / `EVT#<timestamp>#<id>` |

## 3. GSIs (todos com chave iniciando por `TENANT#tenantId`)
- **GSI1 — vencimentos/dashboard**: `PK=TENANT#t#ITEMSTATUS#<status>`, `SK=DUE#<dueDate>#ITEM#i`. Lista próximos/vencidos/arquivados.
- **GSI2 — responsável/categoria**: `PK=TENANT#t#ASSIGNEE#u` ou `TENANT#t#CATEGORY#c`, `SK=DUE#<dueDate>#ITEM#i`. Índices separados se ambos forem padrões frequentes de acesso.
- **GSI3 — scheduler**: `PK=TENANT#t#DUE#yyyyMMddHHmm#NN`, `SK=<scheduledAtUtc>#OCC#id`. 4 shards/minuto inicial (decisão Fase 3 Rodada 4); produtor condiciona por status/versão.
- **GSI4 — membership por usuário**: `PK=TENANT#t#USER#u`, `SK=ORG#o#MEMBERSHIP#m`.
- **GSI5 — provider callback**: `PK=TENANT#t#PROVIDER#p`, `SK=MSG#<providerMessageId>`. Localiza a tentativa correta a partir de webhook de delivery/bounce.
- **GSI6 — retenção/reconciliação**: `PK=TENANT#t#PURGE#yyyyMM` ou `...#WORKSTATE#<status>`, `SK=<purgeAfter/expiresAt>#<type>#<id>`. Suporta purge, upload slots vencidos, inbox/outbox e jobs pendentes num índice único. TTL é limpeza auxiliar, nunca gatilho operacional (evita depender de timing assíncrono do TTL para correção — mesma lição do reconciliador de upload da Fase 3 Rodada 6).

## 4. Idempotência
Chaves materializadas com `PutItem attribute_not_exists(PK)`:
| Operação | Chave de idempotência |
|---|---|
| Materialização de ReminderOccurrence | `tenantId\|itemId\|itemVersion\|policyId\|policyVersion\|triggerId\|scheduledAtUtc` |
| NotificationIntent | `tenantId\|occurrenceId\|channel\|recipient\|intentKind` |
| NotificationAttempt | `tenantId\|intentId\|provider\|attemptNumber\|redriveGeneration` |
| Extração (ExtractedField) | `tenantId\|documentId\|documentVersion\|pipelineVersion` |
| Renovação de item | `tenantId\|sourceItemId\|sourceVersion\|cycle` |
| Webhook recebido | PK+SK do `WebhookInbox` já é a chave de idempotência |
| Upload | `UploadSlot` reservado atomicamente via `TransactWriteItems` no momento da geração da URL presigned (decisão Fase 3 Rodada 6) |

## 5. Concorrência, exclusão e consistência
Toda entidade mutável usa `version`; updates exigem `ConditionExpression: version=:expected` e incrementam atomicamente (optimistic concurrency control, decisão Fase 3 Rodada 6). Alterar vencimento grava o item, cancela ocorrências antigas e cria o evento de outbox crítico (`ItemDueDateChanged`) numa única transação (`TransactWriteItems`) — fecha a corrida identificada no Red Team cenário 13. Aplicação de resultado de extração verifica simultaneamente as versões de `Document` e `ExpirationItem`; divergência ou tombstone descarta o resultado (Red Team cenário 14).

Soft delete: `deletedAt` + status + nova versão; leituras normais excluem tombstones. Exclusão LGPD: workflow auditável, atendimento em até 30 dias (PRIV-003), remoção de DynamoDB/S3/índices e propagação a backups em até 90 dias (PRIV-006). `purgeAfter` deriva da tabela de retenção por tipo de dado exigida por PRIV-004; retenção legal suspende purge com justificativa explícita registrada.

Leitura da PK base é fortemente consistente quando necessário (autorização, edição, pré-envio de notificação — a revalidação de versão do Red Team cenário 13 depende disso). GSIs são eventualmente consistentes: dashboards podem atrasar brevemente; nenhuma decisão crítica (cancelamento, disparo, aplicação de extração) depende exclusivamente de um GSI. Scheduler, inbox, upload e outbox toleram duplicação por condições/idempotência e são cobertos por reconciliação periódica (mesmo padrão em todos os casos).

## Governança do single-table (adicionado após revisão externa pós-aprovação)

Single-table design com 17 entidades e 6 GSIs é elegante hoje, mas é também o componente com maior risco de degradação silenciosa ao longo da vida do produto — cada novo padrão de acesso (novo relatório, nova tela, nova integração) tenta "aproveitar" um GSI existente de forma não prevista, e depois de alguns anos a tabela pode ficar difícil de raciocinar sem que nenhuma decisão individual pareça errada no momento em que foi tomada. Regra de processo, não de schema:

> **Nenhum novo access pattern entra em produção sem revisão explícita do modelo de dados** — mesmo que "caiba" tecnicamente num GSI existente. A revisão deve responder: este padrão pertence a um GSI já existente pelo motivo certo, ou está sendo espremido ali por conveniência? Se a resposta for a segunda, criar novo GSI (até o limite prático de ~20 por tabela) ou reconsiderar particionamento, nunca sobrecarregar um índice com um propósito que ele não foi desenhado para servir.

Isso não é uma decisão de arquitetura nova — é uma prática operacional a manter, com o mesmo peso de um requisito não-funcional, registrada aqui para não se perder na passagem do design para a implementação.

**GSI1 hot partition — correção de erro técnico real**: a mitigação original ("aplicar shard ao `GSI1SK`") estava errada — a partição física do DynamoDB é determinada pela **PK**, não pela SK; adicionar shard à SK não distribui carga nenhuma. Corrigido: se o volume por tenant/status justificar (critério quantitativo a extrair do capacity model, não decidido a priori), o shard entra na **PK**: `GSI1PK=TENANT#t#ITEMSTATUS#<status>#SHARD#<NN>`, exigindo fan-out de leitura (consultar todos os shards e mesclar) no lado da aplicação. **Para o MVP, não shardar é a decisão correta** — volume por tenant é baixo (`capacity-model.md`, Stage 0–2) e a complexidade de fan-out não se justifica ainda; gatilho de ativação: mesmo padrão de alarme de `ConsumedReadCapacity` já usado no GSI3 (scheduler, decisão Fase 3 Rodada 4).

**Category — normalização mínima adicionada**: `ExpirationItem` ganha o atributo `categoryNormalized` (lowercase, sem acentos/espaços extras) ao lado do `category` de exibição — evita fragmentação de filtro por variação de digitação, sem exigir uma entidade `Category` própria no MVP. Entidade própria permanece como evolução futura condicionada a necessidade real de taxonomia administrável/analytics consistente entre usuários.

**ExtractedField — modelo híbrido com ExtractionRun**: adicionada entidade `ExtractionRun` como item-pai da execução (estado agregado, `pipelineVersion`, `documentVersion`, timestamps de início/fim, resumo), com `ExtractedField` individuais referenciando `runId`. Corrige também a chave de idempotência, que antes correspondia à execução como um todo mas era declarada ambiguamente sobre múltiplos itens de campo: agora a idempotência da **execução** é `tenantId|documentId|documentVersion|pipelineVersion` (chave do `ExtractionRun`), e cada `ExtractedField` é unicamente identificado por `runId + fieldName` (não precisa de chave de idempotência própria, pois é sempre escrito uma vez por `ExtractionRun` já idempotente).

| Entidade adicionada | Atributos principais | PK / SK |
|---|---|---|
| ExtractionRun | runId, documentId, documentVersion, pipelineVersion, status (RUNNING/COMPLETED/FAILED/DISCARDED), startedAt, completedAt? | `TENANT#t#DOC#d` / `RUN#<runId>` |

`ExtractedField` passa a referenciar `runId` explicitamente (já implícito na SK `FIELD#<fieldName>#<runId>`, agora com o item-pai correspondente).

## Rastreabilidade a gates de abuso/custo (G6, COST-004/005) — entidade ausente adicionada

O token bucket de quota por tenant em HTTP API (decisão já aprovada em `architecture-fase3-consolidada.md` §2) e os limites de upload (COST-005) não tinham entidade de dados própria — implícitos, não modelados. Adicionado:

| Entidade adicionada | Atributos principais | PK / SK |
|---|---|---|
| TenantQuota | quotaType (API_REQUEST/UPLOAD_BYTES/UPLOAD_COUNT/AI_CALL), limite, janela (rolling window), contador atual, `resetAt`, `killSwitchOverride?` (referência ao estado do kill switch AppConfig quando aplicável) | `TENANT#t#QUOTA` / `TYPE#<quotaType>#<window>` |

Decrementado via `ConditionExpression` no mesmo padrão do `UploadSlot` (atômico, sem race condition entre requisições concorrentes do mesmo tenant). `killSwitchOverride` permite que o middleware de quota consulte um único lugar tanto o limite normal quanto um bloqueio de emergência, sem duas chamadas separadas. Esta entidade fecha a lacuna de rastreabilidade entre a decisão arquitetural de G6 (existe o mecanismo) e o modelo de dados (como o mecanismo é persistido e consultado).

## Pontos abertos remanescentes (não bloqueantes)
Nenhum — os 3 pontos da Rodada 1 foram fechados nesta Rodada 2. Itens de implementação (não de design) permanecem para fases posteriores: critério quantitativo exato de ativação do shard de GSI1 (depende de dados reais de uso por tenant, não disponíveis antes de produção).
