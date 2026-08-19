# Exception Registry

Registro de violações conscientes de regra, com justificativa, risco, owner e prazo de revisão (Prompt Mestre §47). Nenhuma exceção aqui é permanente por padrão.

## EX-001 — Vulnerabilidades transitivas em devDependencies (vitest/vite/esbuild)

- **Regra violada**: G5 (sem vulnerabilidade crítica não tratada).
- **Achado**: `npm audit` reporta 2 critical, 1 high, 2 moderate, todos transitivos via `vitest`→`vite`→`esbuild`. A mais severa (CVSS 9.8, GHSA-5xrq-8626-4rwp) é sobre o servidor de UI do Vitest permitir leitura/execução arbitrária de arquivo quando exposto — este projeto nunca inicia esse servidor (não há `vitest --ui` em nenhum script/workflow).
- **Justificativa**: risco real é de dev-server local, não de runtime de produção; `npm audit --omit=dev` (produção) mostra 0 vulnerabilidades. Corrigir requer `npm audit fix --force`, que é upgrade major do Vitest (1.x→4.x) — mudança breaking, desproporcional a aplicar sem verificar a suíte de testes inteira contra a nova major version.
- **Risco residual**: baixo (superfície de ataque exige rodar o dev-server localmente com input não confiável) — mas não é zero e não deve virar exceção permanente.
- **Owner**: Marcelo (a definir formalmente).
- **Data de registro**: 2026-08-19.
- **Prazo de revisão**: antes de M4 ou em 30 dias, o que vier primeiro — avaliar upgrade do Vitest para 4.x com suíte completa rodando verde.
- **Compensating control**: gate de CI `Dependency audit (production - blocking)` bloqueia qualquer vulnerabilidade real em `dependencies` (não `devDependencies`); o job separado de dev-audit é informacional e referencia esta entrada.
