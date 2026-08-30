# Multi-User B2B — Wave B2B-8 (Invitations/Team), Rodada 2 — Proposta Claude

Resposta à Rodada 1 do Codex (`round-1-codex-critique.md`, régua 8,0/design 7,8). Os 4 achados são reais — 2 deles (token pointer não consumido, colisão de chave de rate-limit) são bugs de design que eu teria descoberto só ao tentar implementar; melhor agora. Checklist v2 abaixo + design corrigido.

## Checklist v2 (Rodada 2) — reconciliado

```text
1. (peso 25%, era 30% — achado 1/4 da crítica) Last-owner protection estrutural (ownerCount >
   :one) aplicada às transições ATIVAS desta wave (role-change de/para OWNER, remove, leave) —
   suspend/unsuspend fica fora de escopo (physical model já nomeia como ação administrativa
   futura), mas o builder do guard é genérico o bastante para ser reaproveitado quando existir.
   Atende: as 3 operações compartilham o mesmo builder, erro nomeado na falha. Não atende:
   checagem solta de aplicação, ou exigência de suspend nesta wave.
2. (peso 20%, era parte do critério 2 — achado 1 da crítica) Superfícies de leitura distintas
   por sensibilidade: listar MEMBROS ativos é READ_ONLY_ROLES (qualquer papel real); listar
   CONVITES PENDENTES (carrega e-mail + intenção) é ADMIN_ROLES — nunca a mesma action/tier
   para as duas. Atende: 2 actions separadas testadas independentemente. Não atende: uma única
   action cobrindo as duas superfícies.
3. (peso 20%, era parte do critério 3 — achado 2 da crítica) Anti-replay do token de convite é
   estrutural na PRÓPRIA transação de aceite, não só resolução prévia — `InvitationTokenPointer`
   é atualizado (`consumedAt`) na MESMA `TransactWriteItems` do aceite, condicionado a não
   consumido ainda. Atende: teste prova que aceitar o mesmo token 2x (inclusive concorrente)
   falha na segunda tentativa via falha de condição, não só por checagem de aplicação antes da
   transação. Não atende: consumo do token fica fora da transação atômica.
4. (peso 20%, era critério 4 — achado 3 da crítica) Namespace de rate-limit de convite de
   Organization é distinto do rate-limit de guest document-request mesmo pós-cutover
   (`tenantId=organizationId` faria as duas quotas colidirem se usassem a mesma forma de
   chave) — porta correta identificada e usada (`OrganizationStore`, com `updateConditional`
   adicionado por extensão mecânica, não reaproveitando `SubjectStore`). Atende: chave inclui um
   segmento que distingue "convite de membro" de "convite de guest"; porta usada é a certa.
5. (peso 15%, era critério 5) Auditoria — cada mutação real grava `MembershipAuditEvent` na
   mesma transação, inalterado da Rodada 1.
```

## Correções ao design (1 por achado)

### 1. `membership:list-members` (READ_ONLY_ROLES) separado de `membership:list-invitations` (ADMIN_ROLES)

```text
"membership:list-members"      → READ_ONLY_ROLES  (qualquer Membership real vê a lista de membros)
"membership:list-invitations"  → ADMIN_ROLES       (convite pendente carrega e-mail + intenção — superfície administrativa, precedente Linear "Settings > Administration > Members" para pending invites, Notion remove/altera membros só via Owner/Admin)
```

`ListMembersService`/`ListInvitationsService` continuam 2 classes distintas (não uma genérica parametrizada por tipo) — a diferença de autorização já justifica a separação, evita uma classe genérica que esconderia a diferença de sensibilidade atrás de um parâmetro.

### 2. `AcceptInvitationService` — token pointer consumido dentro da transação

Fluxo de 2 fases (mesmo padrão de resolução de guest token, `guest-token.ts`/`parseGuestToken`/`secretMatches`, que já roda ANTES de qualquer transação):

1. **Resolução (fora da transação, só leitura)**: parse do token recebido → `GetItem InvitationTokenPointer` por `selectorHash` → `secretMatches()` (timing-safe) → verifica `expiresAt` não passado E `consumedAt` ainda ausente. Qualquer falha aqui → erro genérico anti-enumeration (mesmo padrão de `guest-token.ts`), nunca revela qual verificação falhou.
2. **Transação atômica** (`TransactWriteItems`, 6 itens — 1 a mais que a Rodada 1):
   ```text
   Update Membership { ...upsert, per D-086 §9 }
   Update Invitation { SET #status=:ACCEPTED, ConditionExpression: #status=:PENDING AND emailNormalized=:callerVerifiedEmail }
   Update InvitationTokenPointer { SET consumedAt=:now, ConditionExpression: attribute_not_exists(consumedAt) AND expiresAt > :now }
   Delete InvitationDedupPointer
   Put MembershipAuditEvent
   Update Organization { ownerCount = ownerCount + 1 }   -- só se role === "OWNER"
   ```
   **Achado corrigido durante a escrita desta própria proposta**: a condição inicial só checava `attribute_not_exists(consumedAt)` — deixaria uma corrida estreita (token expira exatamente entre a resolução fora da transação e o commit) aceitar um token tecnicamente expirado. Corrigido: a condição da transação repete `expiresAt > :now`, não confia só na checagem já feita na resolução prévia. O `ConditionExpression` completo no `Update InvitationTokenPointer` é o que fecha Q14 de verdade — se dois requests concorrentes chegam com o mesmo token (replay ou corrida genuína), só um vence a transação; o outro recebe `TransactionCanceledException`, mapeado (via `getCancellationReasonCodes()`, já usado em `occ.ts` desde D-096) a `InvitationTokenAlreadyConsumedError` nomeado — nunca `ConditionalCheckFailedException` cru na resposta HTTP.

