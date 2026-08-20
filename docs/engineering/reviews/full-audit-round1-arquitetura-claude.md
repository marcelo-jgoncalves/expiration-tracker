---
status: draft
owner: claude
authority: informational
---

# Auditoria de Arquitetura — Rodada 1 (Claude, blind, independente de Codex)

Revisão baseada em leitura direta do código real em `src/`, `infra/`, `test/`, `schemas/`, `.github/workflows/`, `package.json` e `cdk.out/`. Critérios e pesos: `docs/engineering/joint-review-criteria.md` linhas 19-35. Contexto de design (não usado para pontuar): `docs/architecture/implementation-blueprint.md`, `docs/architecture/m3.5-runtime-design.md`.

**Achado central que atravessa vários critérios**: rodar `npx cdk synth` (via `test/infra/stack.test.ts`) produz, para toda função Lambda bundlada, o warning do esbuild:

```
▲ [WARNING] "import.meta" is not available with the "cjs" output format and will be empty [empty-import-meta]
    src/shared/observability/redactor.ts:29:42
```

`infra/lib/scoped-lambda-function.ts:39-54` (`bundleEntry`) empacota cada handler com `format: "cjs"`. `src/shared/observability/redactor.ts:27-31` (`resolveSchemaPath`) usa `fileURLToPath(import.meta.url)` para localizar `schemas/sensitive-fields.json`. Sob `cjs`, `import.meta.url` fica vazio — `fileURLToPath("")` lança `TypeError [ERR_INVALID_URL]`. `redactor.ts:140` executa `export const defaultRedactor = new Redactor()` — logo, **no top level do módulo**, no import, não sob demanda. `src/shared/observability/logger.ts:11,44` usa `defaultRedactor` como default de todo `SecureLogger`, e todo handler real (`src/runtime/aws/handlers/*.ts`) instancia um `SecureLogger` no top level do módulo (ex. `reminder-producer-handler.ts:18`). `src/modules/expiration/domain/audit-event.ts:9,73` importa `defaultRedactor` diretamente também. Como nenhum handler passa um `redactor` customizado, **toda Lambda real do sistema, ao ser invocada em AWS de verdade, provavelmente falha no cold start** com uma exceção de inicialização de módulo — nenhum request chega a ser processado. Isso nunca foi pego porque (a) os testes unitários/integração rodam via `vitest`/`tsx` em ESM real, nunca através do bundle CJS produzido por `bundleEntry`; (b) nenhum teste de infra invoca o artefato bundlado (`test/infra/stack.test.ts:137-151` só verifica que existe um S3 asset, nunca o executa); (c) nenhum deploy real em sandbox AWS jamais rodou (ver Critério 8) — a Camada 3 descrita em `m3.5-runtime-design.md` §"Testes em 3 camadas" (deploy efêmero, IAM negativo real) nunca foi executada, que é exatamente o gate que teria pego isto.

---

## 1. Domain Fit & Simplicity — peso 8%

**Nota: 8.0**

- Separação em módulos (`identity`, `expiration`, `reminder`) com `application/domain/ports/persistence/http` consistente em todos os três — `src/modules/reminder/{application,domain,ports,persistence,http}` espelha `src/modules/expiration/*` e `src/modules/identity/*`.
- `tenantId` nunca aceito do payload — `src/modules/identity/domain/authorization.ts` e o teste `test/integration/cross-tenant.test.ts:60-70` provam que o contexto de autorização vem só de `ctx.tenant.tenantId`, nunca do DTO.
- Escopo Stage 0-2 (só Reminder Engine, sem Notification/Document/AI) mantido honesto no código — não há pastas `notification/`/`document/` fantasma em `src/modules`, ao contrário do blueprint que as lista para o futuro (`implementation-blueprint.md` linhas 71-81 vs. listagem real de `src/modules`).
- `dependency-cruiser` (`.dependency-cruiser.cjs`, rodado em CI via `check-boundaries`) fecha o gap que o comentário em `src/shared/dynamodb/occ.ts:115-124` documenta: ESLint sozinho não pega import transitivo cross-módulo; a correção foi real e datada (2026-08-19).

