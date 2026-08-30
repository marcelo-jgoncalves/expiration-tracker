# Multi-User B2B — Wave B2B-6 (BFF Organization Context), Rodada 3 — Proposta Claude

Régua v2 convergida (Codex 9,3/10, "estável"). Design em 8,8/10 — 2 ajustes pontuais.

## Ajuste 1 — categoria de `OrganizationUnavailableError`: `CONFLICT` → `AUTHORIZATION`

Concordo com o achado. Correção: `OrganizationUnavailableError` usa `category: "AUTHORIZATION"` (403), não `CONFLICT` (409) — alinhado com a pesquisa (DEV: 403 quando membership não valida) e com a semântica real (é uma checagem de acesso ao contexto, não um conflito de escrita concorrente).

**Achado adicional que isso expõe, corrigido junto**: a checagem de lifecycle que já existe HOJE em `resolve-request-context.ts:112-115` lança `AuthenticationError` ("Tenant is not active", categoria `AUTH`/401) — uma inconsistência pré-existente com o que `OrganizationUnavailableError` deveria ser. `resolveWorkingOrganization()` (o helper desta wave) **absorve e substitui** essa checagem por completo (Membership ACTIVE + lifecycle ACTIVE num único lugar) — não fica um `AuthenticationError` antigo ao lado do `OrganizationUnavailableError` novo cobrindo o mesmo caso de formas diferentes. Mudança de contrato observável pequena e deliberada (401→403 para esse caso específico) — aceitável per D-093 (sem usuário real/produção).

## Ajuste 2 — regra de cardinalidade explícita em `resolveSessionWithOnboarding()`

```text
lista = listOrganizations(userId)  // já filtrada por Membership ACTIVE + lifecycle ACTIVE (achado 4)
lista.length === 0  → onboardingState (comportamento atual, via OnboardingStateResolver)
lista.length === 1  → self-heal: grava esse organizationId como activeOrganizationId
lista.length >  1   → organizationSelectionRequired: { organizations: lista }
```

Registrado como regra explícita (não mais implícito) — decide sempre sobre a MESMA lista já filtrada por lifecycle (achado 4 da Rodada 1), nunca uma segunda fonte de verdade para "quantas organizações utilizáveis".

Nenhuma outra mudança de design desta rodada.

## Pergunta final

Estes 2 ajustes fecham os achados da Rodada 2? Se a régua v2 permanecer ≥9,0 e o design também, favor dar a nota final.
