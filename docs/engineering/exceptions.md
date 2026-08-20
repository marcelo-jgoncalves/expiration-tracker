# Exception Registry

Registro de violações conscientes de regra, com justificativa, risco, owner e prazo de revisão (Prompt Mestre §47; formalizado com o padrão de `expiraEm` do `event-discovery-platform`, ver `docs/engineering/quality-gate-tiers.md` §"Política de exceção"). Nenhuma exceção aqui é permanente por padrão — **uma exceção sem `expiraEm` explícito não é uma exceção válida, é uma vulnerabilidade não tratada disfarçada.** Ao expirar sem reavaliação registrada, o achado volta a bloquear `Dependency audit` normalmente até ser re-registrado com novo prazo.

## EX-001 — Vulnerabilidades transitivas em devDependencies (vitest/vite/esbuild)

- **Regra violada**: G5 (sem vulnerabilidade crítica não tratada).
- **Achado**: `npm audit` reporta 2 critical, 1 high, 2 moderate, todos transitivos via `vitest`→`vite`→`esbuild`. A mais severa (CVSS 9.8, GHSA-5xrq-8626-4rwp) é sobre o servidor de UI do Vitest permitir leitura/execução arbitrária de arquivo quando exposto — este projeto nunca inicia esse servidor (não há `vitest --ui` em nenhum script/workflow).
- **Justificativa**: risco real é de dev-server local, não de runtime de produção; `npm audit --omit=dev` (produção) mostra 0 vulnerabilidades.
- **Tentativa de correção registrada (2026-08-19)**: upgrade para Vitest 4.1.11 foi tentado nesta sessão. Localmente (Windows) passou limpo (typecheck/lint/130 testes/audit zerado), mas **quebrou o CI real (Ubuntu)**: `Error: Cannot find native binding... Cannot find module '@rolldown/binding-wasm32-wasi'` — bug conhecido e não resolvido do ecossistema npm com optional dependencies cross-platform (`npm/cli#4828`, referenciado na própria mensagem de erro), onde o lockfile gerado numa plataforma não resolve corretamente o binding nativo de outra mesmo depois de regenerado do zero. **Revertido** para `vitest@^1.6.0` após confirmar em duas execuções reais de CI que o upgrade quebrava o pipeline — CI real verde é mais importante do que fechar esta exceção às pressas. Não tentar de novo sem verificar primeiro se o bug upstream do rolldown/npm foi corrigido numa versão futura do Vitest/Vite.
- **Risco residual**: baixo (superfície de ataque exige rodar o dev-server localmente com input não confiável) — mas não é zero e não deve virar exceção permanente.
- **Owner**: Marcelo (product/eng owner único do projeto neste estágio solo — não há um segundo responsável a definir; formalizado aqui em vez de "a definir" per full-audit round1/qualidade).
- **Data de registro**: 2026-08-19.
- **Prazo de revisão**: antes de M4 ou em 30 dias, o que vier primeiro — reavaliar upgrade do Vitest quando o bug de optional dependencies cross-platform estiver resolvido upstream.
- **Compensating control**: gate de CI `Dependency audit (production - blocking)` bloqueia qualquer vulnerabilidade real em `dependencies` (não `devDependencies`); o job separado de dev-audit é informacional e referencia esta entrada.
