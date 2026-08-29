# Context Architecture Reconciliation (2026-08-29) — registro do protocolo Claude↔Codex

Mission brief completo: `mission-brief.md` (mesma pasta, movido da raiz após execução).

## Resumo

Duas fases, ambas em `develop`:

1. **Root cleanup** (commit `5050037`): 21 arquivos `.md` soltos na raiz → 6 canônicos (`AGENTS.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `ENGINEERING.md`, `NEXT_SESSION_PROMPT.md`, `README.md`). Todos preservados via `git mv` para pastas semanticamente corretas (`docs/project/handoffs/`, `docs/architecture/reviews/w3-07-tenant-cascade-deletion-design/`, `docs/frontend/`, `docs/engineering/`, `docs/architecture/roadmap-evolution/`). Não requereu protocolo (mecânico, nível 1-2).
2. **AGENTS.md/NEXT_SESSION_PROMPT.md/guardrails/README** (esta rodada, blast radius alto per mission brief §18 — protocolo Claude↔Codex aplicado):
   - `AGENTS.md`: §1/§7 trimados (narrativa de milestone M0-M5 removida, invariantes duráveis mantidas), nota nova de acesso AWS via `--profile claude-dev`.
   - `NEXT_SESSION_PROMPT.md`: 1067 → 78 linhas (narrativa D-058 a D-083 já duplicada em `decisions-log.md` removida, template current-state+next-action adotado).
   - `scripts/check-doc-drift.ts` + `test/architecture/check-doc-drift.test.ts`: guardrails novos (root allowlist, size guardrail de `AGENTS.md`/`NEXT_SESSION_PROMPT.md`).
   - `README.md`, `docs/engineering/README.md`, `docs/architecture/README.md`: status stale corrigido.

## Achados reais de drift semântico encontrados e corrigidos (não só reorganização)

- `docs/engineering/pilot-readiness-program.md`: W2-01-DECISION marcada `BLOCKED` quando já estava decidida e implementada (D-058, commit `e9f2439`) — drift pré-existente à reconciliação, não introduzido por ela.
- `docs/architecture/README.md`: bloco de status dizia "8 de 9 classes sem purga"/"auto-CONFIRMED aguardando decisão" quando D-058/D-061 já tinham fechado ambos.
- `AGENTS.md` §7: citava um achado de M5 (`reminder.dispatch.v1` wire contract incompleto) como não corrigido — confirmado já resolvido por leitura direta do código (`src/workers/reminder-producer/producer.ts:44-51`).

## Protocolo Claude↔Codex

Thread `01a04f9f-3f77-7aa0-b1ad-1c45484f493d`, via MCP `codex/codex`/`codex-reply`, sandbox read-only. 4 rodadas:

| Rodada | Nota Codex | Achados principais |
|---|---:|---|
| 1 | 8.1/10 | `docs/architecture/README.md` stale (auto-CONFIRMED/retenção); `pilot-readiness-program.md` contradição interna (W2-01 DONE vs. BLOCKED); status AWS desatualizado em 4 arquivos; referência a seção removida de `NEXT_SESSION_PROMPT.md`; datas futuras (2026-08-30); referência errada a `AGENTS.md` §6; `isDirectRun` frágil |
| 2 | 8.8/10 | W3-06 (`pilot-readiness-program.md`) ainda com campos ativos (`Desired state`/`Risk`/`Priority`) falando dos 9 originais em vez das 7 classes restantes |
| 3 | 8.9/10 | Mesmo achado, correção incompleta (só 2 parágrafos re-rotulados, campos ativos não) |
| 4 | **9.3/10 — APPROVED** | Nenhum achado novo |

Todos os achados das rodadas 1-3 corrigidos e reverificados pelo próprio Codex antes da rodada seguinte. `npm run check-docs`/`typecheck`/`lint`/`npm test` (1104/1104) verdes na versão final.

## Pendência residual, não bloqueante

IDs de execução real do state machine da verificação E2E do M7 (2026-08-27) — resumo truncado preservado (`pilot-readiness-program.md` W2-01), transcript/output completo não está em nenhum documento normativo atual. Perda de detalhe forense menor, não de decisão (achado desta reconciliação).
