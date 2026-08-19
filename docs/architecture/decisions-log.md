# Decision Log — Plataforma de Controle de Vencimentos

Registro vivo de decisões, mantido atualizado a cada rodada relevante (conforme seção 55 do prompt mestre). Cada linha aponta para o artefato-fonte da decisão.

| ID | Decisão | Tipo | Claude Score | Codex Score | Status | ADR | Data |
|---|---|---|---|---|---|---|---|
| D-000 | Quality Criteria (12 critérios, pesos) | Fundação | — | — | APPROVED (consenso 3 rodadas) | `quality-criteria.md` | 2026-08-19 |
| D-001 | Fitness Function (fórmula + gates G1–G6) | Fundação | — | — | APPROVED | `fitness-function.md` | 2026-08-19 |
| D-002 | Requirements (FR/NFR/SEC/PRIV/COST/SCALE/OPS) | Fundação | 9.16 | 9.03 | **FASE 1 APPROVED** | `requirements.md` | 2026-08-19 |
| D-003 | Capacity Model (Stage 0–5 + pico extremo) | Fundação | ~9.3 | 9.1 | **FASE 2 APPROVED** | `capacity-model.md` | 2026-08-19 |
| D-004 | Duas rubricas de nota (Design Maturity A / Operational Evidence B) | Processo | consenso | consenso | APPROVED | `requirements.md` §13.1 | 2026-08-19 |
| D-005 | Architecture Red Team (20 cenários, seção 58) — 6 lacunas críticas fechadas + 2 refinamentos | Processo | 9.13 | 9.20 | **APPROVED** | `red-team-claude-round1.md`, `red-team-codex-round1.md`, `architecture-fase3-consolidada.md` §Rodada 6 | 2026-08-19 |
| D-006 | Domain Model + Data Model (seção 25) — 13 entidades, DynamoDB single-table, GSIs, idempotência, OCC | Type 1 | ~9.05 | 9.10 | **APPROVED** | `data-model.md` | 2026-08-19 |
| D-007 | SLOs (seção 39) — metas por estágio, fecha UNK-CAP-006 (drenagem em 5min) | Processo | ~9.08 | 9.001 | **APPROVED** | `slo.md` | 2026-08-19 |
| D-008 | Disaster Recovery (seção 43) — RPO/RTO por componente, teste de restore, runbook de credencial, reparo seletivo, retentionClass | Type 1 | ~9.10 | 9.10 | **APPROVED** | `disaster-recovery.md` | 2026-08-19 |
| D-009 | Privacy/LGPD (seção 35) — mapa de dados, 8 classes de retenção, direitos do titular, transferência internacional | Type 1 | ~9.15 | 9.10 | **APPROVED** | `privacy-lgpd.md` | 2026-08-19 |
| D-024 | Cost Model (seção 36) — custo por estágio, top 5 drivers (WhatsApp domina), sensibilidade, custo por tenant | Processo | ~9.15 | 9.20 | **APPROVED** (2 rodadas) | `cost-model.md` | 2026-08-19 |
| D-025 | MCP Readiness (seção 48) + Evolution (seção 51) + AWS Well-Architected Review (seção 50) — pacote conjunto | Processo | ~9.25 | 9.30 | **APPROVED** (2 rodadas) | `mcp-readiness.md`, `evolution.md`, `aws-well-architected-review.md` | 2026-08-19 |
| D-010 | Compute — Lambda + monólito modular | Type 2 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §1 | 2026-08-19 |
| D-011 | API — API Gateway HTTP API + quota por tenant via DynamoDB token bucket | Type 2 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §2 | 2026-08-19 |
| D-012 | Frontend — S3 + CloudFront | Type 2 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §3 | 2026-08-19 |
| D-013 | Auth — Cognito, IDs internos desacoplados do `sub` | Type 2 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §4 | 2026-08-19 |
| D-014 | Banco primário — DynamoDB on-demand single-table | Type 1 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §5 | 2026-08-19 |
| D-015 | Multi-tenant readiness — `tenantId` em toda chave | Type 1 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §6 | 2026-08-19 |
| D-016 | Documentos — S3 quarentena de 2 buckets + estados obrigatórios | Type 1/2 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §7 | 2026-08-19 |
| D-017 | Reminder Engine — shards por minuto + SQS, 4 shards/min inicial | Type 1 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §8 | 2026-08-19 |
| D-018 | Notification Engine — SQS por canal + adapters + envelope/payload | Type 1/2 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §9 | 2026-08-19 |
| D-019 | AI/OCR — Textract+Bedrock, orquestração explícita (tipo a decidir) | Type 1/2 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §10 | 2026-08-19 |
| D-020 | Event backbone — EventBridge + outbox seletivo com sweeper | Type 1 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §11 | 2026-08-19 |
| D-021 | IaC/CI/CD — CDK + GitHub Actions/OIDC, ScopedLambdaFunction | Type 2 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §12 | 2026-08-19 |
| D-022 | Observabilidade — CloudWatch EMF + X-Ray | Type 2 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §13 | 2026-08-19 |
| D-023 | Kill switch — AppConfig; WAF condicional; RTO/RPO alvo | Type 1 | 9.13 | 9.20 | **APPROVED** (Design Maturity, pós-Red-Team R6) | `architecture-fase3-consolidada.md` §14 | 2026-08-19 |

