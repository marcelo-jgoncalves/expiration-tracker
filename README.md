# Expiration Tracker

Micro-SaaS de controle de vencimentos/renovações (certificados, contratos, apólices, licenças) com lembretes multi-canal. Arquitetura AWS serverless, TypeScript/Node 20, DynamoDB single-table.

**Status**: pré-produção. Design maturity aprovado; implementação real em andamento (M0-M3 concluídos). Ver `ARCHITECTURE.md` e `ENGINEERING.md` (quando existir) para o estado normativo vigente — este README é só o ponto de entrada, não a fonte de verdade.

## Começando

Pré-requisitos: Node 20.x (fixado em `.nvmrc`), npm. Docker é necessário só para `npm run test:dynamodb` (Testcontainers sobe DynamoDB Local) — não é pré-requisito dos demais comandos.

```bash
npm ci                  # install imutável (scripts de terceiros desabilitados via .npmrc)
npm run typecheck       # TypeScript estrito
npm run lint            # ESLint (max-warnings=0) - feedback rápido de boundary só no caso de import direto, não autoritativo (ver check-boundaries)
npm run check-boundaries # dependency-cruiser - enforcement AUTORITATIVO de boundary de arquitetura (grafo real, não só texto do import)
npm test                # Vitest: unit + contract + integration + infra
npm run test:dynamodb   # Vitest contra DynamoDB Local via Testcontainers (requer Docker) - não roda em `npm test`, job de CI separado (dynamodb-integration)
npm run validate-schemas # valida schemas/ (JSON Schema via Ajv)
npm run build           # compila para dist/
```

Todos os comandos acima (exceto `test:dynamodb`, que roda num job de CI separado) devem rodar limpos localmente antes de qualquer PR — são os mesmos que o job `guardrails` do CI executa (`.github/workflows/ci.yml`).

## Estrutura do repositório

```text
src/shared/       — primitivas cross-módulo (erros, config, observabilidade, DynamoDB/OCC, idempotência, outbox, schemas)
src/modules/      — domain/application/ports/http por módulo de negócio (identity, expiration, reminder — mais a caminho)
src/workers/      — lógica assíncrona pura (producer/dispatch/reconciliation), testável com relógio injetado
infra/            — AWS CDK (TypeScript como infraestrutura)
schemas/          — contratos JSON Schema (events/queues/api) — fonte de verdade de contrato
test/             — unit, integration, contract, infra
docs/architecture/ — design maturity (aprovado) — não é o guia de "como trabalhar no código"
docs/engineering/  — Engineering Maturity Review (em andamento) — rubrica, evidência, gates, remediação
```

## Para agentes de IA (Claude Code, Codex CLI)

Leia `AGENTS.md` na raiz primeiro — é a fonte canônica de regras de processo para qualquer agente trabalhando neste repositório (`CLAUDE.md` só importa esse arquivo).

## Convenções principais

- TypeScript estrito (`noUncheckedIndexedAccess`); erros usam a taxonomia de `src/shared/errors/app-error.ts`.
- Toda escrita mutável usa os builders de `src/shared/dynamodb/occ.ts` (nunca `UpdateItem`/`PutItem` cru).
- Eventos críticos usam o outbox transacional (`src/shared/outbox/outbox.ts`) na mesma `TransactWriteItems` do agregado.
- `console.*` é proibido fora de `src/shared/observability/**` (ESLint `no-console`) — todo handler usa `SecureLogger`.
- `domain/` de cada módulo não pode importar `infra/`, `aws-sdk`, ou internals de outro módulo — enforced pelo grafo real de imports via `dependency-cruiser` (`npm run check-boundaries`), não só por convenção; ESLint sozinho não pega import transitivo cross-módulo (ver `decisions-log.md`).
