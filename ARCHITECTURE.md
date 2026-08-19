# ARCHITECTURE.md — Expiration Tracker

Documento final consolidado conforme seção 61 do prompt mestre (`docs/00-prompt-mestre.md`). Produzido ao final de um processo Claude↔Codex de proposta → crítica → tréplica → nota independente às cegas, repetido em 14 entregáveis, todos aprovados com nota ≥9.0 de ambos os "engenheiros" (Design Maturity Score, rubrica A — ver seção "Status Final" abaixo para o que isso significa e o que ainda falta).

## Executive Summary
Expiration Tracker é um micro-SaaS de controle de vencimentos, renovações e obrigações recorrentes ("Cadastre o que não pode vencer. Nós lembramos você."), voltado a pessoas físicas, autônomos, MEIs e pequenas empresas. A arquitetura é serverless-first na AWS: Lambda em monólito modular, DynamoDB on-demand single-table, S3 com quarentena de documentos, notificações por e-mail/Telegram/WhatsApp desacopladas por adapter, extração de dados por IA/OCR com confirmação humana obrigatória em baixa confiança. Toda decisão foi debatida independentemente por dois "engenheiros" (Claude e Codex), com pelo menos uma rodada de crítica real e correção em praticamente todo entregável.

## Product Context
Ver `docs/00-prompt-mestre.md` seções 4–8. Resumo: itens com prazo/validade (certificados, contratos, seguros, alvarás, documentos de veículos, domínios, etc.), múltiplos alertas configuráveis, upload de documento com extração assistida por IA, dashboard, auditoria.

## Goals
Simplicidade, custo idle≈0 nos estágios iniciais, correção/confiabilidade dos vencimentos (nenhum perdido silenciosamente), segurança e privacidade por padrão, extensibilidade de canais/provedores sem acoplamento.

## Non-goals
Multi-tenancy plena, RBAC, SSO, app mobile nativo, workflows de aprovação, integrações ERP/CRM — todos readiness, não implementação, no MVP (ver `requirements.md` seção 12, NG-001..006).

## Quality Criteria
12 critérios, pesos somando 100%, com gates eliminatórios G1-G6 — ver `docs/architecture/quality-criteria.md` e `docs/architecture/fitness-function.md` (Fase 0, aprovados).

## Architecture Principles
Serverless-first, pay-per-use, monólito modular (não microsserviços prematuros), fail-closed em decisões de IA, idempotência em toda operação crítica, `tenantId` em toda chave desde o Day 0, nenhuma escolha "porque é óbvio" — toda decisão rastreada a requisito/métrica.

## Architecture Overview
Ver `docs/architecture/architecture-fase3-consolidada.md` (documento central, 14 decisões numeradas) e os 14 diagramas Mermaid em `docs/architecture/diagrams/diagrams.md`.

## AWS Services
Lambda, API Gateway HTTP API, DynamoDB on-demand, S3 (2 buckets), Cognito, EventBridge, SQS, SES, Textract, Bedrock, Step Functions Standard, CDK, CloudWatch, X-Ray, AppConfig, Secrets Manager, KMS, GuardDuty Malware Protection, WAF (condicional). Nenhum serviço always-on (EC2/RDS/ECS provisionado/Kubernetes).

## Domain Architecture
13+ entidades (`User`, `Organization`, `Membership`, `ExpirationItem`, `ReminderPolicy`, `ReminderOccurrence`, `Document`, `ExtractedField`, `ExtractionRun`, `NotificationIntent`, `NotificationAttempt`, `Channel`, `Provider`, `WebhookInbox`, `UploadSlot`, `TenantQuota`, `AuditEvent`) — ver `docs/architecture/data-model.md` seção 1-2.

## Data Architecture
DynamoDB single-table, PK `TENANT#<tenantId>#<aggregate>`, 6 GSIs (dashboard, responsável/categoria, scheduler, membership, provider callback, retenção/reconciliação), idempotência por operação, optimistic concurrency control — `docs/architecture/data-model.md` seções 3-5.

