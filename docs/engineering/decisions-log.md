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

## E-007 — Não injetar `SecureLogger` diretamente na lógica pura dos workers (dispatch/producer/reconciliation); fechar G8 via testes dedicados em vez disso

Motivo: `producer.ts` documenta explicitamente que "this module stays observability-agnostic" — telemetria fica para a camada de handler Lambda real, que ainda não existe (mesmo padrão de M0-M3: lógica pura testável primeiro, wiring de runtime depois). Injetar logging agora romperia esse padrão arquitetural já estabelecido e adiantaria trabalho de M4+ sem o handler real para validar o formato de evento contra CloudWatch de verdade — risco de reabstração. Decisão: em vez disso, fechar a parte de G8 que É possível fechar hoje sem infraestrutura nova — "replay/reconciliation são testados" — com testes unitários dedicados que faltavam:

- `test/unit/reminder/reconciliation.test.ts`: `reconcileExpiredClaims` (claim expirado reverte pra SCHEDULED; claim ainda válido ou ocorrência não-CLAIMED não é tocada) e `reconcileDst` (cenário real de drift: ocorrência materializada sob uma regra antiga é cancelada e substituída por uma nova ocorrência recomputada sob a regra atual — antes disso, `reconcileDst` tinha ZERO cobertura de teste em qualquer lugar do repositório, direta ou indireta).
- `test/unit/reminder/producer.test.ts`: prova que uma falha genuína de store (não uma perda de race de OCC) numa claim específica cai em `failed`, sem abortar o resto do tick nem mutar a ocorrência (fica disponível pra retry) — o caminho `failed` do producer nunca tinha sido exercitado por nenhum teste antes (só afirmado vazio no caminho feliz).

G8 permanece **não-PASS pleno** — "observável em execução real" continua exigindo o handler Lambda + fila real de M4+, isso não muda com testes. Mas a parte de "replay/reconciliation testados" da definição do gate agora tem evidência real, o que não existia antes desta sessão.

**Nota de superação (2026-08-19, full-audit round1/qualidade)**: a premissa "handler Lambda real... ainda não existe" ficou desatualizada em M3.5 — `src/runtime/aws/handlers/` tem handlers reais hoje (achado real de drift documentação↔código, `AGENTS.md` §7 já corrigido). Entrada mantida como registro histórico do raciocínio na data em que foi tomada (não editada retroativamente); a decisão de fundo (workers puros continuam observability-agnostic, logging fica no handler) continua válida e não foi revertida.

## E-008 — Boundary transitivo real via `dependency-cruiser`, não só ESLint; achado real de código corrigido no processo

Motivo: o red team formal (Checkpoint 12) apontou que a regra `no-restricted-imports` do ESLint (E-004) só compara o texto literal do specifier do import, não o grafo real — não pega reexport transitivo, `import()` dinâmico, nem (descoberta ao testar de verdade) imports relativos dentro do MESMO módulo, porque a string `"../ports/foo.js"` nunca contém a substring `modules/*/ports` que os padrões glob esperam. Adicionado `dependency-cruiser` (`npm run check-boundaries`, wired no CI) como enforcement AUTORITATIVO — resolve o grafo de módulos de verdade. ESLint mantido só como feedback rápido no editor, comentário do arquivo agora deixa isso explícito.

Ao testar a nova ferramenta contra o código real (não só contra um caso sintético), ela encontrou **2 violações genuínas já existentes**: `src/modules/expiration/domain/expiration-item.ts` e `audit-event.ts` importavam `EntityKey`/`TransactPutEntry` de `../ports/expiration-store.ts` (domain→ports, boundary real) em vez do `shared/dynamodb/occ.ts` já usado corretamente pelo módulo `reminder` para o mesmo tipo — `expiration-store.ts` tinha uma cópia própria e estruturalmente duplicada de `EntityKey`/`TransactPutEntry`/`TransactUpdateEntry`/`TransactWriteEntry`/`isTransactionCanceled`. Também descoberto no processo: `reminder/ports/reminder-store.ts` reexportava esses mesmos tipos de `expiration/ports/expiration-store.ts` — uma dependência acidental ports→ports entre módulos irmãos. Corrigido na origem: os tipos/função agora vivem só em `shared/dynamodb/occ.ts`; `expiration-store.ts` e `reminder-store.ts` importam de lá diretamente; `dependency-cruiser` confirma zero violações após a correção (rodado contra o código real, não um exemplo isolado).

