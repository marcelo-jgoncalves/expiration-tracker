# BLOCKER-B — Recon Handoff (sessão interrompida por limite de tokens)

> **Status: RECON PARCIAL — nenhum código alterado.** Sessão abortada por limite de tokens do usuário antes da fase de implementação; será retomada em outra sessão/conta. Este documento existe só para que a próxima sessão não repita o reconhecimento já feito. Não é o deliverable final (`docs/architecture/reminder-delivery-pipeline.md`, ainda não criado) nem uma decisão de arquitetura.

## 1. Missão (condensada)

Resolver **BLOCKER-B** — hoje, salvar/editar uma `ReminderPolicy` **não** produz automaticamente um lembrete real entregue. A missão completa (recebida do usuário nesta sessão, ~138 seções, não persistida na íntegra aqui) pede um pipeline end-to-end real:

```text
ExpirationItem → ReminderPolicy → materialization → Reminder/Occurrence
→ scheduler/dispatcher → worker → notification provider → delivery result
→ success/retry/terminal failure → observability
```

com idempotência, concorrência segura, isolamento de tenant, timezone correto, recovery de falha, e sem regressão de Epistemic Integrity (nunca afirmar "agendado"/"entregue" com mais certeza do que a evidência real permite).

**Definition of Done (resumo dos pontos que a próxima sessão precisa provar, não só implementar):**
1. `ReminderPolicy` real origina materialização automática (não só o worker de reconciliação de DST).
2. Occurrence tem identidade idempotente (chave lógica: tenant+item+ciclo+policy+ocorrência agendada — derivar do domínio real, não copiar cegamente).
3. Scheduling/dispatch automático; worker real processa; provider real (ou adapter production-capable) é chamado.
4. Success persistido; retry em falha retryable; falha terminal registrada; concorrência não duplica envio.
5. Renovação não deixa reminder do ciclo antigo obsoleto entregável; policy disable/update tem comportamento definido e testado.
6. Timezone validado (não usar `new Date("YYYY-MM-DD")` ingênuo); tenant isolation testado; pipeline observável (métricas+alarmes); stuck/failure tem recovery path; backfill seguro (deploy não pode disparar lembretes históricos em massa); infra versionada (Terraform); testes cobrindo os cenários acima; protocolo Claude↔Codex completo (mín. 3 rodadas, nota ≥9.0 dos dois lados, nota cega) fechado; documentação atualizada sem drift.
7. Se o único impedimento for provider externo (ex.: identidade SES não verificada em sandbox), **não** declarar BLOCKER-B resolvido — usar status `IMPLEMENTATION COMPLETE — EXTERNAL PROVIDER ACTIVATION REQUIRED`.

Autonomia operacional total foi concedida pelo usuário para esta missão (inspecionar, branch, implementar, testar, revisar via Codex, commitar, push, PR, merge, atualizar `develop`, sem interromper para aprovação intermediária) — **exceto** para subagentes/forks de pesquisa/revisão, que devem permanecer read-only por padrão. Essa autonomia deve ser reconfirmada como ainda válida no início da próxima sessão (o usuário pode ter mudado de ideia entre sessões — não presumir).

## 2. Baseline confirmado nesta sessão

- Branch `develop`, working tree limpo, `origin/develop` em dia no início da sessão (commit `ad055e9`, merge do Core Expiration Vertical Slice).
- Nenhum arquivo de código foi alterado nesta sessão — só este documento e (potencialmente) `NEXT_SESSION_PROMPT.md` foram tocados.

## 3. Reconhecimento já concluído (não repetir)

### 3.1 Notification/delivery module (`src/modules/notification/**`) — CONFIRMADO NO CÓDIGO, real e conectado

- Estrutura: `domain/ports/application/persistence/providers/http`. Três workflows reais: `routeNotificationIntent` (router), `processEmailDelivery` (envio real via SES), `ses-callback-workflow`/`ses-callback-processor` (bounce/complaint/delivery, precedência monotônica idempotente).
- Interface de envio: `EmailProviderAdapter.send(input): Promise<EmailSendResult>`; falhas tipadas `EmailSendError.kind: "CONCLUSIVE_RETRYABLE" | "CONCLUSIVE_TERMINAL" | "AMBIGUOUS"`.
- Recipient: `resolveCandidateUserId` = `item.assigneeUserId ?? tenantId`; resolver real (`persistence/dynamodb-recipient-resolver.ts`) exige perfil ativo no mesmo tenant, nunca fallback silencioso.
- Estado de `NotificationAttempt`: `PREPARED → SUBMITTING → {ACCEPTED, FAILED_RETRYABLE, FAILED_TERMINAL, UNKNOWN} → (callback) → {DELIVERED, BOUNCED, COMPLAINED}` + `NOT_SENT_STALE`. **`UNKNOWN` já é o estado UNKNOWN_OUTCOME exigido pela missão** — nunca auto-retry a partir dele (comentário no código: retry automático ali poderia duplicar envio já aceito pela SES).
- Idempotência de envio: OCC (`version`) + lease (`leaseExpiresAt`) via conditional write antes da chamada SES; duplicata concorrente retorna `SKIPPED_IN_PROGRESS`; lease expirado reconcilia para `UNKNOWN`, nunca reenvia cegamente.
- **Wiring confirmado, ponta a ponta**: `reminder-dispatch-handler` (SQS) → cria `NotificationIntent` (mesma transação do `CLAIMED→TRIGGERED` + outbox `notification.intent-created.v1`) → `notification-router-handler` (DynamoDB Streams) → `routeNotificationIntent` → grava `NotificationAttempt` + outbox `SQS_NOTIFICATION_EMAIL_V1` → `email-delivery-handler` (SQS) → `SesEmailAdapter.send()` real.
- Testes: 8 arquivos em `test/unit/notification/**` cobrindo lógica pura + composição de workflow; sem provider fake compartilhado (cada teste define seu próprio double) — aceitável.
- **Conclusão**: a metade "de trás para frente" do pipeline (a partir de uma `ReminderOccurrence` já materializada e despachada) está real, testada e implementada conforme o design M4 aprovado.

