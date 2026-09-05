# Rodada 2 — Revisão Claude + Crítica Codex

## Revisão Claude (aceita os 7 pontos da Rodada 1 integralmente)

1. **TTL do link**: revisado para 72 horas (dentro do teto SigV4). Retenção do OBJETO em S3
   continua 30 dias (dado, não link) — a proposta original confundiu os dois.
2. **GSI8, não GSI10**: verificado fisicamente — `infra/modules/dynamo-table/main.tf:248`
   (`local.gsi8_worker_types`) é um mapa fechado de 9 entradas, cada uma com sua própria policy
   `LeadingKeys` (linhas 337-362). Adicionar `report_subscription = "REPORT_SUBSCRIPTION"` é
   mecânico, idêntico ao que as 9 fatias de D-179/D-180-190 já fizeram.
3. **Idempotência/concorrência**: reusar outbox→SQS→worker já `APPROVED` (D-193/D-200/D-201) em
   vez de mecanismo novo. Fluxo: (a) Lambda agendado varre GSI8 `WORK#REPORT_SUBSCRIPTION`;
   `TransactWriteItems` único faz `Update` em `ReportSubscription` (avança `nextRunAt`,
   `ConditionCheck` de versão) + `Outbox` Put com destino novo `SQS_REPORT_SUBSCRIPTION_
   DELIVERY_V1` (novo valor no enum fechado `OutboxDestination`, `outbox.ts:21-51`, mesmo padrão
   de `SQS_REQUIREMENT_EVIDENCE_REFRESH_V1`, D-193); (b) worker SQS separado gera CSVs, grava em
   S3, presina, envia e-mail, grava `ReportSubscriptionRun` — retry/DLQ via `maxReceiveCount`
   nativo, nunca lógica própria.
4. **RBAC/RequestContext do worker**: `ReportsService` ganha variante system-facing (sem
   `RequestContext`/`authorize()`), mesmo posto de `DocumentArchiveService.
   findRequirementsByEvidenceVersion` (`document-archive-service.ts:1300-1306`, "SYSTEM query...
   nunca age em nome de uma requisição autenticada de usuário final, mesma postura que
   `scanActiveSeries`"). Autorização acontece UMA VEZ na criação da assinatura (ADMIN_ROLES);
   execução periódica é o sistema cumprindo configuração já autorizada.
5. **Destinatários**: restringidos a `Membership ACTIVE`+`GlobalUser ACTIVE` no v1. Nenhum e-mail
   externo arbitrário.
6. **Cadência**: `WEEKLY` + `dayOfWeek`/`localTime`/`timeZone` (mesmo shape de `ReminderTrigger`).
7. **Bucket/segurança**: novo bucket/prefixo dedicado, classe de retenção 30 dias nomeada (mesma
   disciplina de D-127/D-156), SSE, bloqueio de acesso público.

## Crítica Codex (Rodada 2)

Nota cega: **8,4/10**.

1. **72h de presigned S3 ainda não é contrato seguro se gerado por Lambda** — o erro não era só
   "30d > 7d", era também "URL expira quando expiram as credenciais temporárias que assinaram".
   Para destinatários restritos a `Membership ACTIVE`, a forma mais coerente é e-mail com link
   para rota AUTENTICADA da aplicação, que gera presign curto sob demanda.
2. **`ReportSubscriptionRun` gravado só depois de SES não fecha idempotência.** O pipeline
   existente cria `NotificationAttempt`, move para `SUBMITTING` ANTES da chamada externa, e se
   morrer após SES aceitar, reconcilia para `UNKNOWN` em vez de reenviar cegamente
   (`email-delivery-workflow.ts:116`, `notification-attempt.ts:3`). Precisa de
   `ReportDeliveryAttempt` com lease/status (`PREPARED`/`SUBMITTING`/.../`UNKNOWN`) ANTES do SES.
3. **Revalidação de destinatário precisa acontecer no worker de entrega, não só na criação** —
   persistir `recipientUserIds` e resolver e-mail fresco no envio via algo equivalente a
   `DynamoDbNotificationRecipientResolver` (`dynamodb-recipient-resolver.ts:33`). Persistir só
   e-mails validados na criação reabriria o TOCTOU.
4. **Novo destino de outbox e novo worker type GSI8 são bons, mas exigem wiring fechado**
   (relay/sweeper/env vars/schema/testes) — sem objeção conceitual.
