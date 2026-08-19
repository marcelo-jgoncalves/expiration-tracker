# ADR-0002 — Isolamento Multi-tenant: tenantId em Toda Chave desde o Day 0

**Status**: Aceito | **Data**: 2026-08-19 | **Type**: Type 1 | **Requisitos**: SCALE-004, NFR-020

## Contexto
Produto é single-tenant no MVP mas precisa evoluir para Organizations (FUT-001) sem migração destrutiva.

## Options Considered
1. **`tenantId` obrigatório em toda chave/objeto/evento desde o Day 0** (escolhida) — `tenantId=userId` até Organization existir.
2. Adicionar tenancy depois, quando Organizations for implementado — rejeitada: exigiria migração estrutural de todos os dados existentes, violando SCALE-004.

## Claude/Codex Proposal
Convergência independente na Rodada 1 da Fase 3.

## Rebuttals
Nenhuma — consenso desde a primeira rodada.

## Evidence
`data-model.md` (toda PK prefixada `TENANT#<tenantId>`); testes negativos de isolamento exigidos por SCALE-004 (API, workers, storage, logs, restore).

## Security/Privacy Impact
Gate G5 (fitness function) ativa automaticamente quando dados de tenants distintos compartilharem infraestrutura lógica — testado nesse momento, não antes (evita over-engineering prematuro nem esquecer o gate).

## Scale Impact
Estrutura de dados já pronta para Organizations sem remapeamento de schema — apenas mudança de valor de `tenantId` (`userId`→`organizationId`), com plano de migração dual-write/backfill/cutover em `evolution.md`.

## Trade-offs
Nenhum custo adicional relevante — `tenantId` já seria necessário para autorização de qualquer forma.

## Final Decision
`tenantId` obrigatório em toda entidade, chave física DynamoDB, objeto S3, mensagem, idempotency key e evento, sem exceção, desde o primeiro commit de schema.

## References
`architecture-fase3-consolidada.md` §6, `data-model.md`, `evolution.md` (gatilho de migração para Organizations).
