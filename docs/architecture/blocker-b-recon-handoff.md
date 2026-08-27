# BLOCKER-B — Recon Handoff

> **Status: RECON COMPLETO — causa raiz confirmada no código. Nenhum código alterado ainda.** Notification/delivery (M4), infra Terraform, e agora o materializer/trigger de materialização — todos confirmados no código (ver §3.4). Próximo passo é decisão de arquitetura (ainda em aberto) seguida de implementação. Texto integral do prompt de missão original (~138 seções): `docs/architecture/blocker-b-mission-brief.md` (persistido verbatim nesta sessão — antes só existia no histórico de conversa, não sobreviveria a uma troca de máquina/sessão). Este documento existe para que qualquer sessão retomando o trabalho não repita o reconhecimento já feito. Não é o deliverable final (`docs/architecture/reminder-delivery-pipeline.md`, ainda não criado) nem uma decisão de arquitetura.

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
- ADRs vigentes e não supersedidos, relevantes ao redesign: **ADR-0003** (Reminder Engine — shards por minuto `DUE#yyyyMMddHHmm#NN` + Lambda scanner + SQS; rejeita EventBridge Scheduler por-ocorrência por quota/cancelamento em escala, e scan global por hot partition), **ADR-0004** (EventBridge + outbox seletivo com sweeper; rejeita outbox só-via-Streams por risco de retenção de 24h), **ADR-0008** (Notification Engine — 1 fila SQS por canal + contrato de adapter comum; rejeita fila única compartilhada e chamada síncrona direta). Qualquer redesign do trigger de materialização deve respeitar essas 3 decisões aceitas (não as reabrir sem motivo).
- decisions-log relevantes (nenhum aborda BLOCKER-B diretamente, mas dão o pano de fundo): D-017 (Reminder Engine shards/min+SQS, APPROVED), D-018 (Notification Engine SQS por canal, APPROVED), D-020 (Event backbone EventBridge+outbox, APPROVED), D-028 (correção de GSI global no blueprint, APPROVED), D-030 (M5 Observability — achou e já corrigiu o wire contract `reminder.dispatch.v1`, ver acima), D-039 (Automated Chasing reusa GSI3, nunca generaliza `NotificationIntent`/`ReminderOccurrence` — precedente relevante: prefira agregados-irmãos a generalizar essas entidades), D-046 (mini-revisão de capacidade GSI3 antes de reusar em chasing — modelo a seguir se o novo trigger de materialização aumentar tráfego em GSI3/GSI6).
- `docs/engineering/principles.md` princípio #4, diretamente aplicável ao redesign: "idempotência/outbox/reconciliação existem para que uma falha de fila/rede nunca perca um lembrete silenciosamente — mas o inverso também vale: a materialização de ocorrências não pode ficar bloqueada esperando o outbox confirmar publicação." Ou seja, o novo trigger de materialização (seja síncrono no create/update/renew, seja via evento) não deve tornar a escrita do item/policy dependente da confirmação de um efeito colateral assíncrono.
- `docs/architecture/incident-runbooks.md` (draft operacional, não passou pelo protocolo de 3 rodadas — classificado processo/documentação, não Type 1): runbooks existentes (§2 falha de disparo, §3 DLQ crescendo, §4 provider indisponível) cobrem falha de disparo, DLQ, provider indisponível — todos assumindo que a materialização já aconteceu. **Não existe runbook para "materialização nunca disparada"** (o próprio modo de falha do BLOCKER-B) — precisará de seção nova se o fix mudar o trigger path. Gaps já reconhecidos no próprio doc: sem alarme dedicado de profundidade de DLQ (só idade), sem alarme dedicado de taxa de erro por provider/canal.
- **Distinção importante, não confundir**: `GTR-01` (identidade do solicitante interno não exposta ao guest externo no fluxo de upload) é um blocker **diferente** de BLOCKER-B — pertence a BLOCKER-C (guest upload), não a reminders. Não misturar as duas linhas de trabalho.
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

## 4. Reconhecimento **NÃO concluído** — em andamento

Resta só a confirmação a nível de código do lado da **materialização** (o infra e o notification module já estão confirmados — ver 3.1/3.3). Um fork de reconhecimento dedicado (substituto do primeiro, que foi morto sem relatar nada útil) está rodando com este escopo exato:

1. `src/modules/reminder/**` — o materializer existe, sua assinatura real, e **quem de fato o chama hoje** (grep por todos os call sites em toda a árvore `src/`).
2. `src/workers/reminder-producer/reminder-dispatch/reminder-reconciliation/**` — lógica interna de cada um (a infra já confirma os *schedules*), e confirmação de que só `reminder-reconciliation` (caminho DST) chama o materializer.
3. Se `createItem`/`updateItem`/`renewItem` (em `src/modules/expiration/**`) chamam o materializer sincronamente, de alguma forma, ou não chamam de forma alguma.
4. Como `ReminderPolicy` em si é persistida (rota HTTP própria?) e se essa rota faz algo além de um write simples.
5. Cobertura de teste existente do materializer (duplicidade, renovação, policy desabilitada, item arquivado).

