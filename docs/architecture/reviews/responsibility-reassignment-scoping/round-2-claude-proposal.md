# Responsibility Reassignment on Member Removal — Round 2 Proposal

> Responde aos 4 bloqueantes e 3 sugestões menores da Rodada 1 do Codex. Nota da Rodada 1 foi
> registrada em 2 partes (régua 7,2/design 7,0) porque o Codex contestou o próprio checklist —
> esta rodada traz o checklist reconciliado (v2) junto com o design corrigido, como
> `research-protocol.md` exige.

## Correção 1 — pesquisa externa (Jira deactivate vs. delete)

A síntese original estava imprecisa (achado real do Codex, verificado por pesquisa adicional
2026-08-30, fonte: `support.atlassian.com/user-management/docs/remove-or-suspend-a-user/` +
`community.atlassian.com/t5/.../Deactivate-vs-Disable-vs-Delete-an-Account/qaq-p/1489280`):

- **Desativar** (o caminho recomendado pela própria Atlassian, análogo ao `REMOVED`/soft-status
  deste projeto): **preserva a atribuição como está** — "a user who was assigned, watching, or had
  reported issues... will still appear as the respective assignee". Nenhum bloqueio, nenhuma
  reatribuição automática. **Isso CONVERGE com Linear** (nenhuma ação), não diverge como a Rodada 1
  alegou.
- **Deletar** (operação distinta, mais destrutiva, sem análogo direto neste projeto — mais perto do
  pipeline de purga W3-07/D-121 do que de `Remove`/`Leave`): **bloqueia a exclusão até reatribuição
  manual** — "You can't delete a user from Jira if they've reported any issues... assigned to any
  issues... You're going to need to re-assign all issues".

**Conclusão corrigida**: das 3 fontes reais, **nenhuma bloqueia a operação equivalente a
`Remove`/`Leave` deste projeto** (soft/deactivate) — Jira, GitHub e Linear convergem em não
bloquear aqui. O único precedente real de bloqueio (Jira) se aplica a uma operação mais destrutiva
(hard delete), sem equivalente direto no escopo desta proposta. Isso enfraquece ainda mais a
convergência externa a favor do mecanismo proposto — a justificativa para divergir continua sendo
domain-specific (critério 1 do checklist), agora carregando explicitamente mais peso da
argumentação, não apoiada por precedente de mercado nenhum.

**Mantenho a recomendação de bloquear** apesar disso — não porque o mercado converge (não
converge), mas porque a natureza deste produto (rastreamento de prazo/obrigação legal) tem um custo
de "item órfão temporário" mais alto do que um board de tarefas genérico. Registrado explicitamente
como decisão deliberada contra o padrão de mercado, não como decisão informada por ele — o Marcelo
deve saber que está escolhendo divergir, não seguir um precedente estabelecido.

## Correção 2 — checklist reconciliado (v2)

O Codex contestou o critério 1 por não ter âncora verificável de consistência sob concorrência.
Checklist v2 (substitui integralmente a v1 da Rodada 1):

1. **(peso 25%) Nunca perder rastreabilidade por omissão silenciosa** — atende se o mecanismo
   detecta e bloqueia o caso comum (remoção deliberada, não concorrente com uma atribuição no
   mesmo instante); não exige atomicidade perfeita, que é inatingível dado GSI1 ser eventualmente
   consistente (constraint real do DynamoDB, não escolha de design — GSIs nunca suportam
   `ConsistentRead`).
2. **(peso 25%, NOVO, extraído do critério 1 original) Falha residual é sempre não-pior que o
   status quo hoje** — âncora explícita: no pior caso (janela de corrida entre o check e a
   transação), o resultado é exatamente o bug que Wave B2B-11 já mitiga (notificação cancelada
   silenciosamente no dispatch) — nunca um estado NOVO ou pior que o já `APPROVED`/em produção.
3. **(peso 20%) Nenhum access pattern não governado** — inalterado da v1.
4. **(peso 15%) Fronteira de módulo respeitada** — inalterado da v1.
5. **(peso 10%) UX não deve travar de forma indecifrável** — inalterado da v1 (payload limitado,
   ver Correção 4 abaixo).
6. **(peso 5%) Watchers coerentes com o precedente já existente** — inalterado da v1.

## Correção 3 — TOCTOU: por que atomicidade perfeita é inatingível aqui, e o que a proposta faz em vez disso

