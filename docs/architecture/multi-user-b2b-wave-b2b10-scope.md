# Multi-User B2B — Wave B2B-10 (Tenant-aware Frontend), escopo final

**Status: `APPROVED`** via protocolo Claude↔Codex (`AGENTS.md` §4, nível 5 de `change-risk-scale.md`
para a peça de arquitetura de cache — o restante da wave é implementação direta de contratos já
`APPROVED`, nível 3-4), 3 rodadas, nota cega cada rodada: Rodada 1 Claude 8,4/Codex 8,1 (2 achados
bloqueantes reais); Rodada 2 Claude 9,0/Codex 8,7 (2 achados bloqueantes adicionais); Rodada 3 Claude
9,2/Codex 9,2 (fechamento, ambos ≥9,0, sem arredondar). Registrado como
`docs/architecture/decisions-log.md` D-105. Evidência completa das 3 rodadas:
`docs/architecture/reviews/multi-user-b2b-wave-b2b10-scoping/`.

Todos os endpoints BFF necessários já existiam e estavam `APPROVED`/`IMPLEMENTED` antes desta wave
(B2B-6/D-102: `GET /bff/session`, `GET /bff/organizations`, `POST /bff/organization/select`;
B2B-8/D-100: `Invitation`/membership management) — B2B-10 é consumo real desses contratos no
frontend, não desenho de contrato novo, exceto pelo endpoint de settings (achado #2 abaixo).

## Achado real #1 — regressão já em produção (verificada por leitura de código)

`frontend/src/auth/AuthContext.tsx`'s `probe()` só transicionava para `AUTHENTICATED` se
`info.tenantId && info.userId` — campos que `GET /bff/session` nunca retorna desde que B2B-5/D-095
removeu `Session.tenantId` em favor de `activeOrganizationId?`. **Consequência real**: todo usuário
autenticado era tratado como `SESSION_MISSING` pelo frontend — bug real em `develop`/`main`, não
hipotético, nunca reconciliado porque nenhuma wave B2B anterior tocou o frontend.

## Achado real #2 — settings precisa de um writer novo

Nenhum serviço de B2B-8 atualiza `Organization.displayName`/`timezone` — só cria/gerencia
Membership/Invitation. Construído nesta wave: `UpdateOrganizationSettingsService`
(`organization:update-settings`, tier `OWNER_ROLES`, mesmo padrão OCC de
`change-membership-role.ts`) + rota `PATCH /organizations/settings` (mesmo Lambda
`memberships_handler`, sem infra nova).

## Achado bloqueante da Rodada 1 — corrida real de cache pós-`selectOrganization()`

`organizationId` não é uma variável que o `queryFn` real usa (o browser nunca a envia — o BFF injeta
`X-Organization-Id` a partir da sessão server-side). A garantia "TanStack Query refaz fetch
automaticamente quando a variável da chave muda" não se aplica sozinha aqui: existe uma janela real
entre `POST /select` (sessão já trocada no servidor) e o cliente saber disso via refetch de sessão,
onde uma query ainda montada sob a chave da organização antiga pode receber dado da organização NOVA
e gravá-lo sob a chave errada.

**Correção**: `ActiveOrganizationProvider` (Context único, não hook reimplementado por chamador —
2º achado bloqueante da Rodada 2, ver abaixo) expõe um flag `switching`; toda `useQuery` org-scoped
ganha `enabled: Boolean(organizationId) && !switching`; `onMutate` da troca cancela
(`queryClient.cancelQueries`) todo tráfego em voo escopado à organização ATUAL; `onSettled` só
libera `switching` depois que a própria sessão confirma a nova `activeOrganizationId`. Fecha as 2
metades da corrida: nada novo dispara durante a janela, nada já em voo sobrevive para gravar sob a
chave errada — mecanismo verificado com `AbortSignal` real propagado ponta-a-ponta (achado
bloqueante adicional da Rodada 3: os wrappers de leitura não aceitavam nem repassavam `signal`
nenhum, então `cancelQueries()` sozinho não abortava o `fetch()` real).

## Achado bloqueante da Rodada 2 — `ActiveOrganizationProvider` precisa ser Context único

Um hook `useActiveOrganization()` chamado independentemente por cada tela criaria N cópias
desincronizadas de `switching`. Corrigido: toda a lógica (query de sessão, mutação de seleção,
cancelamento) mora dentro de um único `ActiveOrganizationProvider`, montado uma vez em `App.tsx`
(dentro de `AuthProvider`, acima de `AppShell`); `useActiveOrganization()` só consome via
`useContext`.

## Escopo final implementado

- **Fix de regressão**: `AuthContext`/`SessionInfo` corrigidos para o contrato real de sessão.
- **Arquitetura de cache**: `api/queryKeys.ts` (factory central, `organizationId` como segmento
  líder), `auth/ActiveOrganizationContext.tsx` (Provider único + gate `switching` + cancelamento),
  `AbortSignal` propagado ponta-a-ponta nos 7 call sites de leitura reais (inventário exaustivo:
  `useItem`/`useItemsDashboard`/`useSubject`/`useSubjectsDashboard`/`useRequirementAssignments`/
  `useDocumentSubmissions`/`Overview.tsx` inline) + 5 `invalidateQueries` reescritos.
- **Switcher**: `OrganizationSwitcher.tsx`, `<select>` nativo listando `GET /bff/organizations`,
  oculto quando há só 0/1 organização.
- **Members**: `routes/Members.tsx` — lista de membros ativos + convites pendentes (ADMIN/OWNER),
  formulário de convite, troca de role, remoção — "permission UX" espelha o tier real do backend
  (nunca é a única defesa; toda mutação é re-checada por `authorize()` no servidor).
- **Settings**: `routes/Settings.tsx` — nome da organização, OWNER-only na UI (espelha
  `OWNER_ROLES` do backend).

## Decomposição (per `definition-of-done.md`)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-10.1 | Fix de regressão `AuthContext`/`SessionInfo` | 3 |
| B2B-10.2 | Arquitetura de cache isolation (query keys + `ActiveOrganizationContext` + `AbortSignal`) | 5 |
| B2B-10.3 | Backend — `UpdateOrganizationSettingsService` + rota + Action nova na matriz | 4 |
| B2B-10.4 | UI — switcher/members/settings | 3-4 |
| B2B-10.5 | Testes — G-V3 desde a escrita em ambos os lados (backend: `update-organization-settings.test.ts`; frontend: `ActiveOrganizationContext.test.tsx`, `Members.test.tsx`, `Settings.test.tsx`, `OrganizationSwitcher.test.tsx`) | 2-3 |

## Fora de escopo

Playwright E2E dedicado a multi-organização (a suíte de componente/unit já prova o mecanismo real;
E2E fica para B2B-13, que já usa as 25 perguntas de segurança como checklist). Tema/marca customizada
por Organization. Qualquer mudança em RBAC/Invitation/Membership backend (já fechado B2B-7/B2B-8).
