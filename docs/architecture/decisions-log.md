# Decision Log — Plataforma de Controle de Vencimentos

Registro vivo de decisões, mantido atualizado a cada rodada relevante (conforme seção 55 do prompt mestre). Cada linha aponta para o artefato-fonte da decisão.

| ID | Decisão | Tipo | Claude Score | Codex Score | Status | ADR | Data |
|---|---|---|---|---|---|---|---|
| D-000 | Quality Criteria (12 critérios, pesos) | Fundação | — | — | APPROVED (consenso 3 rodadas) | `quality-criteria.md` | 2026-08-19 |
| D-001 | Fitness Function (fórmula + gates G1–G6) | Fundação | — | — | APPROVED | `fitness-function.md` | 2026-08-19 |
| D-002 | Requirements (FR/NFR/SEC/PRIV/COST/SCALE/OPS) | Fundação | 9.16 | 9.03 | **FASE 1 APPROVED** | `requirements.md` | 2026-08-19 |
| D-003 | Capacity Model (Stage 0–5 + pico extremo) | Fundação | ~9.3 | 9.1 | **FASE 2 APPROVED** | `capacity-model.md` | 2026-08-19 |
| D-004 | Duas rubricas de nota (Design Maturity A / Operational Evidence B) | Processo | consenso | consenso | APPROVED | `requirements.md` §13.1 | 2026-08-19 |
| D-010 | Compute — Lambda + monólito modular | Type 2 | pendente | pendente | proposto (convergência R1) | `architecture-fase3-consolidada.md` §1 | 2026-08-19 |
| D-011 | API — API Gateway HTTP API + quota por tenant via DynamoDB token bucket | Type 2 | pendente | pendente | proposto (fechado R4) | `architecture-fase3-consolidada.md` §2 | 2026-08-19 |
| D-012 | Frontend — S3 + CloudFront | Type 2 | pendente | pendente | proposto (convergência R1) | `architecture-fase3-consolidada.md` §3 | 2026-08-19 |
| D-013 | Auth — Cognito, IDs internos desacoplados do `sub` | Type 2 | pendente | pendente | proposto (convergência R1) | `architecture-fase3-consolidada.md` §4 | 2026-08-19 |
| D-014 | Banco primário — DynamoDB on-demand single-table | Type 1 | pendente | pendente | proposto (convergência R1) | `architecture-fase3-consolidada.md` §5 | 2026-08-19 |
| D-015 | Multi-tenant readiness — `tenantId` em toda chave | Type 1 | pendente | pendente | proposto (convergência R1) | `architecture-fase3-consolidada.md` §6 | 2026-08-19 |
| D-016 | Documentos — S3 quarentena de 2 buckets + estados obrigatórios | Type 1/2 | pendente | pendente | proposto (refinado R3) | `architecture-fase3-consolidada.md` §7 | 2026-08-19 |
| D-017 | Reminder Engine — shards por minuto + SQS, 4 shards/min inicial | Type 1 | pendente | pendente | proposto (dimensionado R4) | `architecture-fase3-consolidada.md` §8 | 2026-08-19 |
| D-018 | Notification Engine — SQS por canal + adapters + envelope/payload | Type 1/2 | pendente | pendente | proposto (refinado R3) | `architecture-fase3-consolidada.md` §9 | 2026-08-19 |
| D-019 | AI/OCR — Textract+Bedrock, orquestração explícita (tipo a decidir) | Type 1/2 | pendente | pendente | proposto, ADR aberto | `architecture-fase3-consolidada.md` §10 | 2026-08-19 |
| D-020 | Event backbone — EventBridge + outbox seletivo com sweeper | Type 1 | pendente | pendente | proposto (corrigido R3) | `architecture-fase3-consolidada.md` §11 | 2026-08-19 |
| D-021 | IaC/CI/CD — CDK + GitHub Actions/OIDC, ScopedLambdaFunction | Type 2 | pendente | pendente | proposto (padronizado R4) | `architecture-fase3-consolidada.md` §12 | 2026-08-19 |
| D-022 | Observabilidade — CloudWatch EMF + X-Ray | Type 2 | pendente | pendente | proposto (convergência R1) | `architecture-fase3-consolidada.md` §13 | 2026-08-19 |
| D-023 | Kill switch — AppConfig; WAF condicional; RTO/RPO alvo | Type 1 | pendente | pendente | proposto (metas fixadas R4) | `architecture-fase3-consolidada.md` §14 | 2026-08-19 |

## Status agregado da Fase 3 (arquitetura conceitual)
- Rodadas 1–3: consenso de conteúdo entre propostas independentes.
- Rodada 4: 5 ADRs materialmente relevantes fechados (D-011, D-017, D-023 parcial); avaliação de nota em andamento sob a rubrica Design Maturity Score corrigida.
- **D-010 a D-023 recebem score formal (Claude + Codex, Design Maturity) somente quando `architecture-fase3-consolidada.md` atingir ≥9.0 de ambos** — a nota é dada ao documento consolidado como um todo (Overall ponderado), não decisão a decisão; esta tabela será preenchida com o Overall assim que aprovado.

## ADRs individuais (seção 24 do prompt mestre)
Ainda não criados como arquivos `docs/architecture/adr/ADR-XXXX-*.md` individuais — a consolidar quando cada decisão acima passar de "proposto" para "aprovado" definitivamente, com o modelo completo da seção 24 (Options Considered, Claude/Codex Critique, Rebuttals, Evidence, etc.). Nesta fase as justificativas equivalentes já estão registradas em `architecture-fase3-consolidada.md`, `claude-architecture-proposal.md`, `codex-architecture-proposal.md` e `round2-claude-critique.md`.
