# Multi-User B2B — Wave B2B-8 (Invitations/Team), Rodada 1 — Proposta Claude

Contexto: Waves B2B-0 a B2B-7 `DONE`. Escopo textual original (`roadmap-evolution/17` §113): `Invitation, Invite, Accept, Revoke, List, Members, Role change, Remove, Leave — com segurança e auditoria`. Diferente de B2B-7, aqui o **mecanismo de dados central já está `APPROVED`** desde a Wave B2B-1 (`multi-user-b2b-physical-model.md` §7-9, D-086, protocolo Claude↔Codex 5 rodadas, Claude 9,3/Codex 9,5) — esta rodada não redesenha isso, decompõe a implementação e fecha as decisões genuinamente novas que o physical model deixou em aberto (quem pode convidar/remover/mudar role de quem; semântica de last-owner leave).

## Pesquisa externa considerada: SIM PARCIAL

**Escopo da pesquisa**: o mecanismo de convite/token/dedup/aceite (`Invitation`, anti-account-takeover via `emailNormalized = :callerVerifiedEmail` estrutural, anti-replay via token one-time consumption) **já foi pesquisado e aprovado em D-086** — não repito essa pesquisa aqui (`research-protocol.md` já cita isso como o próprio exemplo `SIM PARCIAL` ilustrativo, retrospectivo). O que é genuinamente novo nesta wave e não tem precedente interno prévio:

1. **Quem pode convidar/remover/mudar role de quem** (autorização composta com a hierarquia de RBAC fechada em B2B-7).
2. **O que acontece quando o único `OWNER` tenta sair ou ser removido** (o mecanismo transacional `ownerCount` de D-086 §8 já bloqueia a condição `ownerCount > :one`, mas D-086 não decidiu a UX/qual ação é bloqueada por isso nem o erro nomeado — isso é decisão desta wave).

**Fontes consultadas 2026-08-30** (mesma amostra de B2B-7 + resultado novo desta rodada, dev-first + produtividade geral):

