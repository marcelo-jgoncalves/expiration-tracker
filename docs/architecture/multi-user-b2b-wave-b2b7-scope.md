# Multi-User B2B — Wave B2B-7 (RBAC), escopo final

**Status: `APPROVED`** via protocolo Claude↔Codex (`AGENTS.md` §4, nível 5 de `change-risk-scale.md` — muda o contrato da matriz de autorização real em produção), 3 rodadas, nota cega cada rodada: Rodada 1 Claude 7,7/Codex — régua 7,4/design 8,2 (régua contestada, ver abaixo); Rodada 2 Claude 8,9/Codex — régua 9,1/design 8,8; Rodada 3 Claude 9,2/Codex — régua 9,1 (mantida)/design 9,3 (fechamento, ambos ≥9,0, sem arredondar). Registrado como `docs/architecture/decisions-log.md` D-097. Evidência completa das 3 rodadas: `docs/architecture/reviews/multi-user-b2b-wave-b2b7-scoping/`.

**Primeira aplicação real de `docs/engineering/research-protocol.md` (E-014)** — formalizado na sessão anterior, nunca antes exercitado numa decisão real. A Rodada 1 contestou o checklist de critérios de nota em si (não só a nota do design) — seguiu o fluxo de reconciliação do próprio E-014: nota da régua e nota do design registradas separadas até a régua convergir ≥9,0 dos dois lados (Rodada 2), só então a nota do design passou a contar para o fechamento.

## Pesquisa externa considerada: SIM

Fontes consultadas 2026-08-30: GitHub Docs (predefined organization roles), Linear Docs (members and roles), Slack Help (permissions by role), Notion Help (members/admins/guests), OWASP Authorization Cheat Sheet, NIST/ANSI INCITS 359 (RBAC formal, Hierarchical RBAC — adicionada na Rodada 2 após achado real da crítica do Codex de que a representatividade da Rodada 1 estava incompleta sem uma norma formal de RBAC). Achado central: os 4 produtos **não convergem totalmente** sobre o que "Admin" deveria poder fazer além de "Member" — GitHub decompõe em papéis granulares por capacidade em vez de um "Admin" único; Linear/Slack mantêm uma hierarquia mais limpa mas ainda reservam a Owner ações de mais-alta-irreversibilidade (billing, deleção do workspace, transferência de ownership, SSO); Notion trata "Membership Admin" como papel lateral (gerência de membros, sem acesso a configurações de workspace). Nenhuma dessas ações de mais-alta-irreversibilidade existe como `Action` neste projeto hoje — o checklist final (v2) exige uma decisão nomeada e justificada individualmente por action, não uma regra única de parity.

## Escopo final

### Estrutura de tiers (`src/modules/identity/domain/authorization.ts`)

```ts
export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

const READ_ONLY_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
const WRITE_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER"]);
const ADMIN_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN"]);
const OWNER_ROLES: ReadonlySet<Role> = new Set(["OWNER"]);
```

### Decisão nomeada por action (as únicas 2 linhas de `ACTION_ROLES` que mudam de constante; as outras 27 actions continuam apontando para a mesma constante de antes, agora com `ADMIN` incluído onde `ADMIN_ROLES` já se aplicava)

| Action | Tier final | Por quê |
|---|---|---|
| `item:delete`, `document:delete`, `subject:delete`, `requirement:delete` | `ADMIN_ROLES` (inalterado — `ADMIN` entra por construção) | Deleção de recurso de negócio individual, não configuração de workspace nem ação de mais-alta-irreversibilidade — precedente Slack (Admin deleta canais)/Linear (Admin tem acesso completo a conteúdo do workspace). |
| `notification:configure` | **`READ_ONLY_ROLES`** (era `ADMIN_ROLES` — **achado real, bug fix, não decisão ADMIN-vs-OWNER**) | A action cobre GET e update de uma preferência **pessoal** (`ctx.principal.userId`-keyed, `notification-preferences-service.ts:53/78`, sem parâmetro de userId arbitrário no handler HTTP), não configuração do tenant. Diferente de `profile:update` (WRITE_ROLES, D-060, amarrado à capacidade de AGIR — só quem cria `RequirementAssignment` precisa de `requesterDisplayName`), `notification:configure` é sobre RECEBER comunicação: `assigneeUserId` não é restrito por role do assignee em nenhum call site real, então até um `VIEWER` pode legitimamente ser destinatário de lembretes e precisa poder configurar `emailEnabled`/`quietHours` para si mesmo. Reaproveita `READ_ONLY_ROLES` (que, apesar do nome, já significa "qualquer papel com `Membership` real") em vez de criar uma 5ª constante para o mesmo conjunto de 4 papéis — comentário dedicado na tabela explica a mutação apesar do nome da constante. |
| `tenant:configure-document-request-delivery` | **`OWNER_ROLES`** (novo tier, era `ADMIN_ROLES`) | Única action da lista que é genuinamente configuração de tenant inteiro com impacto de reputação externa (política de convite automático de guest upload) — a classe que a pesquisa identifica como o real diferencial Owner-vs-Admin nos produtos consultados (workspace settings/comunicação externa, que Notion exclui do "Membership Admin" lateral). |

