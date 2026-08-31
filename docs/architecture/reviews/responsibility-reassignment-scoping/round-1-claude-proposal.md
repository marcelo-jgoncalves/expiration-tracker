# Responsibility Reassignment on Member Removal — Round 1 Proposal

> Escopo desta decisão: **design apenas**, não implementação (mesmo padrão de D-121, purge
> orchestrator). Origem: pergunta real do Marcelo (2026-08-30) — "quando um membro responsável por
> um vencimento é removido, alguém precisa herdar a responsabilidade? Ele pode reatribuir antes de
> sair; se o item já tem outro responsável, não precisa." Confirmado por leitura de código (não
> hipotético): `RemoveMembershipService`/`LeaveOrganizationService` nunca tocam
> `ExpirationItem.assigneeUserId`/`ItemWatch` — o campo fica órfão indefinidamente, a notificação só
> para de disparar silenciosamente no dispatch (Wave B2B-11/D-108). Pergunta aberta desde
> `roadmap-evolution/17` §121 itens 22-23, nunca respondida com mecanismo.

## Classificação de risco

**Nível 5** (`change-risk-scale.md`): muda fronteira de módulo (organization precisa ler dado do
módulo expiration pela primeira vez para decidir se bloqueia uma remoção), introduz um novo tipo de
erro/precondição bloqueante numa mutação já em produção (remove/leave), e é difícil de reverter no
sentido de que uma vez em uso, membros passam a depender do fluxo de reatribuição para sair.
Protocolo Claude↔Codex obrigatório.

## Pesquisa externa considerada

**SIM** (fontes verificadas por fetch direto, 2026-08-30):

1. Jira — `jira.atlassian.com/browse/JRASERVER-2073` ("Deactivating user - assigning all issues to
   other user"), resolvido como "Duplicate"/fixado na 5.1: o pedido original era "todos os issues
   atribuídos são automaticamente atribuídos a um usuário especificado (ou ao project lead, se não
   especificado)" — **Jira moderno faz reatribuição automática para um fallback designado**, nunca
   bloqueia a desativação.
2. GitHub — `github.com/orgs/community/discussions/156375`: "When a member is removed from a team,
   they are automatically removed from assignee fields in issues, pull requests, and project
   cards" (comportamento oficial, embora a mesma thread registre inconsistência relatada por
   usuários). **GitHub faz auto-unassign (limpa o campo), nunca bloqueia, nunca reatribui a
   ninguém.**
3. Linear — `linear.app/docs/members-roles`/`linear.app/docs/assigning-issues`: "Suspended users
   lose all access immediately... the user's historical data (issues created, comments,
   assignments) is retained and attributed to them" — visível no perfil do usuário suspenso para
   referência histórica. **Linear NÃO reatribui nem desatribui — o campo fica apontando para o
   usuário suspenso indefinidamente**, o oposto de "unassign on deactivation" (correção de uma
   alegação informal anterior desta mesma sessão, que citava Linear incorretamente como exemplo de
   auto-unassign).

**Representatividade da amostra**: os 3 cobrem posturas genuinamente diferentes de gestão de
projeto/produtividade (enterprise/ITSM tradicional, dev-first startup, developer platform) — não é
viés de nicho único.

**Sem padrão convergente.** As 3 fontes reais divergem entre si (reatribuição automática a
fallback / auto-unassign best-effort / nenhuma ação) e **nenhuma bloqueia a ação administrativa**
como a proposta original do Marcelo sugere. Isso não invalida a ideia dele — só significa que não
há um padrão de mercado estabelecido a favor de bloquear, e a proposta abaixo é uma escolha
deliberada de trade-off para este domínio específico (rastreamento de prazo/obrigação legal, não
gestão de projeto genérica), justificada abaixo, não por convergência externa.

### Checklist de critérios (trade-off explícito, já que não há convergência)

1. **(peso 30%) Nunca perder rastreabilidade de um vencimento ativo** — dado que este produto
   existe especificamente para não deixar uma obrigação/prazo passar despercebido, um item sem
   responsável rastreável (mesmo temporariamente) é uma falha mais séria aqui do que num board de
   tarefas genérico — pesa a favor de bloquear, não de "unassign silencioso" (GitHub) ou "deixa
   como está" (Linear).
2. **(peso 25%) Nenhum novo access pattern não governado** — a solução não pode introduzir um GSI
   novo sem passar pela revisão explícita de D-026; reaproveitar um índice/query já existente e
   aprovado pesa a favor.
3. **(peso 20%) Fronteira de módulo respeitada** — `organization` não pode importar
   `expiration`/`domain` diretamente; qualquer leitura cruzada usa uma porta estreita no módulo
   consumidor (mesmo padrão de `MemberEligibilityChecker`, Wave B2B-11), nunca o inverso.
4. **(peso 15%) UX não deve travar de forma indecifrável** — se a ação for bloqueada, o erro deve
   listar exatamente quais itens precisam de reatribuição, não só "não é possível remover".
5. **(peso 10%) Watchers (`ItemWatch`) tratados coerentemente com o precedente já existente** —
   B2B-11 já decidiu que remover um watcher é sempre seguro (`removeWatcher` nunca valida) - esta
   decisão não deve reabrir isso sem motivo novo.

