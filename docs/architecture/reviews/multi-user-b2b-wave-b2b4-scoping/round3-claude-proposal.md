# Multi-User B2B — Wave B2B-4 escopo, Rodada 3 (proposta Claude, fechamento formal)

Rodada 2: Claude 9,1/Codex 9,1, ambos ≥9,0 — convergência técnica atingida. Per `AGENTS.md` §4 (mínimo 3 rodadas), esta é a tréplica de fechamento formal, incorporando a única ressalva não-bloqueante que o Codex registrou.

## Refinamento incorporado (Codex, Rodada 2, não-bloqueante)

`HAS_MEMBERSHIPS` precisa distinguir por `status` da `Membership`, não só existência da linha (que nunca é hard-deletada, physical model §5):

```text
role/status considerados "organização utilizável" para efeito de onboarding:
  ACTIVE    → conta como HAS_MEMBERSHIPS (organização real, usável)
  SUSPENDED → NÃO conta como onboarding pendente, mas também não é "usável" — é um
              estado administrativo distinto (usuário tem vínculo, mas bloqueado);
              o resolver retorna um quarto estado explícito em vez de forçar isso
              dentro de HAS_MEMBERSHIPS ou LEGACY_TENANT_ONLY
  REMOVED   → NÃO conta como HAS_MEMBERSHIPS (a linha histórica não deveria bloquear
              onboarding para sempre só por existir) — equivalente a "sem Membership
              usável" para este classificador
```

Estado final do `OnboardingStateResolver`, 4 valores (não mais 3):

```text
HAS_USABLE_MEMBERSHIP   — ao menos uma Membership ACTIVE (via GSI4, deduplicada por
                           organizationId, hidratada contra a base — GSI4 nunca é
                           fonte de autorização, physical model §6)
SUSPENDED_ONLY          — Memberships existem, mas nenhuma ACTIVE (todas SUSPENDED/
                           REMOVED) — estado administrativo, não onboarding
LEGACY_TENANT_ONLY      — TenantLifecycleRecord legado existe (tenantId=userId),
                           zero Membership ACTIVE — estado real de todo usuário hoje
NO_TENANT_NO_MEMBERSHIP — nem tenant legado nem Membership utilizável — só alcançável
                           de verdade depois que Wave B2B-5 parar de criar tenant
                           legado automaticamente
```

Nomenclatura ajustada de `HAS_MEMBERSHIPS`/`NO_TENANT_NO_MEMBERSHIPS` (Rodada 2) para `HAS_USABLE_MEMBERSHIP`/`NO_TENANT_NO_MEMBERSHIP` — deixa explícito que é sobre utilizabilidade, não só existência da linha.

## Escopo final de B2B-4 (inalterado desde a Rodada 2, só o classificador refinado)

- **Deliverable único**: `OnboardingStateResolver` (`src/modules/organization/application/onboarding-state.ts`) — serviço puro, 4 estados acima, consumindo `OrganizationStore.queryGsi4()` (já existe) + `tenantLifecycleKey()`/`TenantLifecycleRecord` (já existe, mesmo padrão cross-module de `bootstrap-identity.ts` lendo de `shared/tenant-lifecycle/`).
- **Não tocar** `bootstrap-identity.ts`/`resolve-request-context.ts`/`bff-auth-service.ts` — zero wiring em login real.
- **Não expor via HTTP** — sem rota/handler/Terraform nesta wave (achado convergente da Rodada 1).
- `CreateOrganizationService` permanece isolado, sem consumidor, até B2B-5/B2B-6.
- Testes cobrem os 4 estados, incluindo `NO_TENANT_NO_MEMBERSHIP` via fixture sintético (legítimo per convergência da Rodada 2 — simula o estado real que B2B-5 vai produzir, não teatro de teste), com G-V3 aplicado desde a escrita (E-013).
- "Remover tenant auto-provision silencioso" e gate real de login permanecem formalmente em Wave B2B-5.

## Fechamento

Sem achado novo pendente. Pronto para apresentar ao Marcelo para confirmação de escopo antes de codificar.
