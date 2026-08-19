# ADR-0004 — Event Backbone: EventBridge + Outbox Seletivo com Sweeper

**Status**: Aceito | **Data**: 2026-08-19 | **Type**: Type 1 (contratos de evento) | **Requisitos**: FR-014, NFR-002

## Contexto
Módulos do monólito precisam de desacoplamento por eventos sem microsserviços, e eventos críticos (ex.: `ItemDueDateChanged`) não podem se perder por dual-write.

## Options Considered
1. **EventBridge + outbox pattern seletivo (apenas eventos críticos) com sweeper/reconciliador** (escolhida).
2. Outbox dependente só de DynamoDB Streams — rejeitada: retenção de 24h, perderia eventos se consumidor caísse por mais tempo (erro identificado e corrigido na Rodada 3 da Fase 3).
3. Kafka/MSK, Kinesis — rejeitadas: overengineering para o volume do produto (CON-002).
4. SNS isolado — rejeitada: menos roteamento/governança de schema que EventBridge.

## Rebuttals
Codex identificou que depender só de Streams seria erro grave (Rodada 3); Claude corrigiu adicionando padrão `PENDING`+reconciliador que reenfileira mesmo após o Stream expirar.

## Evidence
`architecture-fase3-consolidada.md` §11; Red Team cenário 10 (duplicação de eventos) — outbox+dedup por `eventId` cobre o cenário.

## Correctness Impact
Outbox aplicado seletivamente (não a telemetria/eventos reconstruíveis) evita complexidade operacional desnecessária, mantendo garantia forte só onde importa.

## Final Decision
EventBridge para distribuição, outbox pattern com registro `PENDING`+sweeper para eventos críticos, nunca dependência exclusiva de Streams.

## References
`architecture-fase3-consolidada.md` §11, `docs/architecture/history/architecture-fase3/red-team-claude-round1.md` cenário 10.
