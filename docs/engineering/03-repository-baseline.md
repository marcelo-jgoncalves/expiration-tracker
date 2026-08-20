# Repository Baseline — Engineering Maturity Review

Congelado no início da Engineering Maturity Review (ver `Prompt Mestre — Engineering Maturity Review do Expiration Tracker.md`, §23). Toda avaliação inicial (Checkpoints 0-12) se refere exatamente a este estado. Correções feitas no Checkpoint 13 serão registradas com novo SHA (BEFORE → AFTER).

## Identidade do commit

```text
commit SHA: 154d6e02d6c17c0c341757db2f131ffa68f6b960
branch: main
timestamp (freeze): 2026-08-19
git status --short:
  ?? "Prompt Mestre — Engineering Maturity Review do Expiration Tracker.md"
```

Working tree limpo exceto pelo próprio prompt mestre desta revisão (arquivo novo, não afeta código). `git log --oneline -5`:

```text
154d6e0 Implementation Blueprint (secao 60) aprovado + implementacao real M0-M3
532c606 Reconciliar drift do threat model na engenharia de contexto
502c759 Threat Model aprovado (secao 33) + reorganizacao de engenharia de contexto
9759f79 Adicionar regra de governanca do single-table DynamoDB
7fc0156 Adicionar desenho tecnico completo da arquitetura (master drawing)
```

Nota: `NEXT_SESSION_PROMPT.md` (escrito antes deste commit) descreve M0-M3 como "nada commitado" — o estado real do repo é que M0-M3 **já está commitado** em um único commit (`154d6e0`). Isso por si é uma observação de baseline (commit único e grande cobrindo 4 milestones, sem granularidade — relevante para Checkpoint 16/Engineering Governance, não corrigido aqui).

## Stack identificada

- Runtime: Node.js 20.x (`.nvmrc`, `package.json engines`), TypeScript 5.5 estrito (`noUncheckedIndexedAccess`).
- Módulo: ESM (`"type": "module"`).
- Package manager: npm, `package-lock.json` presente (lockfile real).
- Test runner: Vitest 1.6 (`vitest run`), coverage via `@vitest/coverage-v8`.
- Lint: ESLint 8.57 + `@typescript-eslint` 7.16 (`eslint . --max-warnings=0`).
- Validação de schema: Ajv 8 + ajv-formats, script próprio `scripts/validate-schemas.ts` (via `tsx`).
- IaC: AWS CDK v2 (`aws-cdk-lib` 2.265.0, `constructs` 10.8.1) — apenas a lib, **CLI `aws-cdk` não instalado** (synth testado só via `aws-cdk-lib/assertions` em memória).
- Dependências de produção: `ajv`, `ajv-formats`, `ulid` (3 pacotes diretos).
- Dependências de dev: 11 pacotes diretos (ver `package.json`).
- `aws-jwt-verify` presente como devDependency (deveria provavelmente ser dependency de produção — usado em runtime de autorização; achado a verificar no Checkpoint 6).

## Estrutura de diretórios (nível 1-2)

```text
.github/workflows/          — CI
infra/{lib,bin}              — CDK constructs e stack
schemas/{api,events,queues}  — contratos JSON Schema
scripts/                     — validate-schemas.ts
src/shared/{config,contracts,dynamodb,errors,idempotency,observability,outbox}
src/modules/{identity,expiration,reminder}
src/workers/{reminder-producer,reminder-dispatch,reminder-reconciliation}
test/{unit,integration,contract,infra}
docs/architecture/           — design maturity (aprovado, fora de escopo desta revisão)
docs/engineering/            — esta revisão (novo)
```

Módulos ausentes vs. blueprint completo (M4-M7, esperado): `notification`, `document`, `audit` (audit existe embutido em `expiration`, não como módulo próprio — verificar), frontend/BFF de sessão.

## Comandos de verificação e resultado no baseline

Executados em 2026-08-19, mesmo SHA, ambiente local Windows (Git Bash), sem AWS CLI/credenciais.

```text
$ npm test
Test Files  19 passed (19)
Tests       123 passed (123)
Duration    ~13s
exit code: 0
```

Nota: `NEXT_SESSION_PROMPT.md` menciona "123 testes" apenas para a sessão do M3, e memória do usuário registrava "390 tests passing" como total acumulado M0-M3. O número real medido agora é **123 testes totais no repositório**, não 390. Divergência a investigar — pode ser que a smoke test suite tenha sido reduzida/consolidada no commit único, ou a cifra de 390 nunca foi verificada com execução real (ver `Prompt Mestre §20`: hierarquia de evidência — execução real > declaração). Tratado como achado, não como fato aceito.

Comandos ainda não executados neste freeze (serão no Checkpoint 5/registrados em `verification-log.md`): `npm run typecheck`, `npm run lint`, `npm run validate-schemas`, `npm run build`, `npm audit`, CDK synth isolado, OpenSSF Scorecard.

## Ferramentas disponíveis no ambiente

- Node/npm: presentes (script executou).
- `git`: presente.
- `codex` CLI: uso obrigatório para revisão independente per `AGENTS.md` §4 (número de seção corrigido em auditoria posterior; o conteúdo/decisão original congelada neste baseline não muda) — disponibilidade a confirmar no Checkpoint 1.
- `aws-cdk` CLI: **não instalado** (achado de DevEx/CI — sintetização real de infraestrutura nunca foi exercitada fora de testes em memória).
- OpenSSF Scorecard: disponibilidade a verificar quando necessário (Checkpoint 6/Prompt Mestre §53) — requer repositório público ou GH token; repo é privado, pode ser `NOT ENOUGH EVIDENCE`/bloqueio técnico a registrar honestamente, não simulado.

## Workflows de CI

`.github/workflows/ci.yml` presente (não auditado em detalhe neste documento — auditoria completa pertence ao Checkpoint 5). Descrito em `AGENTS.md` §6 como executando: typecheck, lint, test, validate-schemas, audit, SBOM (CycloneDX), actions pinadas por SHA. A verificar contra o arquivo real, não contra a descrição.
