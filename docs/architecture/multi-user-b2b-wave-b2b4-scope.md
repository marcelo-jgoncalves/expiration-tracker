# Multi-User B2B — Wave B2B-4 (Onboarding), escopo final

**Status: `APPROVED`** via protocolo Claude↔Codex (`AGENTS.md` §4, submetido a pedido explícito do Marcelo antes de qualquer código), 4 rodadas, nota cega cada rodada: Rodada 1 Claude 7,2/Codex 8,4; Rodada 2 Claude 9,1/Codex 9,1; Rodada 3 Claude 8,7/Codex 8,8; Rodada 4 Claude 9,3/Codex 9,4 (fechamento, ambos ≥9,0). Registrado como `docs/architecture/decisions-log.md` D-092. Evidência completa das 4 rodadas: `docs/architecture/reviews/multi-user-b2b-wave-b2b4-scoping/`.

## Achado central que motivou a rodada

`roadmap-evolution/17-multi-user-b2b-revised-strategy.md` §109 define B2B-4 literalmente como "remover tenant auto-provision silencioso; new User → Create Organization ou Accept Invitation". Esse escopo literal **não pode ser wireado com segurança no fluxo de login real agora**: hoje, `TenantBootstrapService.createAll()` (`bootstrap-identity.ts`) continua criando `TenantLifecycleRecord`+`UserProfile` legado automaticamente no primeiro login (decisão consciente de B2B-2/D-087) — TODO usuário existente já tem acesso de tenant funcional, mas ZERO linhas `Membership` reais (o mecanismo existe desde B2B-3, mas `CreateOrganizationService` nunca foi chamado para ninguém ainda). Um gate ingênuo "zero Memberships → onboarding" wireado no login real hoje mostraria uma tela de onboarding incorreta para todo usuário legado funcional — verificado diretamente contra `resolve-request-context.ts`/`bff-auth-service.ts` (nenhum gate de Membership/GSI4 existe neles hoje).

`Accept Invitation` também está fora de escopo — depende de `Invitation` (token pointer, dedup pointer), formalmente Wave B2B-8 (§113), inexistente ainda.

## Convergência da rodada (acompanhando a trajetória)

- **Rodada 1**: proposta inicial (não tocar fluxo de login; expor `CreateOrganizationService` via HTTP como deliverable). Ambos os lados, independentemente, acharam a mesma fraqueza real: expor via HTTP cria superfície de deploy (handler, Lambda, rota Terraform) sem nenhum consumidor real — viola `principles.md` #1 na direção oposta ao problema original.
- **Rodada 2**: ambos convergiram independentemente na mesma alternativa — um classificador de estado de onboarding puro, não wireado a nenhum fluxo real. Nota ≥9,0 dos dois lados, mas Codex acrescentou uma ressalva não-bloqueante (semântica de status de Membership).
- **Rodada 3**: ao incorporar a ressalva, a proposta introduziu um erro real e novo (agrupou `REMOVED` com `SUSPENDED`, contradizendo sua própria premissa de que `REMOVED` não deveria bloquear onboarding). Achado genuíno do Codex, não cosmético.
- **Rodada 4 (fechamento)**: reescrita como procedimento sequencial estrito de 5 passos, fechando o achado da Rodada 3 e, por construção, também uma ambiguidade de precedência que o autograde da própria Rodada 3 tinha achado independentemente (`LEGACY_TENANT_ONLY` vs `SUSPENDED_ONLY`).

## Escopo final de B2B-4

**Deliverable único**: `OnboardingStateResolver` (`src/modules/organization/application/onboarding-state.ts`) — serviço puro, sem wiring em `bootstrap-identity.ts`/`resolve-request-context.ts`/`bff-auth-service.ts`, sem exposição HTTP.

### Procedimento de classificação (sequencial estrito, não condições paralelas)

```text
1. Existe Membership ACTIVE (qualquer org)               → HAS_USABLE_MEMBERSHIP
   (incondicional — vence mesmo com outras SUSPENDED/REMOVED presentes)
2. Nenhuma ACTIVE, mas existe SUSPENDED                   → SUSPENDED_ONLY
3. Nenhuma ACTIVE nem SUSPENDED (só REMOVED ou nada)      → ignorar REMOVED (linha
   histórica, physical model §5 — reingresso é permitido, não deve bloquear onboarding
   para sempre), cair para os passos 4-5
4. TenantLifecycleRecord legado existe (tenantId=userId)  → LEGACY_TENANT_ONLY
   (estado real de TODO usuário hoje, antes do cutover de B2B-5)
5. Nem legado nem Membership utilizável                   → NO_TENANT_NO_MEMBERSHIP
   (só alcançável de verdade depois que Wave B2B-5 parar de criar tenant legado
   automaticamente — testável agora via fixture sintético, legítimo per Rodada 2)
```

Implementação consome capabilities já existentes: `OrganizationStore.queryGsi4()` (Wave B2B-3) para Membership por usuário, hidratado contra a base (GSI4 nunca é fonte de autorização, physical model §6) + `tenantLifecycleKey()`/`TenantLifecycleRecord` (`shared/tenant-lifecycle/`, mesmo padrão cross-module já usado por `bootstrap-identity.ts`).

### O que fica fora desta wave (redesignado, não esquecido)

- Wiring em fluxo de login real e remoção do auto-provision legado: **Wave B2B-5** (RequestContext Cutover — §110 do roadmap já define isso textualmente: "eliminar fallback tenantId=userId").
- Exposição HTTP de `CreateOrganizationService`: adiada até haver consumidor real (provavelmente B2B-5/B2B-6).
- `Accept Invitation`: **Wave B2B-8** (Invitations/Team).

## Aplicação de `docs/engineering/definition-of-done.md` (E-013)

Implementação real desta wave (quando aprovada pelo Marcelo) deve cobrir os 4 estados com testes, incluindo `NO_TENANT_NO_MEMBERSHIP` via fixture sintético — G-V3 (mutação nomeada por escrito) aplicado desde a escrita de cada teste, não retrofitado depois.
