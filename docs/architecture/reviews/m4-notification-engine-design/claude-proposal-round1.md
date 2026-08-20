# M4 — Notification Engine — Design (Rodada 1, proposta Claude)

Status: **PROPOSTA — Rodada 1 do protocolo de nota cega** (protocolo `AGENTS.md` §4, Type 1 — contratos de router/entitlement/preferências; adapters de provider são Type 2). Esta é a proposta inicial de Claude, produzida sem ver a proposta independente do Codex (`codex-proposal-round1.md`). Superada pela convergência em `docs/architecture/m4-notification-engine-design.md` (rodada 2) — preservada aqui como histórico do protocolo de nota cega, não como especificação vigente.

Escopo fixado por `implementation-blueprint.md` §19 (M4): router; preferências, entitlement e quiet hours; fila de e-mail (sem kill switch); provider sandbox/test account; attempts; callbacks; DLQs. Depende de M3 (`NotificationIntent` já criado deterministicamente, sem delivery externo) e M1 (quotas/entitlement). WhatsApp é submilestone posterior (kill switch AppConfig `WHATSAPP`), não bloqueia e-mail.

Decisão conceitual já fixada (`architecture-fase3-consolidada.md` §9, ADR-0008): SQS por canal + adapter com contrato comum (envelope + payload específico por canal, sem campo genérico tipo `usaTemplate`) + contract tests. Este documento é a especificação de runtime que falta para tornar isso implementável, no mesmo nível de detalhe que `m3.5-runtime-design.md` deu ao Reminder Engine.

## 1. Fluxo ponta a ponta

`NotificationIntent` (status `PENDING`, já existe desde M3) → **Router** decide se e como despachar → `NotificationAttempt` criado → mensagem no `EmailDeliverQueue` (schema `notification-email-deliver.v1.json`, já existe) → `EmailDeliveryWorker` chama o provider → callback assíncrono do provider atualiza `NotificationAttempt` → `NotificationIntent.status` transiciona para `DISPATCHED` (ou permanece `PENDING`/vira `CORRECTIVE` se o item mudou de versão).

O Router é um worker novo (`NotificationRouter`), não o mesmo Lambda que grava o `NotificationIntent` em M3 — ele é acionado pela criação do intent (via Streams, mesmo padrão do `DispatchOutboxRelay`) e decide **se** despachar, não apenas roteia burro para a fila.

## 2. Router: decisão de despacho

Gatilho: DynamoDB Streams sobre `NotificationIntent` (`NEW_IMAGE`, filtro por `entityType=NotificationIntent` e `status=PENDING`), `reportBatchItemFailures: true` — mesmo padrão do `DispatchOutboxRelay` (M3.5), não um mecanismo novo.

Para cada intent `PENDING`, o Router resolve, nesta ordem, cada uma capaz de impedir o despacho (fail-closed — qualquer falha de resolução impede o envio, nunca assume "permitido" por omissão):

1. **Revalidação de versão do item** (FR-014, mesmo princípio do M3.5 dispatch): `GetItem` no `ExpirationItem`; se `itemVersion` do intent ≠ versão atual, o Router não descarta silenciosamente — grava um novo `NotificationIntent` com `kind: CORRECTIVE`, `supersedesIntentId` apontando para o original, e marca o original `CORRECTIVE` (campo já existe no schema). O intent corretivo é o único que segue para a fila.
2. **Entitlement**: `TenantQuota`/plano (M1, `src/modules/identity/application/quota.ts`) — se o tenant não tem o canal habilitado no plano, o intent vira `CANCELLED` com razão registrada (auditoria, não silêncio).
3. **Opt-out**: preferências do destinatário (nova entidade — ver §3). Opt-out por canal cancela só aquele canal do `requestedChannels`; se todos os canais requisitados forem opt-out, o intent inteiro vira `CANCELLED`.
4. **Quiet hours**: se o horário de despacho cai dentro da janela de silêncio do destinatário (timezone-aware, mesma lib IANA já usada em M3 para DST), o Router **não descarta nem despacha atrasado silenciosamente** — reagenda: grava `deliverNotBefore` no comando SQS como o próximo instante fora da janela (SQS `DelaySeconds` tem teto de 15 min, insuficiente para uma janela de horas — por isso `deliverNotBefore` é campo do payload, avaliado pelo `EmailDeliveryWorker`, não pelo SQS; mensagem entregue cedo é reenfileirada pelo próprio worker com `changeMessageVisibility`, não descartada). **[Correção da rodada de crítica cruzada: esse mecanismo está tecnicamente incorreto — SQS tem teto de 12h de visibility timeout; a proposta convergida adota o EventBridge Scheduler one-shot do Codex.]**