Não pontua mais alto porque o domínio ainda é muito estreito (só o motor de lembretes está implementado ponta a ponta) — simplicidade aqui reflete escopo pequeno, não necessariamente uma prova de que o modelo aguenta a complexidade completa do produto (Notification/Document ainda não existem para testar o fit real).

## 2. Reliability & Fault Recovery — peso 16%

**Nota: 3.6**

- Design de recuperação de falha é sofisticado e testado em memória: claim atômico + outbox na mesma `TransactWriteItems` (`src/workers/reminder-producer/producer.ts`), relay via DynamoDB Streams com lease condicional (`src/workers/dispatch-outbox-relay/relay.ts`, `src/runtime/aws/handlers/dispatch-outbox-relay-handler.ts:29-40`), sweeper de recuperação (`src/runtime/aws/handlers/outbox-sweeper-handler.ts`), DLQ com `maxReceiveCount=5` e alarme de idade (`infra/lib/reminder-queue.ts:41`, verificado em `test/infra/stack.test.ts:153-160`).
- **Mas** o bug de `import.meta`/CJS descrito acima (`infra/lib/scoped-lambda-function.ts:41-49`, `src/shared/observability/redactor.ts:27-31,140`) muito provavelmente derruba TODO handler real no cold start em produção — nenhum dos mecanismos de recuperação acima (claim, relay, sweeper, DLQ) tem a chance de rodar se a própria função não inicializa. Isso não é uma hipótese teórica: é o próprio esbuild avisando, reproduzido ao rodar `npx cdk synth`/`npm test` neste repositório.
- Nenhum deploy real em AWS jamais confirmou ou refutou isso (ver Critério 8) — a "Camada 3" do design (`m3.5-runtime-design.md` linha 55) que existe precisamente para pegar esse tipo de falha nunca rodou.
- Sem região secundária/DR (`implementation-blueprint.md:5` já declara "sem DR cross-region" como escopo, então não é penalizado aqui como surpresa, mas soma ao quadro de robustez real ainda não comprovada).

Nota baixa porque a robustez de recuperação de falha, por mais bem desenhada em unit tests, está presa atrás de um defeito de bundling que provavelmente impede qualquer handler de sequer inicializar em ambiente real — o critério mais pesado do eixo (16%) é também o mais atingido por essa lacuna.

## 3. Event & Integration Correctness — peso 11%

**Nota: 7.8**

- Roteamento outbox→SQS vs. outbox→EventBridge por `destination: "SQS_REMINDER_DISPATCH_V1"` é testado nos dois sentidos: `test/unit/dispatch-outbox-relay/relay.test.ts` e `test/unit/outbox.test.ts` (builder `buildOutboxRecord`, `src/shared/outbox/outbox.ts:47-68`).
- EventBridge Scheduler não envelopa payload em `detail` como Rules legadas — bug real encontrado (comentário atribui a "Codex implementation review") e corrigido nos três handlers relevantes (`reminder-producer-handler.ts:1-6`, `reminder-reconciliation-handler.ts:6-10`), com teste de contrato dedicado em `test/infra/stack.test.ts:173-186` que verifica o `Input` sintetizado não tem `detail` e tem `scheduledTime` top-level.
- Falha parcial de batch (SQS `reportBatchItemFailures`, DynamoDB Streams idem) implementada e testada: `reminder-dispatch-handler.ts:19-35`, `dispatch-outbox-relay-handler.ts:21-44`.
- Ainda não cobre a ponta externa real (nenhum provedor de notificação/e-mail existe ainda — fora de escopo M3.5, mas significa que "integração" hoje é só interna: SQS/Streams/Scheduler, nunca um sistema de terceiros de verdade).

## 4. Data Model & Consistency — peso 13%

**Nota: 8.3**