## Reminder Architecture
Shards por minuto (`DUE#yyyyMMddHHmm#NN`), Reminder Scanner (tick de 1min) + SQS, reconciliação diária, SLO de drenagem do pico extremo = 5min — `docs/architecture/architecture-fase3-consolidada.md` §8, `docs/architecture/slo.md` §3.

## Notification Architecture
SQS por canal (e-mail/Telegram/WhatsApp), contrato comum + payload específico, contract tests, revalidação de versão antes do envio (evita entrega de dado obsoleto) — `docs/architecture/architecture-fase3-consolidada.md` §9.

## Document Pipeline
Presigned upload → quarentena (2 buckets, GuardDuty) → CLEAN → OCR (Textract) → parser determinístico → LLM (Bedrock) se necessário → `ExtractedField` ou `PENDING_CONFIRMATION` — `docs/architecture/architecture-fase3-consolidada.md` §7/§10.

## AI Architecture
Fail-closed obrigatório (FR-043): confidence baixa/ausente, timeout, tipo desconhecido ou divergência entre extratores nunca aplicam valor automaticamente — gate G4. Step Functions Standard desde o Stage 1 para auditabilidade nativa.

## Security
IAM least privilege (`ScopedLambdaFunction`), KMS, Secrets Manager, kill switch (AppConfig), WAF condicional, quarentena fail-closed, inbox de webhook anti-replay, optimistic concurrency contra corrida de dados — `docs/architecture/architecture-fase3-consolidada.md` §14, `docs/architecture/aws-well-architected-review.md` pilar 2. **Threat model formal (seção 33) ainda não produzido — risco Alta severidade registrado, próximo item recomendado.**

## LGPD
Mapa de dados pessoais, 8 classes de retenção (`retentionClass`/`legalHold`), state machine de exclusão, região AWS/transferência internacional sinalizada como bloqueante pré-produção — `docs/architecture/privacy-lgpd.md`. **Não substitui parecer jurídico.**

## Observability
CloudWatch EMF, X-Ray amostrado, correlation ID + tenantId (nunca como dimensão de métrica), alarmes por sintoma — `docs/architecture/architecture-fase3-consolidada.md` §13.

## Reliability
Idempotência, OCC, outbox com sweeper, DLQ com SLA (1h/4h), reconciliação diária, testes negativos de isolamento — `docs/architecture/architecture-fase3-consolidada.md`, `docs/architecture/red-team-claude-round1.md`/`docs/architecture/history/architecture-fase3/red-team-codex-round1.md`.

## DR
RPO≤5min/RTO≤4h (falhas dentro da região); falha de região é risco aceito com gatilho de revisão; teste de restore real como gate de produção — `docs/architecture/disaster-recovery.md`.

## Cost
idle≈0 validado; WhatsApp domina 76-94% do custo em qualquer cenário plausível (maior driver, decisão de produto mais do que de arquitetura); ~US$3-15/mês Stage 0 até ~US$44-45k/mês Stage 5 — `docs/architecture/cost-model.md`.

## Capacity
Stage 0 (dev) a Stage 5 (1M usuários, 8M itens), cenário de pico extremo modelado (1M ocorrências simultâneas, drenagem em 5min) — `docs/architecture/capacity-model.md`.

## MCP Readiness
Domínio não bloqueia MCP futuro, mas "não bloquear" ≠ "pronto para implementar" — lacunas de tool design (delegação, paginação, consentimento) registradas conscientemente — `docs/architecture/mcp-readiness.md`. Não implementar agora (FUT-007).

## Evolution
6 transições de estágio com gatilho numérico/operacional, custo estimado, risco e fases de migração (incluindo dual-write/backfill/cutover para Organizations e multi-region) — `docs/architecture/evolution.md`.