## E-009 — Full-audit round1, eixo Qualidade de Engenharia: achados reais corrigidos

Protocolo `AGENTS.md` §4 executado contra `docs/engineering/joint-review-criteria.md` ("Eixo: Qualidade de engenharia"). Ver `docs/engineering/reviews/full-audit-round1-qualidade-summary.md` para o registro completo (notas por critério, ambos os lados, achados restantes). Achados reais corrigidos nesta sessão:

1. **Bug real de bundle em `schema-validator.ts`** (mesma classe do bug já corrigido no Redactor, E-anterior/commit `494f4e5`): `defaultSchemaRegistry` usava `import.meta.url`+`readdirSync` em runtime, que resolve vazio sob o bundle esbuild-cjs (`infra/lib/scoped-lambda-function.ts`) — ficou dormant até esta sessão porque nenhum handler real importava `defaultSchemaRegistry`. Corrigido em duas etapas: primeiro `SchemaRegistry` ganhou um construtor explícito (`new SchemaRegistry(schemas)`) alimentado por imports estáticos para `defaultSchemaRegistry`; o warning cosmético do esbuild persistia porque o disk-walk (`import.meta.url`) ainda vivia no mesmo módulo/arquivo bundlado. Segunda correção (mesma sessão, round subsequente): o disk-walk (`repoRoot`/`schemasDir`/`walkJsonFiles`) foi extraído para `src/shared/contracts/schema-registry-disk.ts` (`loadAllSchemasFromDisk`), usado só por `scripts/validate-schemas.ts` e `test/contract/schemas.test.ts` (ESM real, nunca bundle). `schema-validator.ts` não referencia mais `import.meta.url`; o construtor de `SchemaRegistry` agora sempre exige a lista explícita de schemas.
2. **`reminder-dispatch-handler.ts` fazia cast não validado de `JSON.parse(record.body)`** apesar de já existir um schema (`schemas/queues/reminder-dispatch.v1.json`) nunca usado por nenhum handler real. Corrigido para validar via `defaultSchemaRegistry` antes do cast, tratando payload schema-inválido como poison message (não retryable).
3. **`as never` inseguro em `dispatch.ts`**: `TransactWriteEntry` (occ.ts) e `DynamoTransactPutEntry` (outbox.ts) eram tipos estruturalmente idênticos, declarados duas vezes (mesmo padrão do achado E-008) — `appendToTransaction` exigia o tipo mais estreito, forçando o cast. Corrigido: `outbox.ts` reusa `TransactPutEntry`/`TransactWriteEntry` de `occ.ts`; `appendToTransaction` aceita `TransactWriteEntry[]` (Put|Update), cast removido.
4. **CDK usava `lambda.Runtime.NODEJS_20_X`** (8 ocorrências, `infra/lib/expiration-tracker-stack.ts`) — CDK synth já emitia warning real de deprecação (`nodejs20.x` deprecado em 2026-04-30). Atualizado para `NODEJS_24_X`.
5. **CI só disparava em push para `main`**, nunca `develop` (branch de trabalho ativo per `AGENTS.md` §3) — `.github/workflows/ci.yml` agora dispara em `[main, develop]`.
6. **Drift real doc↔código em `AGENTS.md` §7**: afirmava "nenhum worker tem runtime Lambda real ainda", mas `src/runtime/aws/handlers/` já tinha 8 handlers reais desde M3.5. Corrigido (ver também nota de superação em E-007 acima).
7. **README.md** omitia `check-boundaries`/`test:dynamodb` e afirmava incorretamente que lint sozinho cobre enforcement de boundary (na verdade `dependency-cruiser` é o autoritativo, per E-008). Corrigido.
8. **`exceptions.md` EX-001** tinha owner "a definir formalmente" sem nunca ser definido — formalizado como Marcelo (projeto solo).

Achados adicionais corrigidos numa rodada seguinte (Codex round2, nota 7,788/10, revisão estática sem execução dos gates por sandbox read-only):

