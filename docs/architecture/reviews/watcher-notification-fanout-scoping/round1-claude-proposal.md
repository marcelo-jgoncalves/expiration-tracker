# Watcher Notification Fan-out (Roadmap P1 item 13, metade 1/2) — Rodada 1 (proposta Claude)

Escopo: fechar a metade que falta de um design JÁ `APPROVED`
(`07-domain-model-escalation-watchers-digest.md`, Fase 2b, Claude 9,2/Codex 9,4) —
`ItemWatch` foi desenhado como parte da AUDIÊNCIA de notificação (`ASSIGNEE`/`OWNER`/
`WATCHERS`/`EXTERNAL_CONTACT`), mas só a metade CRUD (`addWatcher`/`removeWatcher`/
`listWatchers`) foi construída; nenhum worker hoje lê `ItemWatch` para notificar. Nível 5
(muda o contrato de `NotificationIntent`, entidade já em produção/versionada) — protocolo
`AGENTS.md` §4 aplicável apesar da intenção de produto já estar aprovada, porque o MECANISMO
concreto (como múltiplos intents por ocorrência se diferenciam) não foi especificado naquele
design original.

**Achado que motivou esta investigação, corrigido no ato**: ao escopar isto, uma leitura
completa da cadeia `dispatchOccorrence→routeNotificationIntent→applyRoutedDecision→
email-delivery-workflow.ts` revelou um bug crítico pré-existente e não relacionado —
`recipientUserId` nunca era persistido no intent, então todo e-mail real falhava antes de
chamar a SES. **Corrigido separadamente, já mergeado (D-199)**, antes desta proposta — esta
rodada assume esse fix já em vigor (o mecanismo abaixo depende dele estar correto).

## Pesquisa externa considerada