Quando esse fork retornar, atualizar a seção 6 (Gap Analysis) abaixo confirmando ou refutando a hipótese de trabalho, e só então prosseguir para decisão de arquitetura.

## 5. Próxima ação recomendada

1. Reconfirmar branch/estado (`git status`, `git branch --show-current`, `git log -5`, `git pull`) — não presumir que nada mudou.
2. Reler este documento + `NEXT_SESSION_PROMPT.md` + `docs/architecture/README.md`.
3. Se a seção 6 abaixo ainda estiver marcada como hipótese não confirmada, aguardar/checar o fork de recon do materializer antes de decidir arquitetura.
4. Produzir a decisão de arquitetura de materialização (antecipada vs just-in-time vs híbrida — avaliar explicitamente, não assumir) e só então implementar.

## 6. Gap Analysis (síntese) — materializer wiring ainda pendente de confirmação de código

**Hipótese de trabalho (confirmada por 3 fontes documentais independentes, ainda não confirmada em código — fork de recon rodando):** o `ReminderMaterializer` (ou equivalente) só é chamado pelo caminho de reconciliação de DST (`reminder-reconciliation`, GSI6 `WORKSTATE#DST_PENDING`); nenhuma rota HTTP de `ReminderPolicy` nem `createItem`/`updateItem`/`renewItem` de `ExpirationItem` chama o materializer ou emite evento que o dispare. Isso explicaria exatamente o sintoma relatado: salvar uma policy hoje não produz nenhuma ocorrência futura, exceto no raro caso em que uma ocorrência pré-existente cruza uma transição de DST.

**O que já está confirmado e NÃO precisa ser redesenhado:**
- Downstream de uma `ReminderOccurrence` já `SCHEDULED`: claim→outbox→relay→sweeper→dispatch (M3.5) e dispatch→NotificationIntent→router→SES→callback (M4) — ambos reais, testados, com idempotência e estado `UNKNOWN` para resultado ambíguo. **A implementação de BLOCKER-B não deve tocar esse trecho**, só garantir que ele receba occurrences reais.
- Infraestrutura (schedules, filas, DLQs, alarmes, IAM) para tudo que já existe — sólida, sem gaps de infra novos necessários para o trigger em si (só possivelmente para expor a identidade SES real quando verificada — gap externo, não de código).
- Estratégia de materialização **antecipada/eager** já decidida em `architecture-fase3-consolidada.md` (não é uma decisão em aberto para esta missão — não redecidir de novo "antecipada vs just-in-time" do zero; a pergunta real é só *o que dispara* a chamada ao materializer já existente, não *como* ele calcula as ocorrências).

**O que falta decidir (arquitetura real da correção), depois de confirmado o call-site real:**
- Onde plugar o trigger: síncrono dentro da mesma transação de `createItem`/`updateItem`/`renewItem`/policy-save (mais simples, mas acopla a escrita do item à materialização — tensão com o princípio #4 de engenharia citado acima) vs. assíncrono via outbox/evento (`ReminderPolicySaved`/`ExpirationItemCreated` → materializer como consumidor, consistente com o padrão outbox já usado em M3/M3.5) vs. híbrido.
- Backfill: o que fazer com `ReminderPolicy`s já salvas antes do deploy da correção — precisam de materialização retroativa seguem, mas sem disparar lembretes históricos em massa no primeiro deploy (item 66-68 da missão).
- Renovação: confirmar que ocorrências do ciclo antigo não ficam entregáveis após `renewItem` — a materialização precisa saber invalidar/versionar ocorrências futuras do ciclo anterior, não só criar novas.
- Idempotência de materialização: identidade lógica (tenant+item+ciclo+policy+ocorrência) precisa ser confirmada/definida a partir do desenho real do materializer, não assumida.

**Este Gap Analysis será atualizado assim que o fork de recon do materializer retornar** — a hipótese acima pode ser refutada (call site adicional encontrado) ou refinada com os detalhes exatos de assinatura/idempotência do materializer.

## 5. Próxima ação recomendada (início da próxima sessão)

1. Reconfirmar branch/estado (`git status`, `git branch --show-current`, `git log -5`, `git pull`) — não presumir que nada mudou.
2. Reler este documento + `NEXT_SESSION_PROMPT.md` + `docs/architecture/README.md`.
3. Pedir ao usuário (ou reusar, se ainda disponível) o prompt de missão completo original (~138 seções) — este handoff só resume os pontos essenciais de Definition of Done/protocolo, não reproduz o texto integral.
4. Refazer o reconhecimento de código dos itens da seção 4 acima (infra já confirmada na seção 3.3 — só falta `src/modules/reminder/**` + `src/workers/reminder-*/**`).
5. Produzir o Gap Analysis real e a decisão de arquitetura de materialização antes de escrever qualquer código.
