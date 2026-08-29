# Expiration Tracker

Micro-SaaS de controle de vencimentos/renovações (certificados, contratos, apólices, licenças) com lembretes multi-canal. Arquitetura AWS serverless, TypeScript/Node 20, DynamoDB single-table.

**Status**: pré-produção, recomendação **CONDITIONAL GO** para piloto controlado (`docs/engineering/pilot-readiness-assessment.md`). Design maturity aprovado; backend (M0-M11, mais M6/M7) e infraestrutura (Terraform/GitHub Actions, ADR-0009) implementados e deployados em `dev`; Full BFF + frontend de produção implementados; planejamento de interface com 8 de 9 etapas aprovadas. Este README é só o ponto de entrada — nunca a fonte de verdade: ver `docs/architecture/README.md` (mapa de arquitetura vigente) e `NEXT_SESSION_PROMPT.md` (estado atual + próxima ação, nunca normativo). `ARCHITECTURE.md`/`ENGINEERING.md` são os resumos executivos consolidados de arquitetura/engenharia, não histórico.

## Começando

Pré-requisitos: Node 20.x (fixado em `.nvmrc`), npm. Docker é necessário só para `npm run test:dynamodb` (Testcontainers sobe DynamoDB Local) — não é pré-requisito dos demais comandos.

```bash
npm ci                  # install imutável (scripts de terceiros desabilitados via .npmrc)
npm run typecheck       # TypeScript estrito
npm run lint            # ESLint (max-warnings=0) - feedback rápido de boundary só no caso de import direto, não autoritativo (ver check-boundaries)
npm run check-boundaries # dependency-cruiser - enforcement AUTORITATIVO de boundary de arquitetura (grafo real, não só texto do import)
npm test                # Vitest: unit + contract + integration
npm run test:dynamodb   # Vitest contra DynamoDB Local via Testcontainers (requer Docker) - não roda em `npm test`, job de CI separado (dynamodb-integration)
npm run validate-schemas # valida schemas/ (JSON Schema via Ajv)
npm run check-docs      # link relativo quebrado + referência AGENTS.md §N desatualizada
npm run build           # compila para dist/
npm run build:lambdas   # bundla os handlers via esbuild (pré-requisito de terraform plan/apply)
```

Infra (`infra/`, Terraform — ver ADR-0009): `terraform fmt/validate/test/plan` rodam no job `infra` do CI a cada PR; `terraform apply` só roda via `.github/workflows/cd.yml`, em push para `main` — nunca localmente.

Todos os comandos acima (exceto `test:dynamodb`, que roda num job de CI separado) devem rodar limpos localmente antes de qualquer PR — são os mesmos que o job `guardrails` do CI executa (`.github/workflows/ci.yml`).

## Estrutura do repositório

```text
src/shared/        — primitivas cross-módulo (erros, config, observabilidade, DynamoDB/OCC, idempotência, outbox, schemas)
src/modules/       — domain/application/ports/http por módulo de negócio (identity, expiration, reminder, notification, document, subject, import, extraction, bff)
src/workers/       — lógica assíncrona pura (producer/dispatch/reconciliation/purge), testável com relógio injetado
src/runtime/aws/   — handlers Lambda reais (único lugar que importa AWS SDK/observability concreta)
infra/             — Terraform (infraestrutura, ADR-0009)
frontend/          — SPA de produção (Vite+React+TS+React Router v7+TanStack Query v5)
prototype/         — protótipo interativo do planejamento de interface (HTML/CSS/JS sem dependências)
schemas/           — contratos JSON Schema (events/queues/api) — fonte de verdade de contrato
test/              — unit, integration, contract, architecture
docs/architecture/ — design maturity + estado de implementação (ver docs/architecture/README.md)
docs/engineering/  — padrões de qualidade, gates, backlog do programa de pilot readiness
docs/frontend/     — planejamento de interface (UX/IA/journeys) + docs de produção do frontend
docs/project/      — como trabalhar com o Marcelo (ferramentas/processo), handoffs históricos
```

## Para agentes de IA (Claude Code, Codex CLI)

Leia `AGENTS.md` na raiz primeiro — é a fonte canônica de regras de processo para qualquer agente trabalhando neste repositório (`CLAUDE.md` só importa esse arquivo).

## Convenções principais

- TypeScript estrito (`noUncheckedIndexedAccess`); erros usam a taxonomia de `src/shared/errors/app-error.ts`.
- Toda escrita mutável usa os builders de `src/shared/dynamodb/occ.ts` (nunca `UpdateItem`/`PutItem` cru).
- Eventos críticos usam o outbox transacional (`src/shared/outbox/outbox.ts`) na mesma `TransactWriteItems` do agregado.
- `console.*` é proibido fora de `src/shared/observability/**` (ESLint `no-console`) — todo handler usa `SecureLogger`.
- `domain/` de cada módulo não pode importar `infra/`, `aws-sdk`, ou internals de outro módulo — enforced pelo grafo real de imports via `dependency-cruiser` (`npm run check-boundaries`), não só por convenção; ESLint sozinho não pega import transitivo cross-módulo (ver `decisions-log.md`).