Somente após as 4 checagens passarem (ou o reagendamento ser aplicado) o Router grava, na mesma `TransactWriteItems`: `NotificationAttempt` (`status: QUEUED`, `attemptNumber: 1`) + `OutboxEvent` com `destination: "SQS_NOTIFICATION_EMAIL_V1"` (mesmo padrão do `destination` discriminador do M3.5 — reusa `shared/outbox/outbox.ts`, nenhum mecanismo de outbox paralelo). Um relay dedicado (`NotificationOutboxRelay`, mesma estrutura do `DispatchOutboxRelay`) publica no `EmailDeliverQueue`; sweeper próprio (`OutboxSweeperNotificationEmail`, 5 min) cobre a mesma lacuna de "claim sem publicação" já resolvida em M3.5 — **é o mesmo padrão de outbox-entre-decisão-e-fila, não uma exceção nova**: qualquer decisão do Router que resulte em mensagem de fila passa por esse caminho, nunca por `SendMessage` direto no handler do Router.

## 3. Preferências e quiet hours — nova entidade

`NotificationPreference` (nova, não estava em `data-model.md`): `TENANT#t#USER#u` / `PREF#NOTIFICATION`. Campos: `optOutChannels: ("EMAIL"|"WHATSAPP")[]`, `quietHours: { start: string; end: string; timezone: string } | null` (formato `HH:mm`, mesma timezone IANA de `ReminderPolicy`), `version`. Fallback quando o registro não existe: nenhum opt-out, sem quiet hours (não fail-closed aqui — ausência de preferência configurada é o estado normal de um usuário novo, diferente de ausência de entitlement, que é sempre fail-closed). Escrita via rota HTTP nova (`PUT /notifications/preferences`), OCC padrão (`shared/dynamodb/occ.ts`). **[Superado pela decisão de rodada 2: onboarding cria o registro com opt-in default, não deixa o fallback implícito acima ser o comportamento real.]**

## 4. Fila de e-mail e adapter de provider

`EmailDeliverQueue` (SQS Standard, já tem schema) + DLQ, `maxReceiveCount=5`, batch size 10, `reportBatchItemFailures: true` — mesmos parâmetros já documentados em `implementation-blueprint.md` §26 para as filas de M3. **Sem kill switch** (decisão já fixada no escopo do milestone — e-mail é canal essencial; WhatsApp é o único com toggle AppConfig).

`EmailDeliveryWorker`: revalida `deliverNotBefore` (reagenda via `changeMessageVisibility` se ainda dentro da janela, não descarta); resolve o template (`templateId`/`templateVersion` do payload — templates versionados, nenhuma renderização de conteúdo arbitrário do usuário sem sanitização, mesma disciplina de SEC-004 do M6/AI mas aplicada aqui a template injection); chama o `EmailProviderAdapter` (porta nova, contrato comum do ADR-0008: `send(input): Promise<{ providerMessageId: string }>`, erros mapeados para a taxonomia de `shared/errors/app-error.ts` — throttling do provider é retryable, endereço inválido é terminal); grava `NotificationAttempt.status = SENT` com `providerMessageId` via `update` condicional (OCC).

**Provider**: Amazon SES em sandbox/test mode para este milestone (não um provider fake) — decisão já registrada no escopo ("provider sandbox/test account"). SES sandbox exige endereços verificados; contract test do adapter roda contra a API real do SES sandbox (não mock), mesma disciplina de Camada 2/3 do M3.5 (containers não provam integração com provider externo real — só a Camada 3/sandbox AWS prova isso).

