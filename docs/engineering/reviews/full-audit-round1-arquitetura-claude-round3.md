---
status: round3-claude-blind
owner: claude
authority: evidence-round (not normative until protocol closes)
---

# Nota cega Claude — Eixo Arquitetura — Rodada 3

Reavaliação após commit `0262d96`: novo construct `infra/lib/cost-budget.ts` (`AWS::Budgets::Budget`, teto mensal configurável, notificação opcional a 80%/100%), testado em `test/infra/stack.test.ts`. `npm test` 152/152, typecheck/lint/check-boundaries verdes.

Não vi a nota do Codex desta rodada.

| # | Critério | Peso | Nota R2 | Nota R3 | Motivo da mudança |
|---:|---|---:|---:|---:|---|
| 1 | Domain Fit & Simplicity | 8% | 8.5 | 8.5 | — |
| 2 | Reliability & Fault Recovery | 16% | 7.2 | 7.2 | Não afetado por esta rodada; gap dominante continua a ausência de Camada 3. |
| 3 | Event & Integration Correctness | 11% | 8.0 | 8.0 | — |
| 4 | Data Model & Consistency | 13% | 8.3 | 8.3 | — |
| 5 | Security & Privacy | 13% | 7.5 | 7.5 | `resources: ["*"]` do AppConfig e CMK continuam pendentes — fora do escopo desta rodada (dependem de um construto AppConfig que ainda não existe). |
| 6 | Modifiability & Evolvability | 7% | 8.5 | 8.5 | — |
| 7 | Observability & Operability | 8% | 7.5 | 7.5 | Não afetado — `metrics.ts`/EMF/dashboard continuam ausentes. |
| 8 | Testability & Delivery Safety | 8% | 8.0 | 8.0 | — |
| 9 | Cost & Resource Governance | 5% | 8.0 | 8.7 | `CostBudget` fecha a lacuna concreta apontada nas duas rodadas anteriores (nenhum alarme de custo existia). Não chega a 9.0 porque ainda falta tagging/cost-allocation e o teto (US$50/mês, `cost-budget.ts:26`) é um valor-julgamento não calibrado por dado real de consumo — e o e-mail de notificação é opcional/não configurado por padrão (`cost-budget.ts:20-23`, gap documentado no próprio código). |
| 10 | Performance & Scalability Fitness | 4% | 7.5 | 7.5 | — |
| 11 | Architecture Governance & Traceability | 7% | 9.0 | 9.0 | Commit mantém o mesmo padrão de rastreabilidade (mensagem referencia achado→arquivo→teste). |

**Nota ponderada final (Claude, rodada 3):**
0.08×8.5 + 0.16×7.2 + 0.11×8.0 + 0.13×8.3 + 0.13×7.5 + 0.07×8.5 + 0.08×7.5 + 0.08×8.0 + 0.05×8.7 + 0.04×7.5 + 0.07×9.0
= 0.68 + 1.152 + 0.88 + 1.079 + 0.975 + 0.595 + 0.60 + 0.64 + 0.435 + 0.30 + 0.63 = **7.966 ≈ 7.97/10**

## Avaliação de esgotamento (para decidir se compensa uma rodada 4)

Dos 4 achados "corrigíveis sem AWS real" listados na rodada 1/2, 2 já foram fechados (GSI3 orphan pointer, alarmes de observabilidade básicos, budget de custo — na prática 3 dos 4). Os que restam de fato corrigíveis nesta sessão sem tocar em AWS real:

- **Security & Privacy**: `appConfigAccessFor` com `resources: ["*"]` (`infra/lib/scoped-lambda-function.ts:130-146`) só pode ser escopado de verdade quando existir um recurso `AppConfig::Application/ConfigurationProfile` real no CDK para referenciar por ARN — hoje NENHUM construto AppConfig existe no repositório (grep confirma). Corrigir "de verdade" (não só cosmeticamente) exigiria criar esse construto do zero, o que é escopo de um milestone futuro (Notification/kill-switch, ainda não iniciado), não um achado pontual desta auditoria — registrado como impedimento real (não por AWS, mas por dependência de um construto que não existe ainda no codebase).
- **Testability & Delivery Safety**: tornar `test:dynamodb` bloqueante no gate `guardrails` do CI é possível sem AWS real (Docker/Testcontainers já roda em CI hoje, `.github/workflows/ci.yml:92-116` — só não é `required`), mas é uma mudança de política de CI que si beneficia de decisão explícita do usuário (torna merges mais lentos/frágeis a falhas de Docker) — Type 2-3 na escala de risco, judgment call razoável fazer nesta sessão. Deixado de fora desta rodada por foco nos achados de maior peso ponderado primeiro; registrado como pendência aberta, não impedimento.
- **Observability & Operability**: `metrics.ts`/EMF real e dashboard exigem mais esforço de design (formato EMF, quais métricas, cardinalidade por tenant) do que os itens já corrigidos — não é um ajuste pontual de uma linha, é trabalho de escopo maior; mantenho a nota como está e registro como não esgotado, não impedido.

Nenhum desses três é um impedimento *externo* real (não dependem de AWS/deploy) — são simplesmente maiores que o formato "achado pontual" e ficam fora do escopo razoável desta sessão de auditoria, documentados explicitamente aqui em vez de escondidos.

## Critérios ainda abaixo de 9.0 — classificação final

**Impedimento real e externo (Camada 3 / AWS sandbox, decisão de deploy pendente)**: Reliability & Fault Recovery (7.2), Event & Integration Correctness (8.0), parte de Security & Privacy (7.5), Performance & Scalability Fitness (7.5). Nenhum destes pode chegar a 9.0 sem: (a) deploy real (decisão de rota CDK vs Terraform ainda pendente, `NEXT_SESSION_PROMPT.md`), (b) teste de IAM negativo real, (c) teste de carga real.

**Escopo maior que "achado pontual", não impedimento externo, não corrigido nesta sessão**: Domain Fit & Simplicity (8.5 — indireção de 3 camadas em workers/handlers/composition, não um bug), Data Model & Consistency (8.3 — resta só prova de concorrência real, que é impedimento de AWS), Security & Privacy (7.5 — construto AppConfig não existe ainda), Modifiability & Evolvability (8.5 — sem achado concreto pendente, só não é 9+ por não ter ADR formal do composition-root), Observability & Operability (7.5 — EMF/dashboard é trabalho de escopo maior), Testability & Delivery Safety (8.0 — gate do CI é decisão de política, não bug), Cost & Resource Governance (8.7 — falta tagging e calibração de valor real), Architecture Governance & Traceability (9.0 — já no piso do gate, resta só a ratificação mecânica do GSI3 em `data-model.md`).
