# Engineering Summary — Expiration Tracker

Documento equivalente de engenharia ao `ARCHITECTURE.md`. Produzido pela Engineering Maturity Review (`Prompt Mestre — Engineering Maturity Review do Expiration Tracker.md`), processo Claude↔Codex, iniciado e concluído (rodada 1 de avaliação + remediação de P0s de alto valor) em 2026-08-19. Baseline avaliado: commit `154d6e0`.

## Scope

Avalia se o projeto é **construído, testado, versionado, protegido, entregue, observado, documentado e mantido** de acordo com padrões profissionais — não reavalia a arquitetura (já aprovada em processo anterior, ver `ARCHITECTURE.md`). Notas de arquitetura não influenciam esta avaliação (Prompt Mestre §3).

## External Standards Used

ISO/IEC 25010:2023, NIST SP 800-218 SSDF v1.1, OWASP SAMM v2 + ASVS, OpenSSF Scorecard, SLSA, AWS Well-Architected Framework (+ Serverless Lens, Security Pillar, Builders' Library, IAM Best Practices), DynamoDB Developer Guide, Google SRE book, DORA/Accelerate. Detalhe completo com versão/status/limitações em `docs/engineering/00-research-bibliography.md`.

## Engineering Principles

evidence-first (execução real > teste executável > código > docs > declaração); N/A ≠ NOT ENOUGH EVIDENCE; gate não pode ser removido por ter falhado; nota final = min(Claude, Codex), sem arredondar; documentação sem enforcement não vale como prova; proporcionalidade ao estágio (micro-SaaS pré-produção) sem tolerar falhas básicas (secret no git, isolamento ausente, CI que não roda).

## Repository Standards

Rubrica congelada com 16 domínios (A-P, pesos somando 100%) e 11 gates eliminatórios (G1-G11) — ver `docs/engineering/01-engineering-quality-criteria.md`. Regra anti-double-counting entre domínios sobrepostos (M/B/I). Fitness functions em `docs/engineering/02-engineering-fitness-functions.md`.

## Code Quality

Score Claude 7.20 / Codex 7.00 (domínio A). Boundaries de módulo limpos (zero violação encontrada por grep manual), zero dead code/TODO/HACK, zero `any`/`@ts-ignore`. Duplicação real e reconhecida no pipeline de error-mapping HTTP (copiado em 3 módulos, não extraído para `shared/` apesar de já existir o lar natural) — não corrigida nesta rodada (P2, não bloqueante).

## Testing

Score Claude 6.30 / Codex 6.50 (domínio C). 123 testes (19 arquivos: unit/integration/contract/infra), todos verdes localmente. Boa amplitude (cross-tenant negativo, isolamento de GSI3, lifecycle end-to-end, reminder engine). Lacuna real: workers assíncronos (`dispatch.ts`, `producer.ts`, `reconciliation.ts`) não têm teste unitário individual com fault injection dedicada (timeout, poison message) — cobertos só agregadamente via integração.

## CI/CD

**Achado mais grave da revisão**: o CI nunca executou com sucesso. O SHA pinado do `actions/setup-node` tinha 39 caracteres em vez de 40 (truncado) — confirmado via `gh run view` que a única execução real falhou em "Set up job", antes do checkout de código. **Corrigido nesta sessão** (SHA completo verificado contra a tag `v4.0.2` real via `gh api`). O step de dependency audit era `npm audit ... || echo warning` — nunca bloqueava nada independentemente do achado. **Corrigido**: audit de produção agora é genuinamente bloqueante; audit de dev é informacional com exceção formal registrada. CD real não existe ainda (sem alvo de deploy) — NOT ENOUGH EVIDENCE, esperado no estágio.

## Security

Score Claude 5.80 / Codex 6.50 (domínio F). `SecureLogger`/`Redactor` reais e testados com valor canário. IAM com least-privilege explícito por índice (bug real de M3 — vazamento de `/index/*` via `grantReadWriteData` — corrigido com teste de regressão). `npm audit --omit=dev` mostra 0 vulnerabilidades reais de produção; 5 vulnerabilidades (2 critical, 1 high, 2 moderate) são transitivas de devDependencies (`vitest`/`vite`/`esbuild`, risco de dev-server, não expostas em produção) — registradas como exceção formal (`docs/engineering/exceptions.md` EX-001), não deixadas como warning sem dono/prazo.

## Software Supply Chain

Score Claude 4.50 / Codex 2.00 (domínio G) — divergência grande porque o SHA quebrado invalidava toda a cadeia de confiança que o pinning deveria prover. Lockfile imutável, `ignore-scripts=true`, SBOM CycloneDX gerado no CI, Actions pinadas por SHA (agora as três corretamente). SLSA L3/assinatura de artefato permanecem NEE — desproporcionais sem alvo de deploy real.

## Infrastructure Engineering

Score Claude 7.60 / Codex 7.50 (domínio H). CDK bem estruturado (`ExpirationTrackerTable`, `ExpirationTrackerAuth`, `ScopedLambdaFunction`, `ExpirationTrackerApi`), sem secrets/ARNs hardcoded, testado via `aws-cdk-lib/assertions`. `cdk synth` real via CLI nunca executado (CLI não instalado) — validação estática em memória é equivalente para este fim, mas não é a mesma coisa que rodar o comando real.

## Reliability

Divergência grande: Claude 7.50 vs. Codex 2.50 (domínio I). Codex aplicou corretamente o padrão evidence-first mais rigoroso: OCC/idempotência/outbox/DST são reais e testados **como mecanismo**, mas nenhum comportamento de recuperação real sob falha (DLQ, replay, redrive, poison message) foi provado em execução — não há Lambda/fila real ainda. Claude aceitou essa correção (`docs/engineering/disagreement-log.md` D-001).

## Observability

Divergência: Claude 5.00 vs. Codex 2.00 (domínio J). Logger/Redactor existem e são testados; zero métricas, alarmes, dashboards, correlation ID ou tracing em execução — esperado pré-produção, mas não pontua alto por design isoladamente.

## Developer Experience

Sem README até esta sessão — **corrigido** (`README.md` novo na raiz, com comandos, estrutura, convenções, ponto de entrada tanto para humano quanto referência a `AGENTS.md` para agentes).

## Documentation

Divergência real doc↔realidade encontrada e corrigida: `NEXT_SESSION_PROMPT.md` afirmava "nada commitado" e contagens de teste desatualizadas; estado real (M0-M3 já commitado, 123 testes) anotado no próprio arquivo com correção datada, preservando o histórico original.

## AI-Assisted Engineering

Processo Claude↔Codex real, com Codex genuinamente rejeitando o draft inicial da rubrica e a primeira leitura de vários domínios de código — não houve confirmação automática. Achado do próprio Codex: documentação gerada por sessões anteriores (contagem de testes, status de commit) não foi reverificada contra execução real antes de ser registrada — exatamente o padrão de risco que este domínio existe para vigiar.

## Engineering Gates (estado após remediação desta sessão)

```text
G1 (build reproduzível)              PASS — confirmado: run real 32262099908 (commit 6d541a0) verde em runner limpo do GitHub Actions, 45s, incluindo build/typecheck/lint/test
G2 (CI enforced)                     PARCIAL → CI agora executa com sucesso de verdade (confirmado em produção, primeira vez desde a criação do workflow); falta só branch protection para virar PASS pleno
G3 (testes críticos)                 PASS — confirmado em CI real, não só local
G4 (sem secret)                      PASS
G5 (sem vuln crítica não tratada)    PASS agora (produção limpa; dev com exceção formal EX-001, não mais "tratada" por omissão) — warning informacional do audit de dev apareceu na run real como desenhado, sem bloquear
G6 (autorização cross-tenant)        PASS
G7 (least privilege de índice)       PASS
G8 (falhas assíncronas recuperáveis) FAIL (sem mudança nesta sessão — requer Lambda/fila real)
G9 (infra sintetizável)              PASS
G10 (boundaries enforced automaticamente) PASS agora (ESLint no-restricted-imports adicionado e verificado, antes era só convenção) — confirmado também em CI real
G11 (contratos no CI)                PASS — confirmado em CI real
```

Confirmação: commit `6d541a0` pushado para `main`, run `32262099908` (https://github.com/marcelo-jgoncalves/expiration-tracker/actions/runs/32262099908) — job `guardrails` completo com sucesso em 45s, SBOM gerado como artefato, warning informacional do audit de dev apareceu exatamente como desenhado (não bloqueou). Dois achados novos não-críticos da run real: (1) as três Actions pinadas visam Node 20, que o runner do GitHub já força para Node 24 (deprecation warning, não erro — pins funcionam mas merecem atualização numa manutenção futura); (2) uma falha transitória de infraestrutura do GitHub ("services aren't available"/cache 400) apareceu como anotação, não relacionada ao código deste repositório.

## Fitness Functions

`docs/engineering/02-engineering-fitness-functions.md` — 9 fitness functions definidas, FF5 corrigida nesta sessão (era decorativa) e confirmada em execução real, FF9 (secret scan automatizado) ainda não implementada.

## Known Gaps

- **G2 falta só branch protection para virar PASS pleno** — o CI já executa com sucesso de verdade (confirmado em produção, run `32262099908`), mas `main` continua sem proteção nenhuma no GitHub.
- **Branch protection não foi habilitada** — decisão deliberadamente deixada para o usuário confirmar (muda o fluxo de trabalho atual de push direto). Recomendação concreta: exigir PR + pelo menos o job `guardrails` como required status check.
- **G8 (recuperação de falhas assíncronas) segue FAIL** — não é uma correção de arquivo, é trabalho de M4+ (Lambda real, DLQ real, telemetria real).
- **Vulnerabilidade de devDependency (EX-001)** não corrigida (requer upgrade major do Vitest) — prazo de revisão de 30 dias registrado.
- **Sem secret scanner automatizado no CI** (FF9) — verificação manual dirigida feita nesta sessão, sem achado real, mas não é um mecanismo contínuo.
- **Red team formal (Checkpoint 12 do Prompt Mestre) não foi executado como exercício separado** nesta sessão — os achados equivalentes (CI quebrado, gate decorativo, ausência de branch protection, commit único de 4 milestones) emergiram organicamente da avaliação evidence-first, mas uma rodada dedicada de red team (bypass de autorização, race conditions, poison messages, etc., Prompt Mestre §28) fica como trabalho futuro explícito, não fabricada como concluída.
- **Duplicação de HTTP error-mapping** (domínio A) não extraída para `shared/` — P2, não bloqueante.
- **Boundary enforcement do ESLint é parcial, não à prova de bypass** (achado do red team leve da rodada 2, ver abaixo) — cobre import direto proibido, não cobre import transitivo via um arquivo-ponte dentro do próprio `domain/`, `import()` dinâmico, ou alias de `tsconfig` fora do padrão bloqueado.
- **Gate de audit de produção confia na classificação `dependencies`/`devDependencies` do `package.json`** — uma dependência de runtime movida deliberadamente para `devDependencies` escaparia do gate bloqueante (achado do red team).
- **`enforce_admins: false` na proteção de `main`** — o dono do repo pode fazer bypass da proteção como admin; decisão consciente e proporcional ao tamanho do time, não um descuido, mas é um bypass real.
- **Fluxo `develop`→PR→`main` documentado mas não exercitado** — nenhum PR real foi aberto/mergeado ainda para provar o processo na prática (a run verde do CI foi disparada por push direto em `main`, antes da nova estratégia de branch).
- **`EX-001` depende de disciplina humana** — sem checagem automatizada, o prazo de revisão de 30 dias pode expirar silenciosamente.

## Exceptions

`docs/engineering/exceptions.md` — EX-001 (vulnerabilidade transitiva de devDependency, dev-server only, prazo de revisão 30 dias, sem expiração automatizada — ver Known Gaps).

## Engineering Scores

```text
ENGINEERING FOUNDATION STATUS: NOT APPROVED
OPERATIONAL ENGINEERING STATUS: NOT APPROVED (esperado — sem produção, sem deploy real, per Prompt Mestre §63)
```

**Rodada 1** (baseline, antes de qualquer remediação): Claude 5.88/10.00, Codex 4.84/10.00, Conservative 4.84/10.00. Ver `docs/engineering/reviews/checkpoint-02-09-consolidated/claude-evaluation-round1.md` e `_codex-output-round1.txt`.

**Rodada 2** (pós-remediação de 5 dos 7 gaps abertos: CI real, branch protection real, audit de produção bloqueante, boundary enforcement, README, correção de docs, testes de reconciliação/producer):

```text
CLAUDE ENGINEERING SCORE (rodada 2): 5.98 / 10.00
CODEX ENGINEERING SCORE (rodada 2): qualitativo apenas — "aumento material" confirmado, sem número exato
CONSERVATIVE ENGINEERING SCORE (rodada 2): não calculável numericamente para os dois lados
```

Nota de processo (`disagreement-log.md` D-003): o prompt da rodada 2 para o Codex não incluiu a tabela congelada de pesos/notas A-P (falha de preparo desta sessão, não do processo) — o Codex corretamente recusou-se a inventar um número sem ela, dando só direção qualitativa ("aumento material" vs. os 4.84 da rodada 1), reavaliação por domínio, gates, e um red team leve. O score Claude de 5.98 é autoavaliação com a rubrica completa, partindo do padrão de evidência mais rigoroso que o Codex aplicou na rodada 1 (aceito em D-001) e aplicando alta em D (CI: 0.50→7.00), N (Governance: 2.00→5.00), G (Supply Chain: 2.00→5.50), A (Code Quality: 7.00→7.50), C (Testing: 6.50→7.20), I (Reliability: 2.50→3.50 — só a parte testável melhorou, G8 segue sem prova de runtime), K (DX: 3.50→6.00), L (Documentation: 3.00→5.00); demais domínios mantidos. **Ambos os lados concordam, sem ambiguidade, no veredito qualitativo**: aumento material, mas `NOT APPROVED` continua correto porque G8 segue aberto e o score está bem abaixo de 9.0 de qualquer forma.

```text
GATES (rodada 2, após CI real + branch protection + boundary enforcement confirmados):
G1 PASS | G2 PASS (branch protection confirmada via API: required check "guardrails", sem force-push/deleção — reserva: enforce_admins=false) | G3 PASS | G4 PASS | G5 PASS | G6 PASS | G7 PASS | G8 FAIL (replay/reconciliation agora testados; observabilidade em runtime real segue ausente) | G9 PASS | G10 PASS (reserva: não cobre bypass transitivo, ver red team) | G11 PASS
```

## Red Team (rodada leve, 2026-08-19, Codex)

Não é o red team formal completo do Checkpoint 12 do Prompt Mestre (não executado como exercício isolado) — foi uma passada rápida sobre especificamente o que mudou nesta sessão, pedida junto com a rodada 2 de notas. Achados reais, não hipotéticos:

- **Bypass do boundary ESLint via import transitivo**: a regra `no-restricted-imports` avalia o specifier direto do import — um arquivo dentro de `domain/` que importe um "arquivo-ponte" também dentro de `domain/`, que por sua vez importe `application/`/`infra`, não é pego. Também não cobre `import()` dinâmico, `require()`, alias de `tsconfig.json` fora do padrão bloqueado, ou barrel files com reexportação.
- **Bypass do gate de audit de produção via reclassificação de dependência**: `npm audit --omit=dev` confia inteiramente na seção (`dependencies` vs. `devDependencies`) do `package.json` — uma dependência de runtime movida deliberadamente (ou por engano) para `devDependencies` escaparia do gate bloqueante.
- **`enforce_admins: false`** é um bypass administrativo real e consciente da proteção de `main`.
- **Confusão de provenance do required check**: um check obrigatório só pelo nome (`guardrails`) é teoricamente vulnerável se outro workflow/app pudesse publicar um contexto com o mesmo nome — não investigado a fundo nesta passada leve.

Nenhum desses é um P0 (nenhum já foi explorado, e todos exigem ação deliberada ou configuração adicional para virar um problema real) — registrados como P1/P2 em Known Gaps.

## Next Steps

1. ~~Push das correções e observar a run real do CI~~ — feito, confirmado (run 32262099908).
2. ~~Decidir sobre branch protection~~ — feito e confirmado via API.
3. ~~Rodada 2 de notas pós-remediação~~ — feito (ver acima); refazer com a tabela completa anexada ao prompt do Codex, se um número exato conservador for necessário.
4. Abrir e mergear o primeiro PR real `develop`→`main` para exercitar o processo documentado (hoje só existe no papel).
5. Fechar G8 de verdade exige runtime real (Lambda + fila + telemetria) — trabalho de M4+, não uma correção de arquivo. Decidir a prioridade relativa entre isso e feature work (M4 Notification Engine) antes de prosseguir.
6. P1s do red team, quando fizer sentido pelo tamanho do time: `dependency-cruiser`/`madge` para checar boundary transitivamente; checagem automatizada de exceções vencidas (`EX-001`); `cdk synth` real via CLI.
