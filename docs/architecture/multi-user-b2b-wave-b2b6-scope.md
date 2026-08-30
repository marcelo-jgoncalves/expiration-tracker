# Multi-User B2B — Wave B2B-6 (BFF Organization Context), escopo final

**Status: `APPROVED`** via protocolo Claude↔Codex (`AGENTS.md` §4, nível 5 de `change-risk-scale.md`), 3 rodadas, nota cega cada rodada: Rodada 1 Claude 7,8/Codex — régua 8,2/design 8,4 (régua contestada); Rodada 2 Claude 8,9/Codex — régua 9,3/design 8,8; Rodada 3 Claude 9,1/Codex — régua 9,3 (mantida)/design 9,2 (fechamento, ambos ≥9,0, sem arredondar). Registrado como `docs/architecture/decisions-log.md` D-101. Evidência completa das 3 rodadas: `docs/architecture/reviews/multi-user-b2b-wave-b2b6-scoping/`.

**Terceira aplicação real de `docs/engineering/research-protocol.md` (E-014)**, declaração `SIM`: "sessão/contexto multi-tenant" é exemplo explicitamente nomeado no próprio documento. Pesquisado 2026-08-30: padrão header+revalidação server-side (2 fontes técnicas convergem em "nunca confiar no header sozinho", divergem em mecanismo — claims de JWT vs. banco; este projeto já usa banco, mais forte); Slack/Notion confirmam troca de workspace sem reautenticação; OWASP Multi Tenant Security Cheat Sheet nomeia "Tenant Context Injection" e confirma a postura já proposta (derivar contexto da sessão autenticada, nunca de header client-side, revalidar sempre na camada de dados).

A Rodada 1 do Codex contestou o checklist (achados reais: faltava OWASP como fonte de segurança/identidade; faltava critério de boundary BFF/browser contra header forjado; `POST /bff/organization/select` sem CSRF explícito; `GET /bff/organizations` sem filtro de lifecycle; estado ambíguo sem contrato tipado). Reconciliado na Rodada 2. Rodada 3 corrigiu 2 ajustes finais (categoria de erro, regra de cardinalidade explícita).

## Achado real que motivou esta wave agora

`RequestContextResolver.resolveActiveMembership()` lança `InternalError` (500) para qualquer usuário com >1 `Membership` `ACTIVE` — inatingível até B2B-8, **agora explorável de verdade** por qualquer usuário que aceite um 2º convite. B2B-6 fecha um bug real, não só uma lacuna arquitetural.

## Escopo final

### Transporte: `X-Organization-Id`, injetado só pelo BFF

`ProxyService.forward()` NUNCA lê `req.headers["x-organization-id"]` do browser (não entra em `FORWARDED_REQUEST_HEADERS`) — grava o header numa linha separada, fonte única `session.activeOrganizationId`. Fecha "Tenant Context Injection" (OWASP) por construção, não por checagem.

### `resolveWorkingOrganization()` — helper compartilhado, resultado semântico

```ts
export type WorkingOrganizationResult = { status: "OK"; membership: Membership } | { status: "UNAVAILABLE" };
```

Consolida (e substitui) as 2 checagens que hoje vivem separadas em `resolve-request-context.ts` (Membership ACTIVE + `TenantLifecycleRecord` ACTIVE) — nunca lança diretamente; cada chamador (recurso vs. BFF) decide seu próprio formato de erro.

### `RequestContextResolver`

`organizationIdHint: string | undefined` **obrigatório** (não opcional) no `ResolveRequestContextInput` — força o compilador a barrar qualquer um dos 56 call sites reais (13 arquivos, contagem via `grep -rl` exaustivo, corrigida na Rodada 2 após faltar `test-route-handler.ts` na primeira contagem) que esqueça de repassar o header. Hint presente → `resolveWorkingOrganization()` direto; ausente + exatamente 1 Membership ACTIVE (via GSI4) → usa (comportamento inalterado para organização única); ausente + 0 → fluxo de onboarding já existente; ausente + >1 → `OrganizationSelectionRequiredError` (nunca mais `InternalError`). `UNAVAILABLE` → `OrganizationUnavailableError`.

`OrganizationUnavailableError`/`OrganizationSelectionRequiredError` (novos, `app-error.ts`): `OrganizationUnavailableError` usa `category: "AUTHORIZATION"` (403) — **substitui por completo** o `AuthenticationError` ("Tenant is not active", 401) que hoje cobre parte do mesmo caso, achado de inconsistência pré-existente corrigido nesta wave (mudança de contrato observável pequena e deliberada, aceitável per D-093).

### BFF

- `POST /bff/organization/select`: mesmo padrão de `handleCreateOrganization` — `checkCsrf()` antes de qualquer mutação, `resolveWorkingOrganization()` para validar, CAS via `sessionStore.updateConditional`.
- `GET /bff/organizations`: lista `Membership` ACTIVE **E** `TenantLifecycleRecord` ACTIVE (nunca só o primeiro — sem isso a lista ofereceria algo que `select`/o recurso rejeitariam).
- `SessionWithOnboarding` ganha `organizationSelectionRequired?: { organizations: [...] }`, mutuamente exclusivo com `activeOrganizationId`/`onboardingState`. Regra de cardinalidade explícita em `resolveSessionWithOnboarding()`, sempre sobre a MESMA lista já filtrada por lifecycle: 0 → `onboardingState`; 1 → self-heal; >1 → `organizationSelectionRequired`. **Cuidado de implementação (nota do Codex, Rodada 3)**: no ramo 0, checar se o motivo é "nenhuma Membership" (onboarding real) vs. "Membership existe mas lifecycle não-ACTIVE" (`OnboardingStateResolver` não avalia lifecycle — não retornar `HAS_USABLE_MEMBERSHIP` nesse caso).

### Multi-sessão

Nenhuma mudança de schema — verificado que a tabela de sessão não tem GSI por `userId`. Item é só teste, não código novo.

## Decomposição (per `definition-of-done.md`)

| Subitem | Camada | Risco |
|---|---|---|
| B2B-6.1 | Domain (`app-error.ts`) — `OrganizationUnavailableError` (AUTHORIZATION)/`OrganizationSelectionRequiredError`; Application — `resolveWorkingOrganization()` | 5 |
| B2B-6.2 | Application (`resolve-request-context.ts`) — `organizationIdHint` obrigatório, `resolveActiveMembership()` reescrito, substitui o `AuthenticationError` de lifecycle existente | 5 |
| B2B-6.3 | Application/HTTP (BFF) — `ProxyService.forward()` injeta header sem ler do browser; `POST /bff/organization/select` com CSRF; `GET /bff/organizations` filtrado por lifecycle; `organizationSelectionRequired` tipado com regra de cardinalidade explícita | 5 |
| B2B-6.4 | HTTP — threading obrigatório de `organizationIdHint` nos 56 call sites reais (13 arquivos) | 3 |
| B2B-6.5 | Testes — G-V3 desde a escrita: revalidação real, header de browser descartado, CSRF no select, filtro de lifecycle, contrato tipado do estado ambíguo (incl. o caso 0-mas-lifecycle-inativo), `resolver.test.ts:225` atualizado para `OrganizationUnavailableError`, CAS, multi-sessão, regressão zero para organização única | 2-3 |

## Fora de escopo

UI/IA do switcher (B2B-10); migração/cutover de `dev` (B2B-12); qualquer mudança em `Membership`/`Invitation`/RBAC (já fechado B2B-7/B2B-8).
