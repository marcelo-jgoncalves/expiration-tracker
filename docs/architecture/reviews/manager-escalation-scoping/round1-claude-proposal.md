# MANAGER Escalation (Roadmap P1 item 13, fio 2/2) — Rodada 1 (proposta Claude)

Escopo: fecha o item 13 do backlog P1 por completo (fio 1, watcher fan-out, já `APPROVED`+
implementado em D-200). `MANAGER` como audience de notificação foi explicitamente adiado em
2026-08-19 (`11-phase3-impacts-and-closing.md` linha 202: "Adiado até Organization real —
Pressupõem hierarquia organizacional que não existe") — condição que não vale mais desde as
waves B2B (Membership/RBAC real). Nível 5 (`change-risk-scale.md` — novo tipo de audience de
notificação, estende `ReminderTrigger`/`NotificationIntent`, cruza a fronteira
reminder→organization pela primeira vez neste worker) — protocolo `AGENTS.md` §4 aplicável.

## Pesquisa externa considerada

`SIM` (fontes consultadas 2026-09-05): Atlassian — "Ticket Escalation in Jira SLA: What It Is
+ 8 Ways to Manage It" (https://community.atlassian.com/forums/App-Central-articles/Ticket-Escalation-in-Jira-SLA-What-It-Is-8-Ways-to-Manage-It/ba-p/2758664):
escalação é modelada como uma AÇÃO AUTOMATIZADA disparada por um TIMER de SLA (não um agente de
IA decidindo "ninguém agiu") — quando o timer de SLA se aproxima/estoura, uma regra de
automação notifica lead/gestor, e o próprio ticket pode ser reatribuído. Zendesk — "Ticket
escalation: what it is + 8 ways to manage it" (https://www.zendesk.com/blog/customer-service/ticketing-system/ticketing-system/art-ticket-escalation-process/):
mesmo padrão — regra de tempo, não inferência de inação. **Padrão convergente**: escalação =
UM GATILHO DE TEMPO A MAIS (nunca uma lógica de "detectar inação"), disparado
independentemente de qualquer confirmação humana. Isso simplifica o design: não preciso
inventar um conceito novo de "ação reconhecida" — a MESMA maquinaria de `ReminderTrigger` já
usada para os lembretes normais serve, só apontando para uma audiência diferente.

## Achados de escopo real

- `ReminderOccurrence.triggerId` já existe e é preenchido pelo materializer — cada ocorrência
  sabe de qual `ReminderTrigger` da política ela veio. `dispatchOccurrence()` já carrega
  `occurrence`/`policy` antes de decidir o que criar — o trigger específico é só um lookup em
  `policy.triggers.find(t => t.triggerId === occurrence.triggerId)`, sem leitura nova.
- `MemberEligibilityChecker` (Wave B2B-11, `expiration/ports/member-eligibility.ts`) já
  estabeleceu o padrão exato para cruzar a fronteira `expiration→organization`: porta estreita
  no módulo CONSUMIDOR, implementação real só no composition root
  (`runtime/aws/composition/expiration.ts`), nunca um import direto de `organization`'s
  physical model. `ListMembersService` (`organization/application/list-membership.ts`) já
  reaproveita `queryByPk(organizationKey(tenantId).PK, "MEMBER#")` — sem GSI novo, sem `Scan`.
- Lambda `reminder_dispatch` já tem `tenant_facing_read_write_policy_json` — cobre a partição
  `TENANT#t#ORG#...` que `Membership` usa, nenhuma policy IAM nova necessária.
- D-200 já entrega o mecanismo de "N intents por ocorrência, um por destinatário,
  `targetKind` discriminando a audiência, revalidado fresco no roteamento" — MANAGER é um
  TERCEIRO valor de `targetKind`, reusando a FORMA inteira, não um mecanismo paralelo.

## Checklist de critérios pesados

1. **(25%) Escalação é um trigger de tempo a mais, nunca inferência de "ninguém agiu".**
   Atende: um novo `ReminderTrigger` com `audience: "MANAGER"` na MESMA lista `triggers[]` já
   existente, com seu próprio `offsetIso`/`localTime` (tipicamente positivo, depois do
   vencimento) — dispara pela MESMA maquinaria de materialização/claim/dispatch, sem novo
   conceito de estado "reconhecido". Não atende: qualquer worker que decida escalar com base em
   "o assignee não abriu o lembrete" ou equivalente.
2. **(20%) Reuso total do mecanismo de D-200 — `targetKind` ganha um 3º valor, nunca um
   pipeline paralelo.** Atende: `NotificationIntent.targetKind` alarga para
   `"ASSIGNEE"|"WATCHER"|"MANAGER"`; `dispatchOccurrence()` cria 1 intent por manager elegível
   (mesma forma de fan-out/dedupe/idempotência já construída); router revalida o manager
   fresco no roteamento (mesmo padrão do watcher). Não atende: uma nova entidade/fila/worker
   para escalação.
3. **(20%) Fronteira `reminder→organization` cruzada por porta estreita, mesmo padrão de
   `MemberEligibilityChecker`.** Atende: porta nova (`ports/tenant-manager-lookup.ts` ou
   equivalente) no módulo consumidor, implementação real só no composition root, nunca um
   import direto do physical model de `organization` dentro de `src/workers/`/`src/modules/reminder/`.
   Não atende: `dispatch.ts` importando `organizationKey()`/`Membership` diretamente.
4. **(15%) Dedupe cross-audience: um MANAGER que também é assignee/watcher do item recebe
   UMA notificação.** Atende: o conjunto deduplicado de D-200 (assignee+watchers) é
   estendido para excluir também qualquer manager que já esteja nesse conjunto — mesmo
   princípio já `APPROVED`/pesquisado em D-200 (Jira: união deduplicada de audiências).
   Não atende: um manager que é assignee recebendo duas notificações.
5. **(10%) Trigger de escalação é opcional, nunca obrigatório em toda política.** Atende:
   `ReminderPolicy` sem nenhum trigger `audience: "MANAGER"` continua funcionando exatamente
   como hoje (aditivo, opt-in por política/tenant). Não atende: forçar toda política existente
   a ganhar uma escalação.
6. **(10%) `MANAGER` é definido por papel real (`Membership.role`), nunca uma lista
   configurável separada.** Atende: managers elegíveis = toda `Membership` `ACTIVE` com
   `role IN (OWNER, ADMIN)` no tenant (reaproveita a MESMA hierarquia de RBAC já `APPROVED`,
   D-097/D-098) — nenhum campo novo de "quem é manager" fora do RBAC existente. Não atende:
   uma lista de destinatários de escalação configurada separadamente do RBAC real.

## Decisões propostas

### D-1. `ReminderTrigger` ganha `audience` opcional

```ts
export interface ReminderTrigger {
  triggerId: string;
  offsetIso: string;
  localTime: string;
  audience?: "ASSIGNEE_AND_WATCHERS" | "MANAGER"; // default ASSIGNEE_AND_WATCHERS
}
```

### D-2. `NotificationIntent.targetKind` ganha `"MANAGER"`

`targetKind?: "ASSIGNEE" | "WATCHER" | "MANAGER"`. Um intent `MANAGER` carrega
`targetWatcherUserId`? Não — proposta: reaproveitar o MESMO campo `targetWatcherUserId` como
"o userId do alvo, seja watcher OU manager" (renomear seria churn desnecessário em produção;
alternativa é um campo genérico `targetUserId` substituindo `targetWatcherUserId` — decisão
explícita para a crítica: qual dos dois o Codex prefere).

### D-3. Porta nova, mesmo padrão de `MemberEligibilityChecker`

```ts
// src/modules/reminder/ports/tenant-manager-lookup.ts
export interface TenantManagerLookup {
  listActiveManagers(tenantId: string): Promise<{ userId: string }[]>;
}
```
Implementação real no composition root do `reminder-dispatch-handler`, reaproveitando
`queryByPk(organizationKey(tenantId).PK, "MEMBER#")` + filtro `status===ACTIVE && role IN
(OWNER, ADMIN)` — mesma leitura que `ListMembersService` já faz, sem `Scan`, sem GSI novo.

### D-4. `dispatchOccurrence()` resolve a audiência pelo trigger que disparou

```ts
const trigger = policy.triggers.find(t => t.triggerId === occurrence.triggerId);
if (trigger?.audience === "MANAGER") {
  const managers = await deps.managerLookup.listActiveManagers(tenantId);
  targets = managers.map(m => ({ kind: "MANAGER", userId: m.userId }))
    .filter(t => t.userId !== item.assigneeUserId && !watcherUserIds.has(t.userId)); // dedupe cross-audience
} else {
  targets = [...forma já existente de D-200...]; // ASSIGNEE + WATCHERS
}
```
Uma ocorrência de escalação NUNCA mistura os dois conjuntos — o trigger que a materializou já
decide a audiência inteira daquele disparo.

### D-5. Router revalida MANAGER fresco, mesmo padrão do watcher

`routeNotificationIntent`: se `targetKind === "MANAGER"`, revalida via `TenantManagerLookup`
(ou uma leitura direta da `Membership`, a definir na próxima rodada) que o candidato ainda é
`ACTIVE`+`role IN (OWNER,ADMIN)` antes de rotear — nunca confia no valor da criação.

## Pendências explicitamente fora desta rodada

- Nome exato do campo (`targetWatcherUserId` reaproveitado vs. `targetUserId` genérico) —
  decisão de forma, não de princípio, fica para a Rodada 2 conforme a crítica.
- Mecanismo exato de revalidação do manager no router (via a mesma porta `TenantManagerLookup`
  ou um `GetItem` direto na `Membership`) — D-5 acima é a direção, não o mecanismo físico final.
- UI/configuração de quando adicionar um trigger `MANAGER` a uma política — fora de escopo
  (roadmap item 11, frontend, adiado para semana que vem).
