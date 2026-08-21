# Expiration Tracker — Status e Próxima Sessão

## Status atual (2026-08-21) — M5 implementado, deployado, verificado em produção real e operacionalmente fechado. Leia esta seção primeiro, supera todo o histórico abaixo.

**M5 (Observabilidade)** está implementado, revisado pelo protocolo Claude↔Codex e **verificado
funcionando na conta AWS `dev` real** — não só "código no repo". Linha do tempo resumida (detalhe
completo no histórico abaixo, se precisar dos porquês):

1. Implementação de `correlationId`/`tenantId` contextual via `AsyncLocalStorage`, ADOT tracing,
   alerta SNS→e-mail — revisão Claude↔Codex 7,4→8,8→**9,1/10**.
2. Achado colateral (`reminder.dispatch.v1` nunca cumpria seu próprio schema de envelope) —
   corrigido no mesmo dia, revisão Claude↔Codex **9,2/10** de primeira (Nível 5 da escala de
   risco, `DispatchCommand` passou a emitir `messageVersion`/`messageId`/`createdAt`/
   `correlationId` reais).
3. Deploy real via `cd.yml` exigiu 3 correções de infra que nada tinham a ver com o código do
   milestone: role de CI/CD trocada para `GITHUB-OIDC-ROLE` (decisão do usuário — essa role tem
   policy `Action:*/Resource:*`, admin total da conta, mantida assim deliberadamente após o
   risco ser avisado), trust policy da role corrigido para o formato "imutável" do `sub` claim
   OIDC do GitHub (`repo:owner@orgId/repo@repoId:*`, não só o clássico), e `dev.tfvars` com
   `alert_email`/`adot_layer_arn` reais (verificados via CLI, não placeholders).
4. **Bug real e severo pós-deploy**, achado via `aws lambda invoke` real: a ADOT layer quebrava
   as 12 funções (`Cannot redefine property: handler` — esbuild exporta `handler` como getter
   não-configurável, o `shimmer`/instrumentation do OTel não consegue envolvê-lo). Corrigido em
   `scripts/build-lambdas.ts` (esbuild `footer` reatribui `module.exports` a um objeto plano
   novo) + teste de regressão real (`test/unit/build-lambdas-export-shape.test.ts`). Verificado
   corrigido via novo `aws lambda invoke` real após redeploy.
5. **Achado de infra separado, também corrigido**: `ci.yml` e `cd.yml` disparavam ambos em
   `push: branches: [main]`, competindo pelo mesmo lock nativo do state no S3 — quem perdia
   falhava com "Error acquiring the state lock" (parecia lock travado, era só corrida). Corrigido:
   `cd.yml` agora dispara via `workflow_run` (`workflows: ["CI"]`), só depois da CI real terminar
   com sucesso — verificado funcionando sequencialmente num merge real subsequente.
6. **Subscription SNS confirmada pelo usuário** (`tchelojg@gmail.com`, deixou de ser
   `PendingConfirmation`). **Teste real de alarme→e-mail executado**: `exptrk-dev-reminder-producer-errors`
   tinha um estado `ALARM` real e antigo (de 2026-08-20, antes do M5 ter destino de notificação) —
   limpo para `OK`, depois forçado `OK→ALARM→OK` via `aws cloudwatch set-alarm-state` (método
   prescrito pelo próprio design M5 §4 para esse teste), publicando de verdade no tópico
   `exptrk-dev-alerts` já confirmado.

