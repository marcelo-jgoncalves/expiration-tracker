# Rodada 3 — Revisão final Claude + fechamento Codex

## Revisão Claude (aceita os 2 bloqueantes restantes da Rodada 2)

1. **Link presignado → substituído por download autenticado.** O e-mail NUNCA contém um link S3
   direto — contém um link para uma rota HTTP autenticada nova (`GET /reports/subscriptions/
   {subscriptionId}/runs/{runId}/download`, RBAC igual às rotas de D-195), que gera um presign
   CURTO (5 min) SOB DEMANDA no momento do clique, após validar a sessão. Fecha dois problemas:
   (a) nenhum TTL de e-mail para gerenciar — o link do e-mail é permanente até a retenção do
   objeto expirar (30 dias), só o presign interno é efêmero; (b) fecha o risco de "bearer token
   encaminhável" (ponto 5 da Rodada 1) — quem recebe o e-mail precisa estar autenticado E ser
   elegível para baixar, não basta ter o link.
2. **Idempotência pré-SES.** Novo `ReportDeliveryAttempt` (mesma máquina de estados de
   `NotificationAttempt`: `PREPARED`→`SUBMITTING` com `leaseExpiresAt` claim transacional ANTES de
   qualquer chamada externa →`ACCEPTED`/`FAILED_RETRYABLE`/`FAILED_TERMINAL`/`UNKNOWN`). Worker:
   (a) claim `PREPARED`→`SUBMITTING` com lease; (b) gera CSVs + grava em S3; (c) envia e-mail
   (corpo com o link autenticado, nunca um presign); (d) resolve o attempt conforme resultado —
   mesmo `nextStatusAfterSendAttempt` já usado.
3. **Revalidação de destinatário no envio**: `ReportSubscription.recipientUserIds: string[]`
   (userIds, nunca e-mails soltos). No envio, resolver novo (forma de
   `DynamoDbNotificationRecipientResolver`) revalida fresco `Membership ACTIVE`+`GlobalUser.
   identityStatus ACTIVE` para CADA `recipientUserId` — um membro removido depois da criação e
   antes do disparo é excluído silenciosamente daquele envio (nunca bloqueia os demais), mesma
   postura de D-200/D-201.
4. **Wiring do destino de outbox**: registrado como escopo de implementação completo (relay,
   sweeper, env vars, schema, testes), não uma objeção de design.

## Crítica final Codex (Rodada 3)

Uma objeção menor e corrigível:

- **Conflito de RBAC**: "download igual D-195" (`ADMIN_ROLES`/`item:export`,
  `reports-service.ts:123`, `reports-service.test.ts:159` prova `MEMBER` negado) conflita com
  `recipientUserIds` podendo incluir qualquer `Membership ACTIVE`. Se a assinatura pode mandar
  para MEMBER/VIEWER ativos, eles receberiam um e-mail com link que não conseguem baixar.
  **Correção**: a rota de download autoriza `ADMIN_ROLES` OU o próprio `principal.userId` constar
  como destinatário elegível daquele `ReportDeliveryAttempt`/run, sempre revalidando `Membership
  ACTIVE + GlobalUser ACTIVE` no clique.
- **Precisão de nomenclatura**: não copiar literalmente o estado `SENT` — o pipeline real termina
  o submit em `ACCEPTED` (`email-delivery.ts:47`), não `SENT`. `ReportDeliveryAttempt` deve usar o
  vocabulário real (`PREPARED`/`SUBMITTING`/`ACCEPTED`/`FAILED_RETRYABLE`/`FAILED_TERMINAL`/
  `UNKNOWN`). Modelo deixa claro: `ReportSubscriptionRun` por execução agendada,
  `ReportDeliveryAttempt` por destinatário — um destinatário inválido/falho nunca contamina os
  demais.

Ambos os refinamentos aceitos e incorporados na decisão final (ver `estado-final-consolidado.md`).

**Nota cega final Codex: 9,1/10.**
**Nota cega final Claude: 9,2/10** — os 3 achados físicos/segurança reais das 3 rodadas foram
verificados por leitura direta de código e fechados com citações precisas; o desenho final reusa
integralmente 4 padrões já `APPROVED` (GSI8 discovery, outbox transacional, SQS+DLQ, máquina de
estados de `NotificationAttempt`) em vez de inventar mecanismo novo.

**Ambos ≥9,0, sem arredondar. FECHADO — DESIGN APROVADO.**