- GSI3/GSI6 com chave global sem `tenantId`, isolamento de IAM testado positiva e negativamente em `test/infra/stack.test.ts:97-135` (nenhuma outra role referencia `/index/GSI3` ou `/index/GSI6` além das duas designadas).
- OCC consistente: `buildVersionedUpdate`/`buildVersionedCreate` (`src/shared/dynamodb/occ.ts:45-113`) com `ConditionExpression` incluindo `#tenantId = :tenantId`, testado em `test/unit/occ.test.ts`.
- Remoção atômica de ponteiros GSI6 via `REMOVE` na mesma `UpdateItem` — gap documentado explicitamente como corrigido (`occ.ts:20-28`, comentário registra que GSI3 tinha o mesmo problema e ficou órfão até agora).
- Teste de integração real contra DynamoDB Local (`test/integration-dynamodb/reminder-engine.dynamodb.test.ts`, 229 linhas) valida paridade adapter-real vs. fake em memória, incluindo `TransactWriteItems` — não é só suíte de fakes.
- Ponto fraco real: `ScopedLambdaFunction`/`scoped-lambda-function.ts:6-15` admite explicitamente que a IAM não consegue restringir por tipo de entidade (SK prefix) — todo grant `readWriteKeys` é table-level, então o isolamento por entidade documentado como metadado (`entities`) não é IAM real, é só rótulo de auditoria.

## 5. Security & Privacy — peso 13%

**Nota: 6.5**

- Suíte cross-tenant negativa robusta e específica: substituição de tenantId, DTO forjado, membership vazia, revogação de token (`globalLogoutAfter`), leitura via GSI de outro tenant seguida de tentativa de ação — `test/integration/cross-tenant.test.ts:50-158`, 9 casos.
- IAM de índice restrito por construct dedicado (`infra/lib/dynamo-table.ts:109-189`), não via helpers genéricos do CDK que vazariam `index/*` — comentário explica por que (`grantReadWriteData`/`grantReadData` do CDK sempre incluiriam todos os índices).
- Redactor central com denylist declarativa (`schemas/sensitive-fields.json`) e limites de profundidade/tamanho (`redactor.ts:92-136`), testado em `test/unit/redactor.test.ts`.
- **Mas** o próprio mecanismo de redação de logs (Critério de Reliability acima) provavelmente quebra a inicialização de toda função em produção real — o que do ponto de vista de segurança é "fail-safe" (nada roda, nada vaza) mas também significa que a garantia "dados sensíveis são redigidos antes de logs" (`implementation-blueprint.md` princípio 8) nunca foi de fato comprovada rodando em AWS.
- IAM ainda é table-level, não per-entity (mesmo gap do Critério 4) — blast radius de uma função comprometida dentro do grupo tenant-facing é maior do que a intenção documentada.

## 6. Modifiability & Evolvability — peso 7%

**Nota: 8.1**

- Ports/adapters limpos: `src/modules/reminder/ports/reminder-store.ts` + `src/modules/reminder/persistence/dynamodb-reminder-store.ts` — lógica de domínio (`reminder-materializer.ts`, `reminder-policy-service.ts`) nunca importa o SDK da AWS diretamente.
- Nenhuma classe universal de adapter cobrindo todos os ports (comentário em `m3.5-runtime-design.md` linha 48 documentado e cumprido: `DynamoDbReminderStore`, `DynamoDbReminderProducerStore`, `DynamoDbReconciliationCandidateSource` são classes separadas mesmo compartilhando a tabela).
- `ScopedLambdaFunction` é o único ponto de criação de Lambda (`scoped-lambda-function.ts:173-177`, comentário normativo), reduzindo o custo de adicionar uma nova função.
- `check-boundaries` (dependency-cruiser) no CI garante que a fronteira entre módulos não se degrade silenciosamente ao longo do tempo.

## 7. Observability & Operability — peso 8%

**Nota: 4.8**

- `SecureLogger` estruturado (JSON, `timestamp`/`level`/`event`) usado em todo handler real (`reminder-producer-handler.ts:33-38`, `reminder-dispatch-handler.ts:25,30`, etc.) — mas ver o achado central: seu redactor default provavelmente quebra a inicialização em produção.
- `lambda.Tracing.ACTIVE` habilitado por padrão em `scoped-lambda-function.ts:207` (X-Ray), porém nunca validado contra uma execução real — nenhum trace foi de fato inspecionado.
- Só **um** `CloudWatch::Alarm` existe em toda a stack — `infra/lib/reminder-queue.ts:41` (idade da DLQ) — confirmado por `test/infra/stack.test.ts:159` (`resourceCountIs("AWS::CloudWatch::Alarm", 1)`). Não há alarme de erro de Lambda, de duração de reconciliação, de outbox pendente (mencionado como necessário em `m3.5-runtime-design.md` linha 15 — "alarme de outbox pendente há mais de N execuções do sweeper" — não implementado em `infra/`).
- Nenhum `shared/observability/metrics.ts` existe (comentário em `logger.ts:8-9` referencia esse módulo futuro para EMF, mas `ls src/shared/observability/` só lista `logger.ts` e `redactor.ts`) — não há métricas custom/EMF wired em lugar nenhum.
- Nenhum dashboard CloudWatch definido em `infra/lib/*.ts`.

