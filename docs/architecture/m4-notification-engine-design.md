# M4 — Notification Engine — Design (APPROVED)

Status: **APPROVED** (protocolo `AGENTS.md` §4, Type 1, nota cega Claude 9,3/10 · Codex 9,4/10 — rodada 4/confirmação, ambos ≥9.0 sem arredondar). Histórico: rodada 1 produziu duas propostas independentes (`docs/architecture/reviews/m4-notification-engine-design/codex-proposal-round1.md` e `claude-proposal-round1.md`), crítica cruzada em `round1-cross-critique.md`, 3 decisões de produto em `round1-decisions-resolved.md`. Rodada 2 (nota cega contra o convergido): Claude 8,6/10, Codex 8,4/10 — abaixo do gate, achados em `claude-score-round2.md`/`codex-score-round2.md`. Rodada 3 fechou 7 achados combinados (`round3-fixes.md`); nota de rodada 3 (Codex 8,8/10) apontou 2 ajustes finos (consistência forte do lookup + estado `SUBMITTING` faltando no critério REPLACEMENT/CORRECTIVE), corrigidos e confirmados na rodada 4 (`claude-score-round4.md`/`codex-score-round4.md`). **Design pronto para implementação.**

## Documento base

**A proposta do Codex (`codex-proposal-round1.md`) continua a base técnica** — ler o documento inteiro como especificação de referência para tudo que não está listado como delta ou fechamento aqui.

## Deltas de rodada 2 (decisões de produto, já fechados)

Ver `round1-decisions-resolved.md` para o registro completo. Resumo:

1. **Consentimento default** (decisão de Marcelo): `NotificationPreferences` criado automaticamente no onboarding (M1) com `emailEnabled: true`, `consentSource: "ONBOARDING"` — e-mail de lembrete é transacional/essencial, não marketing.
2. **Resolução de destinatário** (convergência técnica Claude↔Codex): `candidateUserId = item.assigneeUserId ?? tenantId`, resolvido por `NotificationRecipientResolver` que **exige perfil ativo e pertencimento ao mesmo tenant** — `assigneeUserId` inválido/cross-tenant nunca cai silenciosamente para o dono; cancela com `RECIPIENT_NOT_FOUND`/`RECIPIENT_NOT_ELIGIBLE`, auditável.
3. **Política de complaint** (decisão de Marcelo): complaint do SES sempre gera supressão local automática e permanente do e-mail daquele destinatário.

## Fechamentos de rodada 3 (achados combinados das duas notas cegas de rodada 2)

Ver `round3-fixes.md` para o detalhe e justificativa completos. Texto normativo:

1. **Lookup de `NotificationAttempt`** (achado bloqueante nas duas notas): item ponteiro tenant-scoped, criado atomicamente com a tentativa — `PK=TENANT#<tenantId>#ATTEMPT#<attemptId>`, `SK=LOOKUP` → `{ intentPk, attemptSk, tenantId, provider, providerAccountId }`. Criação usa `ConditionExpression: attribute_not_exists(PK)` na mesma `TransactWriteItems` da tentativa (nunca sobrescreve um ponteiro existente — colisão de `attemptId` é tratada como erro de geração de ID, não como update silencioso). `SesCallbackWorker` lê o ponteiro **e** a tentativa base com `ConsistentRead: true` (via tag `et_attempt_id`), valida tenant/provider/account antes de qualquer transição — leitura eventualmente consistente poderia encontrar o ponteiro antes da tentativa estar visível, mesmo sendo a mesma transação.
2. **Correlação de callback — tags como pré-condição validada + fallback GSI5 completo**: presença das tags SES (`et_attempt_id`/`et_intent_id`/`et_tenant_id`) nos 3 eventos habilitados é validada como primeiro passo da implementação (spike de Camada 3), não deixada pendente até o fim. Ausência de tag **e** nenhum tenant confiável já resolvido localmente → `WebhookInbox.processingStatus = UNMATCHED`, alarmado, **nunca** `Query`/scan global. GSI5 permanece tenant-scoped (justificativa registrada: diferente do GSI3/GSI6, aqui o fallback só roda quando já há tenant confiável a partir do estado local — não é a mesma classe de erro estrutural já cometida duas vezes no projeto).
3. **Intent corretivo — dois `kind` distintos, não um só**, predicado pelo estado da tentativa mais recente do intent stale (não apenas por um subconjunto de estados terminais — `SUBMITTING` é justamente o estado em que o limite externo pode ter sido atravessado sem confirmação, e precisa cair do lado conservador):
   - **`REPLACEMENT`** (nenhuma entrega possível): nenhuma tentativa existe, ou a mais recente está em `PREPARED`, `FAILED_RETRYABLE`, `FAILED_TERMINAL` ou `NOT_SENT_STALE`. Intent antigo `CANCELLED`/`STALE_ITEM_VERSION`, novo intent como se fosse a primeira comunicação.
   - **`CORRECTIVE`** (entrega stale possível ou comprovada): tentativa mais recente em `SUBMITTING`, `ACCEPTED`, `DELIVERED`, `UNKNOWN`, `BOUNCED` ou `COMPLAINED` — comunica a correção explicitamente, referenciando o envio anterior. `BOUNCED`/`COMPLAINED` entram aqui mesmo sendo estados que indicam falha de entrega, porque a tentativa de envio real ocorreu (o destinatário ou o provider já reagiram ao conteúdo stale).

   Chaves idempotentes distintas (`...|REPLACEMENT` vs. `...|CORRECTIVE`), templates distintos.