### Branch de ownership-bypass (`authorize()`, hoje linhas 161-173)

`ADMIN` bypassa mismatch de `ownerUserId`/`assigneeUserId`, mesmo comportamento de `OWNER` hoje — decisão explícita, não implícita (achado da Rodada 1 do Codex: a proposta original caracterizava esse branch como "código morto" sem decidir o comportamento de `ADMIN` nele). Justificativa: `ADMIN` tem paridade de conteúdo/recurso com `OWNER` (tabela acima), a mesma lógica "tenant-wide admin" que já justifica o bypass de `OWNER` se aplica.

```ts
if (!roles.includes("OWNER") && !roles.includes("ADMIN") && !isOwnerOrAssignee) {
  throw new AuthorizationDeniedError("RESOURCE_OWNERSHIP_MISMATCH", action);
}
```

### `resolveRoles()` (`src/modules/identity/application/resolve-request-context.ts`)

Passa a aceitar os 4 valores reais de `Membership["role"]` — `UnsupportedMembershipRoleError` continua existindo (fail-closed preservado) para qualquer valor fora desse domínio.

### Decomposição (per `definition-of-done.md`)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-7.1 | Domain — `Role` ganha `ADMIN`; 4 constantes de role (`READ_ONLY_ROLES`/`WRITE_ROLES`/`ADMIN_ROLES`/novo `OWNER_ROLES`); `notification:configure`→`READ_ONLY_ROLES`; `tenant:configure-document-request-delivery`→`OWNER_ROLES`; branch de ownership-bypass estendido a `ADMIN`; comentários obsoletos reconciliados (M1 role model comment, D-060 comment) | 5 (muda o contrato da matriz de autorização real em produção — gate de toda ação hoje) |
| B2B-7.2 | Application — `resolveRoles()` aceita os 4 valores reais, remove o throw para `ADMIN` | 4 |
| B2B-7.3 | Testes — G-V3 desde a escrita: `ADMIN` paritário com `OWNER` nas 4 actions `ADMIN_ROLES`; `ADMIN` negado em `tenant:configure-document-request-delivery` (só `OWNER`); `VIEWER` aceito em `notification:configure` (GET e update); `ADMIN` bypassa ownership mismatch (espelha `authorization.test.ts:60`); fail-closed preservado para um valor de role hipotético fora do domínio real; suíte completa, zero regressão | 2-3 |

## O que fica fora desta wave (redesignado, não esquecido)

- Actions novas de gerência de `Membership` (convite/aceitar/revogar/listar membros/mudança de role/remover/sair) — Wave B2B-8, §113 do roadmap.
- Decremento transacional de `ownerCount` — TODO já registrado de B2B-7/B2B-8 no wave tracker desde B2B-3; ainda sem call site real porque nenhuma operação muda role/status de `Membership` nesta wave.
- Qualquer tela/endpoint de "organization settings" separado de `ACTION_ROLES` — não existe no produto hoje.

## Achado real registrado durante a rodada (não estava no escopo textual original de §112 do roadmap)

`notification:configure` estava `ADMIN_ROLES`-gated desde o commit original (M0-M3), contradizendo o próprio comentário do código (D-060, `authorization.ts:49-52`) que já a citava como precedente de "self-service WRITE... not ADMIN". Inofensivo sob MVP (`tenantId=userId`, comentário explícito em `notification-preferences-service.ts:6-7` já registrava isso como "no-op restriction"), mas se tornaria um bug real de UX no momento em que `MEMBER`/`VIEWER` passassem a ser papéis alcançáveis por pessoas de verdade — exatamente o que esta wave habilita. Corrigido por ser "migrar autorização existente" (§112), não uma decisão nova de RBAC — mesma classe de honestidade de processo dos achados de B2B-5 (D-096).

## Aplicação de `docs/engineering/definition-of-done.md` (E-012/E-013)

Implementação real desta wave cobre com teste, no mínimo: paridade `ADMIN`=`OWNER` nas 4 actions `ADMIN_ROLES`; a exceção nomeada `OWNER_ROLES`; a correção de `notification:configure` incluindo o caso `VIEWER`; o branch de ownership-bypass para `ADMIN`; e o fail-closed preservado para um valor de role desconhecido. G-V3 (mutação nomeada por escrito) aplicado desde a escrita de cada teste, não retrofitado depois.
