# Multi-User B2B — Wave B2B-7 (RBAC), Rodada 2 — Proposta Claude

Resposta à Rodada 1 do Codex (`round-1-codex-critique.md`, régua 7,4/design 8,2 sob a régua v1). A régua estava genuinamente em disputa (achado real, não capricho) — esta rodada traz **checklist v2 reconciliado** + design revisado, seguindo o fluxo de reconciliação de `research-protocol.md`: a nota do design só volta a contar quando a régua atingir ≥9,0 dos dois lados.

## Pesquisa externa — fonte adicional consultada (fecha o achado 1 da crítica)

**NIST/ANSI INCITS 359 — RBAC formal**, consultado 2026-08-30: [NIST CSRC — Role Engineering and RBAC Standards](https://csrc.nist.gov/projects/role-based-access-control/role-engineering-and-rbac-standards) + [NIST CSRC — RBAC FAQ](https://csrc.nist.gov/projects/role-based-access-control/faqs). Confirma que **Hierarchical RBAC (RBAC1, modelo Sandhu 1996, adotado como ANSI/INCITS 359-2004)** é o componente formal do padrão que define hierarquia de papéis como uma relação de ordem parcial entre papéis, onde um papel sênior herda o conjunto de permissões autorizadas de um papel júnior. Isto **valida a forma estrutural já usada por este código** (`READ_ONLY_ROLES ⊇ WRITE_ROLES ⊇ ADMIN_ROLES`, nested sets = hierarquia por inclusão) como Hierarchical RBAC padrão-conformante — mas a norma não prescreve QUAIS ações específicas cada nível deve ter; isso permanece decisão de produto informada, não ditada, pela pesquisa (mesma distinção que `research-protocol.md` já registra para D-086/RFC 6749).

**Ressalva OWASP incorporada (achado 5 da crítica)**: o Authorization Cheat Sheet nota que RBAC puro "faz um trabalho pobre" em decisões de controle horizontal/multi-tenant — o código real já resolve isso fora do RBAC (tenant-mismatch check em `authorization.ts:151`, gate de lifecycle da Organization em `resolve-request-context.ts`, precedem qualquer checagem de role). A régua v2 (abaixo) exige explicitamente que a introdução de `ADMIN` não regrida nenhuma dessas checagens.

**Correção das duas afirmações overclaimed (achados 2/3 da crítica)**: retiro a frase "3 de 4 convergem para ADMIN=OWNER nas actions atuais" — a leitura correta, mais estreita, é: **as 4 fontes de produto convergem em que a linha real Owner-vs-Admin (quando existe) fica nas ações de mais-alta-irreversibilidade/reputação-de-workspace (billing, deleção de organização inteira, transferência de ownership, SSO/segurança de nível workspace, configurações de workspace separadas de ações de conteúdo) — nenhuma delas existe como `Action` neste projeto hoje** — não que os produtos deem paridade total a tudo mais. Retiro também a atribuição de "default-deny" ao Slack como achado da fonte; default-deny fica ancorado só em OWASP + no próprio `implementation-blueprint.md` §4.3 (já citado no código).

## Checklist v2 (Rodada 2) — reconciliado após achado real da Rodada 1 do Codex

Mudanças em relação ao v1 (`round-1-claude-proposal.md`), cada uma citando o achado que a motivou:

```text
1. (peso 35%, era "paridade total" — agora trade-off nomeado, achado 4/1 da crítica)
   Toda ação hoje `ADMIN_ROLES`-only recebe uma decisão NOMEADA e justificada
   individualmente: permanece OWNER-only só se pertencer à classe de mais-alta-
   irreversibilidade/reputação-de-workspace que a pesquisa identificou (ownership,
   billing, deleção de organização, segurança/SSO de nível workspace, configuração de
   comunicação externa do tenant) — nunca herdada por default do agrupamento anterior.
   Atende: cada uma das 6 actions hoje ADMIN_ROLES-only tem uma linha de decisão
   nomeada (paritária com ADMIN, ou permanece OWNER-only com a classe específica
   citada). Não atende: qualquer action muda de tier sem essa justificativa nomeada.

2. (peso 25%, ampliado — achado 5/6 da crítica) `ADMIN` não pode enfraquecer NENHUMA
   invariante já existente: tenant-mismatch (`authorization.ts:151`), gate de lifecycle
   da Organization (`resolve-request-context.ts`), ou o branch de bypass de ownership
   (`authorize.ts:161-173`) — o comportamento de `ADMIN` nesse branch é decidido
   explicitamente (não implícito) e coberto por teste dedicado, mesmo padrão do teste
   já existente para `OWNER` (`authorization.test.ts:60`). Atende: teste dedicado prova
   o comportamento escolhido para `ADMIN` no branch de ownership + nenhuma das outras
   invariantes muda de resultado para nenhum papel. Não atende: o branch fica implícito
   ou sem teste, ou qualquer invariante de tenant/lifecycle regride.

3. (peso 20%, era 25% — achado 7 da crítica, contagem corrigida) Proporcionalidade de
   escopo — nenhuma `Action` nova de gerência de `Membership` (convite/remoção/mudança
   de role) é adicionada (Wave B2B-8, §113 do roadmap); `Action` permanece com as 29
   actions reais confirmadas por leitura direta (`authorization.ts:7-54`), não 26.

4. (peso 20%, era 15% — achado 6/7 da crítica) Migração sem regressão e auditável —
   suíte cobre cada action reclassificada (paritária E exceção nomeada) + o branch de
   ownership decidido + fail-closed de um valor de role desconhecido; G-V3 aplicado
   desde a escrita de cada teste novo (E-013).
```

**Nota da régua auto-atribuída (v2, antes de ver a resposta do Codex a esta rodada)**: julgo esta régua v2 como convergindo para ≥9,0 do meu lado — incorpora os 7 achados da crítica ponto a ponto (não uma rejeição genérica), sem introduzir nenhum critério novo não motivado por um achado real. Registro isso aqui como minha nota da régua desta rodada (protocolo de nota cega já quebrado para a régua em si, já que a crítica do Codex já existe — mas a nota do DESIGN abaixo continua registrada antes de ver a réplica do Codex a esta rodada).

## Design revisado (aplicando o checklist v2 às 6 actions reais)

### Decisão nomeada, action por action (critério 1)

| Action (hoje `ADMIN_ROLES`) | Decisão | Justificativa nomeada |
|---|---|---|
| `item:delete` | **Paritária — `ADMIN` entra em `ADMIN_ROLES`** | Deleção de recurso de negócio individual, não configuração de workspace nem ação de mais-alta-irreversibilidade (não é deleção da organização inteira). Precedente: Slack Admin deleta canais, Linear Admin tem acesso completo a conteúdo do workspace. |
| `document:delete` | **Paritária** | Mesma classe de `item:delete` — deleção de recurso, não de organização. |
| `subject:delete` | **Paritária** | Mesma classe. |
| `requirement:delete` | **Paritária** | Mesma classe. |
| `notification:configure` | **Reclassificada para `WRITE_ROLES` (não é sobre ADMIN vs OWNER — é uma correção de bug real, achada por leitura direta nesta rodada, ver §"Achado real" abaixo)** | `getOrCreatePreferences()`/preferências chaveadas por `ctx.principal.userId` (`notification-preferences-service.ts:56`) — é configuração **pessoal**, não de tenant. O comentário de `authorization.ts:49-52` (D-060/GTR-01) já argumenta essa mesma lógica de "self-service WRITE... não ADMIN" para `profile:update` citando `notification:configure` como precedente análogo — mas a tabela real (`authorization.ts:91`) contradiz o próprio comentário, deixando-a `ADMIN_ROLES` desde o commit original (M0-M3). Sob MVP (`tenantId=userId`) isso era um no-op inofensivo (só o OWNER podia chamar de qualquer forma, comentário explícito em `notification-preferences-service.ts:6-7`); com `Membership` real, um `MEMBER`/`VIEWER` legítimo ficaria bloqueado de configurar a própria preferência de e-mail — um bug real que esta wave expõe e corrige, não uma escolha ADMIN-vs-OWNER. |
| `tenant:configure-document-request-delivery` | **Permanece OWNER-only — NOVO tier `OWNER_ROLES = {OWNER}`, distinto de `ADMIN_ROLES`** | Única action da lista que é genuinamente configuração de tenant inteiro com impacto de reputação externa (o comentário original de `authorization.ts:39-42` já a nomeia assim: "decisão de comunicação externa/reputação de todo o tenant"). Esta é exatamente a classe que a pesquisa identifica como o real diferencial Owner-vs-Admin (workspace settings/external-facing config) — Notion exclui isso do "Membership Admin" lateral, Linear/Slack mantêm parte da configuração de workspace mais restrita que gerência de conteúdo. |

### Estrutura de tiers revisada

```ts
export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

const READ_ONLY_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
const WRITE_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER"]);
const ADMIN_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN"]);
const OWNER_ROLES: ReadonlySet<Role> = new Set(["OWNER"]);
```

`ACTION_ROLES` muda em exatamente 2 linhas (além da reclassificação estrutural das 3 constantes já existentes): `notification:configure` passa de `ADMIN_ROLES` para `WRITE_ROLES`; `tenant:configure-document-request-delivery` passa de `ADMIN_ROLES` para o novo `OWNER_ROLES`. As outras 4 actions (`item:delete`/`document:delete`/`subject:delete`/`requirement:delete`) continuam apontando para `ADMIN_ROLES`, que agora inclui `ADMIN` — paridade alcançada sem tocar essas 4 linhas da tabela.

### Branch de ownership-bypass (`authorize()` linhas 161-173) — decisão explícita (critério 2)

`ADMIN` **bypassa** mismatch de `ownerUserId`/`assigneeUserId`, mesmo comportamento de `OWNER` hoje — mesma justificativa "tenant-wide admin" que o comentário original já usa para `OWNER`, consistente com a paridade de conteúdo/recurso que a pesquisa suporta para o nível Admin (Linear: Admin tem acesso completo a issues/projects não-privados; Slack: Admin remove pessoas de canais públicos, gerencia conteúdo além do próprio). `MEMBER`/`VIEWER` continuam exigindo match de ownership, sem mudança.

```ts
if (!roles.includes("OWNER") && !roles.includes("ADMIN") && !isOwnerOrAssignee) {
  throw new AuthorizationDeniedError("RESOURCE_OWNERSHIP_MISMATCH", action);
}
```

Novo teste dedicado espelhando `authorization.test.ts:60` ("ADMIN bypasses per-resource ownership mismatch, same as OWNER").

### `resolveRoles()` (`resolve-request-context.ts:186-191`)

Sem mudança em relação à Rodada 1 — aceita os 4 valores reais de `Membership["role"]`, fail-closed preservado para qualquer valor fora desse domínio.

## Achado real registrado nesta rodada (não estava na Rodada 1, encontrado por leitura direta antes de propor)

`notification:configure` está `ADMIN_ROLES`-gated na tabela desde o commit original (`154d6e0`, M0-M3) — mas o comentário de `authorization.ts:49-52` (D-060, sessão 2026-08-28) já afirmava, por analogia, que `notification:configure` é "tenant-scoped WRITE like every other self-service setting... not ADMIN". A tabela nunca foi corrigida para bater com essa afirmação — inofensivo sob MVP `tenantId=userId` (comentário explícito em `notification-preferences-service.ts:6-7` já registra isso como "no-op restriction"), mas se torna um bug real de UX/produto no momento em que `MEMBER`/`VIEWER` passam a ser papéis alcançáveis por pessoas de verdade. Corrigido nesta wave por ser exatamente "migrar autorização existente" (§112 do roadmap) — não uma decisão nova de RBAC, uma correção de drift documentado vs. código real, mesma classe dos achados de B2B-5 (D-096).

## Decomposição (sem mudança material da Rodada 1, ver `round-1-claude-proposal.md` §3) — risco reavaliado

| Subitem | Camada | Risco |
|---|---|---|
| B2B-7.1 | Domain — `Role` ganha `ADMIN`; 4 constantes (`READ_ONLY_ROLES`/`WRITE_ROLES`/`ADMIN_ROLES`/novo `OWNER_ROLES`); `notification:configure`→`WRITE_ROLES`; `tenant:configure-document-request-delivery`→`OWNER_ROLES`; branch de ownership atualizado | 5 (muda o contrato da matriz de autorização real em produção + corrige um bug de gate existente) |
| B2B-7.2 | Application — `resolveRoles()` aceita os 4 valores | 4 |
| B2B-7.3 | Testes — paridade ADMIN=OWNER por tier, exceção `OWNER_ROLES` testada negativamente para `ADMIN`, `notification:configure` testado para `MEMBER`, branch de ownership para `ADMIN`, fail-closed para valor desconhecido, suíte completa, G-V3 desde a escrita | 2-3 |

## Pergunta aberta para a Rodada 2 do Codex

1. A régua v2 fecha os 7 achados da Rodada 1 de forma que você considera ≥9,0? Se não, quais critérios específicos ainda faltam reconciliar antes da nota do design voltar a contar?
2. A reclassificação de `notification:configure` (achado novo desta rodada, não estava na Rodada 1) é uma correção correta, ou existe uma razão para mantê-la `ADMIN_ROLES` que a leitura acima não considerou?
3. O novo tier `OWNER_ROLES` (hoje só com 1 action) é proporcional, ou é over-engineering para uma única action — seria mais simples manter `tenant:configure-document-request-delivery` apontando para uma constante renomeada em vez de uma 4ª estrutura?