## 8. Testability & Delivery Safety — peso 8%

**Nota: 5.4**

- 150 testes passam (`npm test`, 22 arquivos, confirmado localmente: "Test Files 22 passed (22)", "Tests 150 passed (150)"), com camadas unit/contract/integração em memória + integração real contra DynamoDB Local (`vitest.dynamodb.config.ts`, `test/integration-dynamodb/`).
- CI real com gates (`​.github/workflows/ci.yml`): typecheck, lint, `check-boundaries`, testes, `npm audit`, SBOM — não é só descrição em doc, é pipeline executável.
- `test/infra/stack.test.ts:137-151` prova que nenhum handler ficou com placeholder `501` inline — mas, como já registrado, **não executa o bundle**, então não pegou o bug de `import.meta`/CJS.
- **Nenhum deploy real jamais rodou.** `.github/workflows/deploy-dev.yml:6-18` documenta explicitamente 4 pré-requisitos manuais (OIDC provider, IAM role, `cdk bootstrap`, variável de repositório) como "SETUP REQUIRED... not done by this file alone" — é auto-declarado como nunca configurado. Só existe `on: workflow_dispatch`, nunca disparado por push/PR. `cdk.out/` no repo contém apenas artefatos de `cdk synth` local (templates, assets, `manifest.json`), não há log de `cdk deploy`, nem `cdk.context.json` com lookups de conta real, nem evidência de execução em `docs/architecture/m3.5-runtime-design.md`'s "Camada 3" (sandbox AWS efêmero) apesar de ser gate obrigatório no próprio design.
- Resultado prático: a suíte de testes é extensa e genuinamente executa lógica real contra DynamoDB Local, mas o critério mais caro do design ("Camada 3... LocalStack não prova IAM real... deploy em conta/região de teste") nunca ocorreu, e o único defeito que essa camada existiria para pegar (bundle CJS quebrado) está presente agora.

## 9. Cost & Resource Governance — peso 5%

**Nota: 7.6**

- DynamoDB on-demand (`PAY_PER_REQUEST`, `dynamo-table.ts:41`, decisão D-014 referenciada).
- Reserved concurrency deliberada por função (`reminder-producer: 2`, `dispatch: 10`, `reconciliation: 1`, `relay/sweeper: 2` — `expiration-tracker-stack.ts:88,99,131,145,165`), evitando custo de concorrência descontrolada.
- `docs/architecture/cost-model.md` existe e é referenciado, mas não há evidência de custo real medido (sem deploy, não há fatura AWS real para validar o modelo).
- Ausência de mecanismo de HTTP fetch genérico (princípio 11 do blueprint) mantido — não há client de egress arbitrário em `src/shared/`.

## 10. Performance & Scalability Fitness — peso 4%

**Nota: 5.8**

- `capacity-model.md` com números de pico (16.667/3.333/278 agendamentos/s) citado no blueprint como critério de aceite, mas nenhum teste de carga real existe em `test/` (nenhum arquivo `*load*`/`*perf*`/k6/artillery encontrado).
- Paginação limitada por página lógica com `MAX_PAGES = 25` no reconciliador (`reminder-reconciliation-handler.ts:37`) é uma salvaguarda correta de runaway, mas não há prova empírica de throughput sob o pico modelado.
- Concurrency reservada (Critério 9) é uma boa prática de defesa, mas números (2/10/1/2) nunca foram validados contra os cenários de pico documentados.

## 11. Architecture Governance & Traceability — peso 7%

**Nota: 8.7**

