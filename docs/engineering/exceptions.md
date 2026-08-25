# Exception Registry

Registro de violações conscientes de regra, com justificativa, risco, owner e prazo de revisão (Prompt Mestre §47; formalizado com o padrão de `expiraEm` do `event-discovery-platform`, ver `docs/engineering/quality-gate-tiers.md` §"Política de exceção"). Nenhuma exceção aqui é permanente por padrão — **uma exceção sem `expiraEm` explícito não é uma exceção válida, é uma vulnerabilidade não tratada disfarçada.** Ao expirar sem reavaliação registrada, o achado volta a bloquear `Dependency audit` normalmente até ser re-registrado com novo prazo.

## EX-001 — Vulnerabilidades transitivas em devDependencies (vitest/vite/esbuild + testcontainers/dockerode)

- **Regra violada**: G5 (sem vulnerabilidade crítica não tratada).
- **Reavaliado em 2026-08-25** (achado real: a entrada estava desatualizada em dois eixos — a contagem de `npm audit` e o próprio prazo de revisão, que expirava "antes de M4" e M4 já foi implementado e revisado 9,1/10 desde então sem que esta entrada fosse reavaliada, violando a regra do próprio registro no topo deste arquivo). Números e escopo abaixo são os reais, confirmados via `npm audit`/`npm audit --omit=dev` nesta data, não os originais de 2026-08-19.
- **Achado**: `npm audit` reporta 9 vulnerabilidades (2 critical, 5 high, 2 moderate) — duas cadeias transitivas distintas, não uma só:
  1. `vitest`→`vite`/`vite-node`→`esbuild` (a cadeia original registrada em 2026-08-19). A mais severa (CVSS 9.8, GHSA-5xrq-8626-4rwp) é sobre o servidor de UI do Vitest permitir leitura/execução arbitrária de arquivo quando exposto — este projeto nunca inicia esse servidor (não há `vitest --ui` em nenhum script/workflow).
  2. **Nova, não documentada até agora**: `testcontainers`→`dockerode`→`tar-fs`/`undici` (2 high + 1 high adicionais: tar-fs symlink/path-traversal em extração de tarball, undici — múltiplos CVEs de smuggling/CRLF/DoS). `testcontainers` é usado só por `npm run test:dynamodb` (integração real contra DynamoDB local via container Docker) — nunca em produção, mas roda de fato em CI real (`.github/workflows/ci.yml` linha ~123), não é hipotético.
- **Justificativa**: risco real é de dev-server local (cadeia 1) / ambiente de CI controlado rodando containers Docker confiáveis (cadeia 2), não de runtime de produção; `npm audit --omit=dev` (produção) mostra 0 vulnerabilidades, confirmado nesta reavaliação.
- **Tentativa de correção registrada (2026-08-19)**: upgrade para Vitest 4.1.11 foi tentado nessa sessão. Localmente (Windows) passou limpo, mas **quebrou o CI real (Ubuntu)**: `Error: Cannot find native binding... Cannot find module '@rolldown/binding-wasm32-wasi'` — bug conhecido do ecossistema npm com optional dependencies cross-platform (`npm/cli#4828`). **Revertido** para `vitest@^1.6.0`. Vitest 4.1.11 continua sendo a `latest` publicada em 2026-08-25 — **o status upstream do bug não foi reverificado nesta reavaliação** (fora do escopo desta sessão); não tentar o upgrade de novo sem essa verificação primeiro.
- **Risco residual**: baixo nas duas cadeias (exige, respectivamente, rodar o dev-server localmente com input não confiável, ou comprometer o runner de CI/imagem Docker usada por `test:dynamodb`) — mas não é zero e não deve virar exceção permanente.
- **Owner**: Marcelo (product/eng owner único do projeto neste estágio solo).
- **Data de registro**: 2026-08-19. **Reavaliado**: 2026-08-25.
- **Prazo de revisão**: 30 dias a partir da reavaliação (2026-09-24) — reavaliar upgrade do Vitest quando o bug de optional dependencies cross-platform estiver resolvido upstream, e reavaliar `testcontainers`/`dockerode` separadamente (cadeia independente, pode ter correção disponível antes da cadeia do Vitest).
- **Compensating control**: gate de CI `Dependency audit (production - blocking)` bloqueia qualquer vulnerabilidade real em `dependencies` (não `devDependencies`); o job separado de dev-audit é informacional e referencia esta entrada.

## EX-002 — Vulnerabilidades transitivas em devDependencies do `frontend/` (vitest/vite/esbuild)

- **Regra violada**: G5 (sem vulnerabilidade crítica não tratada).
- **Achado**: mesma cadeia transitiva e mesma causa-raiz de [[EX-001]] (`vitest`→`vite-node`→`vite`→`esbuild`, GHSA-67mh-4wv8-2f99 e as vulnerabilidades derivadas em vite/vite-node/vitest), agora também presente em `frontend/package.json` (projeto npm separado, criado na sessão "Frontend Production Foundation", 2026-08-24) — 4 vulnerabilidades (2 moderate, 1 high, 1 critical) reportadas por `npm audit` dentro de `frontend/`.
- **Justificativa**: idêntica a EX-001 — risco é de dev-server local (`vite`/`vitest --ui`, nenhum dos dois exposto em CI ou produção), não de runtime de produção. `npm audit --omit=dev` dentro de `frontend/` mostra 0 vulnerabilidades; o bundle de produção (`npm run build`) não inclui `esbuild`/`vite`/`vitest` — são apenas ferramentas de build.
- **Risco residual**: baixo, mesma superfície de EX-001 (exige rodar o dev-server localmente com input não confiável).
- **Owner**: Marcelo.
- **Data de registro**: 2026-08-24.
- **Prazo de revisão**: mesmo prazo de [[EX-001]] — reavaliar upgrade do Vitest em ambos os projetos (`frontend/` e raiz) junto, quando o bug upstream de optional dependencies cross-platform (`npm/cli#4828`) estiver resolvido.
- **Compensating control**: nenhum gate de CI de produção depende de `frontend/`'s devDependencies; o job de CI do frontend (typecheck/lint/test/build) roda contra o bundle de produção, que não referencia essas dependências em runtime.
