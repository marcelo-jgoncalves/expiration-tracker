# Multi-User B2B — Wave tracker

> Registro vivo de backlog (mesmo papel de `docs/engineering/pilot-readiness-program.md` para o Pilot Readiness Program) — DONE/IN PROGRESS/BLOCKED/NOT STARTED por wave, atualizado a cada marco. Não normativo sobre arquitetura/design (isso é `roadmap-evolution/17-multi-user-b2b-revised-strategy.md`) — só rastreia execução. Serve também como "todo list" persistida da iniciativa, já que o ambiente desta sessão não tem uma ferramenta de todo list de sessão — persistir em arquivo é preferível de qualquer forma (sobrevive a reset de contexto, mesma convenção de `decisions-log.md`/`session-log.md`).

Cada wave é avaliada contra `docs/engineering/definition-of-done.md` (E-012) antes de virar `DONE` — decompor em subitens quando a wave cruzar mais de uma camada/nível de risco, nunca fechar a wave inteira com uma única linha de evidência genérica.

| Wave | Nome | Status | Nota |
|---|---|---|---|
| B2B-0 | Current Truth + Inventory (read-only) | **DONE** (2026-08-29) | `docs/architecture/multi-user-b2b-wave-b2b0-inventory.md` |
| B2B-1 | Type 1 Design — physical model | **DONE** (2026-08-30, D-086) | `docs/architecture/multi-user-b2b-physical-model.md` — protocolo Claude↔Codex 5 rodadas (6,7/8,7 → 8,1/8,9 → 8,4/9,2 → 8,6/9,4 → 9,3/9,5), evidência em `reviews/multi-user-b2b-physical-model/` |
| B2B-2 | Global Identity Foundation | **NOT STARTED (unblocked)** | `User` global + `IdentityMapping` tenantless + `bootstrapUser()` unificado (§2-3 do physical model) — primeira wave de implementação real, decompor por `docs/engineering/definition-of-done.md` (E-012) |
| B2B-3 | Organization + Membership | NOT STARTED (unblocked) | `Organization`/`Membership`/GSI4 `MembershipByUser`/`ownerCount` (§4-6/8 do physical model) |
| B2B-4 | Onboarding | NOT STARTED | Bloqueado por B2B-2/B2B-3 |
| B2B-5 | RequestContext Cutover | NOT STARTED | Bloqueado por B2B-2/B2B-3 |
| B2B-6 | BFF Organization Context | NOT STARTED | Bloqueado por B2B-5; muda semântica que W3-07 assume (`roadmap-evolution/17` §125.4) — avaliar sequenciamento com a decisão do orquestrador do purge W3-07 (ver `NEXT_SESSION_PROMPT.md` gates) |
| B2B-7 | RBAC | NOT STARTED | Bloqueado por B2B-3 |
| B2B-8 | Invitations / Team | NOT STARTED | Bloqueado por B2B-7 |
| B2B-9 | W3-07 / Privacy Reconciliation | NOT STARTED | Usar `docs/architecture/w3-07-writer-inventory.md` como base, não re-derivar (per achado 125.4 do roadmap doc) |
| B2B-10 | Tenant-aware Frontend | NOT STARTED | Bloqueado por B2B-6; B2B-0 confirmou isolamento de cache hoje é zero (green-field, não modificação) |
| B2B-11 | Responsibility + Notifications | NOT STARTED | Bloqueado por B2B-7 |
| B2B-12 | Cutover de dev | NOT STARTED | Decisão de reset/reseed vs. migração one-shot, ver `roadmap-evolution/17` §62-68 |
| B2B-13 | E2E / Adversarial Security | NOT STARTED | Usa as 25 perguntas de §121 como checklist |
| B2B-14 | Operational Evidence | NOT STARTED | Evidência real contra `dev` via `aws --profile claude-dev` |
| B2B-15 | Documentation Reconciliation | NOT STARTED | Checklist de `AGENTS.md` §6 |

## Achados/pendências laterais abertos durante a execução (não bloqueiam waves seguintes)

- BFF login path (`bff-auth-service.ts`) sem `TenantLifecycleRecord`/fencing — achado da Wave B2B-0, registrado em `NEXT_SESSION_PROMPT.md` "Gates / bloqueios abertos". Decidir se corrige como chunk isolado ou dentro de B2B-2 (mesmos arquivos de bootstrap).
