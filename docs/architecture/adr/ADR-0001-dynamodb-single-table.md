# ADR-0001 — Banco de Dados Primário: DynamoDB On-Demand Single-Table

**Status**: Aceito
**Data**: 2026-08-19
**Decision Type**: Type 1
**Requisitos**: COST-001, SCALE-001, NFR-002

## Contexto
O produto precisa de um armazenamento primário que satisfaça idle≈0 no Stage 0–1 (COST-001) e escale até 1M usuários / 8M itens (Stage 5, `capacity-model.md`) sem redesenho estrutural.

## Constraints
Serverless-first, pay-per-use, sem compute/banco always-on (seção 8 do prompt mestre).

## Options Considered
1. **DynamoDB on-demand, single-table** (escolhida).
2. Aurora Serverless v2 — rejeitada: piso de ACU mesmo em repouso viola COST-001.
3. RDS Postgres provisionado — rejeitada: instância always-on, viola COST-001 diretamente.
4. DynamoDB provisionado (não on-demand) — rejeitada: exige estimar capacidade antecipadamente, inadequado ao Stage 0-1 de baixo volume imprevisível.

## Claude Proposal / Codex Proposal
Convergência independente na Rodada 1 da Fase 3 (`claude-architecture-proposal.md` §5, `codex-architecture-proposal.md` §4) — ambos chegaram a DynamoDB on-demand single-table sem se copiar.

## Claude Critique / Codex Critique / Rebuttals
Nenhuma divergência entre as duas propostas neste ponto específico. Refinamentos posteriores (não desacordos): padrão de co-localização de entidades sob a PK do item pai (adotado do Codex, `data-model.md`); correção de um erro técnico do Claude sobre sharding de partição quente (shard deve estar na PK, não na SK — pego pelo Codex na Rodada 1 de nota do data model).

## Evidence
`capacity-model.md` (volumes por estágio), `data-model.md` (13 entidades, 6 GSIs, idempotência).

## Cost Analysis
Ver `cost-model.md` — DynamoDB é ~US$500/mês estimado no Stage 5, o 4º maior driver de custo (não o dominante — WhatsApp domina).

## Security Impact
Isolamento por `tenantId` em toda PK (SCALE-004); criptografia via KMS (implícita no serviço gerenciado).

## Privacy Impact
Soft delete + purge físico via GSI6 (`data-model.md`) suporta PRIV-003/004/006.

## Scale Impact
Validado até Stage 5 (8M itens) em `capacity-model.md`; escala horizontal nativa do serviço.

## Operational Impact
PITR contínuo (35 dias), teste de restore como gate de produção (`disaster-recovery.md` §6).

## Trade-offs
Padrões de acesso precisam ser antecipados (menos flexível que SQL ad-hoc); relatórios analíticos complexos exigiriam export para S3/Athena (não implementado, não necessário no MVP).

## Rejected Alternatives
Ver "Options Considered" acima.

## Final Decision
DynamoDB on-demand, single-table, conforme `data-model.md` e `architecture-fase3-consolidada.md` §5.

## Claude Score / Codex Score
Parte da nota agregada da Fase 3 pós-Red-Team: Claude 9.13 / Codex 9.20 (Overall do documento consolidado; não pontuado individualmente por decisão).

## References
`architecture-fase3-consolidada.md` §5, `data-model.md`, `capacity-model.md`, `cost-model.md`.