- ADRs completos e numerados (`docs/architecture/adr/ADR-0001` a `ADR-0008`), decisions-log, session-log, fitness-function.md — trilha de decisão densa e datada.
- Comentários no código citam consistentemente a origem da decisão (ex. `reminder-producer-handler.ts:1-6` cita o bug real encontrado por revisão cruzada, `dynamo-table.ts:1-20` cita `data-model.md §3`).
- `m3.5-runtime-design.md` documenta explicitamente o que o milestone NÃO fecha (linhas 61-69) — governança honesta sobre escopo residual, não apenas sobre o que foi entregue.
- Ponto fraco: a trilha de decisão é forte para o *design*, mas não captura formalmente (como ADR/decisions-log) o próprio achado do bug de `import.meta`/CJS revelado nesta auditoria — o gap entre "documento diz Camada 3 é gate obrigatório" e "Camada 3 nunca rodou" não tem um registro de exceção formal em `docs/engineering/exceptions.md` (arquivo existe mas não cobre isso).

---

## Tabela de pontuação

| # | Critério | Peso | Nota | Contribuição |
|---:|---|---:|---:|---:|
| 1 | Domain Fit & Simplicity | 8% | 8.0 | 0.640 |
| 2 | Reliability & Fault Recovery | 16% | 3.6 | 0.576 |
| 3 | Event & Integration Correctness | 11% | 7.8 | 0.858 |
| 4 | Data Model & Consistency | 13% | 8.3 | 1.079 |
| 5 | Security & Privacy | 13% | 6.5 | 0.845 |
| 6 | Modifiability & Evolvability | 7% | 8.1 | 0.567 |
| 7 | Observability & Operability | 8% | 4.8 | 0.384 |
| 8 | Testability & Delivery Safety | 8% | 5.4 | 0.432 |
| 9 | Cost & Resource Governance | 5% | 7.6 | 0.380 |
| 10 | Performance & Scalability Fitness | 4% | 5.8 | 0.232 |
| 11 | Architecture Governance & Traceability | 7% | 8.7 | 0.609 |

**Nota final ponderada: 6.602 / 10**

---

## Critérios abaixo de 9.0

Todos os 11 critérios ficaram abaixo de 9.0. Motivos concretos:

1. **Domain Fit & Simplicity (8.0)** — escopo real ainda cobre só o Reminder Engine; simplicidade não testada contra a complexidade completa do produto (Notification/Document não existem).
2. **Reliability & Fault Recovery (3.6)** — bug real de bundling (`import.meta.url` vazio sob `esbuild --format=cjs`, `scoped-lambda-function.ts:41-49` + `redactor.ts:27-31,140`) provavelmente derruba toda Lambda no cold start; mecanismos de recuperação bem desenhados nunca tiveram chance de rodar em produção.
3. **Event & Integration Correctness (7.8)** — integração hoje é só interna (SQS/Streams/Scheduler); nenhuma integração com sistema de terceiros real ainda existe para testar.
4. **Data Model & Consistency (8.3)** — IAM de tabela ainda é table-level, não per-entidade, apesar da metadata `entities` sugerir granularidade que não existe de fato.
5. **Security & Privacy (6.5)** — a promessa central de redação de logs nunca foi comprovada rodando de verdade (mesmo bug do Critério 2); IAM table-level amplia blast radius além do documentado.
6. **Modifiability & Evolvability (8.1)** — boa separação, mas ainda pouco exercitada: só 3 módulos de negócio existem, nenhuma evolução real de schema (expand/contract) foi testada em produção.
7. **Observability & Operability (4.8)** — só 1 alarme CloudWatch em toda a stack; `metrics.ts`/EMF nunca implementado apesar de referenciado em comentário; nenhum dashboard; tracing X-Ray habilitado mas nunca validado.
8. **Testability & Delivery Safety (5.4)** — suíte de 150 testes é real e passa, mas nenhum deploy jamais ocorreu (`deploy-dev.yml` auto-declarado "setup not done"), e nenhum teste executa o artefato bundlado — exatamente o gap que deixou passar o bug do Critério 2.
9. **Cost & Resource Governance (7.6)** — modelo de custo é só teórico, nunca validado contra fatura real (sem deploy).
10. **Performance & Scalability Fitness (5.8)** — nenhum teste de carga real; números de capacidade nunca validados empiricamente.
11. **Architecture Governance & Traceability (8.7)** — trilha de decisão forte, mas não captura formalmente o gap "Camada 3 nunca rodou" como exceção registrada.