Verificado por leitura direta: GSIs no DynamoDB **nunca** suportam leitura fortemente consistente
(limitação da própria API, não deste projeto) — `queryGsi1` já documenta isso
(`expiration-store.ts`). Além disso, `TransactWriteItems` exige toda chave de item conhecida
antecipadamente (máx. 100 itens) — não existe "bloqueie qualquer escrita futura em itens que eu
ainda não sei quais são" em uma única transação. **Um mecanismo perfeitamente atômico não é
implementável com a arquitetura real deste projeto sem introduzir um lock distribuído novo
(desproporcional, `principles.md` #1, para fechar uma janela de corrida que exige dois humanos
agindo no mesmo instante exato: um removendo X, outro atribuindo um item a X).**

A proposta aceita isto explicitamente (critério 2 do checklist v2 acima) em vez de fingir uma
garantia que não existe: o check via GSI1 cobre o caso real e comum (remoção deliberada de um
membro com itens já atribuídos, sem corrida). A janela residual (corrida genuína entre uma
atribuição e uma remoção no mesmo instante) já **converge para o mesmo comportamento hoje em
produção** — o item fica com um `assigneeUserId` apontando para alguém removido, e a Wave B2B-11 já
garante que a notificação correspondente é cancelada silenciosamente no dispatch (`active: false`),
não perdida silenciosamente sem sinal nenhum. **O pior caso desta proposta nunca é pior que o status
quo atual** — é estritamente uma melhoria no caso comum, sem piora no caso raro.

## Correção 4 — payload limitado e nome da porta

Adotado o formato sugerido pelo Codex, com um teto explícito (evita um payload de erro ilimitado
para uma organização hipotética com centenas de itens atribuídos à mesma pessoa):

```ts
// src/modules/organization/ports/assigned-active-items-lookup.ts
export interface AssignedActiveItemsLookup {
  /** Até 20 itemIds ACTIVE desta organização cujo assigneeUserId é userId, mais um total
   * conhecido/truncamento explícito - nunca um array ilimitado. */
  findAssignedActiveItems(organizationId: string, userId: string): Promise<{ itemIds: string[]; totalKnown: number; truncated: boolean }>;
}
```

Renomeado de `SoleResponsibilityChecker` para `AssignedActiveItemsLookup` (sugestão do Codex — o
domínio não tem conceito de co-responsabilidade, "sole" era impreciso; "lookup" reflete melhor que
é uma consulta, não uma checagem booleana).

`ResponsibilityReassignmentRequiredError` (categoria `BUSINESS_RULE`, `retryable: false`, mesmo
padrão de `LastOwnerError` confirmado por leitura de `app-error.ts`) carrega
`{ targetUserId, itemIds, totalKnown, truncated }` no `details`.

## Correção 5 — bypass de emergência: decisão de default, não mais item 100% em aberto

Aceito o ponto do Codex: a proposta precisa escolher um default técnico normativo, mesmo que a
política de emergência em si continue sendo uma decisão de produto do Marcelo.

**Default desta proposta: SEM bypass nesta versão — o bloqueio vale sempre, mesmo para
`ADMIN`/`OWNER`, mesmo em emergência.** Justificativa: um bypass de emergência sem contexto adicional
recria exatamente o mesmo problema de responsabilidade órfã que esta proposta existe para fechar —
se o Marcelo quiser uma escapatória de emergência no futuro, é uma decisão de produto nova, com seu
próprio design (quem pode, fica registrado como quê, o item fica realmente órfão de propósito ou
cai para um fallback nomeado) — não uma opção lateral desta proposta. Registrado como decisão
técnica tomada agora (não mais pendência aberta), com a política de produto around it deixada
explicitamente para o Marcelo se ele quiser revisitar.

## Verificação adicional (achado próprio, não pedido pelo Codex)

Confirmado por leitura de `capacity-model.md`: "8 itens por usuário ativo" (linha 34) e "8.000.000
itens ativos" no Stage 5 (linha 219) são o **total do sistema inteiro** (1M usuários), não por
tenant/organização — a proposta original não provava isso, corrigido aqui. Combinado com a
distribuição de cauda longa já assumida (`capacity-model.md`), o teto de 20 itemIds do
`AssignedActiveItemsLookup` (Correção 4) já resolve o caso patológico de um tenant desproporcional
sem precisar fechar o dimensionamento exato agora — a query em si (`GSI1` + `FilterExpression`)
sempre lê o partition inteiro de `TENANT#t#ITEMSTATUS#ACTIVE` antes de filtrar, então o CUSTO real
(RCU) escala com o tamanho da organização, não com o teto de retorno — registrado como limitação
conhecida, proporcional ao estágio atual (`AGENTS.md` §1: sem produção real, sem usuário real),
recalibrável quando houver telemetria real (mesmo gatilho já declarado em `capacity-model.md`).

## Auto-avaliação (nota cega, escrita antes de mandar esta rodada ao Codex)

Ver `round-2-claude-self-grade.md`.
