# Estado Final Consolidado — Roadmap P1 item 15 ("Relatórios agendados")

**Status: `APPROVED` — design técnico, protocolo Claude↔Codex (`AGENTS.md` §4) completo, 3
rodadas, nota cega final Claude 9,2/Codex 9,1 (ambos ≥9,0, sem arredondar). Evidência completa:
`round1-claude-proposal.md`, `round1-codex-critique.md`,
`round2-claude-revision-and-codex-critique.md`, `round3-claude-revision-and-codex-final.md`
(neste diretório). DESIGN-ONLY — nenhum código/schema/infra alterado.**

## Origem

D-195 construiu 7 relatórios CSV (`ReportsService`) expostos manualmente via `GET /reports/*`.
D-198 confirmou que nenhum agendamento/entrega automática existe. Este scoping resolve o item 15
do backlog P1.

## Pesquisa externa (E-014): SIM PARCIAL

Metabase "Dashboard subscriptions" (assinatura por usuário/destinatário, cadência
diária/semanal/mensal, opção de anexo) e Google Cloud/Looker "Scheduling and sending
dashboards"/"Emailed data policy" (3 políticas de entrega: Send Link Only/Send Data Only/Send
Links and Data, limites 20 MB corpo/15 MB anexo) — ambas fontes primárias, consultadas
2026-09-05. Nenhuma fonte primária datada equivalente encontrada no nicho específico de
compliance/expiration-tracking (limitação de fonte registrada explicitamente, mesmo padrão de
D-197). Padrão convergente: assinatura por criador/relatório/destinatário específico (não um
agendamento único fixo por tenant); "anexo vs. link" é escolha deliberada de produto.

## Achados reais que fecharam as 3 rodadas (todos do Codex, verificados por leitura de código)

1. TTL de 30 dias em presigned S3 URL é fisicamente inválido quando assinado por credenciais de
   role Lambda (expira com as credenciais, teto ~7 dias do SigV4) — fechado substituindo o link
   por uma rota de download AUTENTICADA que gera presign curto (5 min) sob demanda.
2. GSI10 novo era desnecessário — GSI8 (`local.gsi8_worker_types`, mapa fechado de 9 entradas,
   `infra/modules/dynamo-table/main.tf:248`) já é o índice esparso de trabalho-devido certo;
   adicionar `report_subscription = "REPORT_SUBSCRIPTION"` é mecânico, mesmo padrão de D-179.
3. `lastRunAt+cadence` sozinho é fraco para idempotência/concorrência — fechado reusando o
   pipeline outbox→SQS→worker já `APPROVED` (D-193/D-200/D-201), com um `ReportDeliveryAttempt`
   novo espelhando a máquina de estados de `NotificationAttempt` (claim `SUBMITTING` com lease
   ANTES de qualquer chamada externa, nunca reenvio cego após ambiguidade).
