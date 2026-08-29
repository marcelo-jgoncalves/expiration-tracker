# Engineering Summary — Expiration Tracker

Documento equivalente de engenharia ao `ARCHITECTURE.md`. Produzido pela Engineering Maturity Review (`docs/engineering/engineering-maturity-review-mission-brief.md`, movido da raiz em 2026-08-29), processo Claude↔Codex, iniciado e concluído (rodada 1 de avaliação + remediação de P0s de alto valor) em 2026-08-19. Baseline avaliado: commit `154d6e0`.

**Correção de auditoria (2026-08-20, eixo Engenharia de Contexto, `docs/engineering/reviews/full-audit-round1-contexto-summary.md`)**: este documento é o relatório congelado da rodada 1/2 de Engineering Maturity Review — todo o corpo abaixo (CI/CD, Reliability, Known Gaps, G8, Next Steps) descreve o estado do repositório **em 2026-08-19, antes de M3.5**. M3.5 (sessão posterior) implementou runtime Lambda real, adapters DynamoDB reais, filas SQS+DLQ e EventBridge Scheduler — os handlers `501`/"sem SQS/DLQ/EventBridge wired" citados abaixo (`CI/CD`, `Reliability`, seção `Known Gaps`, gate G8) **não refletem mais o código real**; ver `NEXT_SESSION_PROMPT.md` para o estado vigente de G8 (Camada 3/sandbox AWS ainda pendente, mas o runtime em si já existe). O corpo abaixo não foi reescrito — preservado como registro da rodada 1/2 original — mas não deve ser lido como estado de código vigente.

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

## Engineering Gates (estado atual, pós Checkpoint 12)

```text
G1 (build reproduzível)              PASS — confirmado em 4 execuções reais de CI (a mais recente: run 32282973596)
G2 (CI enforced)                     PARCIAL — CI real verde de forma consistente + branch protection real confirmada via API (required check "guardrails", sem force-push/deleção); reserva: enforce_admins=false
G3 (testes críticos)                 PASS — confirmado em CI real, 130 testes
G4 (sem secret)                      PASS
G5 (sem vuln crítica não tratada)    PASS — produção 0 vulns (confirmado de novo após reverter o upgrade do Vitest); dev com exceção formal EX-001, não "tratada" por omissão
G6 (autorização cross-tenant)        PASS
G7 (least privilege de índice)       PASS
G8 (falhas assíncronas recuperáveis) FAIL — replay/reconciliação agora testados (E-007), mas observabilidade/recuperação em runtime real segue ausente. Ver decisão pendente abaixo.
G9 (infra sintetizável)              PASS
G10 (boundaries enforced automaticamente) PASS — agora com enforcement AUTORITATIVO real (dependency-cruiser, `npm run check-boundaries`, resolve o grafo transitivo de verdade, não só texto de import), não apenas o ESLint anterior que só comparava string literal. Achado e corrigido no processo: 2 violações genuínas pré-existentes (E-008) + uma dependência acidental ports→ports entre módulos irmãos.
G11 (contratos no CI)                PASS — confirmado em CI real
```

Confirmações reais desta sessão, em ordem: run `32262099908` (CI corrigido, primeira vez verde) → run do PR #1 (`develop→main`, fluxo exercitado pela primeira vez) → run `32278097688`/`32279889556` (upgrade do Vitest quebrou CI real, revertido) → run `32281955305` (dependency-cruiser 18.x incompatível com Node 20 do `.nvmrc`, fixado em 17.4.3) → run `32282973596` (verde, estado atual). Padrão que se repetiu 3 vezes nesta sessão: uma mudança passava limpa localmente e só falhava na execução real de CI — exatamente a razão de existir o próprio processo evidence-first.

## Fitness Functions

`docs/engineering/02-engineering-fitness-functions.md` — 9 fitness functions definidas. FF5 (audit) corrigida (era decorativa) e confirmada em execução real. FF9 (secret scan automatizado) ainda não implementada. Nova: `check-boundaries` (dependency-cruiser) — boundary de arquitetura com enforcement real de grafo, wired no CI.

## Known Gaps

