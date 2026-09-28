---
status: draft
owner: Marcelo
authority: proposta Rodada 1 do protocolo Claude↔Codex (AGENTS.md §4) — nível 5, não normativo até convergência
---

# Transferência de titularidade (OWNER) de organização — Rodada 1

Pedido direto de Marcelo (2026-09-28): avaliar a transferência de ownership de uma organização e
submeter ao protocolo. Fecha um gap já nomeado três vezes sem nunca ter sua própria rodada de
escopo técnico: D-345 (multi-org por OWNER, decidido, não implementado), D-346 §5.3 (pesquisa de
concorrência: "definir isso exige... fluxo de transferência de titularidade... precisa da sua
própria rodada de escopo técnico (nível 5) antes da implementação de D-345"), D-347 (planos/preços:
"mecânica de pagador/downgrade/transferência de titularidade permanece um gap de design real, não
resolvido aqui", reafirmado 2026-09-28 como pendência explícita em
`docs/project/planos-precos-2026-09-27.md` §19).

## Nível de risco

Nível 5 (`change-risk-scale.md`): nova operação atômica que muda a matriz de autorização
(`authorization.ts`), toca o agregado `Membership`/`Organization` já em produção, e é difícil de
reverter incorretamente (uma implementação errada pode deixar uma organização sem OWNER ativo).
Protocolo Claude↔Codex obrigatório, mínimo 3 rodadas, ≥9,0 de ambos sem arredondar.

## Pesquisa externa considerada: SIM PARCIAL

