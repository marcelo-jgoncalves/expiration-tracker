# ADR-0003 — Reminder Engine: Shards por Minuto em DynamoDB + Lambda + SQS

**Status**: Aceito | **Data**: 2026-08-19 | **Type**: Type 1 | **Requisitos**: NFR-002, NFR-011, gate G3

## Contexto
Motor de lembretes precisa suportar desde poucas dezenas de disparos/dia (Stage 1) até o cenário de pico extremo (1M ocorrências no mesmo horário, `capacity-model.md`) sem redesenho.

## Options Considered
1. **Shards por minuto (`DUE#yyyyMMddHHmm#NN`) + Lambda Scanner + SQS** (escolhida).
2. EventBridge Scheduler por ocorrência individual — rejeitada: custo/quotas e cancelamento em massa inviáveis em milhões de ocorrências (FR-014 exige cancelamento frequente).
3. Scans periódicos globais sem shard — rejeitada: hot partition.
4. Step Functions por milhão de timers — rejeitada: custo.

## Claude/Codex Proposal
Codex propôs a granularidade por minuto com shard explícito na Rodada 1 (mais rigorosa que a proposta inicial do Claude, que usava bucket por hora); Claude adotou após reconhecer a superioridade técnica (Rodada 2).

## Evidence
`capacity-model.md` (cenário de pico extremo, 3 opções de drenagem 1/5/60min); `slo.md` (fecha em 5min); `data-model.md` (GSI3 dedicado ao scheduler).

## Correctness Impact
Idempotência via chave determinística; reconciliação diária detecta ocorrências omitidas (NFR-004); optimistic concurrency previne corrida em alteração de data (Red Team cenário 13).

## Cost Impact
4 shards/minuto inicial (Stage 0-3), dobrando via runbook manual quando alarme de `ConsumedReadCapacity` disparar — decisão consciente contra auto-scaling de partição prematuro.

## Trade-offs
Precisão de ~1 minuto (não subminuto); dimensionamento de shards exige calibração contínua com dado real de produção (`evolution.md`).

## Final Decision
Conforme `architecture-fase3-consolidada.md` §8, com dimensionamento inicial de 4 shards/minuto e gatilho de re-sharding via alarme.

## References
`architecture-fase3-consolidada.md` §8, `capacity-model.md`, `slo.md` §3, `data-model.md` §3 (GSI3).
