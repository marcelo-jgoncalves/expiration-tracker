# MANAGER Escalation — Estado Final Consolidado

**Status**: `APPROVED` via protocolo Claude↔Codex, 2 rodadas. Régua v2 estável (Claude
9,2/Codex 9,2), design final Claude 9,1/Codex 9,1. Fecha por completo o item 13 do backlog P1
("Escalation/múltiplos destinatários") — fio 1 (watcher fan-out) já implementado em D-200.

Histórico: `round1-claude-proposal.md` (proposta + pesquisa E-014 SIM — Jira SLA/Zendesk,
escalação como gatilho de tempo, nunca inferência de inação), `round2-claude-revision.md`
(fecha os 5 bloqueantes da Rodada 1: teto transacional, nome de campo genérico, elegibilidade
em 2 camadas, dedupe revogado cross-trigger, mecanismo de revalidação via porta).

## Decisões finais (D-1 a D-5, forma pós-Rodada 2)

- **D-1**: `ReminderTrigger` ganha `audience?: "ASSIGNEE_AND_WATCHERS" | "MANAGER"` (aditivo,
  default = comportamento atual).
- **D-2**: `NotificationIntent.targetWatcherUserId` (D-200) é RENOMEADO para `targetUserId?:
  string` — usado por `WATCHER` e `MANAGER`, nunca por `ASSIGNEE`. Renomeação de um campo
  mergeado há poucas horas, sem migração (zero `NotificationIntent` reais em `dev` hoje,
  D-093/`AGENTS.md` §1).
- **D-3**: Porta nova `TenantManagerLookup` (`src/modules/reminder/ports/`):
  `listActiveManagers(tenantId)` (fan-out, capado a `MAX_MANAGER_ESCALATION_RECIPIENTS=20`,
  truncamento auditável) e `isActiveManager(tenantId, userId)` (revalidação single-target no
  router). Candidato = `Membership ACTIVE`+`role IN (OWNER,ADMIN)` **E**
  `GlobalUser.identityStatus ACTIVE` (2 camadas, mesmo padrão de `MemberEligibilityChecker`).
  Implementação real só no composition root do `reminder-dispatch-handler`.
- **D-4**: `dispatchOccurrence()` resolve a audiência pelo `ReminderTrigger` que materializou a
  ocorrência (via `occurrence.triggerId`); um trigger `MANAGER` cria 1 intent por manager
  elegível (capado), **sem** dedupe cross-audience (revogado da Rodada 1 — um manager que
  também é assignee/watcher de um trigger DIFERENTE ainda recebe a escalação; dedupe só dentro
  do próprio fan-out, trivial via `Set`).
- **D-5**: `routeNotificationIntent` revalida `targetKind==="MANAGER"` via
  `deps.managerLookup.isActiveManager(...)`, nunca confia no valor da criação — mesmo
  princípio já aplicado a `WATCHER`.

## Pendência de implementação, não de design

Extrair a checagem "Membership ACTIVE+role E GlobalUser ACTIVE" para uma função utilitária
compartilhada entre `MemberEligibilityChecker` e `TenantManagerLookup` (evitar duplicar a
leitura dupla em 2 composition roots) — decisão de forma de código, não de design.

## Próxima ação

Implementação direta — nível de risco já resolvido pelo protocolo, sem rodada nova salvo
achado real durante a implementação.