1. GitHub Docs — [Maintaining ownership continuity for your organization](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/maintaining-ownership-continuity-for-your-organization), [Transferring organization ownership](https://docs.github.com/en/organizations/managing-organization-settings/transferring-organization-ownership)
2. Slack Help — [Change a member's role](https://slack.com/help/articles/218124397-Change-a-members-role), [Transfer ownership of a workspace or org](https://slack.com/help/articles/204401633-Transfer-ownership-of-a-workspace-or-org)
3. Linear Docs — [Invite & Manage Members](https://linear.app/docs/adding-and-managing-members), [Members and roles](https://linear.app/docs/members-roles)
4. Notion Help — vídeos/help oficiais sobre transferência de ownership (transferir antes de sair; não permite remover o dono antigo antes do novo dono existir)

**Achado central — convergência forte (raro nas pesquisas deste projeto até agora) em "last-owner protection"**: as 4 fontes convergem sem exceção — **nenhuma permite que a organização fique com zero Owners**. GitHub bloqueia literalmente a saída/remoção do último Owner (erro explícito, "an organization must have at least one owner"), exige promover um segundo Owner antes. Slack: "no one can deactivate the Org Primary Owner... before you can deactivate these accounts, they must transfer ownership to someone else." Notion: "You cannot remove the old owner before making the new account a Workspace Owner — Notion won't allow it." Linear (nível Admin, já que Owner é só Enterprise): remover o único Admin exige promover outro primeiro. **Isto confirma (não redesenha) o mecanismo já `APPROVED` em D-086 §8** (`ConditionExpression: ownerCount > :one` bloqueia atomicamente qualquer transição que zeraria `ownerCount`) — a pesquisa mostra que é exatamente o padrão de mercado, não uma invenção interna.

**Achado — convergência parcial em "quem gerencia membros"**: GitHub (só Owner, não tem Admin de organização), Linear (Admin gerencia/suspende membros), Notion (Membership Admin gerencia membros) convergem em **ADMIN-tier-e-acima gerencia membros** (convidar/remover/listar/mudar role) — nunca Member/Viewer. Slack diverge parcialmente: por padrão permite que Members enviem convites (não just Admin/Owner) — mas essa é uma permissão configurável em Slack (workspace setting), não um comportamento fixo, e nenhuma das outras 3 fontes a replica. **Divergência registrada explicitamente, não escondida** — a proposta abaixo segue a maioria (3 de 4) e o viés conservador de default-deny já estabelecido neste projeto (OWASP, `research-protocol.md`), deixando "permitir MEMBER convidar" como uma relaxação futura explícita, não o ponto de partida.

**Achado — hierarquia sobre a própria hierarquia**: Slack é explícito — "Workspace Owners can assign Workspace Owners... [and] assign Workspace Admins" (fraseado assimétrico: promover/demover para/de `OWNER` é ação de `OWNER`, mas gerenciar `ADMIN`/`MEMBER` é ação de `OWNER` **ou** `ADMIN`). Nenhuma fonte mostra um `ADMIN` promovendo outro membro a `OWNER` ou demovendo um `OWNER`. **Decisão**: mudanças de role que envolvem `OWNER` (promover para `OWNER`, ou mudar o role de um `Membership` que hoje é `OWNER`) exigem `OWNER` chamador; mudanças entre `ADMIN`/`MEMBER`/`VIEWER` exigem `ADMIN`-tier-e-acima (paridade com `OWNER`, já existente desde B2B-7).

## Checklist de critérios de nota (subordinado a `joint-review-criteria.md`, eixos Segurança/AppSec e Governança de Produto Multi-tenant)

```text
1. (peso 30%) Last-owner protection é estrutural, não apenas de aplicação — reaproveita o
   ConditionExpression `ownerCount > :one` já `APPROVED` (D-086 §8) em TODA transição que
   reduziria ownerCount (role-change de/para OWNER, remove, suspend, leave), nunca uma
   checagem solta de aplicação antes da transação (mesma disciplina de `occ.ts`/W3-07 - "nenhuma
   leitura solta antes da decisão"). Atende: as 4 operações (role-change, remove, suspend via
   role-change futuro, leave) compartilham o MESMO builder transacional de decremento, erro
   nomeado (não `ConditionalCheckFailedException` cru) na falha. Não atende: qualquer operação
   reimplementa a checagem separadamente ou confia em leitura prévia sem condição atômica.
2. (peso 25%) Hierarquia de gerência de membros nomeada e testada: ADMIN-tier-e-acima (OWNER+
   ADMIN) gerencia MEMBER/VIEWER; só OWNER gerencia entrada/saída do tier OWNER (promover para
   OWNER, mudar role de um Membership atualmente OWNER). Atende: matriz de authorization.ts +
   checagem de serviço nomeada cobrem os 2 níveis, com teste explícito para ADMIN tentando
   promover/demover um OWNER (deve falhar) e ADMIN gerenciando MEMBER/VIEWER (deve funcionar).
   Não atende: ADMIN consegue tocar o tier OWNER, ou a distinção fica só documentada sem teste.
3. (peso 20%) Anti-account-takeover/replay do mecanismo de convite (D-086 §9) implementado
   literalmente, não reinterpretado — `emailNormalized = :callerVerifiedEmail` estrutural na
   transação de aceite, token one-time consumption, dedup PENDING por (org, email) via
   ConditionCheck. Atende: teste adversarial prova que aceitar um convite com e-mail
   verificado diferente do `emailNormalized` do convite falha; token consumido 2x falha.
4. (peso 15%) Proporcionalidade de escopo — nenhuma feature especulativa além do escopo
   textual de §113 (ex. não implementar transferência de ownership como fluxo dedicado além do
   que role-change já cobre; não implementar UI, isso é B2B-10). Rate-limit de convite
   reaproveita o padrão já `APPROVED` (D-049, `initial-invite-rate-limiter.ts`), não inventa um
   mecanismo novo.
5. (peso 10%) Auditoria — cada mutação real (invite criado/aceito/revogado, role mudado,
   membro removido, membro saiu) grava um `MembershipAuditEvent` (agregado-irmão do padrão já
   `APPROVED` em `subject/domain/audit-event.ts`/`expiration/domain/audit-event.ts`) na MESMA
   transação da mutação, nunca best-effort separado. Atende: todo write path novo tem seu
   evento de auditoria na mesma `TransactWriteItems`.
```

## Decisões desta rodada

### 1. `Invitation` + token pointer + dedup pointer — implementação literal de D-086 §7 (nenhuma decisão nova)

`src/modules/organization/domain/invitation.ts` (chaves/tipos, mesmo padrão de `membership.ts`), `src/modules/organization/domain/invitation-token.ts` (paralelo a `subject/domain/guest-token.ts` — MESMA mecânica `selector.secret`/HMAC/`timingSafeEqual`/parse fail-safe, chave `INVITATION_TOKEN#<selectorHash>`, nunca reaproveitando a classe `GuestTokenPointer`, per D-086 §7 texto literal).

### 2. `CreateInvitationService` — invite + rate-limit + dedup

Reaproveita `initial-invite-rate-limiter.ts` como TEMPLATE (mesmo mecanismo de janela fixa `putIfAbsent`/`updateConditional`, chaves próprias `TENANT#<organizationId>#SETTINGS`/`RATE`), não a classe em si (módulo `subject` não deve ser importado por `organization` — `check-boundaries`). `TransactWriteItems`: `Put Invitation` (PENDING) + `Put InvitationTokenPointer` + `ConditionCheck`/`Put InvitationDedupPointer` (`attribute_not_exists` — se falhar, reenvio/rotação do convite PENDING existente, nunca 2º convite) + `Put MembershipAuditEvent` ("INVITATION_CREATED"). Autorização: `membership:invite`, `ADMIN_ROLES` (achado da pesquisa, divergência do Slack registrada e não seguida).

**Achado corrigido durante a escrita desta própria proposta (não deixado como pergunta aberta ao Codex)**: convidar alguém diretamente com `role: "OWNER"` é a MESMA classe de decisão que o item 6 abaixo decide para `role-change` — um `ADMIN` não deveria conseguir criar um convite `OWNER` só porque `membership:invite` é `ADMIN_ROLES`. `CreateInvitationService` aplica a mesma checagem de serviço do item 6 (`OwnerTierChangeRequiresOwnerError` reaproveitado) quando `input.role === "OWNER"`.

### 3. `AcceptInvitationService` — literal de D-086 §9

`Update Membership` (upsert, `attribute_not_exists(PK) OR #status = :REMOVED`) + `Update Invitation` (`#status = :PENDING AND emailNormalized = :callerVerifiedEmail`) + `Delete InvitationDedupPointer` + `Put MembershipAuditEvent` ("INVITATION_ACCEPTED") + **`Update Organization` incrementando `ownerCount`, SÓ SE `role = OWNER`** (fecha o caminho de incremento que D-086 §8 já previa para "promover um segundo membro a OWNER", nunca exercitado até agora porque não havia writer real). Autorização: identidade + token válido, não passa por `authorize()`/`ACTION_ROLES` tenant-scoped (mesmo padrão de `POST /bff/organizations`, D-096 — não há tenant ainda no momento do aceite se o usuário não tinha Membership prévia).

### 4. `RevokeInvitationService`

`Update Invitation` (`#status = :PENDING` → `REVOKED`) + `Delete InvitationDedupPointer` + `Put MembershipAuditEvent`. Autorização: `membership:revoke-invitation`, `ADMIN_ROLES`.

### 5. `ListMembersService` / `ListInvitationsService`

`queryByPk(organizationKey, skPrefix: "MEMBER#" | "INVITATION#")` — porta já existe (`organization-store.ts`), nenhuma mudança de porta necessária. Autorização: `membership:list`, `READ_ONLY_ROLES` (ver membros/convites é leitura, mesmo nível de `item:read` etc — nenhuma fonte pesquisada restringe LISTAR a admin-tier, só as ações de escrita).

### 6. `ChangeMembershipRoleService` / `RemoveMembershipService` / `LeaveOrganizationService` — o núcleo novo desta wave

Todas as 3 operações que podem reduzir `ownerCount` (role-change de OWNER para outro role, remove de uma Membership OWNER `ACTIVE`, leave de si mesmo sendo OWNER) usam o MESMO builder transacional: `Update Organization { ownerCount = ownerCount - 1, ConditionExpression: ownerCount > :one }` + `Update Membership` na mesma `TransactWriteItems`. Falha na condição → erro nomeado `LastOwnerError` (não `ConditionalCheckFailedException` cru, mesma disciplina de `getCancellationReasonCodes()` já usada em `occ.ts` para distinguir por índice qual item da transação falhou), mapeado a 409 pela camada HTTP. Promover PARA `OWNER` incrementa `ownerCount` na mesma transação (mesmo builder de incremento do item 3 acima). Cada operação grava seu `MembershipAuditEvent` (`ROLE_CHANGED`/`MEMBER_REMOVED`/`MEMBER_LEFT`).

**Autorização em 2 camadas** (achado da pesquisa, Slack "Owners assign Owners"):
- Matriz (`authorization.ts`): `membership:role-change`/`membership:remove` → `ADMIN_ROLES` (baseline, quem pode sequer tentar).
- Checagem de serviço (não expressável no `AuthorizedResource` genérico sem inventar um campo novo, mesmo padrão de `resolveRoles()`/gates de lifecycle já feitos como checagem de serviço nomeada): se `targetMembership.role === "OWNER"` OU `newRole === "OWNER"`, exige `context.tenant.roles.includes("OWNER")` — erro nomeado `OwnerTierChangeRequiresOwnerError` se um `ADMIN` tentar. `membership:leave` não passa por `ADMIN_ROLES` (é self-service, qualquer role sai de si mesmo) — a proteção real é só o `LastOwnerError` transacional.

### 7. Novas `Action`s em `authorization.ts`

```text
"membership:invite"            → ADMIN_ROLES
"membership:revoke-invitation" → ADMIN_ROLES
"membership:list"              → READ_ONLY_ROLES
"membership:role-change"       → ADMIN_ROLES (+ checagem de serviço para o tier OWNER)
"membership:remove"            → ADMIN_ROLES (+ checagem de serviço para o tier OWNER)
"membership:leave"             → READ_ONLY_ROLES (self-service, qualquer role — proteção real é o LastOwnerError transacional, não a matriz)
```

### 8. `MembershipAuditEvent` — agregado-irmão (nenhuma decisão nova, reaproveita padrão já `APPROVED`)

`src/modules/organization/domain/audit-event.ts`, mesma forma de `subject/domain/audit-event.ts` (append-only, redigido, sempre na mesma transação), `resourceType: "Membership" | "Invitation"`, `action: "INVITATION_CREATED" | "INVITATION_ACCEPTED" | "INVITATION_REVOKED" | "ROLE_CHANGED" | "MEMBER_REMOVED" | "MEMBER_LEFT"`.

## Decomposição (per `definition-of-done.md`)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-8.1 | Domain — `Invitation`, `InvitationTokenPointer`, `InvitationDedupPointer` (implementação literal D-086 §7); `MembershipAuditEvent` (agregado-irmão) | 5 (novo access pattern/chaves — implementação direta de design já `APPROVED`) |
| B2B-8.2 | Application — `CreateInvitationService` (rate-limit + dedup + audit), `RevokeInvitationService`, `AcceptInvitationService` (transação literal D-086 §9 + incremento de `ownerCount`) | 5 (primeiro writer real de `Membership` além da criação — gatilho central da wave) |
| B2B-8.3 | Application — `ListMembersService`/`ListInvitationsService` | 3 (reaproveita porta existente, sem novo access pattern) |
| B2B-8.4 | Domain (`authorization.ts`) + Application — `ChangeMembershipRoleService`/`RemoveMembershipService`/`LeaveOrganizationService`, builder transacional de `ownerCount` compartilhado, `LastOwnerError`/`OwnerTierChangeRequiresOwnerError` nomeados, 6 novas `Action`s | 5 (decisão de autorização nova nível 5-6, informada por pesquisa desta rodada — o núcleo do debate) |
| B2B-8.5 | HTTP — handlers + rotas Terraform + template de e-mail de convite. **Verificado por leitura direta (não assumido)**: `subject/application/document-request-service.ts` já importa `EmailProviderAdapter`/`sanitizeTenantText` de `notification/providers/email-templates.ts` cross-module (linha 25-26) e envia via `emailProvider!.send()` best-effort após a transação (linha 219) — mesmo padrão de dependência `organization`→`notification` é seguro (precedente já passa `check-boundaries`), só adiciona uma entrada nova ao registry de `email-templates.ts` (`"organization-invitation"`), não um pipeline novo | 4 |
| B2B-8.6 | Testes — G-V3 desde a escrita: last-owner protection nas 3 operações; hierarquia OWNER-tier vs ADMIN-tier; anti-account-takeover/replay do aceite; dedup de convite; suíte completa + `build:lambdas` | 2-3 |

## Fora de escopo desta wave (redesignado, não esquecido)

- UI/IA de invite flow, switcher — Wave B2B-10.
- Transporte real de `activeOrganizationId`/seleção multi-org — Wave B2B-6 (mas B2B-8 é o que torna isso alcançável de verdade pela primeira vez).
- Responsible member/notification routing quando um membro é removido — Wave B2B-11 (já nomeado no physical model §16/§121 Q23).
- Relaxar "convite exige ADMIN-tier" para permitir MEMBER convidar (padrão Slack) — decisão de produto futura, não o ponto de partida conservador desta wave.

## Pergunta aberta para a Rodada 1 do Codex

1. A divisão em 2 camadas de autorização (matriz `ADMIN_ROLES` + checagem de serviço nomeada para o tier OWNER, reaproveitada também para invite-como-OWNER) é a forma certa, ou deveria virar uma 3ª classe na matriz central (ex. `OWNER_ROLES` já existe desde B2B-7 — reaproveitar para as 2 actions diretamente, sem checagem de serviço, mudaria a semântica para "ninguém além de OWNER pode sequer tentar `membership:role-change`/`membership:invite`", o que é MAIS restritivo que o achado da pesquisa: ADMIN pode convidar/mudar role de MEMBER/VIEWER, só não pode tocar o tier OWNER)?
2. Falta alguma fonte ou um caso real não coberto pela pesquisa?
3. `membership:leave` como `READ_ONLY_ROLES` (self-service irrestrito, proteção só via `LastOwnerError`) é a leitura certa, ou deveria ter sua própria checagem de serviço adicional?
