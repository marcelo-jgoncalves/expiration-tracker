---
status: superseded
owner: claude
authority: evidence-round (not normative — converged into docs/engineering/joint-review-criteria.md)
---

# Critérios de revisão conjunta Claude↔Codex, por eixo — Proposta Claude (Rodada 1)

Adaptado da estrutura do projeto irmão `event-discovery-platform` (mesmas fontes normativas: ISO/IEC 25010, AWS Well-Architected, ATAM, DORA/Core-4) — pesos e ênfases recalibrados para a realidade do `expiration-tracker`: serverless single-tenant-per-request AWS, single-table DynamoDB, pipeline assíncrono (SQS/EventBridge/Streams) como núcleo do risco atual (G8), Cognito multi-tenant.

## Eixo: Arquitetura

| # | Critério | Peso | Nota do ajuste vs. fonte |
|---:|---|---:|---|
| 1 | Domain Fit & Simplicity | 10% | leve queda (-1pp): domínio já é bem mapeado (data-model.md), menos risco de over-fit que um domínio novo |
| 2 | Reliability & Fault Recovery | 16% | alta (+3pp): é literalmente o que G8 mede — recuperação real de falha assíncrona é o gate mais caro deste projeto agora |
| 3 | Event & Integration Correctness | 12% | alta (+2pp): outbox/relay/dispatch/reconciliation é a superfície mais intrincada do sistema |
| 4 | Data Model & Consistency | 11% | alta (+1pp): single-table DynamoDB com 6 GSIs, 2 exceções de particionamento (GSI3/GSI6) — risco real e documentado |
| 5 | Security & Privacy | 11% | igual à fonte: multi-tenant + LGPD pendente justificam o peso |
| 6 | Modifiability & Evolvability | 8% | leve queda (-1pp) |
| 7 | Observability & Operability | 8% | leve queda (-1pp): `SecureLogger`/redactor já maduro desde M0, risco menor que em projeto sem isso ainda |
| 8 | Testability & Delivery Safety | 8% | igual |
| 9 | Cost & Resource Governance | 5% | leve queda (-1pp): serverless pay-per-use, menor superfície de erro de custo que infra provisionada |
| 10 | Performance & Scalability Fitness | 4% | leve queda (-1pp): capacity-model.md já cobre isso em detalhe, gate já fechado |
| 11 | Architecture Governance & Traceability | 7% | leve queda (-1pp): decisions-log.md/ADRs já maduros, processo já rodando há vários milestones |

## Eixo: Qualidade de engenharia

Pesos mantidos muito próximos da fonte (universais o suficiente — craft de código, disciplina de teste/CI/tooling não são específicos de domínio). Ajustes:

| # | Critério | Peso | Nota do ajuste |
|---:|---|---:|---|
| 1 | Code Correctness & Defensive Design | 11% | igual |
| 2 | Test Effectiveness & Coverage Discipline | 15% | alta (+1pp): a lição de M3.5 (Camada 2 pegou bug real que Camada 1 não pegaria) justifica peso maior em evidência real vs. contagem |
| 3 | CI Quality Gates & Merge Safety | 11% | igual |
| 4 | Type Safety, Static Analysis & Automated Enforcement | 9% | igual |
| 5 | Readability, Consistency & Implementation Maintainability | 9% | igual |
| 6 | Delivery, Release & Recovery Discipline | 7% | leve queda (-1pp): sem deploy real ainda neste projeto (pendente), peso pleno seria prematuro até Camada 3 rodar pelo menos uma vez |
| 7 | Dependency & Supply-Chain Hygiene | 7% | igual |
| 8 | Debuggability & Operational Feedback | 6% | igual |
| 9 | Developer Experience & Reproducibility | 6% | igual |
| 10 | Documentation Quality & Process Discipline | 6% | igual |
| 11 | Documentation–Implementation Drift Control | 7% | igual |
| 12 | Technical-Debt & Continuous-Improvement Practice | 6% | igual |

## Eixo: Engenharia de contexto

Pesos mantidos muito próximos da fonte — mesma disciplina de "Canonicalidade/Autoridade" já é o modelo que `docs/architecture/README.md` §"Precedência de fontes" implementa. Um ajuste real:

| # | Critério | Peso | Nota do ajuste |
|---:|---|---:|---|
| 1 | Canonicalidade, Autoridade & Não-Duplicação | 16% | igual |
| 2 | Clareza de Papéis & Proporcionalidade | 10% | igual |
| 3 | Context Routing & Progressive Disclosure | 10% | queda (-3pp): este projeto não tem um `system-overview.md`/context router dedicado — `AGENTS.md` §2 cumpre parcialmente esse papel, mas é menos desenvolvido; achado real a corrigir, não motivo para inflar peso artificialmente |
| 4 | Correspondência com a Realidade & Controle de Drift | 17% | alta (+2pp): checklist do `AGENTS.md` §6 já existe mas é manual — histórico real de drift (§1 desatualizado corrigido nesta sessão) mostra que o risco é concreto, não hipotético |
| 5 | Lifecycle, Proveniência & Evolução do Conhecimento | 12% | igual |
| 6 | Rastreabilidade de Decisões, Trabalho & Triggers | 10% | igual |
| 7 | Higiene de Contexto & Sinal-Ruído | 8% | igual |
| 8 | Portabilidade Agnóstica entre Agentes de IA | 6% | igual: `AGENTS.md`/`CLAUDE.md` já seguem o mesmo padrão de separação |
| 9 | Auditabilidade & Enforcement do Sistema de Contexto | 11% | leve alta (+1pp) |

## Pergunta aberta para a crítica

O critério #3 do eixo de contexto (Context Routing) caiu porque este projeto não tem um router dedicado equivalente a `system-overview.md` — isso é um achado real (`AGENTS.md` §2 é mais fraco nesse papel) ou o peso deveria subir de volta justamente por ser uma lacuna real a corrigir, não uma força a reconhecer com peso menor? Levo essa tensão para a crítica cruzada.
