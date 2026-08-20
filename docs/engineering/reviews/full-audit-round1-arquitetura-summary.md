---
status: closed-round1-cycle
owner: engineering
authority: audit-record (referencia docs/engineering/joint-review-criteria.md; nao redefine pesos)
---

# Full-audit round1 — Eixo Arquitetura — Resumo consolidado

Execução do protocolo `AGENTS.md` §4 contra `docs/engineering/joint-review-criteria.md` ("Eixo: Arquitetura", 11 critérios) — primeira execução formal do processo de nota cega Claude↔Codex + correção pontual sobre este eixo, per `NEXT_SESSION_PROMPT.md`.

3 rodadas reais executadas (nota cega → achado → correção pontual → nova nota cega, repetido 2x). Nenhum lado chegou a 9.0 em todos os 11 critérios; a rodada 3 fecha o ciclo porque os dois lados concordam (Claude e Codex, independentemente) que os achados remanescentes são impedimento externo real (Camada 3 / decisão CDK vs Terraform pendente) ou trabalho de escopo maior que "achado pontual" (novo construto AppConfig, design de EMF/dashboard, ADR de IaC) — não uma correção de uma sessão a mais forçável sem virar teatro.

## Notas ponderadas finais por rodada

| Rodada | Claude | Codex |
|---:|---:|---:|
| 1 | 7.635 | 8.578 |
| 2 | 7.931 | 8.718 |
| 3 (final) | 7.966 | 8.743 |

Nenhuma nota foi arredondada. Ambos os lados permanecem abaixo do gate de 9.0 — o eixo **não fecha** por este critério do protocolo; ver seção "Critérios abaixo de 9.0" abaixo para o que é impedimento real vs. pendência de escopo.

## Nota final por critério (rodada 3, ambos os lados)

| # | Critério | Peso | Claude R3 | Codex R3 |
|---:|---|---:|---:|---:|
| 1 | Domain Fit & Simplicity | 8% | 8.5 | 9.1 |
| 2 | Reliability & Fault Recovery | 16% | 7.2 | 8.5 |
| 3 | Event & Integration Correctness | 11% | 8.0 | 8.8 |
| 4 | Data Model & Consistency | 13% | 8.3 | 9.4 |
| 5 | Security & Privacy | 13% | 7.5 | 8.4 |
| 6 | Modifiability & Evolvability | 7% | 8.5 | 9.1 |
| 7 | Observability & Operability | 8% | 7.5 | 8.2 |
| 8 | Testability & Delivery Safety | 8% | 8.0 | 8.6 |
| 9 | Cost & Resource Governance | 5% | 8.7 | 8.8 |
| 10 | Performance & Scalability Fitness | 4% | 7.5 | 8.4 |
| 11 | Architecture Governance & Traceability | 7% | 9.0 | 8.8 |

Divergência sistemática: Codex pontua consistentemente ~0.5-1.3 acima do Claude em quase todo critério (exceção: Governance, onde Claude ficou mais alto). Nenhuma divergência isolada abaixo de 9.0 justificou rodada extra de desacordo per `AGENTS.md` §4 porque ambos os lados já concordam nos achados de fundo (nenhum lado alega que o outro está "errado" sobre um fato concreto — a diferença é calibração de severidade, não achado divergente).

## Achados corrigidos nesta sessão (com commit real)

1. **Data Model & Consistency — ponteiro órfão de GSI3**: `cancelStaleOccurrences` (`src/modules/reminder/application/reminder-materializer.ts`) só removia `GSI6PK`/`GSI6SK` ao cancelar uma ocorrência stale, deixando `GSI3PK`/`GSI3SK` (o índice com a exceção deliberada de particionamento cross-tenant) com ponteiro órfão permanente. Corrigido para remover os quatro atributos. Teste novo em `test/unit/reminder/reminder-materializer.test.ts`. **Commit `494f4e5`.**

2. **Observability & Operability — ausência de alarmes além da DLQ**: novo construct `infra/lib/reminder-observability.ts` com 5 alarmes de erro (ReminderProducer, ReminderDispatch, ReminderReconciliation, DispatchOutboxRelay, OutboxSweeperReminderDispatch) + 1 alarme de backlog-age da fila principal de dispatch. Antes só existia o alarme de idade da DLQ (`infra/lib/reminder-queue.ts`). Testes novos em `test/infra/stack.test.ts`. **Commit `494f4e5`.**

3. **Bug real de bundle no Redactor** (achado durante a leitura de código desta auditoria, não um achado de nota per se, mas corrigido no mesmo commit): `schemas/sensitive-fields.json` era lido via `fs.readFileSync`+`import.meta.url` em runtime — falha em cold start real de Lambda sob o bundle esbuild-cjs (`import.meta.url` vazio nesse formato) e o arquivo nunca era copiado para o bundle. Corrigido para import estático (`src/shared/observability/redactor.ts`), embutindo o JSON no bundle via esbuild. **Commit `494f4e5`.**

4. **Cost & Resource Governance — ausência de qualquer alarme/orçamento de custo**: novo construct `infra/lib/cost-budget.ts` (`AWS::Budgets::Budget`, teto mensal configurável, notificação opcional por e-mail a 80% forecast / 100% actual). Sintetizável e testável via CDK assertions sem deploy real. Teste novo em `test/infra/stack.test.ts`. **Commit `0262d96`.**

Todas as correções foram verificadas com `npm run typecheck`, `npm test` (152/152 passando na versão final), `npm run lint` e `npm run check-boundaries` — todos verdes antes de cada commit.

## Critérios abaixo de 9.0 — classificação final

### A. Impedimento externo real (não corrigível nesta sessão sem deploy AWS ou decisão de produto pendente)

