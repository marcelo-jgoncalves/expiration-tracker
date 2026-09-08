---
status: final
owner: claude+codex
authority: audit-record
---

# Full-audit round2 — Eixo Qualidade de Engenharia — resumo consolidado

Protocolo `AGENTS.md` §4 executado contra os 12 critérios de `docs/engineering/joint-review-criteria.md` ("Eixo: Qualidade de engenharia"), reabrindo o eixo desde o fechamento sub-9.0 da Rodada 1 (2026-08-20, Claude 8.199/Codex 7.788, ver `full-audit-round1-qualidade-summary.md`). Muito código novo desde então: D-084 a D-231+ (`docs/architecture/decisions-log.md`), suíte cresceu de 152 para **2625 casos de teste em 236 arquivos** (~17x).

2 rodadas reais: Rodada 1 nota cega (Claude 8.17/Codex 8.843, o Codex avaliou sem conseguir rodar `npm test`/`check-docs`/`npm audit` no próprio sandbox — restrição de ambiente, não do projeto); Rodada 2 não-cega de reconciliação (Claude 8.32, incorporando 3 achados reais do Codex e corrigindo-os nesta sessão; Codex 8.341, aceitando a evidência real de execução do Claude para os critérios que seu sandbox não conseguiu confirmar). **CONVERGIDA por acordo mútuo explícito do Codex** ("Não há desacordo material que exija Rodada 3") apesar de ambas as notas ficarem abaixo do gate de 9.0 — mesmo padrão de fechamento honesto usado pelos outros eixos desta rodada (Segurança 7.40, Privacidade sub-9): achados reais e nomeados, não celebração prematura.

## Notas finais por critério

| # | Critério | Peso | Claude (R2) | Codex (R2) | Nota |
|---:|---|---:|---:|---:|---|
| 1 | Code Correctness & Defensive Design | 11% | 9.0 | 9.0 | Convergido. Padrão Ajv consistente em 6+ módulos novos; OCC/fencing transacional provado por teste real (D-220). |
| 2 | Test Effectiveness & Coverage Discipline | 15% | 7.2 | 7.2 | **Maior peso do eixo, achado headline desta rodada**: suíte completa rodou vermelha (2624/2625) por corrida intermitente entre 2 arquivos de teste de arquitetura que já tinham tentado se mitigar mutuamente (`vitest.config.ts` serialização + fixtures movidas para `test/`) sem sucesso total — causa raiz real ainda não identificada. Sem `coverage.thresholds` em `vitest.config.ts` (mesmo achado do Round1, 1+ ano sem correção). |
| 3 | CI Quality Gates & Merge Safety | 11% | 8.3 | 8.3 | Convergido. CI abrangente (typecheck/lint/boundaries/schemas/docs/freshness/test/audit bloqueante) mas o achado #2 acima cria risco de falso-negativo de merge (bloquear por teste flaky, não por bug real). Branch protection real segue não confirmada (E-005). |
| 4 | Type Safety, Static Analysis & Automated Enforcement | 9% | 9.0 | 9.1 | Quase convergido. `no-explicit-any` é `warn` mas `--max-warnings=0` o torna hard-block de fato. 5 fitness functions reais em `.dependency-cruiser.cjs` (corrigido comentário desatualizado que dizia "three rules", achado Q2-QE-03). |
| 5 | Readability, Consistency & Implementation Maintainability | 8% | 8.3 | 8.4 | Quase convergido. Convenções replicadas corretamente entre módulos novos; achado do Round1 (`expiration-service.ts` verboso) não reverificado por nenhum dos dois lados nesta rodada. |
| 6 | Delivery, Release & Recovery Discipline | 11% | 8.4 | 8.4 | **Maior salto desde Round1** (era 6.3/4.2): Wave 2 (6 drills reais contra `dev`) + `cd.yml`/`rollback.yml` com plano Terraform salvo e rollback compensável/auditável. RPO ainda não medido (só RTO), nenhum drill novo desde Wave 2 passou pelos gates prospectivos do próprio `test-engineering-standard.md`. |
| 7 | Dependency & Supply-Chain Hygiene | 7% | 7.8 | 7.8 | Convergido. 11 vulnerabilidades reais (`npm audit`), todas triadas: EX-001/EX-002 (dev-only, prazo 2026-09-24) + EX-003 nova (produção, `exceljs→uuid`, prazo 2026-11-06) — nenhuma vencida. CycloneDX agora pinado (`@6.0.1`, achado Q2-QE-05 corrigido). |
| 8 | Debuggability & Operational Feedback | 7% | 9.0 | 9.1 | **Achado do Round1 corrigido de fato**: `AsyncLocalStorage` real implementado (8 arquivos), `logging-observability-standard.md` (documento normativo próprio, 9,5/9,6) formaliza o mecanismo. Reclassificação de 7.7→9.0, não otimismo — evidência de código direta. |
| 9 | Developer Experience & Reproducibility | 5% | 9.0 | 9.0 | Convergido. Nota do Codex R1 (8.6) foi causada por falha do próprio sandbox dele, não do projeto — corrigido em R2. |
| 10 | Documentation Quality & Process Discipline | 5% | 8.8 | 8.8 | Convergido. `check-docs` limpo; ajuste para baixo (de 9.0 Round1) por reconhecer que o achado Q2-QE-02 (contagem desatualizada em documento normativo) só foi pego por auditoria externa, não por processo interno. |
| 11 | Documentation–Implementation Drift Control | 6% | 7.0 | 7.0 | Convergido. Mesma lacuna estrutural do Round1: `check-doc-drift.ts` prova ausência de link quebrado/guardrail de tamanho, não detecta drift semântico (a própria contagem desatualizada do achado Q2-QE-02 e o drift de `exceptions.md` EX-001 corrigido por outra sessão no mesmo dia são prova viva disso). |
| 12 | Technical-Debt & Continuous-Improvement Practice | 5% | 9.0 | 9.0 | Convergido. Follow-through real e nomeado (`decisions-log.md`/`NEXT_SESSION_PROMPT.md`), inclusive autocorreção de overclaim (D-227). |