## Status agregado da Fase 3 (arquitetura conceitual) — APPROVED
- Rodadas 1–3: consenso de conteúdo entre propostas independentes + crítica cruzada + tréplica.
- Rodada 4: 7 ADRs materialmente relevantes fechados (quota HTTP API, shards, DST, RTO/RPO, IAM pattern, WAF×HTTP API, tipo Step Functions). Primeira nota (rubrica antiga, inválida para checkpoint conceitual): Codex 5.9 — expôs falha metodológica na rubrica de evidência, corrigida com a formalização de duas rubricas (Design Maturity A / Operational Evidence B) em `requirements.md` §13.1.
- Rodada 4 (rubrica A corrigida): Codex 9.1 (exato 9.082) / Claude ~8.99 — quase no limiar, mais 2 itens fechados para garantir margem.
- **Rodada 5: Claude 9.10 / Codex 9.04 (exato, sem arredondamento) — ambos ≥9.0, nenhum gate violado. STATUS: FASE 3 (pré-Red-Team) APPROVED.**
- **Rodada 6 (Architecture Red Team, seção 58)**: 20 cenários avaliados independentemente por Claude e Codex (`red-team-claude-round1.md`, `red-team-codex-round1.md`). Convergência forte, 6 lacunas críticas fechadas (upload presigned contornando quota, maxReceiveCount+SLA de DLQ, inbox de webhook idempotente, optimistic concurrency control para alteração de data/exclusão de documento, falha de região como risco aceito documentado, expand/contract para rollback de schema/eventos). Codex revisou os fechamentos e apontou 2 refinamentos não-bloqueantes (restituição de slot de upload via reconciliador, não TTL direto; chave composta de webhook `provider+tenant+providerEventId`), ambos incorporados. **Reavaliação final: Claude 9.13 / Codex 9.20 (exato) — ambos ≥9.0, nenhum gate violado.**
- **STATUS: D-010 a D-023 (decisões de arquitetura da Fase 3) — FASE 3 + ARCHITECTURE RED TEAM APPROVED em 2026-08-19.**
- Nota: esta aprovação é do checkpoint de **desenho conceitual pós-Red-Team** (rubrica A). O Gate de Aprovação Final da seção 23 do prompt mestre (rubrica B, Operational Evidence) só se aplica após implementação real — ainda pendente.

## ADRs individuais (seção 24 do prompt mestre)
Ainda não criados como arquivos `docs/architecture/adr/ADR-XXXX-*.md` individuais — a consolidar quando cada decisão acima passar de "proposto" para "aprovado" definitivamente, com o modelo completo da seção 24 (Options Considered, Claude/Codex Critique, Rebuttals, Evidence, etc.). Nesta fase as justificativas equivalentes já estão registradas em `architecture-fase3-consolidada.md`, `claude-architecture-proposal.md`, `codex-architecture-proposal.md` e `round2-claude-critique.md`.
