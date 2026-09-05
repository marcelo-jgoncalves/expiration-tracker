# Watcher Notification Fan-out — Estado Final Consolidado

**Status**: `APPROVED` via protocolo Claude↔Codex, 2 rodadas. Régua v2 estável (Claude
9,2/Codex 9,2), design final Claude 9,1/Codex 9,1 — ambos ≥9,0. Fecha a metade que faltava de
`07-domain-model-escalation-watchers-digest.md` (já `APPROVED`, Claude 9,2/Codex 9,4) — a
audiência de notificação (`ItemWatch`) tinha CRUD mas nenhum fan-out real.

Histórico: `round1-claude-proposal.md` (proposta + achado do bug D-199 no caminho + pesquisa
E-014 SIM PARCIAL), `round2-claude-revision.md` (fecha o bloqueante real: propagação de
`targetKind`/`targetWatcherUserId` em intents `REPLACEMENT`/`CORRECTIVE`, correção de
aritmética do teto transacional, fontes com URL+data).

## Decisões finais (D-1 a D-6)

- **D-1**: `NotificationIntent` ganha `targetKind?: "ASSIGNEE" | "WATCHER"` +
  `targetWatcherUserId?: string` (aditivo, opcional — intents existentes sem os campos
  continuam válidos, tratados como `ASSIGNEE`). `recipientUserId` (D-199) permanece
  exclusivamente pós-roteamento, nunca reaproveitado como alvo pretendido.
- **D-2**: `dispatchOccurrence()` monta o conjunto DEDUPLICADO de destinatários (assignee +
  watchers `ACTIVE`, removendo do conjunto de watchers qualquer userId que já seja o
  assignee) e cria 1 `NotificationIntent` por destinatário, todos na MESMA
  `TransactWriteItems` que já existe.
- **D-3**: Idempotência de dispatch passa a incluir o destinatário na chave
  (`occurrenceId#targetKind[#watcherUserId]`), nunca só `occurrenceId`.
- **D-4**: `routeNotificationIntent` resolve o candidato a partir de `intent.targetKind`: se
  `"WATCHER"`, revalida que `intent.targetWatcherUserId` ainda é um `ItemWatch` `ACTIVE`
  (nunca confia no valor da criação); se ausente/`"ASSIGNEE"`, comportamento idêntico ao de
  hoje (`item.assigneeUserId`). `applyStaleDecision()` (compartilhada pelos 2 call sites de
  staleness — router e delivery worker) propaga `targetKind`/`targetWatcherUserId` verbatim
  para qualquer intent `REPLACEMENT`/`CORRECTIVE` derivado.
- **D-5**: `ItemWatch` ganha teto de 20 por item (`addWatcher` recusa além disso) — aritmética
  real: 21 destinatários (20 watchers + 1 assignee) × 3 itens de transação
  (`NotificationIntent` Put + `IdempotencyRecord` Put + `OutboxEvent` Put) + 3 entradas fixas
  (Update da ocorrência + 2 `ConditionCheck`) = 66 ações, dentro do teto de 100.
- **D-6**: `schemas/events/notification-intent-created.v1.json` ganha `targetKind`/
  `targetWatcherUserId` opcionais, teste de contrato novo.

## Pendências, não bloqueantes para o design

- Testes devem cobrir explicitamente o caminho de staleness de um intent `WATCHER` nos 2 call
  sites, provando que `targetKind` não degrada para `ASSIGNEE` (apontado pelo Codex como
  residual de implementação, não bloqueante de design).
- MANAGER-escalation (a outra metade do item 13 do roadmap P1) segue como decisão distinta,
  candidata a rodada própria.

## Próxima ação

Implementação direta — nível de risco já resolvido pelo protocolo, sem rodada nova salvo
achado real durante a implementação.
