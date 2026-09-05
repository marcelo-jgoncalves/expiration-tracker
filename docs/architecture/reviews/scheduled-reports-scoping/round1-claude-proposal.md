# Rodada 1 — Proposta Claude: Relatórios Agendados (Roadmap P1, item 15)

## Contexto (verificado por leitura direta de código)

D-195 já construiu 7 relatórios CSV via `ReportsService` (`src/modules/reports/application/
reports-service.ts`), expostos em `GET /reports/*` por um Lambda dedicado (`reports-handler`,
NÃO proxiado pelo BFF), RBAC `item:export`/`docarchive:requirement-export` (ambos ADMIN_ROLES).
Hoje um humano precisa chamar o endpoint manualmente e baixar o CSV — nenhum agendamento ou
entrega automática existe (confirmado por D-198, reconfirmado por grep nesta rodada de scoping).

**Precedente de worker agendado já estabelecido** (preferência forte deste projeto por reusar, não
inventar): `infra/main.tf` (`requirement_reindex`, `cron(0 4 * * ? *)`) — um `aws_scheduler_schedule`
único invoca UM Lambda que varre TODOS os tenants numa única execução, via índice esparso GSI8
(`WORK#<workerType>`, D-179) em vez de `Scan`. Mesmo padrão em `document-request-recurrence` e nos
9 workers de manutenção de D-179/D-180-190. Nunca um agendamento por tenant.

**Precedente de envio de e-mail**: `SESv2Client.SendEmailCommand` com `Content.Simple` apenas
(`src/modules/notification/providers/ses-email-adapter.ts`) — sem suporte a anexo hoje.

## Pesquisa externa (E-014): declaração SIM PARCIAL

Fontes datadas (consultadas 2026-09-05):
- Metabase, "Dashboard subscriptions": assinatura é por usuário/destinatário — cadência
  diária/semanal/mensal com dia da semana; opção de anexar como arquivo.
- Google Cloud/Looker, "Scheduling and sending dashboards"/"Emailed data policy": 3 políticas —
  Send Link Only / Send Data Only / Send Links and Data. Limite: 20 MB corpo, 15 MB anexo.

**Padrão convergente**: assinatura por criador/destinatário/relatório específico, "anexo vs. link"
é escolha deliberada de produto oferecida pelos dois líderes de mercado.

## Proposta (Rodada 1, resumida — ver íntegra na thread do protocolo)

1. Entrega por link presignado S3 (30 dias de TTL), não anexo MIME.
2. `ReportSubscription` por assinatura (tenantId, reportTypes[], cadence WEEKLY, recipients[]
   e-mails, createdBy, lastRunAt).
3. Agendamento via GSI10 novo (formato esparso espelhando GSI8) — pergunta aberta para Codex sobre
   se cabe reusar GSI8 como mais um `workerType` em vez disso.
4. Truncamento sinalizado no e-mail quando qualquer sub-relatório retornar `truncated: true`.

Nota cega Claude (Rodada 1): não registrada — Codex respondeu primeiro nesta rodada (fluxo
assimétrico, ver `AGENTS.md` §4 "protocolo de nota cega": o avaliador que responde depois não vê a
nota do primeiro até ambos existirem).
