---
status: historical
owner: claude
authority: evidence-round (not normative — Engineering Maturity Review checkpoint, superseded by full-audit round1)
---

# Checkpoints 2-9 — Claude Evaluation (Round 1)

Avaliação as-is contra o commit baseline `154d6e0` (não modificar durante a primeira avaliação, Prompt Mestre §24). Evidência coletada via inspeção direta de código, execução real de comandos (`npm test`, `npm audit`, `gh api`, `gh run view`) e um agente Explore de inventário (`_explore-inventory.md` teria sido o output — preservado nesta conversa, resumo incorporado abaixo com citações).

## Achados-chave (evidência real, não documentação)

1. **CI nunca rodou com sucesso.** `actions/setup-node@60edb5dd545a775178f52524783378180af0d1f` em `.github/workflows/ci.yml:46` tem **39 caracteres** (SHA truncado — SHAs válidos têm 40). `gh run view 32258273775` confirma: a única execução real do workflow falhou em "Set up job", antes até do checkout de código, com erro explícito do GitHub Actions ("shortened version of a commit SHA... not supported"). Nenhum dos gates que dependem de "CI realmente executa" (G2) tem evidência de ter passado — porque nunca rodou.
2. **`main` não tem branch protection.** `gh api repos/.../branches/main/protection` retorna 404 "Branch not protected". Não há required checks, não há bloqueio de push direto.
3. **`npm audit` real mostra 2 critical, 1 high, 2 moderate** (todos transitivos via `vitest`/`vite`/`esbuild`, dev-only, relacionados ao dev-server do Vite — não expostos em runtime de produção, mas não corrigidos apesar de fix disponível via `npm audit fix --force`, que é breaking change no vitest). O step de audit no CI (`.github/workflows/ci.yml:66`) é `npm audit --audit-level=high || echo "::warning..."` — **nunca falha o job**, mesmo com critical/high presentes. Isso é exatamente "CI theater" (Prompt Mestre §21) — o step existe e "roda" mas não pode, estruturalmente, bloquear nada.
4. **Divergência documentação↔realidade**: `NEXT_SESSION_PROMPT.md` afirma "nada commitado" para M0-M3 e memória de sessão registrava "390 testes"; o estado real é **123 testes** e **já commitado** (`154d6e0`). Não é evidência de má-fé, mas é exatamente o padrão de risco que o domínio O (AI-Assisted Engineering) pede pra vigiar: documentação gerada por IA que não foi reverificada contra execução real.
5. **Sem README.** Repositório não tem nenhum `README.md` na raiz — `AGENTS.md`/`CLAUDE.md` são orientados a agentes de IA, não a onboarding humano.
6. **Duplicação real e reconhecida**: o pipeline de error-mapping HTTP (`STATUS_BY_CATEGORY`, `toResponse`, `withErrorMapping`) está copiado quase verbatim em `expiration/http/item-handlers.ts`, `reminder/http/policy-handlers.ts` e `identity/http/test-route-handler.ts` — os comentários no próprio código admitem que "mirrors X exactly", mas não foi extraído para `shared/errors/`, que já existe como lar natural.
7. **Boundaries de módulo estão limpos**: nenhum arquivo em `*/domain/` importa `infra/`, `aws-sdk`, ou internals de outro módulo — grep confirma zero violações.
8. **Nenhum `any`/`as any`/`@ts-ignore`** em `src/`; os únicos casts (`as unknown as`) são 4 instâncias do mesmo padrão justificado (adaptar objeto de domínio tipado para o shape genérico esperado pelo builder de OCC).
9. **Nenhum secret real** encontrado em arquivos versionados (o único "segredo" encontrado é um valor canário de teste em `redactor.test.ts`, usado propositalmente para provar que o redactor funciona).
10. **Error handling não tem swallowing silencioso** nos 13 `catch` revisados — todos ou rethrow, ou mapeiam pra `AppError` tipado, ou tratam race condition nomeada explicitamente (`isTransactionCanceled`).
11. **Bug real de M3 (GSI3 leak) foi corrigido com teste de regressão** — evidência de que o processo de engenharia consegue encontrar e fechar bugs reais, não só documentar intenção.
12. **Workers assíncronos (`dispatch.ts`, `producer.ts`, `reconciliation.ts`) não têm teste unitário individual nomeado** — cobertura vem só da suíte de integração `reminder-engine.test.ts`, que testa o conjunto, não cada worker isoladamente com fault injection dedicada.

## Scores por domínio (0.00-10.00, evidência-first)