### 3. Rate-limit de convite de Organization — chave namespaced + porta correta

Chave: `TENANT#<organizationId>#SETTINGS#MEMBERSHIP-INVITE` / `RATE` (e `RATE_DAILY`) — segmento `#MEMBERSHIP-INVITE` distingue explicitamente de `TENANT#<organizationId>#SETTINGS`/`RATE` (guest document-request, `initial-invite-rate-limiter.ts:47-50`), que pós-cutover vive na MESMA partição de tenant (`tenantId=organizationId`) e colidiria sem essa distinção. Porta: `OrganizationStore` ganha `updateConditional<T extends EntityKey>(item: T, expected: { count: number; resetAt: string }): Promise<boolean>` — extensão mecânica, mesma assinatura literal de `SubjectStore.updateConditional` (`subject-store.ts:29`), nível 3-4 (mesmo padrão já testado, só uma porta nova o expõe). `MembershipInviteRateLimiter` (novo, módulo `organization`) segue o `InitialInviteRateLimiter` como TEMPLATE de mecânica (janela fixa, `putIfAbsent`/`updateConditional`, retry sob contenção) — nunca importa a classe de `subject` (evita violar `check-boundaries`).

### 4. Critério 1 — âncora corrigida (sem mudança de código, só de escopo declarado)

`ChangeMembershipRoleService`/`RemoveMembershipService`/`LeaveOrganizationService` cobrem `ACTIVE` ↔ mudança de role, e remoção/saída de uma `Membership` `ACTIVE`. Transição para/de `SUSPENDED` **não é implementada nesta wave** (physical model já nomeia como "ação administrativa explícita, fora do escopo desta wave", `membership.ts:9`) — mas o builder do guard de `ownerCount` recebe o `Membership` atual e o `role`/`status` alvo como parâmetros genéricos, não hardcoded para os 3 casos de hoje, então adicionar `suspend` depois (B2B-9 ou além) reaproveita o mesmo builder sem reabri-lo.

### 5. `membership:leave` — restrição de auto-alvo explícita (resposta à pergunta 3 do Codex)

`LeaveOrganizationService.leave(ctx)` não aceita nenhum `targetUserId` como parâmetro — opera SEMPRE sobre `ctx.principal.userId` (assinatura da função não dá superfície para confundir com "remove de outra pessoa"), diferente de `RemoveMembershipService.remove(ctx, targetUserId)`, que passa por `membership:remove`/`ADMIN_ROLES`. Nenhuma checagem de runtime "targetUserId === principal.userId" é necessária porque a própria assinatura do serviço não aceita um alvo externo — mais forte que uma checagem (não há como chamar errado).

## Decomposição atualizada (per `definition-of-done.md`)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-8.1 | Domain — `Invitation`, `InvitationTokenPointer` (com `consumedAt`), `InvitationDedupPointer`; `MembershipAuditEvent` | 5 |
| B2B-8.2 | Ports — `OrganizationStore.updateConditional()` (extensão mecânica, mesma assinatura de `SubjectStore`) | 3 |
| B2B-8.3 | Application — `MembershipInviteRateLimiter` (chave namespaced) + `CreateInvitationService` + `RevokeInvitationService` + `AcceptInvitationService` (transação de 6 itens, token pointer consumido) | 5 |
| B2B-8.4 | Application — `ListMembersService` (`membership:list-members`) + `ListInvitationsService` (`membership:list-invitations`) | 3 |
| B2B-8.5 | Domain (`authorization.ts`) + Application — `ChangeMembershipRoleService`/`RemoveMembershipService`/`LeaveOrganizationService` (sem parâmetro de alvo), builder de `ownerCount` genérico, `LastOwnerError`/`OwnerTierChangeRequiresOwnerError`/`InvitationTokenAlreadyConsumedError` nomeados, 7 novas `Action`s (6 da Rodada 1 + `membership:list-invitations` separada) | 5 |
| B2B-8.6 | HTTP — handlers + rotas Terraform + entrada nova em `email-templates.ts` (`"organization-invitation"`) | 4 |
| B2B-8.7 | Testes — G-V3 desde a escrita: last-owner nas 3 operações; hierarquia OWNER-tier; anti-replay do token (incl. corrida simulada); dedup; list-members vs. list-invitations; rate-limit namespaced não colide com guest invite; suíte completa + `build:lambdas` | 2-3 |

## Pergunta para a Rodada 2 do Codex

A régua v2 fecha os 4 achados da Rodada 1 de forma que converge para ≥9,0 do seu lado? Se sim, avalie o design corrigido contra ela. Se não, o que falta reconciliar?
