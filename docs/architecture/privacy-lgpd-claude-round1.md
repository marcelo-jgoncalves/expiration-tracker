# Privacy / LGPD — Claude, Rodada 1 (Proposta Independente)

Status: proposta independente do Claude, antes de ver a do Codex.
Base: `docs/architecture/requirements.md` (PRIV-001..008), `docs/architecture/data-model.md`, `docs/architecture/disaster-recovery.md` (matriz `retentionClass`/`legalHold` a preencher aqui). Seção 35 do prompt mestre. **Não substitui parecer jurídico** (PRIV-008, repetido aqui como princípio).

## 1. Mapa de dados pessoais
| Dado pessoal | Entidade (`data-model.md`) | Finalidade | Base legal (LGPD art. 7º) — hipótese técnica, não jurídica |
|---|---|---|---|
| Nome, e-mail | `User` | Autenticação, comunicação | Execução de contrato (art. 7º V) |
| Timezone, preferências de notificação | `User` | Personalização de alertas | Execução de contrato |
| Telefone/chatId (Telegram/WhatsApp) | `Channel` | Entrega de notificação | Execução de contrato + consentimento específico do canal (opt-in, FR-025) |
| Nome/dados de responsável em item | `ExpirationItem.responsibleUserId` | Atribuição de responsabilidade | Execução de contrato |
| Conteúdo de documentos anexados (pode incluir dados de terceiros, ex.: procuração com nome de outra pessoa) | `Document`, `ExtractedField` | Registro do vencimento, extração automatizada | Execução de contrato (do titular da conta) — **dados de terceiros no documento são a hipótese jurídica mais delicada**, sinalizado para parecer jurídico (PRIV-008) |
| Trilha de ações do usuário | `AuditEvent` | Segurança, auditoria, obrigação legal | Legítimo interesse (art. 7º IX) + cumprimento de obrigação legal quando aplicável |
| IP/user-agent em logs de acesso | (fora do data-model.md — infraestrutura) | Segurança, detecção de abuso | Legítimo interesse |

## 2. Minimização e coleta
Consistente com PRIV-002 (já em `requirements.md`): campos obrigatórios mínimos em `ExpirationItem` são nome + data de vencimento (FR-010); todo o resto é opcional. Nenhum dado pessoal adicional é coletado além do necessário para autenticação (`User`) e entrega de notificação (`Channel`).

## 3. Direitos do titular — implementação técnica (PRIV-003)
| Direito | Mecanismo técnico |
|---|---|
| Confirmação de tratamento (≤15 dias, LGPD art. 19) | Query simples por `tenantId` retornando existência de registros — trivial, não é o gargalo |
| Exportação (portabilidade, ≤30 dias, PRIV-003) | Job assíncrono que varre todas as entidades por `tenantId` (`data-model.md` já garante que toda entidade tem essa chave) e gera export estruturado (JSON) via S3 presigned URL de download temporário |
| Exclusão (≤30 dias, PRIV-003) | Soft delete imediato (`deletedAt`, já no data model) + job de purga física após o prazo, cobrindo DynamoDB, S3 (ambos buckets) e índices — reaproveita o mecanismo de reparo seletivo desenhado em `disaster-recovery.md` (varredura por `tenantId`) |

## 4. Retenção — preenchendo a matriz `retentionClass`/`legalHold` (dependência criada em `disaster-recovery.md`)
| `retentionClass` | Tipos de dado | Prazo padrão | `legalHold` aplicável? |
|---|---|---|---|
| `TRANSACTIONAL` | User, ExpirationItem, ReminderOccurrence, NotificationIntent/Attempt | Até exclusão pelo titular ou encerramento de conta + 90 dias (propagação a backup, PRIV-006) | Não, salvo obrigação legal específica não identificada |
| `DOCUMENT_STANDARD` | Documentos sem valor probatório evidente (a maioria) | Mesma regra de `TRANSACTIONAL` | Não |
| `DOCUMENT_LEGAL` | Documentos com valor legal/probatório declarado pelo usuário ou inferido por categoria (ex.: certidões, contratos) | A definir por categoria — **requer parecer jurídico (PRIV-008)**, não decidido tecnicamente aqui | Possível, condicionado a requisito legal confirmado (consistente com `disaster-recovery.md`: "ausência de requisito confirmado implica política padrão") |
| `AUDIT` | AuditEvent | Retenção agregada, não excluível por ação do usuário individual | Não aplicável (não é dado de um titular isolado, é trilha do sistema) |

## 5. Subprocessadores (PRIV-005)
AWS (infraestrutura), provedor de e-mail (SES — próprio AWS), Telegram (Bot API), WhatsApp BSP (a escolher, UNK-003), provedor de modelo LLM (Bedrock — dados do documento podem passar por inferência; **transferência internacional a confirmar conforme região do modelo Bedrock usado**, PRIV-007).

## 6. Transferência internacional (PRIV-007)
Bedrock e Textract podem processar dados fora do Brasil dependendo da região AWS escolhida (ainda não decidida — UNK-007 novo, ver abaixo). Sinalizado explicitamente como ponto que requer confirmação de região + validação jurídica, não decisão técnica unilateral.

## Lacunas conscientes (para debate com o Codex)
1. Prazo de retenção de `DOCUMENT_LEGAL` não é decidido tecnicamente — correto ficar pendente de parecer jurídico, mas o mecanismo técnico (campo `legalHold`, já em `data-model.md`) precisa suportar retenção indefinida sem quebrar o job de purga automática do restante.
2. Não defini processo de consentimento explícito para dados de terceiros em documentos anexados (ex.: procuração com nome de outra pessoa) — situação real do produto, mas fora do controle técnico direto (o titular do documento upload, não o terceiro citado nele, interage com o sistema).
3. Região AWS para Bedrock/Textract ainda não escolhida — a decisão de arquitetura consolidada não fixou região, e isso tem implicação direta de LGPD (transferência internacional).
