# Multi-User B2B — Wave B2B-7 (RBAC), Rodada 1 — Proposta Claude

Contexto: Waves B2B-0 a B2B-5 `DONE` (D-084 a D-096). `Membership.role` já declara 4 valores (`OWNER | ADMIN | MEMBER | VIEWER`, D-090), mas a matriz de autorização real em produção (`src/modules/identity/domain/authorization.ts`) só reconhece 3 (`OWNER | MEMBER | VIEWER`) — `RequestContextResolver.resolveRoles()` lança `UnsupportedMembershipRoleError` (fail-closed, deliberado) se um `Membership.role === "ADMIN"` aparecer, exatamente porque nenhum writer real produz esse valor ainda (achado 2.2 de B2B-5, D-095/D-096). `roadmap-evolution/17` §112 define o escopo textual desta wave em 4 linhas: `OWNER/ADMIN/MEMBER/VIEWER, permissions, default deny, migrar autorização existente`.

Esta é a **primeira aplicação real de `docs/engineering/research-protocol.md` (E-014)** — formalizado nesta mesma sessão, nunca usado antes numa decisão de verdade.

## Pesquisa externa considerada: SIM

**Critério de E-014 (ambas condições)**: (1) nível 5 de `change-risk-scale.md` — muda o contrato de `authorization.ts`/`ACTION_ROLES`, gate real de toda ação do sistema hoje em produção; (2) define um padrão que produtos fora deste projeto já resolveram de forma conhecida (modelo de permissões RBAC com hierarquia de papéis) — não há parte puramente interna significativa nesta decisão (diferente de D-086, que misturava layout de chave interno com mecanismo de last-OWNER externo). Declaração `SIM` completo.

**Fontes (consultadas 2026-08-30)**:

1. GitHub Docs — [Permissions of predefined organization roles](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/permissions-of-predefined-organization-roles)
2. Linear Docs — [Members and roles](https://linear.app/docs/members-roles)
3. Slack Help — [Permissions by role in Slack](https://slack.com/help/articles/201314026-Permissions-by-role-in-Slack)
4. Notion Help — [Manage members, admins & guests in Notion](https://www.notion.com/help/add-members-admins-guests-and-groups) + [Who's who in a workspace](https://www.notion.com/help/whos-who-in-a-workspace)
5. OWASP Cheat Sheet Series — [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) (fundamenta a postura de segurança — default-deny, risco de "role explosion" — não é só padrão de produto)

**Representatividade da amostra**: GitHub e Linear são dev-first; Slack e Notion são produtividade geral — cobre os dois nichos, reduzindo viés de porte único (mesmo critério que `research-protocol.md` nomeia como suficiente). Adicionei OWASP porque a decisão também tem postura de segurança (default-deny/fail-closed), não só forma de produto — `research-protocol.md` distingue essas duas classes e recomenda norma/RFC quando existir em vez de só documentação de vendor.

**Achado real da pesquisa (verificado por leitura direta de cada fonte, não por resumo de busca) — sem padrão totalmente convergente**:

| Fonte | Modelo de ADMIN encontrado |
|---|---|
| GitHub | **Não tem** um "Admin" único no nível de organização. Owner tem controle administrativo total; Member é o papel padrão não-administrativo; qualquer coisa entre os dois é decomposta em papéis granulares por capacidade (`Moderator`, `Billing manager`, `Security manager`, `CI/CD admin`, `App manager`) em vez de um bucket único |
| Linear | Hierarquia limpa e explícita: **Owner > Admin > Member > Guest**, superconjunto estrito a cada nível — Admin gerencia membros/roles e acessa páginas de administração; Owner acrescenta só billing/security/audit log/OAuth app approval (Enterprise-only) |
| Slack | Owner e Admin são **funcionalmente quase idênticos** — únicas ações exclusivas de Owner: transferência de ownership primário, deleção do workspace, config de SSO (Enterprise). Tudo mais que Admin pode (canais, contas, analytics, configurações) é diferença Admin-vs-Member, não Owner-vs-Admin. Modelo documentado explicitamente como **default-deny**: "unlisted actions are implicitly restricted by role" |
| Notion | Diverge dos outros três: "Membership Admin" (Enterprise) é um papel **lateral**, não um degrau da mesma hierarquia — só gerencia membros/grupos, não tem acesso a configurações de workspace que Owner tem. Não é `Owner ⊇ Admin ⊇ Member` |
| OWASP | Deny-by-default explícito ("a aplicação deve sempre decidir negar ou permitir"); alerta contra "role explosion" (múltiplos papéis quase-redundantes) — favorece manter Admin como extensão do papel existente em vez de inventar papéis novos sem necessidade real |

3 de 4 fontes de produto (GitHub via decomposição, Linear, Slack) convergem em: **o que existe hoje como ação "OWNER-only" neste projeto não deveria virar automaticamente ADMIN-exclusive** — a diferenciação real Owner-vs-Admin nos três só aparece em ações de mais alta irreversibilidade que **não existem na superfície de `Action` deste projeto hoje** (billing, deleção da organização inteira, transferência de ownership, SSO/segurança de nível workspace). Notion diverge, mas seu modelo lateral só se justifica porque Notion tem uma camada de "workspace settings" tratada como algo à parte de "conteúdo do workspace" — este projeto não tem essa distinção (não há tela de "org settings" separada das ações de negócio da matriz `ACTION_ROLES`). Registrado explicitamente aqui, não escondido: a pesquisa não é unanimemente convergente, e a proposta abaixo segue a maioria justificando por que a divergência do Notion não se aplica à forma real deste produto.

## Checklist de critérios de nota da rodada (subordinado a `joint-review-criteria.md`, eixos Segurança da Informação/AppSec e Governança de Produto Multi-tenant — não os substitui)

```text
1. (peso 35%) Hierarquia sem "papel lateral" disfarçado — ADMIN é superconjunto estrito
   de MEMBER e paritário com OWNER sobre TODA a superfície de `Action` que existe hoje
   no código real (não uma reinterpretação nova de nenhuma action existente). Segue o
   padrão majoritário da pesquisa (Linear/Slack — hierarquia limpa) em vez do padrão
   lateral do Notion, com justificativa explícita de por que a divergência do Notion
   não se aplica aqui (ausência de uma camada de "workspace settings" separada de
   ACTION_ROLES). Atende: ADMIN_ROLES/WRITE_ROLES/READ_ONLY_ROLES incluem ADMIN em
   paridade com OWNER, zero action existente muda de comportamento para MEMBER/VIEWER.
   Não atende: qualquer action antes ADMIN-tier (OWNER-only) permanecer OWNER-only sem
   uma justificativa nomeada e específica de por que ela pertence à camada de "mais alta
   irreversibilidade" que a pesquisa identificou (billing/deleção de org/ownership
   transfer) — nenhuma delas existe como Action hoje, então essa exceção não deveria
   sobrar nenhuma se a paridade for aplicada corretamente.
2. (peso 25%) Default deny preservado (OWASP + `implementation-blueprint.md` §4.3) —
   nenhuma Action muda de resultado para um papel que não seja ADMIN; o fail-closed
   (`UnsupportedMembershipRoleError`) continua ativo para qualquer valor de role futuro
   não reconhecido pela união de `Role`. Atende: teste explícito prova que um valor de
   role hipotético e desconhecido ainda lança fail-closed depois da mudança. Não atende:
   o cast unsafe (`context.tenant.roles as Role[]`) muda de forma a aceitar um valor não
   validado silenciosamente, ou o assert deixa de existir por completo.
3. (peso 25%) Proporcionalidade de escopo (`principles.md` #1 + achado central da
   pesquisa: OWASP alerta contra "role explosion"/GitHub mostra o custo de granularidade
   prematura) — nenhuma `Action` nova de gerência de `Membership` (convite, remoção,
   mudança de role) é adicionada nesta wave; isso é textualmente Wave B2B-8 (§113 do
   roadmap, "Invitations/Team... Role change... Remove"). Atende: o enum `Action`
   permanece do tamanho atual (26 valores), zero endpoint novo de gerência de membro.
   Não atende: qualquer action especulativa para uma operação que B2B-8 ainda não
   implementa.
4. (peso 15%) Migração sem regressão e auditável — suíte cobre ADMIN em paridade com
   OWNER por tier (read/write/admin-tier) e o fail-closed de um valor de role
   desconhecido; nenhum call site existente de `authorize()` quebra; G-V3 aplicado desde
   a escrita de cada teste novo (E-013). Atende: `npm test` completo verde + os testes
   novos citados com mutação nomeada. Não atende: suíte verde sem teste dedicado
   cobrindo especificamente a paridade ADMIN=OWNER ação-a-ação.
```

Cada rodada subsequente do protocolo Claude↔Codex avalia a proposta contra estes 4 itens especificamente, não contra impressão geral de qualidade (`research-protocol.md` §"a pesquisa estabelece os critérios de nota").

## 1. Inputs não-negociáveis (já fechados por decisões anteriores — esta rodada não reabre)

- `Membership.role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"` já é o tipo de domínio (D-090) — B2B-7 não muda esse enum, só faz a matriz de autorização reconhecê-lo por inteiro.
- `RequestContextResolver.resolveRoles()` hoje lança `UnsupportedMembershipRoleError(role)` para qualquer valor fora de `OWNER|MEMBER|VIEWER` (D-095/D-096, achado 2.2) — este é o gate real que B2B-7 fecha.
- Decremento transacional de `ownerCount` ao remover/demover um `OWNER` (physical model §8) continua **fora de escopo** — TODO explícito de B2B-7/B2B-8 já registrado no wave tracker, sem call site real até B2B-8 existir uma operação que mude role/status de Membership.
- Nenhuma operação de convite/mudança de role é escopo desta wave — B2B-8 (§113 do roadmap).

## 2. Proposta de modelo de permissões

### 2.1. `Role` ganha `ADMIN`, paritário com `OWNER` em toda a superfície de `Action` atual

```ts
export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

const READ_ONLY_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
const WRITE_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER"]);
const ADMIN_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN"]);
```

Nenhuma linha de `ACTION_ROLES` muda de valor (continuam apontando para as mesmas 3 constantes) — só o conteúdo das constantes muda, exatamente a garantia que o comentário original de `authorization.ts:72` já prometia ("a matriz é estruturada para que adicionar papéis depois não mude call sites, só esta tabela").

**Por que paridade total com OWNER, não um subconjunto de `ADMIN_ROLES`**: as 6 actions hoje `ADMIN_ROLES`-gated (`item:delete`, `document:delete`, `subject:delete`, `requirement:delete`, `notification:configure`, `tenant:configure-document-request-delivery`) são deleções de recurso e configuração de tenant — nenhuma delas é da classe "mais alta irreversibilidade" que a pesquisa identificou como o real diferencial Owner-vs-Admin nos produtos consultados (billing, deleção da organização inteira, transferência de ownership). Inventar uma sub-hierarquia dentro de `ADMIN_ROLES` para diferenciar OWNER de ADMIN nessas 6 actions não seria informado por nenhuma fonte pesquisada — seria política nova sem precedente externo nem interno, o oposto do que E-014 pede.

### 2.2. `RequestContextResolver.resolveRoles()` para de rejeitar `ADMIN`

```ts
private resolveRoles(role: Membership["role"]): string[] {
  if (role !== "OWNER" && role !== "ADMIN" && role !== "MEMBER" && role !== "VIEWER") {
    throw new UnsupportedMembershipRoleError(role);
  }
  return [role];
}
```

O fail-closed continua existindo — só a lista de valores aceitos cresce de 3 para 4, cobrindo exatamente o domínio real de `Membership["role"]` hoje (nenhum 5º valor existe). Um valor futuro fora desse domínio (impossível de expressar no TypeScript atual, mas defensivo contra um dado corrompido/legado) ainda lança `UnsupportedMembershipRoleError`.

### 2.3. Comentário de `authorization.ts` atualizado

O comentário atual ("Minimal role model for M1... Membership/roles beyond OWNER are FUT-001") fica obsoleto — `ADMIN` deixa de ser hipotético. Atualizar para registrar que B2B-7 fechou isso e citar esta decisão.

### 2.4. Verificação real de call sites (por leitura direta, não presumida)

Todos os ~45 call sites reais de `authorize()` (`grep` em `src/**/*.ts` excluindo testes) passam `resource: { tenantId }` sozinho — nenhum popula `ownerUserId`+`assigneeUserId` juntos. O branch de bypass por ownership em `authorize()` (linhas 161-173, "`OWNER` role bypasses per-resource ownership") continua código morto hoje, exatamente como o comentário original já documentava — `ADMIN` entrar em paridade com `OWNER` no `ACTION_ROLES` não precisa (e não deveria, por proporcionalidade) estender esse branch, porque nenhum call site real o exercitaria de qualquer forma. Só `Role` (linha 74), as 3 constantes (linhas 76-78) e `resolveRoles()` em `resolve-request-context.ts` (linha 187) têm o valor `"ADMIN"` ausente hoje — confirmado como a superfície completa de mudança.

## 3. Decomposição proposta (per `definition-of-done.md`)

| Subitem | Camada | Risco proposto |
|---|---|---|
| B2B-7.1 | Domain — `Role` ganha `ADMIN`; `READ_ONLY_ROLES`/`WRITE_ROLES`/`ADMIN_ROLES` atualizados; comentário reconciliado | 5 (muda o contrato da matriz de autorização real em produção, gate de toda ação hoje — `change-risk-scale.md` nível 5, "muda contrato... difícil de reverter silenciosamente sem reintroduzir o gap") |
| B2B-7.2 | Application — `resolveRoles()` para de lançar `UnsupportedMembershipRoleError` para `ADMIN` | 4 (implementação direta de 3.1, sem novo contrato — só amplia um `if` já existente) |
| B2B-7.3 | Testes — paridade ADMIN=OWNER ação-a-ação (read/write/admin-tier) + fail-closed continua para um valor hipotético desconhecido + suíte completa, G-V3 desde a escrita | 2-3 (verificação + testes novos sem novo access pattern) |

## 4. Fora de escopo desta wave (redesignado, não esquecido)

- Qualquer `Action` nova de gerência de `Membership` (convite/aceitar/revogar/listar membros/mudança de role/remover/sair) — Wave B2B-8, §113 do roadmap.
- Decremento transacional de `ownerCount` — TODO já registrado de B2B-7/B2B-8 no wave tracker; sem call site real ainda porque nenhuma operação muda role/status de Membership nesta wave.
- Qualquer tela/endpoint de "organization settings" separado de `ACTION_ROLES` (a distinção que tornaria o modelo lateral do Notion aplicável) — não existe no produto hoje, fora de escopo especular sobre ela.

## 5. Pergunta aberta para a crítica do Codex

1. A paridade total ADMIN=OWNER sobre as 6 actions hoje `ADMIN_ROLES`-only é a leitura certa da pesquisa, ou existe uma linha de corte melhor dentro dessas 6 (ex.: `tenant:configure-document-request-delivery` — política de comunicação externa de todo o tenant — merece ficar OWNER-only por analogia com "workspace settings" do Notion, mesmo esse projeto não tendo uma tela separada)?
2. A pesquisa não achou nenhum produto que trate "papel intermediário sem nenhuma diferenciação prática de Owner sobre a superfície de ação atual" como um problema em si (Slack documenta isso abertamente) — mas essa ausência de diferenciação é aceitável permanentemente, ou é só um sintoma de que este produto ainda não tem nenhuma action na classe "mais alta irreversibilidade" (o que muda quando B2B-8/organization-lifecycle existirem)?
3. Falta alguma fonte que deveria ter sido consultada antes de fechar `SIM` (ex.: um RFC/norma de RBAC formal como NIST INCITS 359, que não foi consultado nesta rodada)?