4. **Política de `UNKNOWN` — ratificada, não mais proposta**: at-most-once automático é definitivo. Nenhum retry automático de `SUBMITTING`/`UNKNOWN`; callback pode reconciliar; redrive exige decisão operacional + `redriveGeneration` incrementado; trade-off aceito é possível perda em vez de duplicação automática silenciosa.
5. **Rate limiting do SES — critério objetivo antes do sandbox real**: consultar a quota de envio da conta SES do ambiente de teste; provar por teste de carga simples que `reserved/max concurrency` do `EmailDeliveryWorker` mantém o ritmo abaixo dela. Bucket agregado `TENANT#__SYSTEM__#PROVIDER#SES#<accountAlias>` só entra no escopo se esse teste mostrar que concurrency sozinha não basta (não é escopo mínimo garantido de M4). `ThrottlingException` do SES é sempre retryable sobre a mesma tentativa lógica, nunca cria tentativa nova.
6. **`SesCallbackQueue` tem DLQ própria**, `maxReceiveCount=5` — confirmado explicitamente (a lista de alarmes da base já assumia isso implicitamente).
7. **Teste de regressão obrigatório de Camada 1** para o isolamento cross-tenant do destinatário (delta 2 de rodada 2): `assigneeUserId` de outro tenant → `NotificationRecipientResolver` retorna `undefined` → canal cancelado `RECIPIENT_NOT_ELIGIBLE` → nenhum e-mail enfileirado. Espelha o padrão da suíte cross-tenant de M1.

## Itens que seguem como follow-up técnico de implementação (não bloqueiam nota, concordância das duas notas de rodada 2)

- #3 (custo/escala do EventBridge Scheduler por mensagem adiada) — mecanismo normativo já escolhido (rodada 1); validar idempotência do nome do schedule, limpeza e corrida schedule-vs-redelivery durante a implementação.
- #11 (eventos de domínio de delivery) — só criar se houver consumidor real; estado durável + `AuditEvent` bastam para o exit criterion do milestone.
- #12 (escopo da API de preferências em M4) — não bloqueia o exit criterion se onboarding/migração criam o registro e a Camada 3 prepara o usuário de teste; decidir escopo da rota HTTP antes de declarar M4 funcional para usuários reais, não antes de iniciar o runtime.

## Próximo passo

Design aprovado — implementação de M4 pode começar. Início recomendado: spike de validação das tags SES (fechamento #2) antes de escrever o `NotificationRouter`/`EmailDeliveryWorker`, já que o fallback normativo depende do resultado desse spike. Seguir a estrutura de componentes de `codex-proposal-round1.md` §12 (código, schemas, infra Terraform, IAM) e a estratégia de testes em 3 camadas de §13.