4. `ReportsService` exige `RequestContext`/`authorize()` — um worker agendado não tem ator
   autenticado. Fechado com uma variante system-facing, mesmo posto de
   `findRequirementsByEvidenceVersion` (`document-archive-service.ts:1300-1306`, "SYSTEM query...
   nunca age em nome de uma requisição autenticada de usuário final").
5. Destinatários externos arbitrários são bloqueio real de produto/segurança — fechado
   restringindo a `Membership ACTIVE`+`GlobalUser ACTIVE` do tenant, revalidados FRESCOS no
   momento do envio (nunca confiados da criação), mesma postura tolerante a remoção parcial de
   D-200/D-201.
6. Conflito de RBAC entre a rota de download (ADMIN-tier) e destinatários que podem ser
   MEMBER/VIEWER — fechado autorizando a rota por `ADMIN_ROLES` OU o próprio `principal.userId`
   constar como destinatário elegível do `ReportDeliveryAttempt`/run específico.

## Design final (10 decisões)

1. **`ReportSubscription`** (tenantId, reportTypes[] subconjunto dos 7, cadence `WEEKLY` +
   `dayOfWeek`/`localTime`/`timeZone` — mesmo shape de `ReminderTrigger`, `recipientUserIds:
   string[]` teto nomeado ex. 10, createdBy, nextRunAt, version). Criação/gestão via rota HTTP
   `ADMIN_ROLES` (mesmo tier de D-195).
2. **GSI8** (não GSI10): `report_subscription = "REPORT_SUBSCRIPTION"` novo em
   `local.gsi8_worker_types`, mesma disciplina `LeadingKeys` das 9 entradas existentes.
3. **Scheduler**: `aws_scheduler_schedule` único semanal, um Lambda varre GSI8
   `WORK#REPORT_SUBSCRIPTION` por assinaturas due, cross-tenant numa única execução (mesmo
   padrão de `requirement-reindex`).
4. **Claim transacional**: `TransactWriteItems` de 2 ações — `Update` em `ReportSubscription`
   (avança `nextRunAt`, `ConditionCheck` de versão) + `Outbox` Put, destino novo
   `SQS_REPORT_SUBSCRIPTION_DELIVERY_V1` (novo valor aditivo no enum fechado `OutboxDestination`,
   mesmo padrão de `SQS_REQUIREMENT_EVIDENCE_REFRESH_V1`).
5. **`ReportSubscriptionRun`** (1 por execução agendada) + **`ReportDeliveryAttempt`** (1 por
   destinatário) — nunca um destinatário inválido/falho contamina os demais. Estados espelham
   `NotificationAttempt`: `PREPARED`→`SUBMITTING`(lease)→`ACCEPTED`/`FAILED_RETRYABLE`/
   `FAILED_TERMINAL`/`UNKNOWN`.
6. **Worker de entrega SQS**: consome `SQS_REPORT_SUBSCRIPTION_DELIVERY_V1`; para cada
   assinatura due: gera os CSVs via variante system-facing de `ReportsService` (sem
   `RequestContext`/`authorize()`, mesmo posto de `findRequirementsByEvidenceVersion`), grava em
   S3 (bucket/prefixo dedicado, classe de retenção 30 dias nomeada, SSE, bloqueio de acesso
   público), resolve `recipientUserIds` FRESCO (`Membership ACTIVE`+`GlobalUser ACTIVE`, membro
   inválido excluído silenciosamente do envio, nunca bloqueia os demais), claim
   `ReportDeliveryAttempt` `SUBMITTING` com lease ANTES do SES, envia e-mail (`Content.Simple`,
   sem anexo) com link para a rota de download autenticada, resolve o attempt conforme resultado.
7. **Rota de download**: `GET /reports/subscriptions/{subscriptionId}/runs/{runId}/download`,
   autoriza `ADMIN_ROLES` OU `principal.userId` elegível no `ReportDeliveryAttempt` daquele run,
   gera presign S3 curto (5 min) sob demanda após validar sessão — nunca embute um link S3 direto
   no e-mail.
8. **Retry/DLQ**: nativo do SQS (`maxReceiveCount`), nunca lógica de retry própria.
9. **Truncamento**: se qualquer sub-relatório retornar `truncated: true`, o e-mail sinaliza isso
   explicitamente.
10. **RBAC**: criação/gestão de assinatura permanece `ADMIN_ROLES`, mesmo tier de D-195.

## Escopo explicitamente fora desta decisão

Cadência `MONTHLY` (v1 só `WEEKLY`); anexo MIME (`Content.Raw`) — deliberadamente descartado a
favor do link de download autenticado; destinatários externos arbitrários (fora de
`Membership ACTIVE` do tenant) — decisão de produto separada se necessária no futuro.

## Próxima ação

Implementação real fica para sessão dedicada futura, mesmo padrão de D-121/D-127/D-179/D-191/
D-194/D-197. Fatias sugeridas (não decididas aqui, a critério de quem implementar): (1) entidades
+ GSI8 worker type + schema; (2) scheduler + claim transacional; (3) worker de entrega + rota de
download; (4) wiring completo do destino de outbox (relay/sweeper/env vars/testes).
