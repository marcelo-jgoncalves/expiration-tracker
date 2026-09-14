# Performance Program

Artefatos do programa de performance world-class descrito em
`expiration-tracker-plano-acao-performance-world-class-2026-09-14.md` (raiz do repo, documento do usuário).

Rastreamento de execução: [TODO.md](./TODO.md).

## Estrutura

- `baseline/` — medições de baseline (PERF-01 a PERF-05)
- `experiments/` — um arquivo por experimento (`PERF-Exxx-nome.md`), usando o template do plano §26
- `load-tests/` — scripts e resultados k6 (PERF-11)
- `screenshots/` — waterfalls, DevTools, Lighthouse
- `traces/` — traces X-Ray/Application Signals exportados
- `results/` — relatórios consolidados por fase (`PERF-0X-*.md`)

## Regras do programa (resumo — ver plano completo para detalhes)

1. Medir antes de alterar. Nenhuma mudança estrutural grande sem baseline.
2. Não misturar experimentos — uma mudança por vez.
3. Registrar custo junto com latência.
4. Sempre separar cold vs warm.
5. Usar percentis (p50/p75/p90/p95/p99/max), nunca só média.

SHA do baseline congelado: `8ade66960ae36f51b8cf1b7553e4245d684f6794` (`8ade669 feat(reports): close A16's execution-history gap (D-293)`, branch `develop`).
Branch de trabalho do programa: `perf/performance-program-v1`.
Data de congelamento: 2026-09-14.
