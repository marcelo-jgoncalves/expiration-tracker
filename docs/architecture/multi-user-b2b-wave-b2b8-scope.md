# Multi-User B2B — Wave B2B-8 (Invitations/Team), escopo final

**Status: `APPROVED`** via protocolo Claude↔Codex (`AGENTS.md` §4, nível 5 de `change-risk-scale.md`), 3 rodadas, nota cega cada rodada: Rodada 1 Claude 7,9/Codex — régua 8,0/design 7,8 (régua contestada); Rodada 2 Claude 8,8/Codex — régua 8,8/design 8,7; Rodada 3 Claude 9,1/Codex — régua 9,3/design 9,2 (fechamento, ambos ≥9,0, sem arredondar). Registrado como `docs/architecture/decisions-log.md` D-099. Evidência completa das 3 rodadas: `docs/architecture/reviews/multi-user-b2b-wave-b2b8-scoping/`.

**Segunda aplicação real de `docs/engineering/research-protocol.md` (E-014)**, declaração `SIM PARCIAL`: o mecanismo de dados de `Invitation` (token/dedup/aceite/anti-account-takeover/anti-replay) já foi pesquisado e `APPROVED` em D-086 — não repetido aqui. Pesquisado nesta wave (2026-08-30, fontes GitHub/Slack/Linear/Notion): (a) last-owner protection — convergência forte 4/4, confirma o mecanismo `ownerCount > :one` já `APPROVED` (D-086 §8); (b) quem gerencia membros — convergência 3/4 (Slack diverge, permite Member convidar por padrão; seguida a maioria + viés conservador já estabelecido); (c) hierarquia sobre a própria hierarquia — só `OWNER` promove/demove `OWNER` (achado Slack).

A Rodada 1 do Codex contestou o checklist (achados reais: privacidade de convites pendentes tratada igual à listagem de membros; token pointer nunca consumido na transação de aceite — bug real; colisão de chave de rate-limit com `initial-invite-rate-limiter.ts` pós-cutover; critério exigindo `suspend` fora de escopo). Reconciliado nas Rodadas 2/3.

## Escopo final

### `Invitation` + token pointer + dedup — implementação literal de D-086 §7

`src/modules/organization/domain/invitation.ts` (chaves/tipos), `invitation-token.ts` (paralelo a `subject/domain/guest-token.ts` — mesma mecânica `selector.secret`/HMAC/`timingSafeEqual`, nunca reaproveitando a classe `GuestTokenPointer`). `InvitationTokenPointer` ganha `consumedAt?` consumido dentro da transação de aceite (não só verificado na resolução prévia).

### `CreateInvitationService`

Rate-limit via `MembershipInviteRateLimiter` (novo, módulo `organization`, mesma mecânica de `initial-invite-rate-limiter.ts` mas chave namespaced `TENANT#<organizationId>#SETTINGS#MEMBERSHIP-INVITE`/`RATE`/`RATE_DAILY` — distinta da chave de guest document-request, que pós-cutover viveria na mesma partição de tenant). `TransactWriteItems`: `Put Invitation` (PENDING) + `Put InvitationTokenPointer` + `ConditionCheck`/`Put InvitationDedupPointer` (reenvio/rotação se já PENDING) + `Put MembershipAuditEvent`. Convidar com `role: "OWNER"` exige `OWNER` chamador (mesma checagem de serviço do role-change, ver abaixo) — achado corrigido durante a própria Rodada 1, antes de qualquer crítica.

### `AcceptInvitationService` — fluxo em 2 fases

1. Resolução fora da transação (parse token → `GetItem` pointer → `secretMatches()` timing-safe → `expiresAt`/`consumedAt` checados) — erro genérico anti-enumeration se qualquer verificação falhar.
2. Transação atômica de 6 itens: `Update Membership` (upsert per D-086 §9) + `Update Invitation` (`emailNormalized = :callerVerifiedEmail` estrutural) + `Update InvitationTokenPointer` (`SET consumedAt=:now`, `ConditionExpression: attribute_not_exists(consumedAt) AND expiresAt > :now` — as DUAS cláusulas, fecha replay e a corrida estreita de expiração entre resolução e commit) + `Delete InvitationDedupPointer` + `Put MembershipAuditEvent` + `Update Organization` (`ownerCount += 1`, só se `role === "OWNER"`). Falha da condição do token mapeia para `InvitationTokenUnavailableError` — nome genérico deliberado, a condição não distingue replay de expiração-de-corrida.

### `RevokeInvitationService`, `ListMembersService`/`ListInvitationsService`

Revoke: `Update Invitation` (PENDING→REVOKED) + `Delete InvitationDedupPointer` + audit. Listagem separada por sensibilidade: `ListMembersService` (membros ativos) vs. `ListInvitationsService` (convites pendentes, carrega e-mail+intenção) — ações e tiers de autorização distintos (ver matriz abaixo), reaproveitando `queryByPk` já existente (nenhuma porta nova para isso).