## Achado interno decisivo: o access pattern já existe, sem GSI novo

`ExpirationItem.assigneeUserId` **não tem índice próprio** (confirmado por grep — zero GSI
referencia esse campo). Mas `GSI1` (`GSI1PK=TENANT#t#ITEMSTATUS#<status>`, `projection_type = ALL`,
`infra/modules/dynamo-table/main.tf:99-103`) já é o índice que o próprio dashboard usa para listar
"todos os itens ACTIVE de um tenant" — com projeção `ALL`, `assigneeUserId` já vem de graça na
mesma leitura. **Encontrar "todos os itens ACTIVE deste tenant atribuídos ao usuário X" é uma
`Query` no GSI1 já existente + `FilterExpression` em `assigneeUserId`** — mesmíssimo padrão de
acesso já aprovado e em produção, zero GSI novo, zero decisão D-026 nova. Isso muda
fundamentalmente a viabilidade de um precondition check síncrono: **é barato e não exige revisão de
schema.**

`ItemWatch` é o oposto: chave `PK=TENANT#t#ITEM#i`/`SK=WATCH#USER#u` — para achar "todos os itens
que o usuário X observa" seria necessário um Scan ou um GSI novo, nenhum dos dois proporcional aqui
(critério 2 do checklist). Combinado com o precedente já `APPROVED` de B2B-11 (remover um watcher é
sempre seguro), a proposta abaixo **deixa `ItemWatch` inteiramente fora de escopo** — só
`assigneeUserId` é coberto.

## Design proposto

### Mecanismo: precondição bloqueante (a proposta original do Marcelo), não best-effort pós-remoção

`RemoveMembershipService.remove()`/`LeaveOrganizationService.leave()` ganham um passo **antes** da
transação de remoção: consultar (via uma porta nova e estreita, análoga a
`MemberEligibilityChecker`) se o `targetUserId`/`ctx.principal.userId` é `assigneeUserId` de algum
`ExpirationItem` `ACTIVE` na organização. Se sim, a remoção lança um erro novo
(`ResponsibilityReassignmentRequiredError`, categoria `BUSINESS_RULE`, `retryable: false`, mesmo
padrão de `LastOwnerError`) contendo a lista de `itemId`s afetados — nunca um "não é possível
remover" genérico (critério 4). O chamador reatribui cada item via `updateItem` (mecanismo já
existente, já validado por `MemberEligibilityChecker`) e tenta a remoção de novo — mesma UX de
"promova outro OWNER primeiro" que `LastOwnerError` já estabeleceu.

Nova porta no módulo consumidor (`organization`, que agora precisa ler `expiration`):

```ts
// src/modules/organization/ports/sole-responsibility-checker.ts
export interface SoleResponsibilityChecker {
  /** Retorna os itemIds ACTIVE desta organização cujo assigneeUserId é userId. Vazio se nenhum. */
  findSoleResponsibilityItems(organizationId: string, userId: string): Promise<string[]>;
}
```

Implementação real no composition root (`runtime/aws/composition/organization.ts`), consultando
`GSI1` diretamente (mesma classe de decisão já tomada por `MemberEligibilityChecker` — porta
estreita no consumidor, implementação cruzando módulos só no composition root, nunca um import
direto do `expiration/domain`).

### Por que bloquear, e não replicar Jira/GitHub/Linear

O checklist acima (critério 1, peso 30%) já registra o racional: este produto existe para nunca
deixar um vencimento/obrigação sem dono rastreável, mesmo que por pouco tempo — diferente de um board
de tarefas genérico onde um item temporariamente sem assignee é inofensivo. Um fallback automático
(estilo Jira, reatribuir ao OWNER) foi considerado e descartado nesta proposta: reatribuir
silenciosamente ao OWNER sem o contexto de que ele realmente deveria assumir aquele item específico
recria o mesmo problema de responsabilidade difusa que a Wave B2B-11 já corrigiu (o fallback antigo,
quebrado, `assigneeUserId ?? tenantId`).

### Escapatória de emergência — decisão do Marcelo, não desta proposta

Uma pergunta genuína de produto que esta proposta **não decide sozinha**: um `ADMIN`/`OWNER` pode
forçar a remoção de um membro problemático (ex. conta comprometida, ex-funcionário hostil) SEM
esperar a reatribuição, aceitando itens temporariamente órfãos? A proposta atual não inclui esse
bypass (bloqueio sempre vale, sem exceção de role) — se o Marcelo quiser uma escapatória de
emergência, é uma decisão de produto dele antes da implementação real, registrada aqui como item
aberto, não decidida por esta rodada.

### Fora de escopo desta proposta (registrado, não escondido)

- `ItemWatch`/watchers — nenhuma mudança, precedente de B2B-11 mantido.
- Implementação real (novo código, testes, infra) — fica para uma sessão dedicada futura, mesmo
  padrão de D-121.
- A UI/UX exata do fluxo de reatribuição no frontend (tela dedicada vs. reaproveitar `updateItem`
  existente) — decisão de Wave futura, não deste documento de design de backend.

## Auto-avaliação (nota cega, escrita antes de qualquer resposta do Codex)

Ver `round-1-claude-self-grade.md`.
