# WhatsApp Operacional (Roadmap P0.3) — Estado Final Consolidado

**Status**: `APPROVED` (design) via protocolo Claude↔Codex, 3 rodadas. Checklist v3 estável
(Claude 9,3/Codex 9,3 na régua), design final Claude 9,2/Codex 9,1 — ambos ≥9,0, sem
arredondar. Ver `ADR-0012-whatsapp-cloud-api-channel.md` e `decisions-log.md` D-197.
Fornecedor (Meta Cloud API direta, não BSP) decidido diretamente por Marcelo, fora do
protocolo (`AGENTS.md` §1) — tudo abaixo decorre dessa escolha.

Histórico completo do debate: `round1-claude-proposal.md` (proposta + achados de escopo real +
pesquisa externa `SIM`), `round2-claude-revision.md` (resposta aos 6 bloqueantes da Rodada 1 —
webhook inbox, contrato SQS/ADR-0008, quota, opt-in, correlação, secrets), `round3-claude-
revision.md` (correção dos 2 bloqueantes técnicos reais da Rodada 2 — chave física da quota,
webhook inbox tenantless). Cada rodada tem a crítica do Codex correspondente inline.

## Decisões finais (D-1 a D-10, forma pós-Rodada 3)

- **D-1**: `NotificationChannel`/`NotificationAttempt.channel`/`.provider` alargam de literal
  para união (`"EMAIL"|"WHATSAPP"`, `"SES"|"META_CLOUD_API"`) — sem migração de dado, linhas
  existentes inalteradas.
- **D-2**: `WhatsAppProviderAdapter` — mesma forma de porta de `EmailProviderAdapter`
  (`send`→`SendResult`/`SendError{kind: CONCLUSIVE_RETRYABLE|CONCLUSIVE_TERMINAL|AMBIGUOUS}`).
  Mapeamento exato dos códigos de erro reais da Cloud API fica para a fatia de implementação.
- **D-3**: Templates são catálogo pré-provisionado (Meta Business Manager, fora do repo),
  referenciado por nome+idioma — nunca criado/submetido via API nesta fatia.
- **D-4**: Toda mensagem é categoria `Utility` (nunca `Marketing`) — o produto é inerentemente
  business-initiated, sem janela de serviço aberta por padrão.
- **D-5**: Opt-in é a entidade `WhatsAppOptIn` (`PK=TENANT#<t>#USER#<userId>`,
  `SK=WHATSAPP_OPTIN#<phoneE164>` — a chave inclui o telefone), timestamp+source+tenant
  registrados; leitura sempre contra o telefone ATUAL de `GlobalUser` — troca de número
  invalida o consentimento anterior por construção, sem invalidação explícita necessária.
- **D-6**: `GlobalUser.phoneE164?: string` novo, validado no formato antes de persistir.
- **D-7**: `WebhookInbox` account-scoped: `PK=WEBHOOK#WHATSAPP#<wabaId>`,
  `SK=EVENT#<wamid>#<statusType>` — gravado (create-once, `putIfAbsent`) IMEDIATAMENTE após
  verificação `X-Hub-Signature-256` válida, ANTES de qualquer tentativa de correlação por
  `biz_opaque_callback_data`; se a correlação falhar, a MESMA linha já criada é atualizada para
  `UNMATCHED` (reaproveita `markInboxUnmatched`, já existe). GSI8 transient-purge idêntico ao
  já usado para `WebhookInbox` de SES.
- **D-8**: Quota de destinatário único em janela móvel de 24h — item físico NOVO na tabela
  BASE (não GSI): `PK=WHATSAPP#PORTFOLIO`, `SK=SENT#<timestampIso>#<phoneE164>` (tempo
  primeiro — torna a Query por range de tempo válida), TTL 25h. Política IAM dedicada por
  `dynamodb:LeadingKeys=["WHATSAPP#PORTFOLIO"]`, só no `WhatsAppDeliveryWorker`. Fail-closed em
  falha de leitura. Risco de hot-partition nomeado, gatilho de sharding por hora se o tier
  subir para 10.000+ E o volume real se aproximar do teto de throughput — não construído agora.
- **D-9**: Fila+DLQ dedicada `whatsapp-deliver-queue` (`maxReceiveCount=5`),
  `SQS_NOTIFICATION_WHATSAPP_V1`, schema `notification.whatsapp-deliver.v1` (mesma forma de
  `notification-email-deliver.v1.json`), `buildWhatsAppOutboxRecord` análogo a
  `buildEmailOutboxRecord` — nunca reaproveita a fila de e-mail (ADR-0008).
- **D-10**: Secrets via AWS Secrets Manager (access token, app secret, phone number ID, WABA
  ID, verify_token) — primeiro secret de vendor externo do repo, IAM escopado só aos 2 Lambdas
  que precisam. Kill switch de 2 flags em ordem obrigatória (`WHATSAPP` + um segundo flag de
  "delivery worker habilitado"), mesmo mecanismo de D-193 slice 8.

## Pendências nomeadas, não bloqueantes para o design (ficam para a implementação)

1. Mapeamento exato dos códigos de erro da Cloud API para a forma 3-vias de `SendError`.
2. Confirmar `biz_opaque_callback_data` contra um payload de sandbox real ANTES do primeiro
   envio de produção (gate de implementação, formalizado na Rodada 3).
3. Emenda de `cost-model.md` (D-024) refletindo a resolução de `UNK-003` (fornecedor direto) e
   o novo regime de cobrança 2026 — nenhuma fonte oficial da Meta com granularidade de preço
   por categoria/país foi encontrada citável por URL estável (limitação de pesquisa registrada
   explicitamente na Rodada 1/2, não bloqueia o design técnico).
4. **Achado incidental real, fora de escopo desta decisão**: `ses-callback-workflow.ts`'s
   caminho `UNMATCHED` (tags ausentes) retorna ANTES de gravar `WebhookInbox` — inconsistente
   com o próprio cenário 15 de `architecture-fase3-consolidada.md` ("todo webhook grava inbox
   antes de processar"). SES já está em produção; correção fica como item nível 3-4 separado,
   não feita aqui (mesma disciplina D-177→D-178).
5. Alocação de nome de GSI: esta decisão **não cria GSI novo** (quota é tabela base) — a
   pendência de nomeação GSI10 vs. D-194 Fatia 4 registrada na Rodada 2 fica sem efeito
   (resolvida ao descobrir que a forma correta não precisa de índice).

## Próxima ação real

Implementação por fatias, mesmo padrão de D-163 (`DocumentFile`)/D-191
(`RequirementTemplate`): fatia 1 (widening de tipo D-1 + entidades novas D-5/D-6, sem HTTP
exposto); fatia 2 (`WhatsAppProviderAdapter` D-2 + `WhatsAppDeliveryWorker` + fila/schema
D-9); fatia 3 (webhook handler D-7 + Secrets Manager D-10); fatia 4 (quota D-8 + IAM
dedicada); fatia 5 (router wiring + kill switch + RBAC + terraform completo). Nenhuma fatia
exige nova rodada de protocolo salvo achado real durante a implementação.
