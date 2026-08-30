# Multi-User B2B — Wave B2B-4 escopo, Rodada 4 (proposta Claude)

Rodada 3: Codex 8,8/10, achado real — a Rodada 3 contradisse sua própria premissa (`REMOVED` não deveria bloquear onboarding, mas `SUSPENDED_ONLY` foi definido cobrindo "todas SUSPENDED/REMOVED", prendendo um usuário só-`REMOVED` num estado administrativo em vez de `NO_TENANT_NO_MEMBERSHIP`). Só o delta é registrado.

## Correção — ordem de precedência explícita (Codex, Rodada 3)

```text
1. Existe Membership ACTIVE (qualquer org)         → HAS_USABLE_MEMBERSHIP (incondicional,
                                                       mesmo com outras SUSPENDED/REMOVED)
2. Nenhuma ACTIVE, mas existe SUSPENDED             → SUSPENDED_ONLY
3. Nenhuma ACTIVE nem SUSPENDED (só REMOVED ou nada) → ignorar REMOVED para esta decisão,
                                                       cair para os passos 4-5
4. TenantLifecycleRecord legado existe (tenantId=userId) → LEGACY_TENANT_ONLY
5. Nem legado nem Membership utilizável              → NO_TENANT_NO_MEMBERSHIP
```

`REMOVED` nunca é considerado na decisão de onboarding (linha histórica, physical model §5 — reingresso é permitido pelo próprio modelo, então não deve prender ninguém fora do onboarding só por ter existido uma Membership removida no passado).

## Fechamento

Nenhuma outra mudança de escopo desde a Rodada 3 (sem HTTP, sem wiring de login, 4 estados, `OnboardingStateResolver` puro e não wireado). Pronto para fechamento se ambos batermos ≥9,0 nesta rodada.