9. **Disk-walk residual em `schema-validator.ts`**: mesmo após o item 1, o branch dinâmico (`repoRoot`/`schemasDir`/`walkJsonFiles`, ainda com `import.meta.url`) continuava no mesmo arquivo que `defaultSchemaRegistry`, então esbuild ainda bundlava (e avisava sobre) código morto em runtime. Extraído para `src/shared/contracts/schema-registry-disk.ts`, usado só por `scripts/validate-schemas.ts`/`test/contract/schemas.test.ts`; `schema-validator.ts` não referencia mais `import.meta.url`.
10. **Casts `as TransactPutEntry[]` obsoletos em `expiration-service.ts`** (3 ocorrências: `updateItem`, `renewItem`, `appendAudit`): ficaram redundantes desde que `appendToTransaction`/o item 3 acima passou a aceitar `TransactWriteEntry[]` — `entries` já era `TransactWriteEntry[]`. `appendAuditToTransaction` (`domain/audit-event.ts`) também foi alargado de `TransactPutEntry[]` para `TransactWriteEntry[]` pelo mesmo motivo (mesma convenção de `outbox.ts`). Todos os 3 casts removidos; import não utilizado de `TransactPutEntry` removido.
11. **`README.md` linha 47** ainda afirmava boundary "enforced por ESLint (`no-restricted-imports`)" — desatualizado desde E-008 (`dependency-cruiser` é o enforcement autoritativo real, ESLint só feedback rápido de editor). Corrigido.

Todas verificadas com `npm run typecheck`, `npm run lint`, `npm run check-boundaries`, `npm test` (152/152) antes de cada commit.

## E-010 — `test-engineering-standard.md` APPROVED, protocolo Claude↔Codex 8 rodadas, gate elevado a 9,5/10

Novo documento normativo (`docs/engineering/test-engineering-standard.md`) formalizando, pela primeira vez neste projeto, gates binários de validade (determinismo/reprodutibilidade de veredito, isolamento de dado, asserção não-tautológica, intenção declarada — G-V1 a G-V4; adequação claim→evidência — G-C1; blast radius declarado e reversão tentada, específicos de drill operacional — G-V5/G-V6) e critérios ponderados de qualidade (0-10, com fórmula de agregação explícita por unidade de avaliação — teste individual, claim individual, suíte/componente, relatório) para tudo que este projeto trata como "teste" — automatizado ou drill operacional real (chaos/DiRT). Motivado pela Wave 2 do Pilot Readiness Program (2026-08-28, 6 drills reais contra `dev`, ver `pilot-readiness-program.md`), executada sem uma régua pré-registrada do que tornaria essa evidência válida.

Gate de aceitação elevado a **9,5/10** (acima do padrão de 9,0 deste projeto para protocolo `AGENTS.md` §4) por pedido explícito do Marcelo. Levou **8 rodadas** — a mais longa execução deste protocolo neste projeto até agora (a segunda mais longa, o Visual Language/Design System, levou 16 rodadas mas contra o gate padrão 9,0) — com trajetória de convergência real e monotônica do lado Codex: 6.35 → 7.85 → 8.70 → 9.18 → 9.34 → 9.46 → 9.48 → **9.62** (aprovado). Nota final Claude 9.9/10. Cada rodada corrigiu causas-raiz específicas nomeadas pela rodada anterior (nunca reformulação cosmética): rodada 1 achou defeito de arquitetura conceitual (gates binários que na verdade exigiam julgamento, contradição com a própria fonte citada, "929 arquivos" quando eram 929 casos de teste); rodadas 2-3 acharam inconsistências introduzidas pela própria reestruturação corretiva (referência órfã a gate renomeado, auditoria retroativa concedendo gate prospectivo sem evidência de pré-registro); rodadas 4-7 fecharam lacunas cada vez mais estreitas na fórmula de agregação/regra de nota 10/citação de fontes, terminando em achados de escopo muito pequeno (marcador de rodada desatualizado, lista fechada que esqueceu um critério).

Achado colateral corrigido no mesmo commit: drift real entre `pilot-readiness-program.md`/`pilot-readiness-assessment.md` e a evidência real da Wave 2 — a tabela-resumo e o addendum diziam "replay não duplica side effects"/"medir RPO/RTO"/"fechou por completo" de forma mais ampla do que os 6 drills realmente provaram (achado da Rodada 3/5 do próprio protocolo, corrigido nos dois arquivos).

Evidência completa (notas cegas Claude/Codex de todas as 8 rodadas, prompts, saída bruta): `docs/engineering/reviews/test-engineering-standard/`.