- **Reliability & Fault Recovery (7.2 / 8.5)**: nenhuma prova de recuperação real (redrive de DLQ, retry, partial batch failure, Streams→relay→SQS sob falha real) — Camada 3 (sandbox AWS) nunca executada. **Destrava**: deploy real (bloqueado pela decisão pendente CDK vs Terraform, ver `NEXT_SESSION_PROMPT.md`) + suíte de fault injection contra ele.
- **Event & Integration Correctness (8.0 / 8.8)**: semântica real de EventBridge Scheduler (`<aws.scheduler.scheduled-time>`), DynamoDB Streams e SQS nunca provada contra AWS real, só sintetizada/local. **Destrava**: mesmo impedimento acima.
- **Security & Privacy, parcialmente (7.5 / 8.4)**: teste negativo de IAM real (`AccessDenied` de fato para role tenant-facing em GSI3/GSI6) depende de deploy real. **Destrava**: mesmo impedimento acima.
- **Performance & Scalability Fitness (7.5 / 8.4)**: nenhum teste de carga real; modelo de capacidade é teórico. **Destrava**: mesmo impedimento acima (Camada 3) + tráfego real ou teste de carga sintético contra ambiente real.
- **Testability & Delivery Safety, parcialmente (8.0 / 8.6)**: pipeline de deploy coerente com decisão de IaC ainda não existe; Camada 3 não executada. **Destrava**: decisão explícita de Marcelo sobre CDK vs Terraform vs coexistência (`NEXT_SESSION_PROMPT.md:13-21`), formalmente pendente desde o fim da sessão anterior.
- **Architecture Governance & Traceability, parcialmente (9.0 / 8.8)**: drift documentado entre infraestrutura executável (CDK) e a direção decidida (pipeline+Terraform) enquanto o escopo dessa migração não é decidido. **Destrava**: mesma decisão acima, formalizada como ADR.

### B. Escopo maior que "achado pontual" — não impedimento externo, não corrigido nesta sessão por decisão de foco

- **Security & Privacy, parcialmente (mesmos números acima)**: `appConfigAccessFor` com `resources: ["*"]` (`infra/lib/scoped-lambda-function.ts:130-146`) só pode ser escopado de verdade quando existir um construto `AppConfig::Application/ConfigurationProfile` real — hoje nenhum existe no repositório. Corrigir de verdade é criar esse construto do zero, escopo do milestone Notification/kill-switch (ainda não iniciado), não um ajuste de uma linha desta auditoria.
- **Observability & Operability (7.5 / 8.2)**: `shared/observability/metrics.ts` (EMF real), dashboard e roteamento de notificação dos alarmes (SNS/e-mail) não foram implementados — são um desenho operacional novo (formato de métrica, cardinalidade por tenant, ownership de alerta), maior que os alarmes sintéticos já adicionados.
- **Cost & Resource Governance (8.7 / 8.8)**: o `CostBudget` fecha o achado concreto (nenhum orçamento existia), mas por padrão não tem destinatário de notificação configurado, e faltam tags de alocação de custo — pendências reconhecidas no próprio código (`infra/lib/cost-budget.ts:20-23`), não escondidas.
- **Domain Fit & Simplicity / Modifiability & Evolvability (8.5/9.1)**: nenhum achado concreto de bug — só ausência de um ADR formal explicando a indireção `workers/` → `runtime/aws/handlers` → `runtime/aws/composition`. Documentação, não código quebrado.

### Divergência de calibração (não achado, registrada por transparência)

Codex pontuou sistematicamente mais alto que Claude nas 3 rodadas (~0.5-1.3 por critério, gap final ~0.78 no ponderado). Nenhum dos dois lados contestou um fato concreto do outro — não houve necessidade de rodada de desacordo formal per `AGENTS.md` §4 (esse mecanismo é para quando as partes divergem sobre o que é verdade, não sobre severidade). Registrado aqui para calibração futura de peso/rigor entre os dois avaliadores neste eixo.

## Por que o ciclo fecha aqui (3 rodadas, não 4)

Na rodada 3, ambos os lados (Claude nesta própria nota, Codex explicitamente perguntado e respondendo "sim" critério a critério) concordam que os achados remanescentes não são forçáveis nesta sessão sem: (a) a decisão de produto/infra pendente de Marcelo (CDK vs Terraform), ou (b) trabalho de escopo de design novo (não ajuste pontual). Forçar uma rodada 4 sem uma dessas duas coisas mudar produziria apenas retrabalho cosmético, não achado real corrigido — o que o próprio protocolo (`NEXT_SESSION_PROMPT.md`: "não é para celebrar como descoberta interessante e deixar aberto") pede para não fazer, mas também não pede para simular achados que não existem.

## Commits reais desta sessão

- `494f4e5` — fix(arquitetura): round1 findings - GSI3 orphan pointer, async pipeline alarms, redactor bundle bug
- `0262d96` — fix(arquitetura): round2 - add AWS Budgets monthly cost alarm

## Próxima ação recomendada (fora do escopo desta sessão)

1. Decisão explícita de Marcelo sobre rota de deploy (CDK vs Terraform vs coexistência) — bloqueia Camada 3 e, por consequência, os 5 critérios da categoria A.
2. Quando destravado: executar Camada 3 (sandbox AWS efêmero) e reavaliar os critérios da categoria A com evidência operacional real — provavelmente sobe o eixo inteiro para perto ou acima de 9.0 em ambos os lados, já que é o gap dominante em quase todo critério baixo.
3. Categoria B pode ser corrigida em paralelo, sem depender da decisão acima: construto AppConfig real, `metrics.ts`/EMF + dashboard mínimo, ADR curto sobre a indireção workers/handlers/composition.