### 3.2 Documentos de arquitetura (M3.5, M4, decisions-log, ADRs, runbooks) — CONFIRMADO

- `m3.5-runtime-design.md` (APPROVED, Codex 9.3/10): cobre só claim→outbox→relay→sweeper→dispatch (recovery), **não** cobre como/quando a `ReminderOccurrence` é criada a partir de uma policy. Materialização eager (antecipada) foi decidida em `architecture-fase3-consolidada.md` (não redecidida aqui): `ReminderOccurrence` materializada com antecedência, sharded `DUE#yyyyMMddHHmm#NN`, reconciliação noturna de DST via GSI6 (`WORKSTATE#DST_PENDING`).
- `m4-notification-engine-design.md` (APPROVED, Claude 9.3/Codex 9.4): base spec completa em `docs/architecture/reviews/m4-notification-engine-design/codex-proposal-round1.md`. Confirma o state machine, a política de `UNKNOWN` (at-most-once definitivo, sem retry automático), correlação via tags SES, `NotificationIntent.kind`: `REPLACEMENT` vs `CORRECTIVE`.
- **Tensão real não resolvida por nenhum doc**: M4 assume `assigneeUserId` resolve para um perfil de usuário real e ativo no mesmo tenant; mas `interface-conceptual-model-and-information-architecture.md:124` e `interface-context-and-critical-tasks.md:657` documentam `assigneeUserId` como **texto livre hoje, sem validação contra usuário real**. Isso precisa ser resolvido (ou pelo menos formalmente reconhecido como finding) antes de fechar BLOCKER-B — se a resolução de destinatário depende de um campo não validado, o pipeline pode falhar silenciosamente a resolver destinatário para itens reais.
- **Nenhum ADR/decisions-log entry aborda BLOCKER-B diretamente** (a desconexão entre policy save e materialização) — é citado identicamente em 3 lugares (`NEXT_SESSION_PROMPT.md`, `docs/frontend/README.md`, `session-log.md`) mas nunca analisado tecnicamente em `docs/architecture/`. A causa raiz exata (por que só o worker de reconciliação de DST chama o materializer) ainda precisa ser confirmada no código — ver gap abaixo.
- `docs/architecture/incident-runbooks.md` (draft operacional): runbooks existentes cobrem falha de disparo, DLQ, provider indisponível — todos assumindo que a materialização já aconteceu. **Não existe runbook para "materialização nunca disparada"** (o próprio modo de falha do BLOCKER-B) — precisará de seção nova se o fix mudar o trigger path.
- Schemas já existentes e presumivelmente em uso real (a confirmar): `schemas/queues/reminder-dispatch.v1.json`, `notification-intent-created.v1.json`, `notification-email-deliver.v1.json`, `notification-ses-callback.v1.json`.
- O achado "wire contract `reminder.dispatch.v1` incompleto" citado em `AGENTS.md §7` **já foi corrigido** (commit `dd90174`, Claude↔Codex 9.2/10) — texto do `AGENTS.md` está desatualizado nesse ponto específico (drift menor, não bloqueia BLOCKER-B, mas vale corrigir `AGENTS.md` §7 num commit de documentação futuro).

### 3.3 Infra Terraform (`infra/**`) — CONFIRMADO NO CÓDIGO (recon chegou a terminar, apesar do timeout)