### `ChangeMembershipRoleService` / `RemoveMembershipService` / `LeaveOrganizationService` — núcleo novo da wave

As 3 operações que podem reduzir `ownerCount` compartilham o MESMO builder transacional (`Update Organization { ownerCount -= 1, ConditionExpression: ownerCount > :one }` + `Update Membership`, genérico o bastante para cobrir `suspend` no futuro sem reabrir). Falha → `LastOwnerError` nomeado. Promover para `OWNER` incrementa na mesma transação. `LeaveOrganizationService.leave(ctx)` **não aceita `targetUserId`** — opera sempre sobre `ctx.principal.userId` por assinatura (mais forte que uma checagem de runtime, não há como chamar errado).

**Autorização em 2 camadas**: matriz `ADMIN_ROLES` decide quem pode sequer tentar `role-change`/`remove`; checagem de serviço nomeada (`OwnerTierChangeRequiresOwnerError`) exige `OWNER` chamador quando a transição envolve o tier `OWNER` (promover para `OWNER`, ou mudar role de um `Membership` hoje `OWNER`) — achado de pesquisa (Slack: só Owner assina Owner).

### Novas `Action`s em `authorization.ts`

```text
"membership:invite"             → ADMIN_ROLES (+ checagem de serviço se role="OWNER")
"membership:revoke-invitation"  → ADMIN_ROLES
"membership:list-members"       → READ_ONLY_ROLES
"membership:list-invitations"   → ADMIN_ROLES  (privacidade — e-mail + intenção)
"membership:role-change"        → ADMIN_ROLES (+ checagem de serviço para o tier OWNER)
"membership:remove"             → ADMIN_ROLES (+ checagem de serviço para o tier OWNER)
"membership:leave"              → READ_ONLY_ROLES (self-service, proteção real é LastOwnerError)
```

### `MembershipAuditEvent` — agregado-irmão

`src/modules/organization/domain/audit-event.ts`, mesma forma de `subject/domain/audit-event.ts` — `resourceType: "Membership" | "Invitation"`, `action: "INVITATION_CREATED" | "INVITATION_ACCEPTED" | "INVITATION_REVOKED" | "ROLE_CHANGED" | "MEMBER_REMOVED" | "MEMBER_LEFT"`.

### Porta

`OrganizationStore.updateConditional<T extends EntityKey>(item: T, expected: { count: number; resetAt: string }): Promise<boolean>` — mesma assinatura literal de `SubjectStore.updateConditional`.

## Decomposição (per `definition-of-done.md`)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-8.1 | Domain — `Invitation`, `InvitationTokenPointer`, `InvitationDedupPointer`, `MembershipAuditEvent` | 5 |
| B2B-8.2 | Ports — `OrganizationStore.updateConditional()` | 3 |
| B2B-8.3 | Application — `MembershipInviteRateLimiter` + `CreateInvitationService` + `RevokeInvitationService` + `AcceptInvitationService` | 5 |
| B2B-8.4 | Application — `ListMembersService` + `ListInvitationsService` | 3 |
| B2B-8.5 | Domain (`authorization.ts`) + Application — `ChangeMembershipRoleService`/`RemoveMembershipService`/`LeaveOrganizationService`, builder de `ownerCount`, 7 novas `Action`s | 5 |
| B2B-8.6 | HTTP — handlers + rotas Terraform + entrada em `email-templates.ts` | 4 |
| B2B-8.7 | Testes — G-V3 desde a escrita + suíte completa + `build:lambdas` | 2-3 |

## Fora de escopo desta wave

- UI/IA de invite flow, switcher — Wave B2B-10.
- Transporte real de `activeOrganizationId`/seleção multi-org — Wave B2B-6.
- Responsible member/notification routing ao remover membro — Wave B2B-11.
- Transição `SUSPENDED`/unsuspend — ação administrativa futura, builder de `ownerCount` já genérico o bastante para reaproveitar quando existir.
- Relaxar "convite exige ADMIN-tier" para permitir `MEMBER` convidar (padrão Slack) — decisão de produto futura.

## Aplicação de `docs/engineering/definition-of-done.md` (E-012/E-013)

Cobertura mínima por teste: last-owner protection nas 3 operações (role-change/remove/leave); hierarquia OWNER-tier (ADMIN não promove/demove OWNER, nem convida como OWNER); anti-replay do token incluindo a corrida de expiração; dedup de convite PENDING; `list-members` vs. `list-invitations` com tiers distintos; rate-limit namespaced não colide com `initial-invite-rate-limiter`. G-V3 desde a escrita de cada teste.
