# Rodada 1 — Crítica Codex

Nota cega: **7,4/10**.

A proposta acerta o diagnóstico inicial: os 7 relatórios existem em `reports-service.ts:68`, o
handler CSV é dedicado e expõe `truncated`, e o SES atual é só `Content.Simple` em
`ses-email-adapter.ts:43`. Confirmado que não existe `ReportSubscription` no código.

## Bloqueantes reais

1. **TTL de 30 dias em presigned URL não é fisicamente válido.** URL presignada gerada por Lambda
   usa credenciais temporárias do role e expira no máximo junto delas; documentação AWS registra
   teto de até 7 dias para SDK/CLI, e credenciais temporárias podem expirar antes disso
   (`https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html`). "Presigned
   GET URL com TTL igual à retenção de 30 dias" é uma falha técnica central.
2. **GSI10 é a direção errada; GSI8 deve ser reutilizado com namespace novo.** GSI8 já é
   exatamente um índice global esparso de trabalho devido: `GSI8PK=WORK#<workerType>`,
   `GSI8SK=<dueAtIso>#TENANT#...`, `KEYS_ONLY`, isolado por `dynamodb:LeadingKeys`
   (`infra/modules/dynamo-table/main.tf:228`). Criar GSI10 duplicaria a mesma semântica física. O
   formato correto: `WORK#REPORT_SUBSCRIPTION`, entrada explícita em `gsi8_worker_types`, policy
   própria.
3. **`lastRunAt + cadence` é fraco para idempotência e concorrência.** Falha depois de S3 e
   antes/depois de SES pode duplicar e-mails ou deixar artefato órfão. Falta um
   `ReportSubscriptionRun`/`scheduledFor` idempotente, claim transacional, estado de entrega.
4. **`ReportsService` chama `authorize(ctx, ...)` e depende de `RequestContext` de usuário.** Um
   Lambda agendado não tem JWT nem membership do ator. Precisa definir se a autorização é herdada
   da criação ou se usa uma porta interna sem RBAC interativo.
5. **Destinatários externos são bloqueio real de produto/segurança.** Um CSV de tenant inteiro por
   link bearer encaminhável é diferente de guest upload. V1 deveria restringir a `Membership
   ACTIVE`+`GlobalUser ACTIVE`.
6. **"Cadence WEEKLY" incompleto sem dia/hora/timezone.** MONTHLY não é necessário no v1.
7. **Link por S3 não é automaticamente mais seguro que anexo** — bearer token em e-mail, sem
   autenticação, encaminhável. Precisa bucket/prefixo dedicado, SSE, public access block, lifecycle
   curto.

## Respostas diretas

1. Reusar GSI8, não GSI10, com worker type novo e IAM por `LeadingKeys`.
2. 10 destinatários e WEEKLY são proporcionais; não adicionaria MONTHLY agora. Falta dia/hora/tz.
3. 30 dias de retenção é decisão de engenharia razoável, mas não pode ser confundida com TTL do
   link — link deve ser curto.
4. Sim, há bloqueio de produto se destinatário externo for permitido — restringir a `Membership
   ACTIVE` no tenant.
5. Sim, há problema físico/transacional: geração S3 + presign + SES não é transacional; precisa
   run idempotente/claim/estado ou outbox equivalente.
