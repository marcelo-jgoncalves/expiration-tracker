# Engineering Decision Log

Decisões de engenharia tomadas durante a Engineering Maturity Review (Prompt Mestre §46), com IDs sequenciais.

## E-000 — Rubrica congelada com 16 domínios, pesos e gates G1-G11

Convergência Claude↔Codex em uma rodada (Codex rejeitou o draft inicial, todas as objeções aceitas). Ver `01-engineering-quality-criteria.md` e `reviews/checkpoint-01-rubric/`.

## E-001 — Regra anti-double-counting entre domínios M/B/I

M avalia semântica de persistência, B avalia correção local/de contrato, I avalia comportamento sob falha — mesma implementação (ex.: OCC) pode ser citada nos três, mas cada nota exige uma propriedade distinta comprovada.

## E-002 — Distinção formal entre N/A e NOT ENOUGH EVIDENCE (NEE)

N/A exige inaplicabilidade estrutural + concordância dos dois revisores; NEE é evidência insuficiente sobre algo aplicável, não sai do denominador, reduz a nota máxima possível.

## E-003 — Gate de dependency audit dividido em produção (bloqueante) e dev (informacional com exceção registrada)

Motivo: `npm audit --omit=dev` mostra 0 vulnerabilidades reais; as 5 encontradas (2 critical, 1 high, 2 moderate) são todas transitivas via `vitest`/`vite`/`esbuild`, relacionadas ao dev-server (não expostas em produção). Corrigir exige upgrade major do Vitest (1.x→4.x), desproporcional a aplicar sem verificar a suíte inteira. Decisão: tornar o audit de produção genuinamente bloqueante agora (estava `|| echo`, nunca bloqueava nada); registrar o achado de dev como exceção formal (`exceptions.md` EX-001) com prazo de revisão, não deixar como "warning eterno" sem dono nem prazo.

## E-004 — Enforcement de boundary de arquitetura via ESLint `no-restricted-imports`, não uma ferramenta nova

Motivo: o achado do Checkpoint 2-9 (G10 FAIL) é que os boundaries de módulo estavam limpos só por disciplina, sem mecanismo automatizado. Alternativas consideradas: `dependency-cruiser` (ferramenta dedicada, mais expressiva, mas nova dependência e nova curva de configuração) vs. `no-restricted-imports` do ESLint core (já presente, zero dependência nova, expressivo o suficiente para os três boundaries identificados: domain↛infra, domain↛aws-sdk, domain↛módulo-de-terceiros). Escolhido `no-restricted-imports` por proporcionalidade (Prompt Mestre §29, §37 — não adicionar ferramenta só para "parecer completo"). Verificado que passa hoje sem quebrar nada (`npm run lint` limpo) — prova que o estado real já respeitava o boundary, só faltava o mecanismo.

## E-005 — Branch protection não aplicada automaticamente

Motivo: mudar a configuração do GitHub (branch protection) altera o fluxo de trabalho do usuário (hoje push direto pra `main`) fora do escopo de uma edição de arquivo — tratado como decisão que precisa de confirmação explícita do usuário, não aplicada silenciosamente nesta sessão. Recomendação registrada em `ENGINEERING.md` (Known Gaps).

## E-006 — Correção do SHA truncado do `actions/setup-node` sem rodada de debate

Motivo: bug mecânico e objetivamente verificável (39 vs. 40 caracteres, confirmado via `gh api` contra o SHA real do tag `v4.0.2`) — não é uma decisão de engenharia sujeita a interpretação, é uma correção factual. Tratado como correção direta, não como Type 1 decision.
