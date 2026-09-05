# Watcher Notification Fan-out — Rodada 2 (revisão Claude)

Rodada 1 do Codex: régua 8,2/10, design 8,4/10 contra ela — régua contestada (faltava
cobertura do caminho `REPLACEMENT`/`CORRECTIVE`). 1 bloqueante real + 2 correções menores.

## Ajuste da régua (v2 — só o texto do critério 3 muda, peso igual)

Critério 3 (D-1/D-4 do Rodada 1) agora exige explicitamente: "Atende: `targetKind`/
`targetWatcherUserId` são preservados verbatim em QUALQUER intent `REPLACEMENT`/`CORRECTIVE`
derivado (ambos os call sites de staleness — `routeNotificationIntent`'s próprio check E
`email-delivery-workflow.ts`'s check via `applyStaleDeliveryDecision`, mesma função
`applyStaleDecision` por trás dos dois). Não atende: um intent corretivo silenciosamente
default para `ASSIGNEE` porque o campo não foi copiado do intent superseded."

## Correção 1 — Bloqueante real: propagação de alvo em intents corretivos

**Confirmado por leitura**: `applyStaleDecision()` (`notification-router-workflow.ts:168`)
constrói `newIntent` copiando campo a campo do `intent` superseded (`itemId`/`occurrenceId`/
`policyId`/`requestedChannels`/etc.) — `targetKind`/`targetWatcherUserId` (D-1 da Rodada 1)
precisam entrar nessa MESMA lista de campos copiados, senão um intent de watcher que fica
stale vira um `REPLACEMENT`/`CORRECTIVE` que aponta para o assignee errado (ou pior, para
`item.assigneeUserId` atual, um usuário diferente do watcher pretendido). Correção:

```ts
const newIntent: NotificationIntent = {
  // ...campos já existentes, inalterados...
  targetKind: intent.targetKind,
  targetWatcherUserId: intent.targetWatcherUserId,
  // ...
};
```

Única mudança em `applyStaleDecision` — a função já é compartilhada pelos dois call sites
(`routeNotificationIntent`'s STALE branch e `email-delivery-workflow.ts`'s `isStale` branch
via `applyStaleDeliveryDecision`), então corrigir aqui fecha os dois de uma vez, sem precisar
duplicar a correção.

## Correção 2 — Matemática do teto de transação, corrigida

**Erro reconhecido**: "~2 itens por destinatário" estava errado — cada destinatário produz
`NotificationIntent Put` + `IdempotencyRecord Put` (D-3) + `OutboxEvent Put` (cada
`NotificationIntent` criado é seu próprio evento `notification.intent-created.v1`, aggregate
id = aquele `intentId` — nunca compartilhado entre destinatários) = **3 itens por
destinatário**, não 2. Entradas fixas por ocorrência (Update da ocorrência + 2
`ConditionCheck` de fence) = 3. Cap 20 watchers + 1 assignee = 21 destinatários × 3 = 63,
mais as 3 fixas = **66 itens**, ainda confortavelmente abaixo do teto de 100 de
`TransactWriteItems` (34 de folga). Cap 20 permanece a proposta, agora com a aritmética
correta.

## Correção 3 — Pesquisa, fonte auditável

Fontes diretas (consultadas 2026-09-05): Atlassian — "Configuring email notifications" (Jira
Data Center, https://confluence.atlassian.com/adminjiraserver110/configuring-email-notifications-1627460683.html):
quando um usuário aparece em mais de uma lista de destinatários da mesma notificação, recebe
apenas UMA notificação (a primeira lista em que aparece, não uma por lista) — sustenta
especificamente o critério 1 (dedupe), não qualquer decisão de layout físico interno deste
projeto. Atlassian — "Configure notification schemes" (Jira Cloud,
https://support.atlassian.com/jira-cloud-administration/docs/configure-notification-schemes/):
confirma assignee e watchers como fontes distintas do mesmo evento de notificação, sujeitas à
mesma regra de permissão de visualização antes do envio (paralelo ao próprio
`MemberEligibilityChecker`/`ItemWatch.status===ACTIVE` que este design já reaproveita).

## Demais pontos da Rodada 1 — sem mudança de design, só de precisão do texto

Nenhum outro bloqueante levantado; D-1 a D-6 do Rodada 1 permanecem como estavam, com as 3
correções acima aplicadas.