## Known Risks
Ver tabela de severidade em `docs/architecture/aws-well-architected-review.md` — 2 riscos Alta (threat model ausente, custo de WhatsApp), 2 Média, 3 Baixa. Nenhum é surpresa desta revisão — todos já registrados em documentos-fonte.

## Open Questions
BSP WhatsApp (pricing real), modelo Bedrock específico, região AWS (bloqueante para LGPD), MFA obrigatório vs. opcional (UNK-006) — ver `requirements.md` seção 11 (Unknowns) para lista completa.

## ADR Index
Ver `docs/architecture/adr/README.md` — 8 ADRs formais para decisões Type 1.

## Decision Log
Ver `docs/architecture/decisions-log.md` — 26 decisões registradas (D-000 a D-025), todas com nota Claude/Codex e status.

---

## Claude Score / Codex Score (agregado, Design Maturity — rubrica A)

| Entregável | Claude | Codex | Rodadas |
|---|---:|---:|---:|
| Quality Criteria (Fase 0) | — | — | 3 |
| Requirements (Fase 1) | 9.16 | 9.03 | 4 |
| Capacity Model (Fase 2) | ~9.3 | 9.1 | 9 |
| Arquitetura + Red Team (Fase 3) | 9.13 | 9.20 | 6 |
| Domain/Data Model | ~9.05 | 9.10 | 2 |
| SLOs | ~9.08 | 9.001 | 2 |
| Disaster Recovery | ~9.10 | 9.10 | 2 |
| Privacy/LGPD | ~9.15 | 9.10 | 1 |
| Cost Model | ~9.15 | 9.20 | 2 |
| MCP/Evolution/WAR | ~9.25 | 9.30 | 2 |

**Todos os 10 checkpoints efetivamente pontuados ≥9.0 de ambos, sem exceção, sem arredondamento** (Quality Criteria e Fitness Function, na Fase 0, foram aprovados por consenso de conteúdo em 3 rodadas sem nota numérica formal — não fazem parte da contagem acima).

## Status Final

```text
DESIGN MATURITY STATUS: APPROVED
ARCHITECTURE STATUS: NOT APPROVED
```

Todos os 10 checkpoints de conteúdo pontuados (Fases 1-3, Red Team, Data Model, SLOs, DR, LGPD, Cost Model, MCP/Evolution/WAR) atingiram nota ≥9.0 de Claude e Codex independentemente, sem arredondamento, sob a rubrica (A) Design Maturity Score (`requirements.md` §13.1) — desenho coerente, rastreável a requisitos, com trade-offs e alternativas explicitados, ADRs materialmente relevantes fechados, Architecture Red Team executado.

A seção 62 do prompt mestre só admite dois valores para `ARCHITECTURE STATUS`: `APPROVED` ou `NOT APPROVED` — não existe um terceiro estado "pendente". `requirements.md` §13.1 é explícito: evidência indisponível **não recebe nota neutra**, equivale a nota insuficiente. Como a rubrica (B) — Operational Evidence, que exige sistema **construído e testado sob falha/carga** — nunca foi avaliada (nada foi implementado; o Implementation Blueprint, seção 60, só começa *depois* desta aprovação de Design Maturity), o valor correto e formalmente exigido é `NOT APPROVED`, não um valor alternativo que abrandasse essa regra. Isso não é uma reprovação de mérito — é o estado normativo correto de um sistema ainda não construído, e a distinção entre os dois status acima é o que preserva o rigor do processo em vez de escapar dele.

### Próximos passos (fora do escopo deste documento)
1. Implementation Blueprint (seção 60) — componentes, interfaces, eventos, schemas, ordem de deploy.
2. Implementação real seguindo as decisões aqui consolidadas.
3. Threat model formal (risco Alta, `aws-well-architected-review.md`).
4. Testes de carga real, teste de restore real, exercício de runbook de credencial comprometida.
5. Reavaliação sob rubrica (B) — só então a seção 62 pode ser respondida.
