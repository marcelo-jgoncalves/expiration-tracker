# MANAGER Escalation — Rodada 2 (revisão Claude)

Rodada 1 do Codex: régua 7,8/10, design 7,3/10 contra ela — régua contestada (faltava
critério de teto transacional). 5 bloqueantes reais, todos endereçados abaixo.

## Checklist reconciliado (v2)

Adiciona 1 critério novo (teto do fan-out), corrige o critério 2 (nome do campo) e o
critério 4 (dedupe) da v1; pesos redistribuídos.

1. **(20%, era 25%)** Escalação é gatilho de tempo, nunca inferência de inação. Inalterado.
2. **(15%) NOVO — Fan-out de MANAGER é limitado, nunca pode estourar o teto de 100 ações de
   `TransactWriteItems`.** Atende: teto explícito (`MAX_MANAGER_ESCALATION_RECIPIENTS`),
   truncamento registrado e auditável (nunca silencioso sem rastro) se um tenant tiver mais
   managers ativos que o teto. Não atende: assumir que o número de `OWNER`/`ADMIN` é sempre
   pequeno sem um teto real que prove isso.
3. **(15%, era 20%) Reuso total do mecanismo de D-200 — `targetKind` ganha um 3º valor.**
   Inalterado.
4. **(15%, era 20%) Fronteira `reminder→organization` cruzada por porta estreita.** Inalterado.
5. **(15%) Campo de alvo é genérico desde a criação — reflete a union discriminada real, nunca
   um nome específico de canal reaproveitado para outro propósito.** Atende: `targetUserId`
   (renomeado de `targetWatcherUserId`) — `WATCHER`/`MANAGER` exigem o campo, `ASSIGNEE` nunca
   o usa. Não atende: qualquer reaproveitamento de nome específico de watcher para outro alvo.
6. **(10%) MANAGER é definido por papel real, EM DUAS CAMADAS — Membership+role E identidade
   global ativa.** Atende: candidato precisa de `Membership ACTIVE`+`role IN (OWNER,ADMIN)` **E**
   `GlobalUser.identityStatus ACTIVE` (mesmo padrão de 2 camadas que `MemberEligibilityChecker`
   já exige para toda elegibilidade de notificação, B2B-11). Não atende: só checar
   `Membership.status`/`role`, ignorando a camada global.
7. **(10%) Dedupe é escopado à MESMA ocorrência/trigger, nunca cross-trigger.** Atende: dentro
   de UM disparo de trigger `MANAGER`, managers duplicados óbvios (nenhum aqui, já que é um Set
   de userIds) nunca geram 2 intents; um manager que TAMBÉM é assignee/watcher de um trigger
   DIFERENTE (disparado em outro momento) recebe a escalação normalmente — dedupe cross-audience
   da v1 estava errado (achado real do Codex: suprimiria a escalação exatamente da pessoa que
   mais precisa recebê-la). Não atende: qualquer supressão baseada em audiência de um trigger
   diferente do que está sendo processado agora.

## Correção 1 — Teto do fan-out de MANAGER

`MAX_MANAGER_ESCALATION_RECIPIENTS = 20` (mesmo valor de `MAX_ITEM_WATCHERS`, mesma
justificativa aritmética de D-200 — 20 managers + eventual assignee/watcher de OUTRO trigger
nunca coexistem na mesma transação, já que triggers de audiências diferentes disparam em
ocorrências SEPARADAS). Truncamento (`managers.slice(0, MAX)`) é um cenário extremo
(organização com >20 `OWNER`/`ADMIN` simultâneos) — registrado como limite operacional
conhecido, não uma decisão de produto sobre QUEM entre os managers é priorizado (ordem
estável mas arbitrária, nunca aleatória).

## Correção 2 — `targetUserId` genérico (renomeia `targetWatcherUserId`)

**Aceito integralmente.** `NotificationIntent.targetWatcherUserId` (D-200, já em `main`) vira
`targetUserId?: string` — usado por `WATCHER` E `MANAGER`, nunca por `ASSIGNEE` (que continua
derivado de `item.assigneeUserId`, sem precisar do campo). **Justificativa para renomear algo
já mergeado**: zero linhas `NotificationIntent` reais existem em `dev` hoje (confirmado por
scan direto ao verificar D-199) — este é o momento mais barato possível para corrigir o nome,
antes de qualquer tráfego real depender dele (`AGENTS.md` §1/D-093). `dispatch.ts`'s
`DispatchTarget` vira `{kind:"ASSIGNEE"} | {kind:"WATCHER"|"MANAGER"; userId: string}`; router
revalida via o `kind` do target, nunca infere pelo nome do campo.

## Correção 3 — Elegibilidade de manager em 2 camadas

`TenantManagerLookup.listActiveManagers(tenantId)` (porta nova) é implementado no composition
root lendo `Membership` (`queryByPk(organizationKey.PK, "MEMBER#")`, filtro
`status===ACTIVE && role IN (OWNER,ADMIN)`) **E** `GlobalUser.identityStatus===ACTIVE` para
cada candidato (mesmo par de leituras que a implementação real de `MemberEligibilityChecker`
já faz em `runtime/aws/composition/expiration.ts` — reaproveitada, não duplicada, a próxima
fatia de implementação usa a MESMA função auxiliar se ela já existir isolada, ou extrai uma).
Porta ganha um segundo método para a revalidação do router (Correção 5):
```ts
export interface TenantManagerLookup {
  listActiveManagers(tenantId: string): Promise<{ userId: string }[]>;
  isActiveManager(tenantId: string, userId: string): Promise<boolean>;
}
```

## Correção 4 — Dedupe escopado à ocorrência, nunca cross-trigger

`dispatchOccurrence()` NÃO filtra managers contra o assignee/watchers do item — essa exclusão
só fazia sentido em D-200 porque ASSIGNEE+WATCHERS sempre disparam JUNTOS, na MESMA ocorrência
(mesmo trigger). Um trigger `MANAGER` é uma ocorrência DIFERENTE, materializada/despachada
independentemente — dedupe dentro dela é só "managers duplicados" (impossível, é um Set),
nunca "managers que também aparecem em outra audiência". D-4 da Rodada 1 (proposta original)
está revogado nesse ponto.

## Correção 5 — Revalidação do router via a mesma porta

`routeNotificationIntent`: se `intent.targetKind === "MANAGER"`, chama
`deps.managerLookup.isActiveManager(intent.tenantId, intent.targetUserId)` — mesmo padrão de
"nunca confiar no valor da criação" já usado para `WATCHER` (D-200), só que via a porta em vez
de uma leitura de `ItemWatch` direta (a entidade-fonte aqui é `Membership`/`GlobalUser`, fora
do módulo `expiration`, por isso a porta em vez de um `store.get()` direto).

## Pendência fora de escopo

Extrair a lógica de "candidato + GlobalUser ACTIVE" de `MemberEligibilityChecker` para uma
função utilitária compartilhada (evitar duplicar a leitura dupla em 2 composition roots) é
decisão de implementação, não de design — fica para a fatia de código, registrada aqui para
não se perder.
