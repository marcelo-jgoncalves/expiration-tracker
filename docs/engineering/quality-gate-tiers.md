# Tiers de Gate de Qualidade — Expiration Tracker

> Formaliza (padrão adotado do `event-discovery-platform`, ADR-009 de lá) algo que este projeto já fazia informalmente desde M3.5 como "Camada 1/2/3" (`docs/architecture/m3.5-runtime-design.md`). Mapeamento explícito abaixo — não é um sistema novo, é dar nome ao que já existe e fixar a regra de bloqueio de cada tier.

## Tier A — toda PR (`guardrails` no CI, obrigatório, bloqueia merge)

`typecheck`, `lint`, `check-boundaries` (dependency-cruiser, grafo real de imports), `validate-schemas`, testes unit+contract+integration (fakes em memória) + synth de infra CDK, `npm audit --omit=dev` (produção, bloqueante — zero vulnerabilidade não tratada), `npm audit` dev (informacional, cruzar com `exceptions.md`), SBOM CycloneDX. Corresponde à **Camada 1** do plano de testes de milestones com runtime real (ex. M3.5).

**Vermelho aqui bloqueia merge em `main`, sem exceção.**

## Tier B — merge para `develop`/antes de deploy real (`dynamodb-integration` no CI + testes manuais de Camada 2/3)

Testes contra serviços reais via container (DynamoDB Local, LocalStack/Testcontainers) — prova `ConditionExpression`/`TransactWriteItems`/`Query` reais, não a aproximação da fake em memória. Corresponde à **Camada 2**. Não bloqueia `guardrails`, mas bloqueia a decisão de fazer deploy real de um milestone que dependa do componente testado.

## Tier C — antes de declarar um gate de engenharia fechado (G1-G8) ou promover `ARCHITECTURE STATUS`

Sandbox AWS efêmero: IAM real (`AccessDenied` para role sem permissão), redrive de DLQ real, invocação real de EventBridge Scheduler/Rule, teste de restore real (`disaster-recovery.md` §6). Corresponde à **Camada 3**. Gate mais caro (custo real de AWS, tempo de setup) — só roda quando o milestone genuinamente depende dele, nunca "por rotina".

## Regra de bloqueio

- Tier A vermelho: PR não mergeia.
- Tier B vermelho: milestone não é considerado testado contra runtime real, mesmo com Tier A verde — não declarar "implementação pronta" nesse estado (foi o erro que quase aconteceu em M3.5 antes da Camada 2 rodar).
- Tier C vermelho, ou não executado: gate de engenharia (G1-G8) permanece aberto, `ARCHITECTURE STATUS` permanece `NOT APPROVED`, independente de quão verde Tier A/B estejam.

## Política de exceção de vulnerabilidade

Ver `docs/engineering/exceptions.md`. Toda exceção tem `owner`, `criadoEm`, `expiraEm` explícitos — uma exceção sem `expiraEm` não é uma exceção documentada, é uma vulnerabilidade escondida. Ao expirar sem reavaliação, a exceção deixa de justificar o achado (voltar a tratá-lo como novo até ser re-registrada).
