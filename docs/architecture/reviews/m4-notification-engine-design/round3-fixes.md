# M4 — Rodada 3: fechamento dos achados de rodada 2 (Claude 8,6 / Codex 8,4)

Achados combinados das duas notas cegas de rodada 2 (`claude-score-round2.md`, `codex-score-round2.md`). Convergência: nenhuma tréplica necessária — os dois avaliadores concordam no diagnóstico onde se sobrepõem (#7 é bloqueante para ambos) e nenhum discorda de mérito nas correções propostas um pelo outro. Fechamentos abaixo entram como texto normativo no design de rodada 2 (`docs/architecture/m4-notification-engine-design.md`).

## 1. Lookup de `NotificationAttempt` (achado #1 de ambas as notas — bloqueante)

**Decisão fechada**: item ponteiro tenant-scoped, criado atomicamente na mesma `TransactWriteItems` que cria a tentativa:

```text
PK = TENANT#<tenantId>#ATTEMPT#<attemptId>
SK = LOOKUP
→ { intentPk, attemptSk, tenantId, provider, providerAccountId }
```

O `SesCallbackWorker` lê este ponteiro primeiro (via tags SES → `attemptId`), depois relê a tentativa base pela chave completa, e valida tenant/provider/account antes de aplicar qualquer transição. Sem isso, redesenhar a SK da tentativa para ser derivável só de `attemptId` foi descartado — o ponteiro generaliza melhor para múltiplos canais futuros (WhatsApp) sem redesenhar a chave de `NotificationAttempt` outra vez.

## 2. Correlação de callback: tags como pré-condição validada + fallback GSI5 completo (achado #2 do Codex)

**Decisões fechadas**:
- A presença das tags SES (`et_attempt_id`, `et_intent_id`, `et_tenant_id`) nos três tipos de evento habilitados (`DELIVERY`, `BOUNCE`, `COMPLAINT`) é uma **pré-condição técnica a validar no início da implementação** (spike de Camada 3/sandbox), não uma hipótese que fica pendurada até o fim do milestone — se a validação falhar, o fallback abaixo já é a especificação normativa, não uma reação improvisada.
- Comportamento por ausência de tag: se `et_tenant_id`/`et_attempt_id` estiverem ausentes **e** não houver tenant confiável resolvido por outra via (ex. `providerMessageId` já persistido localmente antes do callback chegar), o evento é marcado `UNMATCHED` no `WebhookInbox` e alarmado — **nunca** dispara `Query` global/scan entre tenants.
- GSI5 permanece **tenant-scoped** (não é o mesmo erro estrutural do GSI3/GSI6, que são globais por necessidade de um worker sem tenant conhecido a priori) — aqui o fallback só é acionado quando *já* existe um tenant confiável a partir da tentativa/intent local, então não há necessidade de índice global. Registrar esta justificativa explicitamente no design para não ser reaberta por engano numa sessão futura pensando que é a mesma classe de erro do GSI3/GSI6 (achado #2 da nota de Claude).

## 3. Intent corretivo: separar `REPLACEMENT` de `CORRECTIVE` (achado #3 do Codex)

**Decisão fechada** (adota a proposta do Codex): dois `kind` distintos de `NotificationIntent`, não um só:

- **`REPLACEMENT`**: item mudou de versão **antes** de qualquer tentativa `ACCEPTED`/`DELIVERED`/`UNKNOWN` existir para o intent stale — o intent antigo é `CANCELLED` (`STALE_ITEM_VERSION`) e um novo intent `REPLACEMENT` é criado com o conteúdo atual, como se fosse a primeira vez (nenhuma comunicação stale chegou a sair).
- **`CORRECTIVE`**: já existe tentativa `ACCEPTED`/`DELIVERED`/`UNKNOWN` para o intent stale — o destinatário pode já ter recebido conteúdo desatualizado, então o novo intent explicitamente comunica a correção (template diferente, referencia o envio anterior).

Cada `kind` tem template próprio, chave idempotente própria (`tenantId|supersededIntentId|currentItemVersion|REPLACEMENT` vs. `...|CORRECTIVE`) e a mesma regra de `supersedesIntentId` para rastreabilidade.

## 4. Política de `UNKNOWN`: ratificada como normativa (achado #4 do Codex)

**Decisão fechada**: at-most-once automático é a política final, não uma proposta.
- Nenhum retry automático de tentativa `SUBMITTING` ou `UNKNOWN`.
- Callback pode reconciliar `UNKNOWN` para um estado terminal quando chega evidência.
- Redrive de uma tentativa `UNKNOWN` exige decisão operacional explícita e `redriveGeneration` incrementado — nunca automático.
- Trade-off aceito e documentado: prefere possível perda de notificação a duplicação automática silenciosa.

## 5. Rate limiting do SES: critério objetivo (achado #5 do Codex)

**Decisão fechada**: antes de declarar M4 pronto para o sandbox real, consultar a quota de envio (rate) da conta SES do ambiente de teste e provar por teste de carga simples que `reserved/max concurrency` do `EmailDeliveryWorker` mantém o ritmo efetivo abaixo dessa quota. Se a quota do sandbox for baixa o suficiente para isso ser trivial (é o caso típico de conta SES em sandbox), o bucket agregado `TENANT#__SYSTEM__#PROVIDER#SES#<accountAlias>` **não** entra no escopo mínimo de M4 — só entra se o teste de carga mostrar que concurrency sozinha não basta. Throttling conclusivo do SES (`ThrottlingException`) é sempre retryable sem criar nova tentativa lógica (a mesma tentativa `PREPARED`/`SUBMITTING` é reprocessada, não uma nova).

## 6. Achados exclusivos da nota de Claude, também fechados

- **DLQ de `SesCallbackQueue`**: confirmado que sim, tem DLQ própria com `maxReceiveCount=5` (a lista de alarmes da proposta base já assumia isso implicitamente — agora é frase explícita no design).
- **Teste de regressão para isolamento cross-tenant do destinatário**: novo caso de teste de Camada 1 obrigatório: "`assigneeUserId` aponta para usuário de outro tenant → `NotificationRecipientResolver` retorna `undefined` → canal cancelado com `RECIPIENT_NOT_ELIGIBLE` → nenhum e-mail enfileirado", espelhando o padrão já usado na suíte cross-tenant de M1.

## Próximo passo

Atualizar `docs/architecture/m4-notification-engine-design.md` incorporando os 7 fechamentos acima como texto normativo (não mais "itens abertos"), e rodar uma terceira nota cega curta (confirmação, não descoberta) para validar que ambos os lados agora fecham ≥9.0.
