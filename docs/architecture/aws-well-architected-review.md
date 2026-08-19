# AWS Well-Architected Review — Expiration Tracker

Status: **APPROVED** (Design Maturity, pacote conjunto com `mcp-readiness.md` e `evolution.md`) — Claude ~9.25 / Codex 9.3, ambos ≥9.0. Rodada 1: Codex 8.8 (NOT APPROVED — checklist afirmativa, gatilhos sem threshold, ausência de fases de migração); Rodada 2: reestruturado como revisão baseada em risco por pilar com severidade/responsável/prazo. Seção 50 do prompt mestre.
Base: `docs/architecture/architecture-fase3-consolidada.md` e todos os documentos de arquitetura aprovados.

Para cada pilar: pontos fortes (evidência concreta), **riscos identificados** (não "lacunas genéricas") com severidade (Alta/Média/Baixa), responsável nominal (papel, não pessoa) e prazo de mitigação.

## 1. Excelência Operacional
**Forte**: IaC 100% (CDK), CI/CD com aprovação manual/canário/rollback (§12); observabilidade estruturada (EMF, X-Ray, correlation ID, §13); runbooks descritos para DLQ, credencial comprometida, restore.
**Risco (Média)**: runbooks nunca executados sob incidente real ou simulado — só existem como texto. **Responsável**: time de operações. **Prazo**: antes do primeiro deploy em produção (gate já implícito no teste de restore de `disaster-recovery.md` §6, que exercita o runbook de restore; runbook de credencial comprometida ainda não tem exercício equivalente agendado).

## 2. Segurança
**Forte**: IAM least privilege via `ScopedLambdaFunction`; KMS/Secrets Manager; quarentena de 2 buckets fail-closed; WAF condicional; kill switch; SEC-004 (prompt injection como dado); inbox de webhook anti-replay.
**Risco (Alta)**: threat model formal (seção 33 do prompt mestre) **não foi produzido** — os controles acima cobrem ameaças específicas já identificadas ad-hoc (Red Team), mas não há uma varredura sistemática STRIDE ou equivalente contra a arquitetura completa. **Responsável**: Arquiteto-Chefe + Segundo Engenheiro (mesmo papel do processo Claude↔Codex). **Prazo**: antes do primeiro lançamento em produção pública — mais urgente que a maioria das lacunas deste documento, dado o peso de Segurança na fitness function (15%, o maior peso individual).

## 3. Confiabilidade
**Forte**: idempotência em toda operação crítica; optimistic concurrency control; outbox com sweeper; DLQ com SLA; reconciliação diária; RPO/RTO definidos com teste de restore como gate de produção.
**Risco (Média, aceito conscientemente)**: falha de região não coberta. **Responsável**: já documentado com gatilho de revisão explícito (primeiro cliente com SLA contratual, `evolution.md`). **Prazo**: não é um prazo fixo, é condicional ao gatilho — correto por design, não uma lacuna a fechar agora.
**Risco (Baixa)**: nenhum teste de carga real executado — esperado nesta fase (Rubrica B exige implementação). **Prazo**: parte do Implementation Blueprint (seção 60), pós-aprovação.

## 4. Eficiência de Performance
**Forte**: DynamoDB on-demand e Lambda escalam automaticamente; SLOs por estágio evitam over-engineering prematuro.
**Risco (Baixa)**: SLOs de `slo.md` são metas não validadas por medição real (mesma limitação de qualquer documento pré-implementação). **Prazo**: validação contínua pós-deploy, não um evento único.

## 5. Otimização de Custo
**Forte**: idle≈0 validado; pay-per-use em todos os componentes centrais; top 5 cost drivers com análise de sensibilidade; Budgets + Anomaly Detection + kill switch (G6).
**Risco (Alta, é de produto não de arquitetura)**: WhatsApp domina 76-94% do custo em qualquer cenário de preço plausível (`cost-model.md`) — decisão de pricing/BSP (UNK-003) tem impacto financeiro maior que qualquer otimização técnica disponível. **Responsável**: decisão de produto/negócio, não engenharia. **Prazo**: antes de habilitar WhatsApp como canal em produção (bloqueante para esse canal especificamente, não para o lançamento do produto via e-mail/Telegram).

## 6. Sustentabilidade
**Forte**: serverless-first minimiza recursos ociosos por design.
**Risco (Baixa)**: nenhuma métrica de sustentabilidade específica definida (ex.: workload por unidade útil de negócio, taxa de desperdício de cold starts, eficiência de retenção de logs vs. valor extraído). **Responsável**: não crítico o suficiente para gate — registrado como melhoria futura, não bloqueante. **Prazo**: sem prazo definido, reavaliar quando o volume justificar medição (Stage 3+).

## Serverless Lens
Monólito modular em Lambda (não microsserviços prematuros); EventBridge+SQS como backbone assíncrono (padrão recomendado, Kafka/Kinesis conscientemente rejeitados); Step Functions Standard para orquestração com estado (padrão recomendado para pipelines com necessidade de auditabilidade). Nenhum desvio da lente identificado.

## Resumo de riscos por severidade
| Severidade | Risco | Responsável | Prazo |
|---|---|---|---|
| **Alta** | Threat model formal ausente | Arquiteto-Chefe + Segundo Engenheiro | Antes do lançamento público |
| **Alta** | Custo de WhatsApp domina o modelo financeiro | Produto/negócio | Antes de habilitar WhatsApp |
| **Média** | Runbooks não exercitados | Operações | Antes do primeiro deploy em produção |
| **Média (aceita)** | Falha de região não coberta | — | Condicional a gatilho de `evolution.md` |
| **Baixa** | Teste de carga real pendente | Implementation Blueprint | Pós-aprovação |
| **Baixa** | SLOs não validados por medição | Operações contínuas | Pós-deploy |
| **Baixa** | Sustentabilidade sem métrica própria | — | Sem prazo, Stage 3+ |

Nenhum risco de severidade Alta é uma surpresa desta revisão — ambos (threat model, custo de WhatsApp) já estavam registrados em documentos anteriores; esta revisão consolida a visão por pilar do Well-Architected Framework, não substitui os documentos-fonte.