- **Toda a infraestrutura downstream de uma `ReminderOccurrence` já materializada está provisionada, testada e sem módulos/handlers órfãos.** Nenhum módulo Terraform existe sem estar instanciado na raiz; os 26 handlers Lambda reais em `src/runtime/aws/handlers/` batem 1:1 com `handler_name` em `infra/main.tf`.
- `infra/modules/reminder-schedule/` — 4 `aws_scheduler_schedule`: `reminder_producer` (`rate(1 minute)`), `reminder_claim_reconciliation` (`rate(5 minutes)`), `reminder_dst_reconciliation` (`cron(0 3 * * ? *)` UTC), `outbox_sweeper` (`rate(5 minutes)`). Kill-switch `var.schedules_enabled` existe mas está `true` por padrão (habilitado).
- Filas via `infra/modules/sqs-worker-queue/` (genérico, reusado): DLQ retenção 14d, redrive `maxReceiveCount=5`, alarme de idade de DLQ embutido (threshold 3600s). Instâncias relevantes: `dispatch_queue`, `router_queue`, `email_deliver_queue`, `ses_callback_queue` (política restrita ao ARN do tópico SNS via `ArnEquals`). Nenhuma FIFO/dedup em lugar nenhum.
- EventBridge Rule `notification_intent_created` (padrão `detail-type: ["notification.intent-created.v1"]`) → `router_queue`.
- IAM: só 2 grants com `Resource:"*"` em todo `infra/` — `ses:SendEmail` (SESv2 não suporta restrição por remetente, aceitável) e um wildcard de `events:PutRule/PutTargets` justificado por ARN interno imprevisível do GuardDuty (não relacionado a reminders). GSI3/GSI6 seguem isolamento por role já estabelecido (só as roles corretas têm `dynamodb:Query`).
- Alarmes: 6 alarmes de erro por função + 1 alarme de backlog do dispatch (idade>900s) + alarme de idade de DLQ por fila — todos apontando para o SNS `alert_topic` real (M5).
- `infra/tests/stack.tftest.hcl` (13 run blocks) já cobre: isolamento GSI3/GSI6, `maxReceiveCount`+alarme de DLQ, contrato de schedule (regressão do bug de HTML-escaping em `<aws.scheduler.scheduled-time>`), concorrência reservada, partial batch failure nos event source mappings.
- CI/CD: `ci.yml` roda `terraform plan` em PR; `cd.yml` roda `apply -auto-approve` via OIDC em push a `main` — ambos confirmados como realmente wired, não só documentados.
- **Único gap real de infraestrutura**: **não existe `aws_sesv2_email_identity` (identidade/domínio SES) em nenhum lugar do Terraform** — nunca foi gerenciado por IaC, é uma etapa manual externa pendente. `var.ses_from_address` não tem default; `dev.tfvars` usa um placeholder (`noreply@example.com`). Isso confirma a nota do `AGENTS.md §4`/`NEXT_SESSION_PROMPT.md` sobre o "spike de validação das tags SES em sandbox" ainda bloqueado externamente — **este é o candidato mais forte para justificar o status mais fraco da missão (`IMPLEMENTATION COMPLETE — EXTERNAL PROVIDER ACTIVATION REQUIRED`) em vez de `RESOLVED`, mas só se o resto do pipeline (materialização) for corrigido.**
- Só existe um ambiente real provisionado (`infra/env/dev.tfvars`); não há `infra/environments/` nem separação dev/prod — `infra/variables.tf` valida `environment == "dev"` apenas. Sem staging/prod real ainda.
- **Conclusão**: a infraestrutura para tudo que já existe (producer/dispatch/reconciliation/notification) está sólida. Isso significa que a implementação de BLOCKER-B provavelmente não precisa de infraestrutura nova de scheduling/queue — só (a) o trigger de materialização em si, e possivelmente (b) Terraform para expor o `EmailProviderAdapter` real ao invés de um placeholder quando a identidade SES for verificada.

## 4. Reconhecimento **NÃO concluído** — próxima sessão deve fazer isso primeiro

Resta só a confirmação a nível de código do lado da **materialização** (o infra e o notification module já estão confirmados — ver 3.1/3.3):

1. `src/modules/reminder/**` — o materializer existe, sua assinatura real, e **quem de fato o chama hoje** (grep por todos os call sites). O fork de recon dedicado a isso foi interrompido (timeout de tokens do usuário) antes de reportar — refazer do zero.
2. `src/workers/reminder-producer/reminder-dispatch/reminder-reconciliation/**` — o que cada um realmente faz (a infra confirma os *schedules*, falta confirmar a *lógica interna*).
3. Se `createItem`/`updateItem`/`renewItem` (em `src/modules/expiration/**`) chamam o materializer sincronamente, de forma alguma, ou só através de reconciliação assíncrona de DST.
4. Com base nisso, fazer o **Gap Analysis** real (seção 5 do template de `docs/architecture/reminder-delivery-pipeline.md` sugerido pela missão) e só então decidir a estratégia de materialização (antecipada vs just-in-time vs híbrida — a missão pede avaliação explícita, não assumir).

## 5. Próxima ação recomendada (início da próxima sessão)

1. Reconfirmar branch/estado (`git status`, `git branch --show-current`, `git log -5`, `git pull`) — não presumir que nada mudou.
2. Reler este documento + `NEXT_SESSION_PROMPT.md` + `docs/architecture/README.md`.
3. Pedir ao usuário (ou reusar, se ainda disponível) o prompt de missão completo original (~138 seções) — este handoff só resume os pontos essenciais de Definition of Done/protocolo, não reproduz o texto integral.
4. Refazer o reconhecimento de código dos itens da seção 4 acima (infra já confirmada na seção 3.3 — só falta `src/modules/reminder/**` + `src/workers/reminder-*/**`).
5. Produzir o Gap Analysis real e a decisão de arquitetura de materialização antes de escrever qualquer código.