**Fontes (todas consultadas em 2026-09-28)**:
- [GitHub Docs — Transferring organization ownership (Enterprise Cloud)](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-organization-settings/transferring-organization-ownership)
- [Slack Help — Transfer ownership of a workspace or org](https://slack.com/help/articles/204401633-Transfer-ownership-of-a-workspace-or-org) + [Understand the Primary Owner role](https://slack.com/help/articles/360038161033-Understand-the-Primary-Owner-role)
- [Notion Help Center — Manage billing](https://www.notion.com/help/billing) (papel de owner e transferência de responsabilidade de billing)
- [Google Workspace Admin Help — transferir o papel de super admin](https://knowledge.workspace.google.com/admin/users/make-a-user-an-admin) (fluxo de transferência de super admin)
- [OWASP Cheat Sheet Series — Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) (re-autenticação para mudanças sensíveis de conta)
- [Achromatic.dev — How to Prevent Ownerless Organizations in a Next.js SaaS](https://www.achromatic.dev/blog/prevent-ownerless-organizations-nextjs-saas) (blog técnico, usado só para o padrão de implementação "promove primeiro, depois rebaixa", não como fonte de postura de produto)

**Representatividade**: a amostra cobre 4 nichos de SaaS B2B distintos (dev tooling/GitHub,
comunicação em equipe/Slack, produtividade/Notion, identidade/admin corporativo/Google Workspace),
reduzindo viés de nicho único — mesma justificativa que `research-protocol.md` Exemplo 1 exige.
Para a sub-decisão de postura de segurança (re-autenticação antes de uma ação de altíssima
irreversibilidade), a fonte é OWASP (norma), não documentação de vendor, seguindo a preferência
explícita de `research-protocol.md` §"Verificabilidade" para decisões com postura de
segurança/identidade.

**Escopo do que é informado por padrão externo vs. interno**:
- **Informado por pesquisa** (checklist abaixo): quem pode iniciar a transferência (o próprio
  OWNER, nunca um terceiro reatribuindo o papel de outro OWNER); exigência de que o alvo já seja
  membro ativo aceito (nunca convite pendente); o antigo OWNER nunca é removido da organização,
  só rebaixado; postura de re-autenticação antes da execução; necessidade de trilha de auditoria.
- **Decisão interna** (layout de transação DynamoDB, qual serviço/arquivo reaproveitar, formato
  exato do `Action`/`MembershipAuditAction`, se toca ou não `Organization.ownerCount`): nenhuma
  pesquisa de mercado ajudaria aqui — depende só do modelo de dados já existente deste projeto
  (`Membership`/`Organization` na mesma partição, OCC por `version`, `buildOwnerCountDeltaEntry`
  já convergido em D-099/Wave B2B-8).
- **Achado real, não um padrão a copiar cegamente**: GitHub e Google Workspace descrevem um fluxo
  **sequencial** (promover o sucessor, DEPOIS remover/rebaixar o antigo) — não porque seja a
  postura ideal, mas porque a maioria dos sistemas não garante uma transação atômica multi-linha
  no nível de aplicação. Este projeto já tem `TransactWriteItems` disponível e em uso extensivo
  (`buildOwnerCountDeltaEntry`, toda a disciplina OCC do repositório) — a proposta abaixo faz a
  troca como uma ÚNICA transação atômica, fechando de vez a janela transitória de "zero ou dois
  donos" que o padrão sequencial dos concorrentes existe precisamente para contornar. Isto não é
  "melhor que o mercado" de forma genérica — é usar uma capacidade de infraestrutura que já
  existe neste código para eliminar um risco que a pesquisa mostrou ser real o bastante para
  moldar a UX de produtos estabelecidos.

## Checklist de critérios de nota (pesado, subordinado aos eixos já aplicáveis de `joint-review-criteria.md`: Arquitetura, Segurança da Informação e AppSec, Governança de Produto e Serviço Multi-tenant, Qualidade de Engenharia)

| # | Critério | Peso | Atende | Não atende |
|---|---|---|---|---|
| 1 | **Alvo já é Membership ACTIVE aceita** — nunca um convite pendente/e-mail solto pode receber OWNER via esta operação (convergente em GitHub/Slack/Notion/Google Workspace) | 20% | Operação lê e valida `target.status === "ACTIVE"` antes de qualquer escrita, rejeita com erro nomeado caso contrário | Aceita um alvo sem Membership existente, ou com status SUSPENDED/REMOVED |
| 2 | **Troca atômica, nunca sequencial** — promoção do sucessor e rebaixamento do atual OWNER na MESMA `TransactWriteItems`, nenhuma janela observável com 0 ou 2 donos "extra" | 20% | Uma única transação faz as duas mutações de `Membership`; falha de qualquer condição aborta as duas, sem estado parcial | Duas chamadas separadas, ou uma transação que permite sucesso parcial |
| 3 | **Auto-transferência, nunca reatribuição por terceiro** — só o próprio OWNER que está cedendo o papel pode iniciar (mesmo padrão em Slack/GitHub/Google Workspace: quem transfere é sempre o dono atual, nunca um ADMIN movendo o título de outro OWNER para um terceiro) | 15% | Autorização exige que `ctx` seja exatamente a Membership OWNER sendo rebaixada, não apenas "qualquer OWNER da organização" | Permite um OWNER A mover o papel de um OWNER B para um MEMBER C sem que B tenha iniciado |
| 4 | **Antigo OWNER nunca é removido da organização** — vira ADMIN, continua membro ativo; sair da organização continua sendo a ação separada já existente (`LeaveOrganizationService`), agora segura porque deixou de ser o único/mais um dono | 10% | Rebaixamento é OWNER→ADMIN, membership permanece `status=ACTIVE` | Remove ou suspende o antigo OWNER como parte desta operação |
| 5 | **Postura de re-autenticação antes da execução** — OWASP ASVS recomenda re-autenticação para mudanças que alteram materialmente a propriedade de uma conta; Slack exige senha antes de confirmar. Este projeto **não tem hoje nenhum mecanismo de step-up para NENHUMA ação sensível** (verificado por busca no código) — tratado como critério de TRADE-OFF explícito, não consenso de implementação pronta | 15% | Proposta discute EXPLICITAMENTE as opções (construir step-up mínimo agora vs. aceitar risco residual nesta fase pré-usuário-real, `AGENTS.md` §1, registrando como item de hardening pré-lançamento) e recomenda uma, com razão declarada | Proposta ignora a questão, ou finge que um mecanismo já existe |
| 6 | **Trilha de auditoria** — quem transferiu, para quem, quando, correlacionável (D-097 já registrou "ações de maior irreversibilidade... auditáveis" como padrão esperado para o tier OWNER) | 10% | Dois `MembershipAuditEvent` (um por Membership afetada) na mesma transação, mesmo `correlationId`, ação nomeada distinta de `ROLE_CHANGED` | Sem auditoria, ou usa `ROLE_CHANGED` genérico sem sinalizar que foi uma transferência |
| 5→7 | **Nunca toca `TenantLifecycleRecord`** — achado já registrado em D-346 (forward-only, desenhado para exclusão de tenant, não pausa reversível) | 5% | Operação depende só de `Membership`/`Organization.ownerCount` | Qualquer leitura/escrita em `TenantLifecycleRecord` |
| 8 | **Não introduz o conceito de "pagador"/billing** — greenfield, fora de escopo desta decisão (billing entra só em M12, D-346/D-347 já registram isso como pendência separada) | 5% | Proposta transfere só o papel `OWNER` de `Membership`; nenhum campo/conceito de billing é criado ou implicado | Proposta cria ou pressupõe um conceito de "payer" |

## Modelo de domínio proposto

### Novo serviço: `TransferOwnershipService.transfer(ctx, targetUserId, expectedCallerVersion, expectedTargetVersion)`

Vive em `src/modules/organization/application/transfer-ownership.ts` — arquivo novo, mesmo padrão
de `ChangeMembershipRoleService`/`RemoveMembershipService`/`LeaveOrganizationService` (um serviço
por operação de negócio, não um método genérico "changeRole" chamado duas vezes).

**Por que não é "duas chamadas a `ChangeMembershipRoleService.changeRole()`"**: além do risco de
janela transitória (critério 2), há um problema técnico REAL e não só teórico — `DynamoDB
TransactWriteItems` rejeita duas operações sobre a MESMA chave primária na mesma transação
(`ValidationException: Transaction request cannot include multiple operations on one item`).
`buildOwnerCountDeltaEntry` sempre escreve em `organizationKey()` — chamá-lo duas vezes (uma para
o rebaixamento do atual OWNER, outra para a promoção do sucessor) dentro da MESMA transação
produziria exatamente essa colisão de chave, não um bug sutil de corrida, um erro imediato do
próprio DynamoDB.

**A correção não é "chamar com cuidado" — é não precisar do builder aqui.** `ownerCount` existe
para nunca deixar a organização chegar a zero OWNER ACTIVE. Numa troca (o alvo NÃO era OWNER,
passa a ser; o chamador ERA OWNER, deixa de ser), a contagem líquida de OWNER ACTIVE da
organização é invariante — a transação nunca produz 0 nem 2 a mais, só troca QUEM ocupa a mesma
vaga. **A operação não precisa ler nem escrever `Organization.ownerCount` em nenhum momento**,
porque o próprio `TransactWriteItems` já garante que as duas mutações de `Membership` acontecem
juntas ou nenhuma acontece — a segurança vem inteiramente da atomicidade da transação, não de um
contador. Isto só vale porque o alvo é validado como NÃO-OWNER antes da transação (ver algoritmo);
se o alvo já fosse OWNER, esta operação não seria uma "transferência" de verdade (seria um
rebaixamento solo do chamador) e é rejeitada explicitamente (ver Casos de erro).

### Algoritmo

```
1. authorize({ context: ctx, action: "membership:transfer-ownership", resource: { tenantId } })
   — OWNER_ROLES (mesmo tier de organization:close/organization:cancel-close), nunca ADMIN_ROLES.
2. tenantId = authorizedTenantId(ctx)
3. caller = store.get(membershipKey(tenantId, ctx.principal.userId))
   — deve existir, status ACTIVE, role OWNER, version === expectedCallerVersion (validado pela
   própria ConditionExpression da transação, não só lido antes).
4. if targetUserId === ctx.principal.userId → ValidationError (auto-transferência não faz sentido)
5. target = store.get(membershipKey(tenantId, targetUserId))
   — deve existir, status ACTIVE (NotFoundError caso contrário — mesma mensagem/comportamento de
   ChangeMembershipRoleService.changeRole para uma Membership ausente/inativa).
6. if target.role === "OWNER" → NewOwnershipTransferTargetAlreadyOwnerError (nova classe de erro,
   nomeada — dirige o chamador para os fluxos já existentes de remoção/rebaixamento se o que ele
   quer é reduzir o número de OWNERs, não transferir a vaga; este NÃO é o problema que esta
   operação resolve).
7. TransactWriteItems (uma única chamada):
   a. Update caller Membership: SET role = "ADMIN", version = version + 1
      ConditionExpression: "#status = :active AND #role = :owner AND version = :expectedCallerVersion"
   b. Update target Membership: SET role = "OWNER", version = version + 1
      ConditionExpression: "#status = :active AND #role <> :owner AND version = :expectedTargetVersion"
      (a re-checagem de `role <> OWNER` dentro da própria condição fecha a corrida entre o GetItem
      do passo 5 e a transação — mesma disciplina de "nunca confiar na leitura fora da transação"
      já usada em todo o resto do código, ex. reminder-dispatch.ts's freshness fence)
   c. Put MembershipAuditEvent (caller): action="OWNERSHIP_TRANSFERRED", changes={fromRole:"OWNER",
      toRole:"ADMIN", counterpartUserId: targetUserId, direction: "RELINQUISHED"}
   d. Put MembershipAuditEvent (target): action="OWNERSHIP_TRANSFERRED", changes={fromRole:
      target.role, toRole:"OWNER", counterpartUserId: ctx.principal.userId, direction: "RECEIVED"}
      (mesmo correlationId nos dois eventos — permite reconstruir o par completo a partir de
      qualquer um dos dois lados)
8. Nenhuma entrada de `Organization.ownerCount` é adicionada — ver justificativa acima.
9. Tratamento de cancelamento (mesma disciplina de getCancellationReasonCodes/índice específico
   já usada em ChangeMembershipRoleService): índice 0 = Membership do chamador (condição falhou →
   "seu papel mudou ou sua versão está desatualizada, recarregue"), índice 1 = Membership do alvo
   ("o alvo deixou de ser elegível ou mudou de versão — recarregue e tente de novo"), nunca uma
   mensagem genérica de conflito para os dois casos.
```

### Autorização

Novo `Action` em `src/modules/identity/domain/authorization.ts`: `"membership:transfer-ownership"`,
gated `OWNER_ROLES` (nunca `ADMIN_ROLES`) — mesmo tier de `organization:close`/
`organization:cancel-close`, seguindo diretamente o achado de pesquisa já registrado neste projeto
em D-097/`multi-user-b2b-wave-b2b7-scope.md`: Linear/Slack "reservam para OWNER as ações de maior
irreversibilidade (billing/exclusão/**transferência de titularidade**/SSO)". A autorização em si
já barra um ADMIN de chamar a rota; o passo 3 do algoritmo acima garante adicionalmente que é
ESPECIFICAMENTE o OWNER que está cedendo o papel, nunca outro OWNER agindo por ele (critério 3).

### Auditoria

Novo `MembershipAuditAction = "OWNERSHIP_TRANSFERRED"` em
`src/modules/organization/domain/audit-event.ts` (união com `ROLE_CHANGED`/`MEMBER_REMOVED`/etc.
já existentes) — deliberadamente distinto de `ROLE_CHANGED` genérico: duas mudanças de role que
seriam registradas como `ROLE_CHANGED` duas vezes esconderiam o fato de que foram uma ÚNICA
operação coordenada (transferência), não duas decisões independentes.

## Casos de erro (novas classes em `src/shared/errors/app-error.ts`, mesma convenção de
`LastOwnerError`/`OwnerTierChangeRequiresOwnerError` já existentes)

- `SelfOwnershipTransferError` — `targetUserId === ctx.principal.userId`.
- `OwnershipTransferTargetAlreadyOwnerError` — alvo já é OWNER ACTIVE.
- `NotFoundError` (reaproveitado) — alvo sem Membership ACTIVE.
- Conflito de versão (reaproveita o padrão já existente de "recarregue e tente de novo", nunca uma
  classe nova só para isso).

## Questão aberta — postura de re-autenticação (critério 5, quero a crítica do Codex aqui especificamente)

Nenhuma rota deste projeto hoje exige re-autenticação/confirmação de senha antes de uma ação
sensível (verificado por busca em `src/` — o único uso de "reauth" existente é sobre falha de
refresh de token, não uma barreira deliberada). Duas opções, nenhuma implementada nesta proposta
ainda:

1. **Construir uma confirmação mínima agora** (ex. o payload da rota exige a senha atual do
   chamador, verificada via uma chamada Cognito antes de prosseguir) — escopo adicional real, sem
   precedente interno a reaproveitar, primeira instância deste padrão no projeto.
2. **Aceitar o risco residual nesta fase** (`AGENTS.md` §1: sem usuário real, sem produção real
   ainda) e registrar como item de hardening explícito antes do primeiro usuário real — mesmo
   padrão já usado para adiar quiet hours no digest de WhatsApp (D-347), mitigado parcialmente
   porque a ação já exige (a) ser autenticado como o OWNER específico sendo rebaixado, (b) alvo já
   ser membro aceito da mesma organização (não um e-mail externo), (c) auditoria completa.

Inclinação desta proposta: opção 2, registrando o gatilho de reavaliação explícito ("antes do
primeiro usuário real com titularidade real em jogo, ou quando QUALQUER outra ação sensível deste
projeto ganhar step-up, para não ser a única exceção"). Aberto a ser convencido do contrário pelo
Codex se a análise de risco discordar.

## Fora de escopo desta proposta (explícito, não esquecido)

- **Transferência de responsabilidade de billing/"pagador"** — não existe billing real neste
  projeto ainda (`TenantEntitlement` não tem conceito de payer, sem integração Stripe/similar,
  confirmado por busca no código). D-346/D-347 já registraram isso como pendência separada,
  dependente de M12. Esta proposta transfere APENAS o papel `OWNER` de `Membership`.
- **Estado de organização "pausada por billing, reversível"** — gap já nomeado em D-346 §5.3,
  explicitamente não resolvido aqui (e `TenantLifecycleRecord` explicitamente não deve ser
  reaproveitado para isso, ver critério 7).
- **Reatribuição de OWNER de um terceiro por outro OWNER** (ex. OWNER A move o título de OWNER B
  para MEMBER C sem que B tenha iniciado) — nenhum produto pesquisado modela "transferência de
  titularidade" dessa forma; o caso "remover/rebaixar outro OWNER" já existe via
  `RemoveMembershipService`/`ChangeMembershipRoleService`, só não pareado atomicamente com uma
  promoção — fora de escopo desta primeira versão, candidato a extensão futura se um caso de uso
  real aparecer.
- **UI/frontend** — a especificação de protótipo `A19-time-organizacao.md` já antecipa um tooltip
  ("Transfira a titularidade antes de sair") mas nenhuma tela real existe; esta proposta é só o
  contrato de backend. Tela nova fica para uma fatia de implementação separada, depois do
  protocolo convergir.

## Validação a fazer nas próximas rodadas

`npm run typecheck`/`lint`/teste do módulo tocado/`check-boundaries` a cada implementação real —
esta é a proposta de DESIGN (Rodada 1), a implementação de código só começa depois de convergência
≥9,0 dos dois lados, seguindo exatamente a ordem que já funcionou para o digest de WhatsApp
(D-347): design primeiro, revisão de código depois.
