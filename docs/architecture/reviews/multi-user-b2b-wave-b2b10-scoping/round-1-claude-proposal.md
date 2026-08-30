# Wave B2B-10 (Tenant-aware Frontend) — Round 1 Proposal

Escopo per `roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §115: switcher, members,
settings, invitation, permission UX, tenant-scoped query keys, cache isolation, switch race
handling. Todos os endpoints BFF necessários já existem e estão `APPROVED`/`IMPLEMENTED`
(B2B-6/D-102: `GET /bff/session`, `GET /bff/organizations`, `POST /bff/organization/select`;
B2B-8/D-100: `CreateInvitationService`/`RevokeInvitationService`/`AcceptInvitationService`,
`ListMembersService`/`ListInvitationsService`, `ChangeMembershipRoleService`/
`RemoveMembershipService`/`LeaveOrganizationService`) — B2B-10 é consumo real desses contratos no
frontend, não desenho de contrato novo.

## Classificação de risco por subitem (não uma nota única para a wave inteira)

Diferente de B2B-6/7/8/9 (decisões de modelo de dados/segurança de backend, protocolo completo
obrigatório de ponta a ponta), a maior parte de B2B-10 é **implementação direta de contrato já
`APPROVED`** (nível 3-4, `change-risk-scale.md` — não reabre o protocolo `AGENTS.md` §4). Só UMA
peça é genuinamente Type 1/nível 5: a arquitetura de isolamento de cache (query keys +
comportamento na troca de organização) — um design de correção incorreto aqui é uma classe real de
vazamento de dado entre tenants na UI (usuário vê, por um instante ou permanentemente até reload,
dado da Organization anterior renderizado como se fosse da atual), mesma categoria de acerto que
motivou B2B-6 no backend (Tenant Context Injection, OWASP).

| Subitem | Risco | Por quê |
|---|---|---|
| B2B-10.1 — Fix de regressão real: `AuthContext`/`SessionInfo` | 3 | Corrige um bug real (achado abaixo), não uma decisão nova — alinha com um contrato já `APPROVED` (B2B-6/D-101-102) |
| B2B-10.2 — **Arquitetura de query key/cache isolation/switch race** | **5** | Decisão de design com consequência de segurança/isolamento de dado; protocolo completo aplicável |
| B2B-10.3 — Switcher UI | 3 | Consome `GET /bff/organizations`/`POST /bff/organization/select` (B2B-6) sem contrato novo |
| B2B-10.4 — Members UI (lista/convite/troca de role/remoção) | 3-4 | Consome os 7 endpoints já `APPROVED` de B2B-8; "permission UX" (mostrar/esconder ação por role) é a única decisão nova pequena — regra: nunca a única camada de proteção, autorização real já é sempre server-side |
| B2B-10.5 — Settings (nome/timezone da Organization) | 3 | Rota placeholder já existe (`App.tsx:60`); sem endpoint de update ainda — ver "achado" abaixo |
| B2B-10.6 — Testes (unit/component + Playwright E2E) | 2-3 | Verificação, G-V3 aplicado |

## Achado real #1 — regressão já em produção, verificada por leitura de código

`frontend/src/auth/AuthContext.tsx:63` — `probe()` só transiciona para `AUTHENTICATED` se
`info.authenticated && info.tenantId && info.userId`. O `GET /bff/session` REAL (B2B-6/D-102,
`bff-handlers.ts:96-99`) retorna `{ authenticated, activeOrganizationId, onboardingState,
organizationSelectionRequired }` — **nunca `tenantId` nem `userId`** (esses campos foram removidos
da sessão em B2B-5/D-095-096, quando `Session.tenantId` virou `activeOrganizationId?`). Confirmado
por grep exaustivo: `tenantId`/`userId` do `AuthState` nunca são lidos em nenhum outro lugar do
frontend (só escritos e checados dentro do próprio `AuthContext.tsx`) — código morto que também é
a causa raiz do bug. **Consequência real**: hoje, todo usuário autenticado é tratado como
`SESSION_MISSING` pelo frontend, porque a condição nunca é verdadeira. Isso não é hipotético nem
introduzido por esta wave — é o estado real de `develop`/`main` desde que B2B-5 mudou o contrato de
sessão, nunca reconciliado com o frontend (que não foi tocado por nenhuma wave B2B até agora).

## Achado real #2 — settings precisa de um endpoint novo (fora do que B2B-8 já cobre)

Nenhum serviço de B2B-8 atualiza `Organization.displayName`/`timezone` — só cria (`CreateOrganizationService`)
e gerencia Membership/Invitation. "Settings" no escopo §115 implica editar esses 2 campos. Isto é
um writer NOVO (nível 3-4: mesmo padrão transacional de update já usado em `change-membership-role.ts`,
sem access pattern novo, sem mudança de chave) — não Type 1, mas precisa ser construído nesta wave
(`UpdateOrganizationSettingsService` + rota HTTP), registrado aqui para não aparecer como surpresa
na implementação.

## Declaração E-014 — Round 1

**SIM** para a peça de risco 5 (B2B-10.2): "query keys escopadas por tenant + isolamento de cache em
SPA multi-tenant" é um padrão que a própria biblioteca usada neste projeto (TanStack Query v5, já em
uso) documenta oficialmente. Verificado por fetch direto da doc oficial
(`tanstack.com/query/v5/docs/framework/react/guides/query-keys`, 2026-08-30): "Adding dependent
variables to your query key will ensure that queries are cached independently, and that any time a
variable changes, queries will be refetched automatically" — e o exemplo dado é literalmente
`['project', projectId, 'todos']`, o mesmo padrão de `organizationId` proposto aqui. Um segundo ponto
de pesquisa (`github.com/TanStack/query/discussions`, comunidade) reforça o mesmo padrão para
multi-tenant e nomeia o risco real do caminho alternativo: "manual namespacing at scale can be error
prone and significantly increases the needed testing surface area" — argumento a favor de uma
factory de chave sistemática (item 3 abaixo) em vez de prefixar cada `useQuery` manualmente à mão,
mesmo raciocínio que motivou tornar `organizationIdHint` obrigatório em B2B-6 (forçar cobertura
completa via mecanismo, não disciplina).

**NÃO aplicável** ao restante da wave (switcher/members/settings/invitation UI) — não são "um padrão
que sistemas fora deste projeto resolveram" no sentido do gatilho de E-014, são consumo direto de
contratos já decididos dentro deste projeto.

## Proposta concreta — B2B-10.2 (a única peça sob debate real)

### Chave de query: `organizationId` como segmento líder, via factory central

```ts
// frontend/src/api/queryKeys.ts (novo)
export const queryKeys = {
  items: {
    dashboard: (orgId: string, status: string) => ["org", orgId, "items", "dashboard", status] as const,
    detail: (orgId: string, itemId: string) => ["org", orgId, "items", "detail", itemId] as const,
  },
  // ...mesmo padrão para subjects/organizations/members/invitations
} as const;
```

Toda chave de recurso tenant-scoped ganha `["org", organizationId, ...]` como prefixo — nunca
escrita à mão em cada hook (fecha o risco "manual namespacing" citado na pesquisa). Hooks existentes
(`useItemsDashboard`/`useItem`/`useSubject`/etc., hoje `["items", "dashboard", status]` sem escopo
nenhum) são atualizados para ler `organizationId` do novo hook de organização ativa (abaixo) e usar a
factory.

### Sem invalidação manual na troca — o próprio React Query resolve

Per a doc oficial citada: mudar o segmento `organizationId` já torna toda query da organização
anterior "inativa" (não mais observada por nenhum componente montado), sem apagar cache
(comportamento padrão de `gcTime`) nem competir com a nova organização por uma chave compartilhada —
elimina a classe inteira de corrida "resposta tardia da organização antiga sobrescreve a nova" POR
CONSTRUÇÃO, não por um guard manual. Nenhum `queryClient.invalidateQueries()`/`.clear()` explícito
necessário no fluxo de troca.

### Fonte única de `activeOrganizationId`: uma query, não estado solto

Novo hook `useActiveOrganization()` — query React Query sobre `GET /bff/session` (não estado
`useState` paralelo, que poderia dessincronizar). `POST /bff/organization/select` (mutação) invalida
essa query em `onSuccess` (padrão React Query de mutação-invalida-query, não escrita otimista —
`resolveWorkingOrganization()` no servidor é a fonte de verdade real, replicar otimisticamente no
cliente arriscaria mostrar uma seleção que o servidor ainda pode rejeitar, ex. Membership revogada
entre o clique e a resposta).

### `AuthContext` — extensão mínima, sem misturar autenticação com seleção de organização

`AuthState.AUTHENTICATED` perde `tenantId`/`userId` (código morto, achado #1) e NÃO ganha os campos
de organização diretamente — esses vivem em `useActiveOrganization()`, uma camada separada
consumida só por componentes dentro de `AUTHENTICATED` (mesma separação de preocupação que o BFF já
tem: autenticação ≠ seleção de tenant, D-053 vs. D-101).

## Fora de escopo desta wave

Endpoint de update de Organization settings É construído aqui (achado #2), mas customização visual
de tema/marca por Organization não é (não pedido por §115). Nenhuma mudança em RBAC/Invitation
backend (já fechado B2B-7/B2B-8). Testes de regressão visual/acessibilidade das novas telas seguem
o padrão já estabelecido (`visual-language-and-design-system.md`), não redecidido aqui.

## Perguntas abertas para a Rodada 1 do Codex

1. A separação `AuthContext` (autenticação) vs. `useActiveOrganization()` (seleção de tenant, via
   query separada) é a divisão certa, ou deveria ser uma única fonte de estado combinada?
2. Existe algum outro lugar no frontend (além dos hooks já listados) que já lê/grava cache
   tenant-scoped e que eu não tenha encontrado?
3. A ausência de escrita otimista em `selectOrganization()` (esperar a invalidação/refetch real em
   vez de atualizar o estado local imediatamente) é a escolha certa, ou o custo de latência percebida
   justifica otimismo com rollback?