Idempotência do lado do provider (P1 #2 do red team, explicitamente deixado aberto por M3.5 como "problema de M4"): `SendEmailCommand` do SES não aceita um idempotency key de aplicação nativamente da mesma forma que SQS FIFO — a garantia aqui vem de **duas camadas**: (a) o próprio `NotificationAttempt` é criado antes do envio com `attemptNumber` determinístico (`intentId`+`attemptNumber` como chave), então duas entregas SQS do mesmo comando batem no mesmo item via `update` condicional em vez de criar dois attempts; (b) se a Lambda cai **depois** do SES aceitar o envio e **antes** de gravar `SENT`, o attempt fica `QUEUED` além do timeout de visibilidade e o SQS reentrega — isso pode gerar um e-mail duplicado real (SES não é idempotente do lado do provider). Aceito como risco residual documentado (não fechado por esta sessão) — mitigação: `receiveCount` do SQS é registrado no attempt; se `receiveCount > 1` ao processar, o worker checa primeiro se um `NotificationAttempt` com esse `providerMessageId` já existe antes de reenviar (não elimina a janela, reduz a probabilidade prática). Fechar completamente exigiria SES com idempotency token nativo ou um lock distribuído antes do `SendEmailCommand` — registrado como item aberto, não resolvido aqui. **[Superado pela proposta convergida: estados `SUBMITTING`/`UNKNOWN`/`NOT_SENT_STALE` explícitos, mais rigorosos que este "risco residual documentado".]**

## 5. Callbacks (bounce/complaint/delivery)

SES publica notificações de entrega/bounce/complaint via SNS. Tópico SNS → SQS (`EmailCallbackQueue`) → `EmailCallbackHandler` (Lambda) atualiza `NotificationAttempt.status` (`DELIVERED`/`FAILED`/`UNKNOWN` conforme `data-model.md` §2) via `update` condicional por `providerMessageId` (GSI novo ou item lookup — a decidir na revisão: `providerMessageId` não é chave nativa do item, precisa de um índice ou de carregar por `intentId`+`attemptNumber` embutido no callback do SES via `Message.Tags`, a confirmar contra a API real do SES antes de fixar). Callback para um `providerMessageId` desconhecido (fora de ordem, ou de um attempt já limpo por retenção) é logado e descartado sem erro — não é fail-closed, é um evento tardio esperado. **[Superado: proposta convergida usa tags SES como correlação primária, não só GSI.]**

## 6. Componentes do milestone

1. Domínio: `NotificationPreference` (nova entidade), `EmailProviderAdapter` (porta), extensão do `NotificationIntent`/`NotificationAttempt` já existentes (nenhuma mudança de schema retroativa — `NotificationAttempt` já não existe como código, só como linha de `data-model.md`; este milestone é quem a implementa pela primeira vez).
2. Handlers Lambda novos: `NotificationRouter` (Streams sobre `NotificationIntent`), `NotificationOutboxRelay` (Streams, `destination` filtrado), `OutboxSweeperNotificationEmail` (Scheduler, 5 min), `EmailDeliveryWorker` (SQS `EmailDeliverQueue`), `EmailCallbackHandler` (SQS `EmailCallbackQueue`), rota HTTP `PUT /notifications/preferences`.
3. Infra: `EmailDeliverQueue`+DLQ, `EmailCallbackQueue` (sem DLQ própria inicialmente — callback perdido não é crítico da mesma forma que envio perdido; a decidir na revisão se isso é aceitável), tópico SNS de feedback do SES, `OutboxSweeperNotificationEmail` Schedule (5 min, mesmo padrão do M3.5).
4. Testes: Camada 1 (unit: 4 checagens do Router isoladas e combinadas; contract test do `EmailProviderAdapter` contra fake); Camada 2 (DynamoDB Local para paridade adapter; LocalStack para Streams+SQS+SNS reais); Camada 3 (sandbox AWS — SES sandbox real, endereço verificado, teste de bounce simulado via endereço de teste do SES `bounce@simulator.amazonses.com`).

## 7. O que este milestone explicitamente NÃO fecha

- WhatsApp (submilestone posterior, kill switch próprio).
- Idempotência completa do lado do provider (risco residual documentado em §4, não eliminado).
- DSR/purge de dados de notificação (achado aberto do eixo Privacidade do full-audit — depende de mais superfície de produto, não deste milestone especificamente).
- Rate limiting/token bucket por provider (mencionado no fluxo conceitual do ADR-0008 como responsabilidade de M4, mas não detalhado aqui ainda — item aberto para a revisão decidir se entra no escopo mínimo ou fica para hardening).

## 8. Itens abertos para a rodada de crítica

- Formato exato de correlação callback→attempt (`providerMessageId` como chave de busca — GSI dedicado vs. tags do SES) não está fechado; depende de confirmar a API real do SES antes de fixar o desenho de índice.
- Se `EmailCallbackQueue` precisa de DLQ própria.
- Se rate limiting por provider entra no escopo mínimo deste milestone ou é adiado.
