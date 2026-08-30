# Responsibility Reassignment on Member Removal — Round 3 Proposal (fechamento)

> Responde aos 2 bloqueantes remanescentes + 1 nit de citação da Rodada 2 (régua 8,4/design 8,1).

## Correção 1 — checklist v3: criterion 2 reancorado, não mais "prêmio" por best-effort

Achado real do Codex: o critério 2 da v2 (peso 25%) premiava demais uma garantia fraca só por ela
"não ser pior que hoje" — isso é piso de não regressão, não um eixo positivo do mesmo peso que
rastreabilidade. Reancorado e repesado:

1. **(peso 30%, volta ao peso original) Nunca perder rastreabilidade no caso comum** — inalterado.
2. **(peso 15%, reancorado — era 25% na v2) A proposta declara EXPLICITAMENTE semântica
   best-effort (nunca garantia forte) e o residual permanece observável pelos mecanismos JÁ
   existentes** — âncora precisa: "atende" só se o design (a) nomeia a garantia como best-effort em
   vez de implicar atomicidade, e (b) aponta que o caso residual (a corrida rara) continua
   observável via o audit event já existente (`MEMBER_REMOVED`/`MEMBER_LEFT`) + o log de
   cancelamento de notificação já `APPROVED` em B2B-11 — nunca inventa telemetria nova só para este
   caso, nunca finge que o residual é silenciosamente invisível.
3. **(peso 20%) Nenhum access pattern não governado** — inalterado.
4. **(peso 15%) Fronteira de módulo respeitada** — inalterado.
5. **(peso 15%) UX não deve travar de forma indecifrável, com contrato de paginação explícito e
   sem falso negativo** — reancorado (ver Correção 2 abaixo) para exigir que o cap de retorno nunca
   vire um `Limit` de leitura do DynamoDB.
6. **(peso 5%) Watchers coerentes com o precedente já existente** — inalterado.

## Correção 2 — contrato de paginação explícito (evita falso negativo)

Achado real do Codex: `Query`/`Limit` do DynamoDB limita **itens avaliados antes do filtro**, não
itens que sobrevivem ao `FilterExpression` — um `Limit: 20` ingênuo poderia devolver "só 3
encontrados" quando na verdade existem mais depois do item 20 não avaliado. Contrato explícito para
a implementação real (fora de escopo desta proposta, mas normativo para quem implementar):

`AssignedActiveItemsLookup.findAssignedActiveItems()` faz uma `Query` **paginada até esgotar** toda
a partição `GSI1PK=TENANT#t#ITEMSTATUS#ACTIVE` (seguindo `LastEvaluatedKey` até `undefined`, mesma
disciplina de paginação já em produção neste projeto para leitura de GSI restrito — ver o padrão
`pageCount` já emitido por `security.global_index_access`/GSI3/GSI6), aplicando
`FilterExpression: assigneeUserId = :userId` a cada página — **nunca** um `Limit` do DynamoDB como
proxy de truncamento (causaria falso negativo). O teto de 20 é aplicado só à **lista retornada**
depois de já ter contado o total real de correspondências (`totalKnown` reflete a contagem
verdadeira, `truncated: true` só quando `totalKnown > itemIds.length`) — nunca ao número de itens
lidos/avaliados. Custo de RCU escala com o tamanho da partição ACTIVE do tenant (registrado como
limitação conhecida na Rodada 2, inalterado — proporcional ao estágio atual sem produção real).

## Correção 3 — precisão de citação (nit da Rodada 2)

Fontes já verificadas por fetch direto, sem mudança de conclusão, só precisão de escopo:
`support.atlassian.com/user-management/docs/remove-or-suspend-a-user/` (Jira Cloud, "remove or
suspend") descreve a operação de acesso em si, sem pré-condição de reatribuição documentada ali; a
afirmação específica "assignee/watcher/reporter permanecem após desativação" vem da thread da
comunidade (`community.atlassian.com/.../Deactivate-vs-Disable-vs-Delete-an-Account`), que por sua
vez cita o comportamento de produto (Cloud e Data Center convergem no mesmo resultado observável,
mesmo vindo de documentação de superfícies diferentes da Atlassian). Precisão adicionada: a
conclusão ("nenhuma das 3 fontes bloqueia a operação equivalente a Remove/Leave") depende da
combinação das duas fontes, não de uma isolada — registrado explicitamente para que um revisor
futuro saiba que não é uma alegação de fonte única.

## Estado final consolidado (para o registro em decisions-log.md)

**Mecanismo**: precondição bloqueante best-effort (não atômica, explicitamente declarada como tal)
em `RemoveMembershipService.remove()`/`LeaveOrganizationService.leave()`, via nova porta
`AssignedActiveItemsLookup` (paginação completa do GSI1 ACTIVE, sem `Limit` como truncamento) no
módulo `organization`, implementada no composition root. Erro novo
`ResponsibilityReassignmentRequiredError` (`BUSINESS_RULE`, `retryable: false`, mesmo padrão de
`LastOwnerError`) com `{targetUserId, itemIds (até 20), totalKnown, truncated}`. `ItemWatch` fora de
escopo (sem access pattern viável, precedente B2B-11 mantido). Sem bypass de emergência nesta
versão (decisão normativa, não pendência). Divergência deliberada do precedente de mercado
(Jira/GitHub/Linear convergem em NÃO bloquear a operação equivalente) justificada pela natureza do
domínio (rastreamento de prazo/obrigação legal), não por convergência externa. Implementação real
(código, testes, infra) fica para sessão dedicada futura, mesmo padrão de D-121.

## Auto-avaliação (nota cega, escrita antes de mandar esta rodada ao Codex)

Ver `round-3-claude-self-grade.md`.