| # | Domínio | Peso | Score Claude | Evidência-chave |
|---|---|---:|---:|---|
| A | Code Quality & Maintainability | 10% | 7.20 | Boundaries limpos, zero dead code/TODO; mas duplicação HTTP real e reconhecida sem extração |
| B | Type Safety, Contracts & Correctness | 11% | 8.40 | Zero `any`/`@ts-ignore`; casts únicos e justificados; contract tests de schema existem e passam |
| C | Testing Engineering | 14% | 6.30 | Boa amplitude (unit/integration/contract/infra); mas workers assíncronos sem unit test individual; testes nunca validados em CI real (só local) |
| D | Continuous Integration | 8% | 1.20 | **CI nunca executou com sucesso** — SHA inválido quebra o job antes do checkout. Achado gate-breaking |
| E | CD & Release Engineering | 4% | NEE (parcial 3.0 estrutural) | Sem alvo de deploy; rastreabilidade commit→deploy inexistente porque não há deploy |
| F | Secure Software Engineering | 12% | 5.80 | SecureLogger/Redactor reais e testados; IAM com least-privilege explícito; mas gate de audit é decorativo e há vulns reais não tratadas |
| G | Software Supply Chain | 6% | 4.50 | Pinning/lockfile/SBOM corretos na intenção, mas nunca executados de verdade (CI quebrado); um dos três pins está errado |
| H | Infrastructure Engineering / IaC | 7% | 7.60 | CDK bem estruturado, per-entity IAM grants explícitos, bug real (GSI leak) já corrigido com teste; `cdk synth` real via CLI nunca executado |
| I | Reliability Engineering | 8% | 7.50 | OCC/idempotência/outbox reais e testados; DST tratado explicitamente; catches corretos |
| J | Observability & Operability | 6% | 5.00 | Logger/Redactor reais e testados (canário); zero métricas/alarmes/correlation ID ainda — proporcional ao estágio, mas não pontua alto |
| K | Developer Experience | 2% | 4.50 | Sem README; `AGENTS.md` é bom mas orientado a agente, não a humano novo |
| L | Documentation Engineering | 3% | 3.80 | Divergência real doc↔realidade (contagem de testes, status de commit); sem README |
| M | Data & State Engineering | 5% | 7.50 | Single-table bem desenhado, OCC/idempotência na camada de persistência, bug real corrigido |
| N | Engineering Governance | 2% | 2.50 | Zero branch protection; um commit gigante cobrindo 4 milestones sem granularidade de PR/review |
| O | AI-Assisted Engineering | 1% | 5.00 | Processo Claude↔Codex real e documentado; mas status docs não foram reverificados contra execução real (test count, commit status) |
| P | Performance & Efficiency | 1% | 6.00 | Nada de N+1 óbvio nos arquivos revisados; não auditado em profundidade |

**Nota**: estes são scores de Claude, ainda não comparados com Codex. Blind review do Codex a seguir usa exatamente esta evidência (não estes scores).

## Gates (G1-G11) — avaliação preliminar

- **G1 (build reproduzível)**: FAIL condicionalmente — `npm ci`/`typecheck`/`build` funcionam localmente (verificado), mas o pipeline que deveria provar isso em ambiente limpo está quebrado.
- **G2 (CI enforced)**: **FAIL** — CI nunca executou com sucesso; branch não protegida.
- **G3 (testes críticos)**: PASS localmente (`npm test` = 123/123 verde), mas nunca provado em CI real.
- **G4 (sem secret)**: PASS.
- **G5 (sem vuln crítica não tratada)**: **FAIL** — 2 critical/1 high presentes, gate de CI que deveria bloquear é decorativo.
- **G6 (autorização/isolamento cross-tenant)**: PASS (suíte negativa dedicada, 9 casos).
- **G7 (least privilege de infra/índices)**: PASS (bug de M3 corrigido com teste de isolamento de GSI3).
- **G8 (falhas assíncronas observáveis/recuperáveis)**: PARCIAL — reconciliação/DLQ conceitual existe no design, mas sem Lambda real/fila real ainda, e sem telemetria de falha correlacionável instrumentada nos workers revisados.
- **G9 (infra sintetizável)**: PASS (via `aws-cdk-lib/assertions`; CLI real não instalado/testado).
- **G10 (boundaries enforced automaticamente)**: PARCIAL — boundaries estão de fato limpos hoje (verificado por grep manual), mas não há teste/lint automatizado que os proíba mecanicamente; depende de disciplina, não de enforcement.
- **G11 (contratos/schemas no CI)**: PASS localmente (`validate-schemas` + `test/contract/schemas.test.ts`), mas mesma ressalva de D/G2 — nunca provado em CI real.

**Conclusão preliminar de Claude**: `ENGINEERING FOUNDATION STATUS` não pode ser `APPROVED` nesta rodada — G2 e G5 falham de forma concreta e verificável, não por falta de evidência, mas por evidência real de falha. Isso não é surpreendente nem uma reprovação injusta: é exatamente o tipo de achado que a Fase 0 do processo existe para capturar antes que vire dívida invisível.