- **G8 (recuperação de falhas assíncronas) segue FAIL de verdade** — não é uma correção de arquivo. Red team formal (Checkpoint 12) confirmou: handlers Lambda ainda são placeholder (`501`), sem SQS/DLQ/EventBridge wired, sem adapter DynamoDB real para os ports. Fechar isso completamente exige a mesma disciplina de M0-M3 (milestone dedicado, não remediação de sessão) — **decisão de escopo pendente do usuário**, ver seção final.
- **Vulnerabilidade de devDependency (EX-001)** não corrigida — tentativa de upgrade do Vitest feita e **revertida** nesta sessão por quebrar CI real (bug upstream conhecido do npm com optional dependencies, `npm/cli#4828`). Prazo de revisão mantido, condicionado à correção do bug upstream.
- **Sem secret scanner automatizado no CI** (FF9) — verificação manual dirigida feita, sem achado real, mas não é mecanismo contínuo.
- **Duplicação de HTTP error-mapping** (domínio A) não extraída para `shared/` — P2, não bloqueante.
- **Gate de audit de produção confia na classificação `dependencies`/`devDependencies` do `package.json`** — uma dependência de runtime movida deliberadamente para `devDependencies` escaparia do gate bloqueante (achado do red team formal).
- **`enforce_admins: false` na proteção de `main`** — bypass admin consciente, proporcional ao tamanho do time.
- **Idempotência não provada no limite do efeito externo** (achado do red team formal, P1) — claim determinístico protege contra parte das duplicatas, mas não o cenário "efeito externo realizado, confirmação perdida" (clássico de sistemas at-least-once) — sem runtime real, não há como testar isso ainda.
- **Concorrência entre renew/cancel, materialização, dispatch e reconciliation** (achado do red team formal, P1) — OCC protege o agregado, sem evidência de fencing antes do efeito externo.
- **Blast radius cross-tenant do GSI3 via workers privilegiados** (achado do red team formal, P1) — IAM limita quem acessa o índice global, mas falta teste negativo no adapter real (que ainda não existe).
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

1. ~~Push das correções e observar a run real do CI~~ — feito, confirmado.
2. ~~Decidir sobre branch protection~~ — feito e confirmado via API.
3. ~~Rodada 2 de notas pós-remediação~~ — feito.
4. ~~Abrir e exercitar o fluxo `develop`→PR→`main`~~ — feito, PR #1 aberto, CI real verde nele.
5. ~~Red team formal (Checkpoint 12)~~ — feito via Codex, achado central: false-green CI (ver `docs/engineering/reviews/checkpoint-12-redteam/summary.md`).
6. ~~Boundary transitivo real (`dependency-cruiser`)~~ — feito, achou e corrigiu 2 violações genuínas pré-existentes (E-008).
7. ~~Tentativa de fechar EX-001 via upgrade do Vitest~~ — tentado, revertido por quebrar CI real (bug upstream). Não repetir sem verificar se foi corrigido.
8. **Pendente, decisão do usuário**: escopo de fechamento pleno de G8. Ver seção final.
9. P2s remanescentes, quando fizer sentido pelo tamanho do time: checagem automatizada de exceções vencidas, `cdk synth` real via CLI, atualizar pins de Actions para Node 24, extrair duplicação de HTTP error-mapping.

## Decisão pendente: escopo de G8

G8 exige, para fechar de verdade: adapters DynamoDB/SQS reais implementando os ports (`ReminderStore`, `ExpirationStore`, `IdentityStore`) contra AWS real; handlers Lambda reais substituindo os placeholders `501`; filas SQS + DLQ com redrive policy; EventBridge Scheduled Rule disparando o producer periodicamente; testes de fault injection contra esse runtime real. Isso é um milestone completo do porte de M0-M3 (pesquisa/design → implementação → teste real → revisão Claude+Codex dedicada), não uma remediação de sessão — o próprio red team formal apontou que construir isso às pressas, sem a mesma disciplina, seria "false-green" (a CI pareceria provar recuperação assíncrona sem realmente provar). Não implementado nesta sessão por essa razão, não por limitação de tempo apenas.
