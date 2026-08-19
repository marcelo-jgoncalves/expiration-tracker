# Exception Registry

Registro de violações conscientes de regra, com justificativa, risco, owner e prazo de revisão (Prompt Mestre §47). Nenhuma exceção aqui é permanente por padrão.

## EX-001 — Vulnerabilidades transitivas em devDependencies (vitest/vite/esbuild) — FECHADA 2026-08-19

- **Regra violada**: G5 (sem vulnerabilidade crítica não tratada).
- **Achado original**: `npm audit` reportava 2 critical, 1 high, 2 moderate, todos transitivos via `vitest`→`vite`→`esbuild`.
- **Resolução**: upgrade de `vitest`/`@vitest/coverage-v8` de 1.6.0 para 4.1.11 (major version), na mesma sessão em que a exceção foi registrada — não foi preciso esperar o prazo de 30 dias. `npm audit` agora reporta **0 vulnerabilidades** (produção e dev). Suíte inteira (130 testes) verde após o upgrade; único ajuste necessário foi `testTimeout` global de 15s em `vitest.config.ts` (Vitest 4 tem timeout padrão de 5s, mais apertado que o synth do CDK em `test/infra`, que leva ~10s — não era um teste quebrado, só um timeout de config desatualizado para a nova major version).
- **Status**: fechada, não mais uma exceção ativa. Mantida aqui como registro histórico (Prompt Mestre: não esconder o que foi encontrado, mesmo depois de corrigido).