**Nota ponderada final (Claude, R2): 8.32/10.**
**Nota ponderada final (Codex, R2): 8.341/10.**

## Achados novos desta rodada (não presentes no Round1)

1. **[Nível 3-4, PENDENTE — investigação]** Suíte completa vermelha nesta sessão (`test/architecture/system-mutation-allowlist.test.ts`, 2624/2625): corrida entre dois arquivos de teste de arquitetura que plantam fixtures sob `src/` e invocam `tsc` real como subprocesso. `fileParallelism: false` e a mitigação documentada (mover fixtures para evitar colisão, comentário em `system-mutation-allowlist.test.ts:56-61`) já foram tentadas e **não foram suficientes** — causa raiz real ainda não identificada. Reexecução isolada do arquivo (`npx vitest run test/architecture/system-mutation-allowlist.test.ts`) passou 5/5, confirmando que não é regressão de código de produção. Maior achado desta rodada, pesa no critério de maior peso do eixo (15%).
2. **[Nível 2, mecânico, corrigido nesta sessão]** `test-engineering-standard.md` tinha contagem/duração de suíte desatualizada (107 arquivos/928 casos/~7-10s, de 2026-08-28) contra a realidade atual (236 arquivos/2625 casos/~523s) — documento normativo citado como fonte de verdade em `docs/engineering/README.md`. Corrigido preservando o número histórico como contexto da v1, com nota explícita de que citações futuras devem reconfirmar contra `vitest run` real, não copiar este número.
3. **[Nível 1, cosmético, corrigido nesta sessão]** Comentário de `.dependency-cruiser.cjs` dizia "three rules" quando já existem 5 fitness functions reais — corrigido.
4. **[Nível 2, mecânico, corrigido nesta sessão]** `npx --yes @cyclonedx/cyclonedx-npm` no CI sem versão pinada — corrigido para `@6.0.1`.
5. **[Nível 5-6, PENDENTE — decisão de design, já registrado, reconfirmado]** Sem `coverage.thresholds` em `vitest.config.ts` — mesma lacuna do Round1, mais de um ano sem correção apesar de ser corrigível nesta sessão; decisão de quanto exigir (por módulo? global? qual piso?) fica para Marcelo decidir, não implementada unilateralmente.

## Comparação com Round1

Maiores ganhos reais desde 2026-08-20: critério 8 (Debuggability, 7.7→9.0, `AsyncLocalStorage` implementado de fato) e critério 6 (Delivery/Recovery, 6.3→8.4, Wave 2 + CD/rollback reais). Maior alerta novo: critério 2 (Test Effectiveness) não subiu apesar do crescimento de 17x na suíte — o crescimento de volume não veio acompanhado de correção do coverage threshold nem preveniu uma nova classe de fragilidade (corrida entre testes de arquitetura) que não existia (ou não tinha se manifestado) no Round1.

## Recomendação para a próxima sessão que retomar este eixo

1. Investigar a causa raiz real da corrida em `test/architecture/system-mutation-allowlist.test.ts` vs. `tenant-fence-boundary.test.ts` antes de confiar cegamente em "suíte verde" como sinal de merge safety — a mitigação já tentada (mover fixture) não foi suficiente, hipótese mais provável é os processos filhos `tsc` de dois testes adjacentes na fila lendo o mesmo `tsconfig.json`/`include: "src"` fora da janela de serialização do vitest.
2. Decidir e aplicar um `coverage.thresholds` real em `vitest.config.ts` (decisão de produto/engenharia: qual piso, por módulo ou global) — pendência mais antiga do eixo, corrigível nesta sessão mas não feita por 2 rodadas seguidas.
3. Medir RPO real (não só RTO) num próximo drill de restore, fechando a lacuna nomeada em `test-engineering-standard.md` §5.