**Nenhuma pendência técnica bloqueante conhecida para M5.** Todas as PRs (#8–#12) mergeadas em
`main`, todas revisadas/testadas conforme o protocolo aplicável, suíte de testes verde, deploy
real confirmado saudável.

### Pendências reais não-M5 ainda abertas (backlog do projeto, nenhuma bloqueante)

- **M4**: spike de validação das tags SES em sandbox real (nunca provado contra API real),
  template de e-mail real versionado (hoje placeholder em `ses-email-adapter.ts`).
  - ~~Rota HTTP `PUT /notifications/preferences`~~ **FECHADA nesta sessão**: novo
    `GET`/`PUT /notifications/preferences` (`src/modules/notification/http/preferences-handlers.ts`
    + `NotificationPreferencesService` + `notifications-handler.ts`/infra novos). Achado real
    descoberto ao implementar: `defaultNotificationPreferences()` nunca era chamado em lugar
    nenhum do `src/` — "hoje só via onboarding" no backlog era aspiracional, não código real.
    Bridge pragmático: o `GET` cria o registro padrão na hora se ele não existir (em vez de
    depender de um onboarding que não existe), e o `PUT` reusa a mesma lógica. Ação
    `notification:configure` já existia na matriz de autorização (`ADMIN_ROLES`/OWNER) — sem
    mismatch real porque o MVP é `tenantId=userId`/tenant single-owner (`authorization.ts:36`),
    então o usuário editando as próprias preferências já É o OWNER daquele tenant.

    **Bug real pós-deploy encontrado via smoke test real** (`aws lambda invoke` contra
    `exptrk-dev-notifications-handler` real): `GET` funcionou (200), `PUT` retornou 500
    "Unknown schema $id". Causa: `schema-validator.ts`'s `defaultSchemaRegistry` usa imports
    estáticos explícitos de cada schema (necessário pro bundle esbuild-cjs — `import.meta.url`
    não funciona nesse formato, então a varredura dinâmica de diretório resolveria zero
    schemas em cold start real). O novo schema foi criado no disco mas eu esqueci de
    adicioná-lo a essa lista estática — o próprio comentário do arquivo já avisava
    explicitamente sobre esse passo manual. **Nunca pego por nenhum teste** porque
    `test/contract/schemas.test.ts` valida contra `loadAllSchemasFromDisk()` (registro
    diferente, só usado por testes/`validate-schemas`, nunca por um handler real) — só o
    `defaultSchemaRegistry` real importa os schemas estaticamente. Corrigido (linha de import +
    entrada no array) + novo teste de regressão real
    (`test/unit/notification/preferences-handlers.test.ts`) que exercita o handler de verdade
    contra o `defaultSchemaRegistry` real — confirmei que esse teste falha sem o fix (revertido
    temporariamente, reproduziu o mesmo 500) antes de restaurar. 255/255 testes,
    typecheck/lint/check-boundaries/validate-schemas/check-docs limpos — deploy real do fix e

    **Segundo bug real, mais severo, encontrado no smoke test seguinte** (agora `PUT` real
    depois do fix do schema): 400 "DynamoDB rejected IdentityStore.updateConditional:
    ValidationException". Causa real (via `aws logs`/leitura do código, não só suposição):
    `DynamoDbIdentityStore.updateConditional` (`src/modules/identity/persistence/
    dynamodb-identity-store.ts`) usava o nome de atributo `count` **direto** (sem placeholder
    `ExpressionAttributeNames`) numa `ConditionExpression` — `count` é palavra reservada do
    DynamoDB. Isso quebra **toda rota HTTP autenticada** (`items-handler`, `reminders-handler`,
    `notifications-handler`, `test-ping-handler` — todas usam `TenantQuotaService.consume()`),
    mas só na **segunda** chamada da mesma tenant dentro da mesma janela de 60s (a primeira
    usa `putIfAbsent`, sem essa `ConditionExpression`; só a partir da segunda o
    `updateConditional` é exercitado). Bug pré-existente desde M1, nunca pego por nenhum teste
    porque `InMemoryIdentityStore` (fake) não interpreta `ConditionExpression` como o DynamoDB
    real — só um teste contra DynamoDB Local real pegaria isso. Corrigido (placeholder
    `#count`) + novo teste de integração real
    (`test/integration-dynamodb/quota.dynamodb.test.ts`, Camada 2, roda no job `dynamodb-integration`
    da CI — não pude rodar localmente por falta de Docker nesta máquina, mas typecheck/lint
    passam). **Ainda não verificado no ambiente real via novo `aws lambda invoke`** — próximo
    passo desta mesma sessão.
    novo `aws lambda invoke` de verificação, ver commit seguinte nesta mesma sessão.
- **Camada 3 de teste** (sandbox AWS efêmero: IAM negativo real, redrive de DLQ real, invocação
  real do EventBridge Scheduler) — pendência estrutural desde M3.5, nunca fechada por falta de
  ambiente de teste efêmero dedicado (distinto do ambiente `dev` real já em uso).
- **Full-audit round1** (9 eixos, ver histórico abaixo): só o eixo Engenharia de Contexto bateu o
  gate de 9,0. Os outros 8 têm achados reais classificados como impedimento externo (parecer
  jurídico, DPA de fornecedor) ou escopo de produto maior (control plane multi-tenant, DSR/purge)
  — não reabrir rodadas só para tentar melhorar nota, só se houver achado novo real.
- **Trace real X-Ray/ADOT**: **CONFIRMADO nesta sessão** via `aws xray get-trace-summaries` —
  traces reais existem para `exptrk-dev-reminder-producer` (sem `HasFault`/`HasError`), provando
  que a instrumentação ADOT está gerando telemetria de verdade, não só configurada. Não visto
  ainda no console web (só via CLI) e não confirmado especificamente para o caminho
  SQS→Lambda→DynamoDB ponta-a-ponta (só para uma invocação single-function) — refinamento
  possível, não bloqueante.

---

Design `APPROVED` (seção histórica abaixo) foi implementado de ponta a ponta nesta sessão:
`src/shared/observability/context.ts` (`runWithContext`/`getContext` via `AsyncLocalStorage` +
`correlationIdFromSqsRecord`), `SecureLogger` integrado (contexto ambiente mesclado, explícito
sempre vence), `buildOutboxRecord` copiando `event.correlationId` para `OutboxRecord`
(`outboxRecordCorrelationId` com fallback `eventId`), wiring por-record nos 12 handlers Lambda
(fontes por tipo de evento conforme o design: `MessageAttributes.correlationId` nas filas SQS
que o próprio relay/sweeper alimenta — ver achado novo abaixo —, `SequenceNumber` nos handlers
Streams, novo UUID nos produtores EventBridge Scheduler, `requestContext.requestId` nos 3
handlers HTTP), propagação real via `MessageAttributes.correlationId` no `SendMessageCommand`.
`tenantId` aninhado via `runWithContext` composto em `reminder-dispatch-handler`,
`ses-callback-handler` e `notification-router-handler` — **não** nos 3 handlers HTTP
(`items-handler`/`reminders-handler`/`test-ping-handler`), decisão deliberada aceita pelo Codex
como follow-up não bloqueante (aninhar exigiria tocar 12 funções `handleXxx` em 3 módulos sem
duplicar a chamada `resolver.resolve()`, que bate no DynamoDB — não é ponto-fix trivial).

Infra Terraform: `infra/modules/lambda-function` ganhou `adot_layer_arn` (sem default) +
`layers`/`AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler`; novo módulo `infra/modules/alert-topic`
(SNS→e-mail); `alarm_actions` wired em todos os alarmes existentes
(`reminder-observability` + os 4 `sqs-worker-queue`). `terraform test` verde em todos os módulos
afetados + raiz (mock_provider/plan real contra `claude-dev`, nunca apply);
`terraform plan -var-file=env/dev.tfvars` real: **0 a destruir/substituir** (só `layers`/
`alarm_actions`, atributos mutáveis).

Revisão de implementação via protocolo Claude↔Codex (`AGENTS.md` §4, mesmo padrão de M3.5):
7,4 → 8,8 → **9,1/10 final**, 3 rondas reais. Achados reais corrigidos: causalidade
outbox→SQS→reminder-dispatch quebrada (handler ignorava o `MessageAttributes.correlationId`
que o relay já propagava — corrigido, extraído para `correlationIdFromSqsRecord()` testável);
4 handlers batch com `try/catch` fora do `runWithContext` (logs de falha perdiam o contexto —
corrigido, `try/catch` agora fica dentro); fallback de Streams usando a fonte errada
(`eventId` do sweeper em vez de `SequenceNumber` — corrigido); teste de partial batch failure
exigido pelo design §5 estava ausente (3 records, 2º falha — adicionado, exigiu extrair
`dispatch-outbox-relay-processor.ts`/`notification-email-outbox-relay-processor.ts` sem efeitos
colaterais de topo para ficarem unit-testáveis).

**Achado novo e real, descoberto durante a revisão, registrado como pendência separada — não é
escopo de M5, mas é bloqueante para prontidão operacional real do Reminder Dispatch**:
`schemas/queues/reminder-dispatch.v1.json` exige (via `allOf` de `command-envelope.v1.json`)
os campos de envelope `messageVersion`/`messageId`/`createdAt`/`correlationId` no corpo da
mensagem SQS — mas o `DispatchCommand` real construído em
`src/workers/reminder-producer/producer.ts` (e serializado como o body real via
`buildOutboxRecord`'s `payload: event.data` → relay's `JSON.stringify(payload)`) nunca teve
esses campos, só `commandType`/`tenantId`/`deduplicationKey`/`data`. Isso significa que
`reminder-dispatch-handler.ts`'s validação de schema contra o corpo real **falharia sempre**
em produção real (mensagem tratada como poison/schema-invalid) — bug pré-existente a M5, nunca
exercitado por nenhum teste (`test/integration/reminder-engine.test.ts` chama `dispatchOccurrence()`
diretamente, nunca passa pelo handler/JSON.parse/validate; `test/contract/schemas.test.ts` só
valida um exemplo de envelope escrito à mão, nunca o objeto real). **Divergência temporária e
consciente do design M5 registrada aqui**: para este contrato legado específico, a fonte real do
`correlationId` no `reminder-dispatch-handler` é `MessageAttributes.correlationId` (que o
relay/sweeper já propaga corretamente), não `record.body` como o design prescreve em geral para
SQS — isso não é evidência de que o envelope atual está correto, é uma exceção temporária até o
bug ser corrigido.

**Próxima ação real (nova, alta severidade para prontidão operacional, antes do próximo deploy
que exercite Reminder Dispatch de verdade)**: decidir formalmente o formato de wire completo de
`reminder.dispatch.v1` (adicionar `messageVersion`/`messageId`/`createdAt` reais ao
`DispatchCommand`, ou revisar o schema/envelope) — muda um contrato SQS já em uso desde M3,
provavelmente Type 1 (`AGENTS.md` §4, avaliar se precisa do protocolo Claude↔Codex) — e então
adicionar um teste de contrato real producer→outbox→relay→body JSON→validação do consumer, que
hoje não existe em lugar nenhum (o gap que deixou esse bug invisível).

**Ainda não feito (pendências explícitas do design, registradas como critério de aceite, não
"resolvido" por este `terraform plan`)**: confirmação manual da subscription SNS→e-mail (passo
humano — `infra/env/dev.tfvars`'s `alert_email`/`adot_layer_arn` são placeholders/valores a
verificar antes de um `apply` real via pipeline: e-mail real do operador, e o ARN/versão real da
ADOT layer publicada pela AWS no momento do primeiro `cd.yml` que tocar isso); teste real de
alarme→e-mail; trace real X-Ray/ADOT verificado em ambiente real (mesma pendência estrutural de
Camada 3 de M3.5/M4).

---

## Status M5 (2026-08-20, histórico — superado pela seção acima): design APPROVED (Claude 9,1 / Codex 9,3, 4 rondas reais) — implementação ainda não começou

`docs/architecture/m5-observability-design.md` está **APPROVED** (protocolo `AGENTS.md` §4).
Escopo: correlationId/tenantId contextual via `AsyncLocalStorage` (granularidade por-record em
handlers batch, propagado ponta a ponta via `DomainEvent.correlationId` — já obrigatório, sem
mudança de schema — copiado explicitamente para `OutboxRecord`, nunca lido de contexto ambiente
no momento do envio); tracing distribuído via **ADOT Lambda layer exportando para X-Ray**
(não `aws-xray-sdk-core`, SDK legado em manutenção — achado real da revisão do Codex, corrigido
na ronda 1→2); alerta real de alarme via **SNS→e-mail** com confirmação manual da subscription
registrada como critério de aceite explícito (não fechado só pelo `terraform apply`). ADR
formal: `docs/architecture/adr/ADR-0010-observability-correlation-tracing-alerting.md`.
Histórico completo das 4 rondas (nota 6,8→8,6→8,9→9,3): `docs/architecture/reviews/
m5-observability-design/codex-round{1,2,3,4}.txt`.

**Limite explícito registrado no design, não pendência a "resolver"**: APIs são HTTP API
(D-011), sem segment X-Ray nativo do API Gateway — a borda HTTP de entrada é correlacionada por
log (`correlationId`), não por span de tracing; migrar para REST API só por isso foi
explicitamente rejeitado como desproporcional a este estágio.

**Nada foi implementado ainda** — design apenas, nenhum commit de código/infra desta sessão além
dos documentos de design/ADR/decisions-log. Próxima ação real: implementar seguindo o mesmo
padrão de M3→M3.5→M4 (lógica pura → adapters/infra → testes) — a ordem sugerida pelo próprio
design é: (1) `runWithContext`/`getContext` em `src/shared/observability/` + testes de
isolamento ALS; (2) `buildOutboxRecord` copiando `correlationId` + testes de causalidade
outbox→relay→SQS + partial batch failure; (3) wiring por-record nos 12 handlers Lambda; (4)
ADOT layer + `infra/modules/lambda-function` (`adot_layer_arn`, sem default, pinado por
região+arquitetura); (5) `infra/modules/alert-topic` (SNS→e-mail) + `alarm_actions` nos alarmes
existentes; (6) confirmação manual da subscription + teste real de alarme→e-mail (passo que
depende do usuário, mesmo padrão do spike SES pendente de M4).

## Status M4 (2026-08-20, histórico — superado pela seção acima quanto à próxima ação): design APPROVED + implementação completa (Camada 1 + adapters + workflows + handlers Lambda + infra Terraform) — só falta o spike de sandbox e a rota HTTP de preferências

`docs/architecture/m4-notification-engine-design.md` está **APPROVED** (protocolo `AGENTS.md` §4, nota cega Claude 9,3/10 · Codex 9,4/10, 4 rodadas reais). Nesta sessão, M4 foi implementado de ponta a ponta seguindo o mesmo padrão de M3→M3.5 (lógica pura → adapters → composition-root workflows → handlers Lambda finos → infra Terraform), tudo commitado e pushado em `develop`, CI verde (workflow 32413826928, `conclusion: success`).

**Código de aplicação** (`src/modules/notification/`):
- `domain/` — `NotificationPreferences`, `NotificationEntitlements`, `NotificationAttempt` (+ `NotificationAttemptLookup`, ponteiro tenant-scoped, + `leaseExpiresAt`), `NotificationIntent` estendido (`kind: REPLACEMENT | CORRECTIVE`, `recipientUserId`, `routedChannels`, `cancelledChannels`).
- `ports/` — `NotificationRecipientResolver`, `EmailProviderAdapter`, `NotificationStore` (com `queryAttemptsByIntent`).
- `application/` — lógica pura (`notification-router.ts`, `quiet-hours.ts`, `corrective-intent-service.ts`, `email-delivery.ts`, `ses-callback-processor.ts`) + os 3 workflows composition-root reais: `notification-router-workflow.ts` (`routeNotificationIntent`), `email-delivery-workflow.ts` (`processEmailDelivery`), `ses-callback-workflow.ts` (`processSesCallback`) — cada um carrega entidades com leitura consistente e produz UMA `TransactWriteItems`.
- `persistence/` — `DynamoDbNotificationStore`, `DynamoDbNotificationRecipientResolver` (validação tenant-scoped em duas camadas).
- `providers/ses-email-adapter.ts` — `SesEmailAdapter` real via `@aws-sdk/client-sesv2` (nova dependência instalada), classifica falhas em CONCLUSIVE_RETRYABLE/CONCLUSIVE_TERMINAL/AMBIGUOUS.

**2 bugs reais pegos pelos testes antes de qualquer deploy**: intent REPLACEMENT/CORRECTIVE usava a versão obsoleta do item/policy em vez da atual; schema `notification-email-deliver.v1` (existente desde M3) não carregava `attemptId`, necessário para o worker saber qual `NotificationAttempt` atualizar — ambos corrigidos.

**Handlers Lambda** (`src/runtime/aws/handlers/`): `notification-router-handler.ts`, `notification-email-outbox-relay-handler.ts`, `email-delivery-handler.ts`, `ses-callback-handler.ts` (inclui parser do envelope real SNS/SES) — todos finos, mesmo padrão de `dispatch-outbox-relay-handler.ts`. `outbox-sweeper-handler.ts` generalizado para cobrir os dois destinations (reminder + notification-email) na mesma role privilegiada. `scripts/build-lambdas.ts` atualizado e verificado (12 handlers empacotam com esbuild sem erro).

**Infra Terraform** (`infra/`): módulo `reminder-queue` renomeado para `sqs-worker-queue` (genérico, SIDs sem nome de reminder — achado real da crítica cruzada de M4) e reusado para as 3 novas filas (`router`, `email-deliver`, `ses-callback`); novo módulo `ses-notifications` (SES Configuration Set → SNS → policy restrita ao topic ARN exato, nunca wildcard); 4 novos módulos `lambda-function` com IAM mínimo (nenhum dos 4 tem acesso a GSI3/GSI6); event source mappings com `ReportBatchItemFailures`. Nova variável `ses_from_address` (sem default — falha rápido até a verificação real de identidade SES). `terraform test` do módulo novo (4/4) e da stack raiz (10/10, isolamento de GSI3/GSI6 e alarmes de DLQ estendidos para os 4 novos componentes) verificados com `AWS_PROFILE=claude-dev`; `terraform plan` real: 48 a adicionar, 11 a atualizar in-place, **0 a destruir/substituir**. CI (`ci.yml`, plan-only) verde.

223/223 testes de aplicação, typecheck/lint/check-boundaries/check-docs/validate-schemas limpos em cada commit.

**Ainda NÃO feito** (próxima ação real, nenhuma bloqueante para considerar M4 "codado"):
1. **Spike de validação das tags SES em sandbox real** — `ses-callback-workflow.ts` já assume que as tags (`et_attempt_id`/`et_intent_id`/`et_tenant_id`) sobrevivem nos eventos SES reais de `DELIVERY`/`BOUNCE`/`COMPLAINT`; isso nunca foi provado contra a API real. Requer uma identidade SES verificada (manual, fora do Terraform) antes de rodar.
2. **Rota HTTP de preferências** (`PUT /notifications/preferences`) — o runtime depende de `NotificationPreferences` existir (via onboarding), mas não há endpoint para o usuário editar depois. Não bloqueia o exit criterion se um usuário de teste for criado via fixture/migração.
3. Template real de e-mail (hoje é um placeholder em `ses-email-adapter.ts`/`composition/notification.ts`) — versionado, localizado, per `templateId`+`templateVersion`.
4. Camada 3 (sandbox AWS efêmero) — mesma pendência estrutural de M3.5, nunca fechada por falta de ambiente de teste efêmero disponível nesta sessão.

Depois disso, M4 está pronto para ser considerado "implementado" no sentido pleno do design aprovado.

**Reforço explícito do usuário (2026-08-20) sobre a infra desta fase de runtime**: toda implantação na AWS é via **Terraform modularizado** (novos módulos ou reuso disciplinado dos existentes em `infra/modules/`, seguindo boas práticas — nunca um bloco monolítico de recursos soltos) e **só via pipeline** (`ci.yml` plan-only em PR, `cd.yml` apply em push a `main`, OIDC) — nunca `terraform apply` local. Já era a política vigente (ADR-0009, `AGENTS.md` §7), mas o usuário pediu para reafirmar antes da fase de infra de M4 (filas, SNS, SES, EventBridge Scheduler) começar.

## Decisão do usuário (2026-08-20): Observabilidade world-class é o passo seguinte após M4 (implementação, não só design)

**O usuário decidiu que, assim que a implementação de M4 estiver concluída (não apenas o design, que já está aprovado), o próximo passo é um milestone/ADR dedicado de Observabilidade** (correlationId/tenant propagado automaticamente no logger, tracing distribuído ponta a ponta API→SQS→Lambda→DynamoDB, destino real de notificação para alarmes) — não abrir isso em paralelo a M4, só depois.

Motivação (levantada nesta sessão, ver `docs/engineering/joint-review-criteria.md`): o tema "logging/tracing world class" não tem eixo próprio no full-audit — está fatiado em 3 critérios diferentes, cada um com achado real abaixo do gate:
- **Qualidade/Debuggability** (7.7/7.5): `SecureLogger` não propaga `correlationId`/tenant automaticamente ao contexto — precisa de mecanismo de logger contextual (ex. `AsyncLocalStorage`), não ponto-fix.
- **Segurança/Logging Seguro & Incident Response** (~5.4, bem abaixo do gate): alarmes existem mas sem destino de notificação real (SNS/PagerDuty/Slack — decisão deliberadamente adiada, `infra/lib/reminder-observability.ts:11-15`); eventos de auth negada não geram trilha de segurança dedicada.
- **Tracing distribuído**: não existe nenhuma menção a X-Ray/OpenTelemetry no código nem nos critérios formais — maior lacuna real, nenhum span cobre o pipeline ponta a ponta.

Nenhum desses 3 é corrigível como ponto-fix isolado — um milestone dedicado resolveria os três de uma vez em vez de remendar cada eixo separadamente. Avaliar no início dessa sessão futura se precisa do protocolo Claude↔Codex (§4, provavelmente sim — decisão de arquitetura transversal) antes de desenhar.

## Status mais recente (2026-08-20 — leia isto primeiro, supera tudo abaixo)

**Os 9 eixos formais do full-audit round1 (`docs/engineering/joint-review-criteria.md`) estão TODOS concluídos.** Resultado real (nota cega Claude↔Codex, `AGENTS.md` §4, sem arredondar):

| Eixo | Nota final (mais baixa dos dois lados) | Gate ≥9.0? | Classificação do que falta |
|---|---:|---|---|
| Engenharia de Contexto | Claude 9,08 / Codex 9,09 | **Sim** (5 rodadas reais) | — fechado |
| Arquitetura | ver `full-audit-round1-arquitetura-summary.md` | Não | acompanhar summary — achado real de cold-start corrigido |
| Qualidade de Engenharia | ver `full-audit-round1-qualidade-summary.md` | Não | acompanhar summary |
| Segurança da Informação e AppSec | ver `full-audit-round1-seguranca-summary.md` | Não | acompanhar summary |
| Privacidade e Governança de Dados | ver `full-audit-round1-privacidade-summary.md` | Não | endpoints DSR/purge são escopo M4+ |
| Operações/SRE e Continuidade | ver `full-audit-round1-operacoes-summary.md` | Não | acompanhar summary |
| Governança de IA e Controles Internos | ver `full-audit-round1-governanca-ia-summary.md` | Não | acompanhar summary |
| Governança Jurídica, Contratual e de Terceiros | Codex 5,015/10 | Não | 2/8 critérios são impedimento externo genuíno (parecer jurídico, DPA de fornecedor não contratado); os demais são escopo de produto/processo maior. 2 fixes reais aplicados nesta sessão (LICENSE + `docs/engineering/third-party-inventory.md`). |
| Governança de Produto e Serviço Multi-tenant | Codex 4,65/10 | Não | 1 achado de concorrência real corrigido (`TenantQuotaService` tinha lost-update sob consumo concorrente — ver `full-audit-round1-produto-summary.md`); o resto é feature de produto ainda não construída (control plane de tenant, DSR/purge, ferramenta de suporte, métricas), consistente com o estágio pré-produção. |

Só o eixo Contexto bateu o gate formal de 9.0 dos dois lados. Os outros 8 ficaram honestamente abaixo, cada achado remanescente classificado como impedimento externo real ou escopo maior — **não é falha do protocolo, é o resultado esperado de auditar um projeto pré-produção sem usuários reais, sem parecer jurídico contratado e sem frontend**: a maior parte das lacunas exige trabalho que não é ponto-fix de uma sessão de engenharia (feature de produto, contrato real, decisão de negócio). Não reabrir rodadas adicionais desses 8 eixos só para tentar empurrar a nota — só reabrir se houver achado NOVO e real, ou se o projeto avançar de estágio (ex. primeiro usuário real destrava reavaliar Privacidade/Jurídico/Produto).

**Trabalho real aplicado nesta sessão além de nota/documentação** (não apenas avaliação):
- `LICENSE` + `package.json` (`license: UNLICENSED`) — antes inexistentes.
- `docs/engineering/third-party-inventory.md` — inventário versionado de fornecedores, novo.
- **Bug de concorrência real corrigido**: `TenantQuotaService.consume()` (`src/modules/identity/application/quota.ts`) fazia read-modify-write sobre um `PutCommand` incondicional, permitindo lost-update sob consumo concorrente da mesma quota. Corrigido com `IdentityStore.updateConditional()` (CAS via `ConditionExpression`) + loop de retry limitado (20 tentativas). Teste de regressão novo prova a propriedade (25 chamadas concorrentes, `limit=10` → exatamente 10 passam). Suite: 137/137 (era 136/136), typecheck/lint/check-boundaries limpos.

**Migração CDK→Terraform (ADR-0009) e primeiro deploy AWS real já concluídos numa sessão anterior a esta** (ver `docs/architecture/adr/ADR-0009-cdk-to-terraform-migration.md`, `infra/`, `.github/workflows/{ci,cd}.yml`) — CDK removido, 95 recursos reais provisionados na conta `975707451904`/`us-east-1` via pipeline (nunca `apply` local). As seções "Mudança de rumo em G8/deploy" e "Próxima ação obrigatória (histórico)" abaixo descrevem esse trabalho como pendente — **estão desatualizadas nesse ponto específico**, preservadas como histórico de como a decisão foi tomada, não como próximo passo.

### Possíveis próximas ações reais (nenhuma delas obrigatória — julgamento do usuário)

1. Retomar M4 (Notification Engine) — é o próximo marco estrutural de produto (`implementation-blueprint.md` §19), e resolveria diretamente vários achados abaixo do gate nos eixos Produto/Privacidade (endpoints DSR, control plane de tenant, ferramenta de suporte dependem de mais superfície HTTP/produto existir).
2. Fechar os 2 fixes documentais restantes do eixo Jurídico que ainda são corrigíveis sem parecer jurídico (ex. matriz de responsabilidades regulatória, calendário de revisão) — impacto pequeno na nota, mas genuinamente ponto-fix.
3. Se o usuário quiser badge/relatório consolidado do full-audit (nota por eixo, achados corrigidos, achados pendentes) num único documento novo — ainda não existe um `docs/engineering/reviews/full-audit-round1-CONSOLIDATED.md`, só os 9 summaries individuais.

---

## Próxima ação obrigatória (2026-08-19, superada pela seção acima quanto ao full-audit — preservada como histórico da decisão original)

**A próxima sessão deve COMEÇAR (antes de qualquer outra coisa, inclusive antes de retomar G8/Camada 3 abaixo) rodando o processo formal de nota do protocolo Claude↔Codex (`AGENTS.md` §4) contra os 9 eixos já formalizados em `docs/engineering/joint-review-criteria.md`** (Arquitetura, Qualidade de Engenharia, Engenharia de Contexto, Segurança/AppSec, Privacidade e Governança de Dados, Operações/SRE e Continuidade de Negócio, Governança de IA e Controles Internos, Governança Jurídica/Contratual/Terceiros, Governança de Produto e Serviço Multi-tenant — **não** o eixo FinOps, que segue deliberadamente sem critérios).

Para cada eixo: nota inicial cega de ambos (Claude e Codex, sem ver a nota um do outro) contra o estado REAL do repositório (não contra intenção documentada) → proposta de correção pontual para cada achado abaixo de 9.0 → réplica → tréplica → repetir até nota ≥9.0 de ambos em todo eixo, sem arredondar (8.99 não vira 9) — mesmo protocolo já usado em M3.5 (design 9.0/9.3, implementação 5.8→7.4→9.3 em 3 rodadas reais).

**Única exceção ao "chegar a 9.0"**: quando o achado que impede a nota tem um impedimento real e externo que não pode ser resolvido nesta sessão. Nesse caso, registrar explicitamente qual achado ficou abaixo de 9.0, por quê, e o que destravaria a correção — nunca arredondar/ignorar/fingir que fechou. Eixos sem esse tipo de impedimento (ex. Contexto, Qualidade de Engenharia, Governança de IA) não têm desculpa para não chegar a 9.0 — se a nota vier baixa, é achado real a corrigir, não celebrar como "descoberta interessante" e deixar aberto.

Registrar o resultado de cada eixo (nota final, achados corrigidos, achados com impedimento real) em `docs/engineering/reviews/full-audit-round1-<eixo>-*` (mesmo padrão de nomenclatura já usado para `security-axis-criteria-round1-*` etc.) e um resumo consolidado no topo deste arquivo ao final.

## Mudança de rumo em G8/deploy (2026-08-19, decidida ao final desta sessão — NÃO implementada ainda)

**Credenciais AWS reais já existem** — perfil AWS CLI `claude-dev` (conta `975707451904`, `us-east-1`), confirmado funcional (`aws sts get-caller-identity --profile claude-dev`). Isso desbloqueia G8/Camada 3 em tese, **mas o usuário decidiu explicitamente NÃO fazer deploy manual via `cdk deploy` a partir da CLI** — quando perguntado, a resposta foi: **"não usamos isso. Temos que criar uma pipeline e o deploy será feito por lá via terraform. vamos continuar na próxima sessão."**

Isso muda o próximo passo real de G8/M3.5 — **não** é mais "rodar `cdk bootstrap`/`cdk deploy` localmente" como as seções abaixo (histórico) ainda descrevem. É uma decisão nova, não totalmente especificada ainda, que precisa ser esclarecida no início da próxima sessão antes de qualquer implementação (nível 5-6 de `docs/engineering/change-risk-scale.md` — mudança de ferramenta de infra é decisão Type 1, protocolo Claude↔Codex provavelmente aplicável):

- O projeto usa **AWS CDK** (`infra/lib/*.ts`, `aws-cdk-lib`) desde M1 para toda a infraestrutura. A instrução de usar Terraform não especificou se isso **substitui** CDK, **coexiste** com ele (ex. Terraform só para a pipeline/bootstrap de conta, CDK continua definindo os recursos da aplicação), ou se o CDK deveria ser **reescrito** em Terraform/HCL — não presumir nenhuma dessas opções sem perguntar.
- "Pipeline" aqui não foi definida — GitHub Actions (já existe um esqueleto em `.github/workflows/deploy-dev.yml`, feito para CDK+OIDC, provavelmente precisa ser refeito para Terraform), outra ferramenta, ou algo já decidido em outro lugar que esta sessão não viu.
- **Antes de escrever qualquer HCL**: perguntar ao usuário o escopo exato (CDK vs Terraform vs coexistência), se há um repositório/padrão de pipeline de referência (ex. o projeto irmão `event-discovery-platform` já tem `infrastructure/terraform/` com módulos e OIDC — pode ser o padrão a seguir, mas não presumir sem confirmar), e revisar `docs/engineering/change-risk-scale.md`/`AGENTS.md` §4 para decidir se isso precisa de ADR formal antes de implementar.

---

## Histórico (2026-08-19, sessão de implementação M3.5 — superado pela seção acima, preservado como contexto de G8)

Milestone M3.5 (runtime real do Reminder Engine / fechamento de G8): design **APPROVED** (Claude 9.0/Codex 9.3, `docs/architecture/m3.5-runtime-design.md`) e implementação **revisada e aprovada pelo protocolo Claude↔Codex** (`AGENTS.md` §4, 3 rodadas: 5.8 → 7.4 → **9.3/10 final**, achados reais corrigidos a cada rodada — ver `docs/architecture/reviews/m3.5-runtime-design/codex-output-implementation-*.txt`). Tudo mergeado em `main` (PRs #2 e #3): wiring CDK completo (fila+DLQ+Streams+4 EventBridge Schedules, zero placeholder `501`), 8 handlers Lambda reais, 5 adapters DynamoDB reais, outbox relay+sweeper, ciclo de vida completo dos ponteiros GSI6 (`WORKSTATE#CLAIMED`/`WORKSTATE#DST_PENDING`).

**Camada 2 do plano de testes do design (DynamoDB Local via Testcontainers) executada e verde nesta sessão** — Docker Desktop foi instalado nesta mesma sessão. `test/integration-dynamodb/` (rodar com `npm run test:dynamodb`, requer Docker; job `dynamodb-integration` no CI, não bloqueante de `guardrails`) prova o exit criterion do M3 (materialize→claim→outbox→relay→dispatch→reconciliação) contra DynamoDB Local real, não fakes. 150 testes de Camada 1 + 2 de Camada 2, tudo verde.

**[Correção pós-sessão: credenciais AWS já existem — perfil `claude-dev` — e a rota de deploy mudou para pipeline+Terraform, ver seção "Mudança de rumo" acima. O parágrafo abaixo é histórico, preservado como contexto do que ainda falta tecnicamente, não como plano de ação vigente.]**

**Pendente real, única coisa que falta para declarar G8 tecnicamente fechado**: **Camada 3 (sandbox AWS efêmero)** — não executada. Sem ela faltam: teste negativo de IAM real (`AccessDenied` em GSI3/GSI6 para role tenant-facing), redrive de DLQ real, invocação real do EventBridge Scheduler (o `Input` usa `<aws.scheduler.scheduled-time>`, sintaxe confirmada correta pela documentação AWS na revisão do Codex, mas nunca invocada de verdade). Infra de deploy já preparada: `cdk.json` + `infra/bin/app.ts` (stack `ExpirationTrackerStack-Dev`, `us-east-1` — confirmado pelo usuário como escolha de ambiente dev descartável, **não** a decisão definitiva de região de produção, que segue pendente por LGPD), `aws-cdk` CLI instalado, `.github/workflows/deploy-dev.yml` (pipeline manual via OIDC, com os 4 passos de setup de conta documentados como pré-requisito — provider OIDC, IAM role, `cdk bootstrap`, variável `AWS_DEPLOY_ROLE_ARN` — nenhum feito ainda).

**Próxima ação real**: (1) confirmar/configurar credenciais AWS (`aws sts get-caller-identity`); (2) `cdk bootstrap aws://<conta>/us-east-1` uma vez; (3) `cdk deploy` real (local, via CLI — o pipeline GitHub Actions é para depois, quando OIDC estiver configurado); (4) Camada 3 de testes contra os recursos reais implantados; (5) só então atualizar `ENGINEERING.md`/`ARCHITECTURE STATUS` declarando G8 fechado — não antes.

---

## Próxima ação obrigatória (histórico — superada pela seção acima, preservada como contexto de G8)

Engineering Maturity Review concluída (checkpoints 0, 1, 2-9, 12; ver `ENGINEERING.md` na raiz para o relatório completo). Veredito: `ENGINEERING FOUNDATION STATUS: NOT APPROVED`, bloqueador único e conhecido: **G8 (recuperação real de falha assíncrona)**.

**Decisão do usuário (2026-08-19)**: tratar o fechamento pleno de G8 como **novo milestone dedicado** (mesma disciplina de M0-M3: pesquisa/design → implementação → teste real → revisão Claude+Codex), não como remediação de sessão. Escopo desse milestone, per `ENGINEERING.md` (seção "Decisão pendente: escopo de G8"):

- Adapters DynamoDB reais implementando os ports (`ReminderStore`, `ExpirationStore`, `IdentityStore`) contra AWS real — hoje só existem fakes em memória para teste.
- Handlers Lambda reais substituindo os placeholders `exports.handler = async () => ({statusCode: 501})` em `infra/lib/expiration-tracker-stack.ts`.
- Filas SQS + DLQ com redrive policy para o pipeline producer→dispatch.
- EventBridge Scheduled Rule disparando o `ReminderProducer` periodicamente (a cada minuto) e a `ReminderReconciliation` periodicamente.
- Testes de fault injection contra esse runtime real (timeout de dependência, poison message, redrive).

Antes de começar esse milestone: ler `docs/engineering/reviews/checkpoint-12-redteam/summary.md` (red team formal já identificou 5 P1 relacionados: pipeline sem recuperação, idempotência não provada no limite do efeito externo, false-green CI, concorrência/estado obsoleto entre renew/cancel/materialização/dispatch/reconciliation, blast radius cross-tenant do GSI3 via workers privilegiados) — usar como input de design, não redescobrir do zero.

Trabalho já feito nesta sessão de engenharia (não repetir): CI real corrigido e confirmado verde em 5 execuções; branch `develop` estabelecida como padrão de trabalho (`AGENTS.md` §3), `main` protegida; `dependency-cruiser` como enforcement real de boundary (achou e corrigiu 2 violações genuínas de arquitetura); testes de `reconciliation.ts`/`producer.ts` que não existiam; tentativa de fechar a vulnerabilidade de devDependency (EX-001) via upgrade do Vitest foi revertida por quebrar CI real (bug upstream do npm, não repetir sem verificar correção).

---

**Correção de 2026-08-19 (Engineering Maturity Review, Checkpoint 2-9)**: as seções abaixo (escritas ao longo das sessões de M0-M3) afirmam "nada foi commitado" e citam contagens de teste por marco que, somadas, não batem com a realidade medida agora. Estado real verificado por execução: M0-M3 **já está commitado** num único commit (`154d6e0`), e `npm test` roda **123 testes** no total (19 arquivos), não a soma das contagens individuais citadas abaixo. As seções não foram reescritas (preservadas como histórico de sessão), mas não devem ser lidas como estado de commit/contagem de teste vigente — confiar em `git log`/`npm test` reais, não nesses números. Ver `docs/engineering/03-repository-baseline.md` e `docs/engineering/reviews/checkpoint-02-09-consolidated/` para a análise completa desta divergência.

Projeto: micro-SaaS de controle de vencimentos/renovações. Pasta: `c:\Users\Usuario\Desktop\projects\expiration-tracker\`. Repo GitHub: `marcelo-jgoncalves/expiration-tracker` (privado).

Mapa completo de documentação, status vigente e regra de precedência: `docs/architecture/README.md`. Regras de processo e ferramentas: `AGENTS.md`. Log cronológico de sessões: `docs/architecture/session-log.md`.

## Status atual

```text
DESIGN MATURITY STATUS: APPROVED (arquitetura conceitual + Implementation Blueprint)
ARCHITECTURE STATUS: NOT APPROVED
```

Todo o processo de design (Fases 0-3 do prompt mestre + os 14 entregáveis das seções 35-52 + threat model seção 33 + Implementation Blueprint seção 60) está completo e aprovado — ver `ARCHITECTURE.md` na raiz para o documento consolidado. `ARCHITECTURE STATUS: NOT APPROVED` é o estado normativo correto até haver implementação real testada sob falha/carga (rubrica B, `requirements.md` §13.1) — **não é reprovação de mérito, e não muda com a conclusão do blueprint**: o blueprint é design detalhado, não evidência operacional.

## Concluído nesta sessão — Implementation Blueprint (seção 60) — APPROVED

`docs/architecture/implementation-blueprint.md`. Componentes/módulos (Identity, Expiration, Reminder, Notification, Document, Audit + workers assíncronos), interfaces concretas, eventos/schemas reais (grounded em `data-model.md`), ordem de deploy, milestones M0-M7, critérios de aceite técnicos por componente, e as 7 lacunas do `threat-model.md` incorporadas como requisito desde o início (não apêndice). Processo: 2 propostas independentes (Claude/Codex) → crítica cruzada (17 problemas reais encontrados, incluindo um erro técnico presente nas duas propostas — chave do GSI3 do scheduler não era consultável) → convergência → 5 rodadas de nota cega com correção pontual a cada achado (cabeçalho prematuro, contradição de kill switch, tabela incompleta, decisões Type 1 não propagadas às seções operativas, mapeamento de estado da Step Functions incompleto). **Nota final: Claude 9.20 / Codex 9.2 (exato)** — ambos ≥9.0 sem arredondar, 8 rodadas totais, nenhum gate violado. Decisão Type 1 nova registrada: chave global do GSI3 (`GSI3PK=DUE#yyyyMMddHHmm#NN`, exceção documentada à regra de toda chave começar por `TENANT#tenantId`) — a decisão está fechada no blueprint; falta só o registro mecânico em `data-model.md` (não bloqueia implementação).

## Concluído nesta sessão — M0 "Guardrails e contratos" (implementation-blueprint.md §19)

Todas as entregas de M0 implementadas e testadas (53 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): estrutura TypeScript (`src/shared/*`, alinhada a `implementation-blueprint.md` §2), schemas JSON (`schemas/{events,queues,api}` + `sensitive-fields.json`, validados via Ajv em `src/shared/contracts/schema-validator.ts`), `SecureLogger`+`Redactor` central (`src/shared/observability/`, corpus de teste com valores canário provando que nada vaza), configuração tipada fail-fast (`src/shared/config/config.ts`), taxonomia de erro normalizada retryable/terminal (`src/shared/errors/app-error.ts`), idempotência via `PutItem attribute_not_exists(PK)` (`src/shared/idempotency/idempotency.ts`, chaves por operação conforme `data-model.md` §4), OCC com `ConditionExpression: version=:expected` (`src/shared/dynamodb/occ.ts`, `data-model.md` §5), outbox transacional (`src/shared/outbox/outbox.ts`, shape de `implementation-blueprint.md` §5.3), pipeline supply-chain (`.github/workflows/ci.yml`: npm ci imutável, actions pinadas por SHA, SBOM CycloneDX, audit, gate de schema). `AGENTS.md` §7 atualizado com comandos/convenções (número de seção corrigido em auditoria posterior; à época da escrita era §6, antes de `AGENTS.md` ganhar a seção de estratégia de branch como novo §3). Nada foi commitado (working tree aberto para revisão).

Judgment calls (blueprint estava silente): Ajv+ajv-formats para validação de JSON Schema; Vitest como test runner; ESLint `no-console` (com exceção para `src/shared/observability/**`) como o mecanismo que faz "chamada direta a `console.*` falhar no lint" (`implementation-blueprint.md` §14.1); idempotência/OCC/outbox construídos como builders puros de parâmetros DynamoDB (sem `@aws-sdk` ainda) para ficarem testáveis sem tabelas reais, que só existem a partir de M1; SLSA/assinatura de artefato adiada para M1+ (não há alvo de deploy ainda); SHAs de actions no CI pinados no momento da escrita — revisar antes do primeiro run real.

## Concluído nesta sessão — M1 "Foundation, Identity e isolamento" (implementation-blueprint.md §19)

Todas as entregas implementadas e testadas (89 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): `src/modules/identity/{domain,application,ports,persistence,http}` (resolver central, matriz de autorização como código, `IdentityMapping`/`User`/`DeviceSession`/`TenantQuota` via portas SDK-agnósticas) e `infra/{lib,bin}` (`ExpirationTrackerTable`, `ExpirationTrackerAuth`, `ScopedLambdaFunction`, `ExpirationTrackerApi` com a rota `GET /test/ping`). Suíte cross-tenant negativa em `test/integration/cross-tenant.test.ts` (9 casos, exit criterion do marco) e synth de infra em `test/infra/stack.test.ts` (6 casos, via `aws-cdk-lib/assertions`, sem AWS CLI). Detalhe completo em `docs/architecture/session-log.md`.

Judgment calls (blueprint silente ou pendência externa já conhecida): (1) MFA implementado como prop configurável (`OFF`/`OPTIONAL`/`REQUIRED`, default `OPTIONAL`) pois UNK-006 segue pendente de pesquisa externa — não bloqueava M1; (2) CSP/CloudFront Response Headers Policy **não implementado nesta sessão** — não há distribuição CloudFront/frontend ainda no repositório, e o texto do blueprint (§4.2) coloca CSP no contexto do SPA estático servido por CloudFront; tratado como pertencente ao milestone que introduzir o frontend, não forçado em M1 (revisar se essa leitura estiver errada); (3) sessão/revogação modelada como campo `globalLogoutAfter` no item `User` + item filho `DeviceSession` (`TENANT#t#USER#u`/`SESSION#<deviceId>`) em vez de uma entidade `Session` de primeira classe — `data-model.md` não define uma; (4) `ScopedLambdaFunction` mantém a lista de entidades por capability como metadado/documentação, mas o IAM real concedido é table-level (`grantReadWriteData`) — DynamoDB IAM não expressa restrição por SK/entidade da forma que a sintaxe do blueprint sugere visualmente; per-entity IAM mais fino fica como follow-up; (5) `TenantQuota` implementado como janela fixa (fixed-window), não sliding-window/leaky-bucket — mais simples e ainda satisfaz "decremento atômico, sem race condition" do `data-model.md`; (6) BFF de sessão (`/session/refresh`, `/session/logout`) **não implementado como rota HTTP nesta sessão** — o Cognito client já está configurado para o padrão (client secret, tokens de vida curta), mas os endpoints do BFF em si ficam para quando a Expiration/Notification API skeleton crescer além da rota de teste; revisar se isso deveria ter sido parte do exit criterion. `cdk synth` real via CLI não foi executado (o pacote `aws-cdk` CLI não está instalado, só a lib `aws-cdk-lib`); a sintetização foi verificada programaticamente via `Template.fromStack` nos testes, que é equivalente para fins de validação estática.

## Concluído nesta sessão — M2 "Expiration core e Audit" (implementation-blueprint.md §19)

Todas as entregas implementadas e testadas (134 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): `src/modules/expiration/{domain,application,ports,http}` — CRUD/renew (`ExpirationService`: createItem/getItem/updateItem/archiveItem/deleteItem/renewItem/listDashboard), OCC via `shared/dynamodb/occ.ts`, `ItemDueDateChanged` por outbox (`shared/outbox/outbox.ts`) na MESMA `TransactWriteItems` do item quando `dueDate` muda (updateItem e renewItem), `AuditEvent` append-only gravado em toda mutação na mesma transação, dashboard via GSI1. `renewItem` cria um item sucessor (`renewedFromId`) em vez de mutar `dueDate` no agregado de origem, que transiciona para `RENEWED`; é idempotente via `IdempotencyStore` de M0. Rotas HTTP CDK adicionadas em `infra/lib/api.ts`/`expiration-tracker-stack.ts` (`ItemsHandler`, mesmo authorizer JWT de M1). Suíte de integração `test/integration/expiration-lifecycle.test.ts` prova o exit criterion do marco end-to-end via handlers HTTP reais. Detalhe completo em `docs/architecture/session-log.md`.

Judgment calls (blueprint silente): (1) evento `ItemDueDateChanged` segue exatamente o schema já existente desde M0 (`schemas/events/item-due-date-changed.v1.json`: `itemId`/`previousDueDate`/`newDueDate`/`itemVersion`, `additionalProperties: false`) em vez do exemplo mais rico do texto do blueprint §8.3 (que inclui `timeZone`/`reminderPolicyId`/`changeReason`) — o schema já testado/versionado é a fonte de verdade de contrato per `AGENTS.md` §7, o exemplo em prosa não; campos adicionais ficam para quando M3 (Reminder) precisar deles, exigindo `.v2` aditivo; (2) `renewItem` também dispara `ItemDueDateChanged` (para o item novo, `previousDueDate: null`) — o blueprint só descreve esse evento no contexto de `updateItem`, mas renovação também é uma "mudança de vencimento" do ponto de vista do futuro `ReminderProducer` (M3), e a alternativa (renovação silenciosa) deixaria o dashboard/scheduler sem sinal de que um novo item precisa de agendamento; (3) `archiveItem` usa a ação de autorização `item:update` (não uma ação dedicada — a matriz de M1 não define uma para archive) enquanto `deleteItem` usa `item:delete` (ADMIN_ROLES), seguindo a granularidade que já existe; (4) idempotência de renovação aceita uma `idempotencyKey` explícita do chamador (header `Idempotency-Key`) com fallback determinístico `itemId|expectedVersion|cycle` quando ausente, já que o blueprint define a CHAVE de dedupe mas não de onde ela vem por HTTP; (5) `ExpirationStore.transactWrite` foi adicionado ao port (não existe em `IdentityStore`) porque nenhuma escrita de M1 precisava de `TransactWriteItems` multi-item — a fake em memória (`test/unit/expiration/in-memory-store.ts`) só entende as duas formas exatas de `ConditionExpression` que este código produz (mesma limitação documentada, mesmo espírito de `InMemoryIdentityStore`).

## Concluído nesta sessão — M3 "Reminder Engine" (implementation-blueprint.md §19)

Todas as entregas implementadas e testadas (123 testes, `npm test`/`typecheck`/`lint`/`validate-schemas` verdes): `src/modules/reminder/{domain,application,ports,http}` (policies CRUD, `ReminderMaterializer` com conversão local→UTC IANA-aware — DST tratado explicitamente, horário inexistente e ambíguo — reagindo a `ItemDueDateChanged` via `cancelStaleOccurrences`) e `src/workers/{reminder-producer,reminder-dispatch,reminder-reconciliation}` (lógica pura testável com relógio falso). GSI3 com shard versionado (`shardFnVersion`) e producer com janela de lookback `[M-5min, M]`; dispatch faz `CLAIMED→TRIGGERED`+`NotificationIntent`+outbox numa única transação; reconciliação é um único job (claim-expiry + DST). Exit criterion provado end-to-end em `test/integration/reminder-engine.test.ts`. **Bug real de infraestrutura corrigido**: `Table.grantReadWriteData`/`grantReadData` do CDK sempre incluíam `<tableArn>/index/*`, vazando `dynamodb:Query` no GSI3 para QUALQUER função da tabela (inclusive as tenant-facing de M1/M2) — a salvaguarda de isolamento documentada desde M1 nunca foi de fato aplicada. Corrigido em `infra/lib/dynamo-table.ts` com `PolicyStatement`s explícitos; teste de isolamento novo em `test/infra/stack.test.ts` prova via CDK synth que só `ReminderProducer` referencia `/index/GSI3`. Detalhe completo em `docs/architecture/session-log.md`.

Judgment calls (blueprint silente): (1) `occurrenceId` derivado deterministicamente (hash da chave de idempotência de data-model.md §4) em vez de UUID + registro `IdempotencyStore` separado — o próprio `putIfAbsent` condicional já garante a idempotência de materialização, mesmo padrão que data-model.md documenta para `WebhookInbox`; (2) cancelamento de ocorrência stale não remove `GSI3PK`/`GSI3SK` (o builder de `occ.ts` é SET-only, sem REMOVE) — deixa um ponteiro órfão no índice, mas o `Query` condicional `SCHEDULED→CLAIMED` do producer falha sobre ele de forma inofensiva; (3) tolerância de dispatch (`toleranceMs`, default 30min) e TTL de claim (default 2min) não estão fixados no blueprint — valores razoáveis documentados no código, revisar contra dados reais de produção; (4) reconciliação DST/claim-expiry recebe os candidatos como parâmetro (batch) em vez de fazer sua própria varredura via GSI6 — a wiring desse índice de "políticas ativas"/"claims expirados" real fica como follow-up de infra, o mecanismo de reconciliação em si (o que a tarefa pediu) está implementado e testado; (5) Lambda handlers reais (bundling com `@aws-sdk`) não foram escritos — mesmo estágio que M0-M2, CDK usa código inline placeholder via `ScopedLambdaFunction`; a lógica testável é o entregável real desta fase, igual às anteriores.

## Próxima ação obrigatória (histórico — superada pela seção do topo)

**Superada em 2026-08-19**: a Engineering Maturity Review identificou G8 (recuperação real de falha assíncrona) como bloqueador de engenharia — o milestone de runtime real (adapters/handlers/filas/EventBridge, ver seção do topo) é pré-requisito antes de M4 fazer sentido operacionalmente, ainda que M4 não dependa dele estruturalmente. Lista original preservada abaixo como histórico, não como próxima ação vigente.

1. **M4 — Notification Engine** (`implementation-blueprint.md` §19, depende de M3 ✅): router de `NotificationIntent`→canal, delivery workers (email/WhatsApp stub-first), `NotificationAttempt`, resolução de destinatário/template.
2. Decidir e fechar os itens abaixo (BFF de sessão como rotas reais, CSP/CloudFront quando o frontend existir) antes de considerar a lacuna de "session theft" do threat model totalmente fechada — ainda não resolvido, re-flagueado a cada sessão desde M1 para não se perder: M1 fechou o mecanismo de revogação/matriz de autorização, não o endpoint BFF completo; M2/M3 não tinham escopo de frontend/sessão (confirmado no blueprint) então também não o resolveram.
3. **Ratificar formalmente em `data-model.md` a exceção do GSI3** (chave global do scheduler, já decidida e justificada em `implementation-blueprint.md` §9.2/§23.3 item 10) — passo de manutenção documental, não nova rodada de debate. M3 já corrigiu o enforcement real do isolamento em IAM; falta só o registro mecânico no documento.
4. Wiring real do GSI6 (ou índice equivalente) para alimentar a reconciliação de M3 com o batch real de "políticas ativas"/"claims a verificar" em produção — hoje o mecanismo de reconciliação recebe esse batch como parâmetro injetado (testável), a query real fica pendente.
5. Testes de carga real (cenários de drenagem do pico extremo, `capacity-model.md`, com SLO de drenagem UNK-CAP-006 a formalizar em `slo.md` antes do gate de M7), teste de restore real (gate já definido em `disaster-recovery.md` §6), exercício do runbook de credencial comprometida.
6. Reavaliação sob rubrica (B) — Operational Evidence — só então `ARCHITECTURE STATUS` pode legitimamente virar `APPROVED`. **Não declarar isso antes de haver evidência operacional real.** Implementar M0/M1/M2/M3 não é evidência operacional.
7. Decisões ainda pendentes de pesquisa externa (não bloqueiam M4 estruturalmente, mas bloqueiam habilitar os canais/features específicos, ver `implementation-blueprint.md` §23.3): provider inicial de e-mail, BSP WhatsApp (pricing real, UNK-003), modelo Bedrock específico, região AWS (bloqueante para LGPD/transferência internacional), MFA obrigatório vs. opcional (UNK-006), ferramenta de backup S3 (RPO≤24h), ferramenta de assinatura/provenance do pipeline de CI.
