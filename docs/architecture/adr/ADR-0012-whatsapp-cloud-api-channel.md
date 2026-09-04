# ADR-0012 — Canal WhatsApp: Meta Cloud API direta + mecanismos de suporte

**Status**: Aceito | **Data**: 2026-09-04 | **Type**: Type 1 (nível 6 — novo terceiro com acesso a PII) | **Requisitos**: Roadmap P0.3, FR-030..034 (ADR-0008)

## Contexto

Roadmap P0.3 pede WhatsApp operacional. Marcelo decidiu o fornecedor (`AGENTS.md` §1, decisão
de produto/custo recorrente reservada a ele): Meta Cloud API direta, não um BSP (Twilio/
360dialog). Esta ADR cobre tudo que decorre dessa escolha — protocolo Claude↔Codex completo,
`docs/architecture/reviews/whatsapp-channel-scoping/` (3 rodadas, régua reconciliada na
Rodada 2/3, Claude 9,2/10 · Codex 9,1/10, ambos ≥9,0 contra checklist v3 estável 9,3/10).

## Options Considered

1. **Widen `NotificationChannel`/`NotificationAttempt` para o canal WhatsApp, reusando o state
   machine de `NotificationAttempt`/ADR-0008 onde a forma é igual, com mecanismos NOVOS onde o
   provedor diverge de verdade (webhook inbox account-scoped, fila/schema SQS dedicados, quota
   por destinatário único)** (escolhida).
2. Tratar WhatsApp como cópia 1:1 do adapter de e-mail (SES) — rejeitada (Rodada 1-2 do Codex):
   a correlação de webhook, a fila/contrato SQS e a quota de destinatário único da Meta não têm
   equivalente direto em SES; copiar cegamente a forma quebraria a quota real e o replay de
   webhook.
3. Adiar o canal até haver um BSP intermediário simplificando o contrato — rejeitada: Marcelo
   já decidiu ir direto; o ganho de simplicidade de um BSP não compensa o markup e a decisão de
   produto já está fechada.

## Evidence

`docs/architecture/reviews/whatsapp-channel-scoping/` (round1-claude-proposal.md,
round2-claude-revision.md, round3-claude-revision.md — cada uma com a crítica do Codex
correspondente registrada inline); ADR-0008 (contrato SQS por canal, já aprovado);
`architecture-fase3-consolidada.md` cenário 15 (WebhookInbox, chave "provider +
tenant/account + providerEventId"); pesquisa externa (Meta for Developers — Messaging Limits,
Webhooks getting-started, Get opt-in — todas consultadas 2026-09-04, fontes com data em
`round1-claude-proposal.md`).

## Correctness Impact

- Toda mensagem business-initiated usa template pré-aprovado (categoria `Utility`), nunca
  free-form — o produto não tem janela de serviço aberta por padrão (usuário não inicia a
  conversa antes do lembrete).
- Quota de destinatário único em janela móvel de 24h é medida contra uma partição dedicada
  (`WHATSAPP#PORTFOLIO`, tabela base, não GSI), fail-closed em falha de leitura — nunca assume
  "abaixo do limite" por padrão.
- `WebhookInbox` é gravado com chave account-scoped (`WEBHOOK#WHATSAPP#<wabaId>`) IMEDIATAMENTE
  após verificação de assinatura válida, antes de qualquer tentativa de correlação por tenant —
  fecha um caso (webhook assinado mas não-correlacionável) que o precedente de SES
  (`ses-callback-workflow.ts`) na verdade não cobre hoje (achado incidental da Rodada 3,
  registrado como pendência separada, não corrigido retroativamente nesta ADR).
- Opt-in é um registro (`WhatsAppOptIn`) vinculado ao valor exato do telefone E.164 consentido —
  uma troca de número invalida o consentimento anterior por construção.

## Extensibility Impact

Mesmo contrato de adapter de ADR-0008 (`WhatsAppProviderAdapter` espelha `EmailProviderAdapter`
— `send`/`SendResult`/`SendError{kind}` 3-vias CONCLUSIVE_RETRYABLE/CONCLUSIVE_TERMINAL/
AMBIGUOUS); fila/schema dedicados (`SQS_NOTIFICATION_WHATSAPP_V1`,
`notification.whatsapp-deliver.v1`) mantêm o isolamento de falha entre canais que ADR-0008 já
exige — trocar de Meta Cloud API para outro provedor no futuro (BSP, ou API alternativa) toca
só o adapter, nunca o domínio.

## Final Decision

Conforme `docs/architecture/reviews/whatsapp-channel-scoping/round3-claude-revision.md` —
design completo, `APPROVED`. Implementação real (fatias) fica para sessão(ões) dedicada(s)
futura(s), mesmo padrão de D-121/D-127/D-179/D-191/D-194 antes delas.

## References

`docs/architecture/reviews/whatsapp-channel-scoping/` (3 rodadas completas),
`docs/architecture/decisions-log.md` D-197, ADR-0008, `architecture-fase3-consolidada.md`
cenário 15, `docs/architecture/cost-model.md` (D-024 — pendência de emenda registrada, não
feita nesta ADR).
