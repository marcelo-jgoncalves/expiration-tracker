# Privacy / LGPD — Expiration Tracker (Consolidado)

Status: **APPROVED** (Design Maturity) — Claude ~9.15 / Codex 9.1, ambos ≥9.0, nenhum gate violado. Consolidação usando a proposta do Codex como base (substancialmente mais detalhada: state machine de exclusão, 8 classes de retenção vs. 4 do Claude, bloqueio de região por IaC/SCP). **Não constitui parecer jurídico** — implica PRIV-001..008.
Base: `docs/architecture/requirements.md`, `docs/architecture/data-model.md`, `docs/architecture/disaster-recovery.md` (dependência da matriz `retentionClass`/`legalHold`, fechada aqui).

## 1. Mapa de dados pessoais
| Entidade/dado | Finalidade | Base legal hipotética |
|---|---|---|
| `User` — IdP, nome, e-mail, locale/timezone, preferências | autenticação, conta e comunicação do serviço | execução de contrato; legítimo interesse para segurança |
| `Organization`, `Membership` — vínculo, papel e permissões | colaboração e autorização B2B | execução de contrato; legítimo interesse do controlador |
| `ExpirationItem` — descrição, datas, emissor, número, responsável, tags | controlar vencimentos e renovações | execução de contrato |
| `Document`, S3, `ExtractedField`, `ExtractionRun` | armazenar documentos e extrair campos solicitados | execução de contrato; possível consentimento/obrigação legal conforme conteúdo |
| `ReminderPolicy`, `ReminderOccurrence` | agendar lembretes | execução de contrato |
| `Channel`, `NotificationIntent`, `NotificationAttempt` | entregar/comprovar notificações, tratar opt-out/falhas | execução de contrato; legítimo interesse operacional |
| `Provider`, `WebhookInbox`, `UploadSlot` | integrações, callbacks e uploads seguros | execução de contrato; legítimo interesse em segurança |
| `AuditEvent` — ator, ação, alterações redigidas, IP/UA se coletados | responsabilização, segurança, investigação | legítimo interesse; obrigação legal quando aplicável |
| `TenantQuota` e telemetria | conter abuso, custo e indisponibilidade | legítimo interesse |

Campos livres e documentos podem conter dados sensíveis, de crianças ou de terceiros. **Validar juridicamente**: papéis controlador/operador, bases por caso de uso, legítimo interesse, consentimento e tratamento de dados especiais.

## 2. Minimização (PRIV-002)
Só e-mail, timezone e identidade federada são necessários à conta; nome e demais campos são opcionais (FR-010). Documento bruto nunca vai a logs/eventos/notificações. OCR/IA recebe apenas páginas e campos necessários. Auditoria é redigida (dados sensíveis mascarados); payloads de webhook limitados; allowlist de MIME/tamanho; uploads incompletos expiram (`UploadSlot`, `data-model.md`). Segredos no Secrets Manager; índices não contêm conteúdo documental. KMS, isolamento por `tenantId`, menor privilégio, acesso administrativo auditado, IDs pseudônimos em métricas.

## 3. Direitos do titular (PRIV-003)
Endpoint autenticado + canal alternativo verificado criam `DataSubjectRequest` (tipo, escopo, verificação de identidade, prazos, decisões).
- **Confirmação** (≤15 dias, LGPD art. 19): categorias, finalidades, origem e compartilhamentos, de forma legível.
- **Exportação** (≤30 dias corridos): JSON/CSV, documentos originais, manifesto/checksums, URL presigned curta — exclui segredos internos e dados de terceiros sem autorização.
- **Exclusão**: state machine `RECEIVED → VERIFIED → DISCOVERED → HELD/PURGING → COMPLETED`. Inventário por `tenantId` em DynamoDB, S3, índices e provedores; bloqueio imediato de notificações/uso; tombstone transacional; purge idempotente via GSI6 (`data-model.md`); revogação de canais e links. Prorrogação de 30 dias exige justificativa e aviso registrados (PRIV-003).

`legalHold=true` exige fundamento, escopo, aprovador e `reviewAt` — retém apenas o mínimo necessário. Backups não são regravados: DynamoDB PITR expira em 35 dias; restores consultam denylist de exclusões e executam purge pós-restore; nenhuma cópia persiste por mais de 90 dias (PRIV-006, teto já fixado).

## 4. Matriz de retenção e DR (fecha a dependência criada em `disaster-recovery.md`)
`purgeAfter` deriva do evento indicado; `legalHold` apenas suspende o purge, nunca o cancela permanentemente sem revisão.

| `retentionClass` | Dados | Prazo padrão | Hold | Cross-region/Object Lock |
|---|---|---|---|---|
| `ACCOUNT_ACTIVE` | User, Organization, Membership, Channel | encerramento + 30 dias | litígio/obrigação confirmada | não |
| `CORE_USER_DATA` | itens, políticas, ocorrências | exclusão/encerramento + 30 dias | obrigação ligada ao item | não |
| `USER_DOCUMENT` | Document/S3, campos e runs | exclusão/encerramento + 30 dias; runs falhos/descartados: 7 dias | obrigação específica | não |
| `LEGAL_EVIDENCE` | documento expressamente classificado | prazo legal/contratual com data final obrigatória | sim; revisão periódica | somente após aprovação jurídica; KMS independente e Object Lock temporário |
| `DELIVERY_RECORD` | intents/attempts | criação + 180 dias | disputa/incidente | não |
| `TRANSIENT` | WebhookInbox, UploadSlot | 7 dias; slot incompleto: 24h | não | não |
| `SECURITY_AUDIT` | AuditEvent/logs redigidos | criação + 365 dias | incidente/litígio | backup regional |
| `QUOTA_TELEMETRY` | quotas/métricas identificáveis | fim da janela + 30 dias | não | não |

Nenhuma classe aceita prazo nulo, salvo conta ainda ativa. `LEGAL_EVIDENCE` sem fundamento e data final regride automaticamente para `USER_DOCUMENT` — nunca fica em limbo indefinido. **Validar juridicamente**: prazos, documentos probatórios, obrigações fiscais/consumeristas/contratuais.

## 5. Subprocessadores e transferência internacional (PRIV-005/007)
Inventário versionado: fornecedor, serviço, finalidade, dados, papel, região/país, suboperadores, retenção, exclusão, criptografia, incidentes, DPA. Escopo previsto: AWS (Cognito, DynamoDB, S3, Backup, KMS, Lambda, filas, logs), Bedrock, Textract, provedores efetivamente habilitados de e-mail/WhatsApp/Telegram.

**Região AWS é decisão bloqueante ainda não tomada** (lacuna herdada da Fase 3 — item aberto #7 do `architecture-fase3-consolidada.md`, escolha de modelo Bedrock). Bedrock/Textract podem processar fora do Brasil dependendo da região. Antes da produção: escolher regiões; bloquear chamadas fora da allowlist via IaC/SCP (Service Control Policy); confirmar residência e retenção de cada serviço/modelo; impedir uso de dados para treinamento de modelo pelo provedor; documentar países e mecanismo contratual de transferência; atualizar aviso de privacidade.

**Parecer jurídico obrigatório antes do lançamento comercial** sobre transferência internacional, garantias contratuais, subprocessadores, transparência, encarregado (DPO) e necessidade de RIPD (Relatório de Impacto à Proteção de Dados).