`SIM PARCIAL` (fonte: prática de mercado consolidada sobre notificação por "watchers" em
issue trackers, consultada 2026-09-05 — Jira: "quando um evento dispara, a lista de
destinatários correspondentes é computada como união deduplicada, um e-mail por destinatário
final"). Escopo informado por pesquisa: **um destinatário que é TANTO assignee QUANTO watcher
do mesmo item recebe UMA notificação, nunca duas** (achado direto da pesquisa, corrige uma
lacuna que a proposta original não tinha nomeado). **Forma física de `NotificationIntent`/
idempotência/schema de evento é decisão puramente interna** — nenhuma pesquisa de mercado
decide layout de chave DynamoDB deste projeto.

## Achados de escopo real (leitura direta do código)

- `dispatchOccurrence()` (`src/workers/reminder-dispatch/dispatch.ts`) cria exatamente UM
  `NotificationIntent` por ocorrência disparada, sem nenhum recipiente embutido na entidade —
  o destinatário é resolvido DEPOIS, no router, a partir de `item.assigneeUserId`
  (`resolveCandidateUserId`).
- `NotificationIntent.recipientUserId?: string` já existe no schema (usado só PÓS-roteamento,
  ver D-199) — reaproveitar o MESMO campo para pré-atribuir um destinatário watcher criaria
  ambiguidade de significado (pré-roteamento "quem é o alvo pretendido" vs. pós-roteamento
  "quem foi confirmado") — proposta abaixo usa um campo distinto.
- Idempotência de dispatch é chaveada só por `occurrenceId`
  (`buildIdempotencyKey(..., "reminder.dispatch", occurrenceId)`) — criar N intents da MESMA
  ocorrência colide nessa mesma chave `ConditionExpression attribute_not_exists` se não for
  ajustada.
- `ItemWatch` (`item-watch-service.ts`) não tem nenhum teto de quantidade hoje — nunca
  importou porque nunca alimentava um fan-out transacional; passa a importar aqui.
- Schema do evento `notification.intent-created.v1` é `additionalProperties: false` — qualquer
  campo novo precisa entrar explicitamente no schema (aditivo, nunca quebra consumidores
  existentes que ignoram campos desconhecidos, mas o AJV valida contra `additionalProperties`).

## Checklist de critérios pesados

1. **(25%) Dedupe: um usuário que é assignee E watcher recebe UMA notificação.** Atende:
   `dispatchOccurrence` monta o conjunto de destinatários (assignee + watchers ACTIVE) e
   deduplica por `userId` ANTES de criar intents — nunca duas linhas de intent para o mesmo
   destinatário na mesma ocorrência. Não atende: criar um intent por watcher sem checar
   sobreposição com o assignee.
2. **(20%) Idempotência por destinatário, não só por ocorrência.** Atende: a chave de
   idempotência de dispatch passa a incluir o destinatário (`occurrenceId + recipientUserId`
   ou equivalente), então N intents da mesma ocorrência nunca colidem entre si nem impedem
   reprocessamento correto. Não atende: manter a chave só por `occurrenceId` (quebraria a
   partir do 2º destinatário).
3. **(20%) Cada intent carrega seu próprio alvo pretendido, sem reinterpretar
   `recipientUserId` pré-roteamento.** Atende: campo novo e distinto (não reaproveita
   `recipientUserId`, que continua exclusivamente pós-roteamento per D-199); o router
   revalida o alvo pretendido no MOMENTO do roteamento (watcher ainda ACTIVE + membro
   elegível), nunca confia cegamente no que foi escrito na criação. Não atende: reaproveitar
   `recipientUserId` para dois significados diferentes ao longo do ciclo de vida do intent.
4. **(15%) Teto explícito de watchers por item, justificado pelo limite real de
   `TransactWriteItems`.** Atende: `addWatcher` ganha um cap (nível de engenharia, escolhido
   com folga contra o teto de 100 ações da transação de dispatch, mesmo raciocínio do cap 30
   de `RequirementTemplate`/D-191). Não atende: deixar `ItemWatch` sem teto agora que alimenta
   uma transação com custo proporcional ao número de watchers.
5. **(10%) Schema do evento `notification.intent-created.v1` estendido de forma aditiva.**
   Atende: campo novo opcional, `additionalProperties: false` preservado, teste de contrato
   novo prova exemplo válido/inválido. Não atende: mudar o schema de forma que quebre um
   consumidor existente silenciosamente.
6. **(10%) Reuso do restante do pipeline sem duplicação.** Atende: o MESMO
   `routeNotificationIntent`/`processEmailDelivery`/preferências/entitlements/quiet-hours já
   existentes processam cada intent de watcher exatamente como processam o de assignee hoje —
   nenhum código novo de roteamento/entrega, só a origem do candidato muda. Não atende:
   qualquer branch de lógica de entrega específico para watcher.

## Decisões propostas

### D-1. Campo novo, distinto de `recipientUserId`

```ts
// NotificationIntent, campos novos (aditivos, opcionais - intents existentes sem eles
// continuam válidos e são tratados como ASSIGNEE, comportamento de hoje):
targetKind?: "ASSIGNEE" | "WATCHER";
targetWatcherUserId?: string; // só quando targetKind === "WATCHER"
```

`recipientUserId` continua exclusivamente pós-roteamento (D-199), nunca lido/escrito na
criação.

### D-2. `dispatchOccurrence` monta o conjunto deduplicado de destinatários

```ts
const watchers = await store.queryByPk<ItemWatch>(itemKey(...).PK, ITEM_WATCH_SK_PREFIX);
const activeWatcherIds = new Set(watchers.filter(w => w.status === "ACTIVE").map(w => w.userId));
if (item.assigneeUserId) activeWatcherIds.delete(item.assigneeUserId); // dedupe (critério 1)
const targets = [
  ...(item.assigneeUserId ? [{ kind: "ASSIGNEE" as const }] : []),
  ...[...activeWatcherIds].map(userId => ({ kind: "WATCHER" as const, userId })),
];
```

Um `NotificationIntent` por `target`, todos na MESMA `TransactWriteItems` que já grava a
transição `CLAIMED→TRIGGERED` da ocorrência (nenhuma transação nova, só mais `Put`s na já
existente).

### D-3. Idempotência por destinatário

`buildIdempotencyKey(..., "reminder.dispatch", `${occurrenceId}#${target.kind}${target.kind === "WATCHER" ? `#${target.userId}` : ""}`)` — uma linha de idempotência por destinatário,
nunca uma só por ocorrência.

### D-4. Router revalida o watcher no momento do roteamento

`routeNotificationIntent` passa a resolver o candidato assim: se `intent.targetKind ===
"WATCHER"`, o candidato é `intent.targetWatcherUserId` **E** uma leitura fresca confirma que a
linha `ItemWatch` correspondente ainda está `ACTIVE` (mesma disciplina "nunca confiar em dado
antigo" já usada para `item.assigneeUserId`) — se o watcher foi removido entre a criação do
intent e o roteamento, cai em `RECIPIENT_NOT_ELIGIBLE`, mesmo caminho já existente. Se
`targetKind` ausente ou `"ASSIGNEE"`, comportamento idêntico ao de hoje (`item.assigneeUserId`).

### D-5. Teto de watchers por item

`addWatcher` ganha um cap (proposta: 20 — a transação de dispatch já carrega ~5 itens fixos
por ocorrência mais ~2 por destinatário; 20 watchers + 1 assignee = 21 destinatários × 2 = 42
itens, confortavelmente abaixo do teto de 100). Retorna erro claro (`ValidationError` ou
similar) ao tentar exceder.

### D-6. Schema de evento estendido

`notification.intent-created.v1` ganha `targetKind`/`targetWatcherUserId` opcionais, mesma
disciplina de `properties`/`additionalProperties: false`; teste de contrato novo.

## Pendências fora de escopo desta rodada

- MANAGER-escalation (a outra metade do item 13) — decisão distinta, candidata a rodada
  própria depois desta fechar (agora desbloqueada pela RBAC real, D-198).
- Digest — segue deferido com gatilho quantitativo nomeado no design original, inalterado.
- `EXTERNAL_CONTACT` — assimetria intencional do design original, inalterada.
