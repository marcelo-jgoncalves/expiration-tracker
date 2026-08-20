# ADR-0009 — Substituição do AWS CDK por Terraform para toda a infraestrutura

**Status**: Aceito | **Data**: 2026-08-20 | **Type**: Type 1 (nível 6, `docs/engineering/change-risk-scale.md` — nova stack tecnológica) | **Decisor**: Marcelo (responsável final por decisões de arquitetura, `AGENTS.md` §1)

## Contexto

Toda a infraestrutura do projeto (`infra/lib/*.ts`) foi construída em AWS CDK desde M1, com uma suíte de testes de synth em memória (`test/infra/stack.test.ts`, 16+ casos) provando propriedades reais: isolamento de IAM do GSI3/GSI6 (nenhuma função tenant-facing referencia esses índices restritos), payload correto do EventBridge Scheduler, contagem/descrição de alarmes CloudWatch, DLQ com `maxReceiveCount`, etc. `NEXT_SESSION_PROMPT.md` registrou ao final da sessão anterior que Marcelo decidiu que o deploy será feito via "pipeline + Terraform", sem especificar inicialmente se isso substitui, coexiste, ou é só a camada de bootstrap/pipeline sobre o CDK existente — três opções de escopo muito diferentes em risco e esforço.

Perguntado diretamente (três opções apresentadas: Terraform só para pipeline/bootstrap; Terraform substitui o CDK inteiramente; Terraform e CDK coexistem por domínio), Marcelo escolheu explicitamente **substituição total** — reescrever toda a infraestrutura de aplicação (DynamoDB, Cognito, API Gateway, 8 Lambdas, SQS+DLQ, EventBridge Scheduler, CloudWatch, Budgets) em HCL, descartando `infra/lib/*.ts`.

## Options Considered

1. **Terraform substitui o CDK inteiramente** (escolhida) — decisão direta de Marcelo, não uma proposta técnica em disputa entre Claude/Codex. O protocolo `AGENTS.md` §4 de nota cega/rodadas de debate normalmente se aplica a decisões Type 1, mas seu propósito é resolver incerteza técnica sobre qual abordagem é melhor quando isso está em aberto — aqui a escolha já foi feita pelo responsável final por decisões de arquitetura (`AGENTS.md` §1), então uma rodada de debate sobre "deveria ser isso?" seria teatro, não revisão real. O que continua exigindo rigor de engenharia real (e é o foco desta ADR e do plano de execução que a acompanha) é COMO migrar sem perder as propriedades já comprovadas pelos testes de infra existentes.
2. Terraform só para pipeline/bootstrap, CDK continua com a aplicação — rejeitada por decisão explícita de Marcelo (não por mérito técnico comparativo; era a opção de menor risco/esforço, mas não foi a escolhida).
3. Terraform e CDK coexistindo por domínio (conta/plataforma vs. aplicação) — rejeitada pelo mesmo motivo.

## Evidence

`NEXT_SESSION_PROMPT.md` (seção "Mudança de rumo em G8/deploy"), conversa desta sessão (usuário escolheu a opção via `AskUserQuestion` depois de as três opções serem apresentadas com trade-offs explícitos).

## Reliability Impact

**Risco real identificado por Claude ao propor esta ADR**: a suíte `test/infra/stack.test.ts` prova propriedades de segurança/confiabilidade genuínas (isolamento de IAM do GSI3/GSI6 é o achado de segurança mais crítico já feito neste projeto, `AGENTS.md` §7) via `aws-cdk-lib/assertions` — uma ferramenta que não existe fora do ecossistema CDK. Migrar sem recriar cobertura equivalente reintroduziria exatamente o tipo de regressão que essa suíte foi criada para pegar (grant de IAM mais amplo que o documentado, wildcard de índice, alarme faltando). Marcelo confirmou explicitamente que os testes perdidos devem ser recriados como parte deste trabalho, não adiados.

## Trade-offs

- **A favor**: uma única stack de infraestrutura (não duas), alinhamento com o padrão do projeto irmão `event-discovery-platform` (que já usa Terraform), Terraform é mais comum em pipelines multi-cloud/multi-conta do que CDK.
- **Contra**: perde o bundling automático de Lambda do CDK (esbuild embutido em `ScopedLambdaFunction`) — Terraform precisa de um passo de build separado antes do `terraform apply`/`plan` referenciar o artefato; perde a expressividade de `aws-cdk-lib/assertions` para testes de infra (equivalente em Terraform é `terraform test`/`.tftest.hcl`, mais verboso para asserções de IAM policy); reescrita integral de ~7 constructs testados e em produção (mesmo que só em dev) é trabalho e risco reais, não backlog cosmético.

## Final Decision

Reescrever toda a infraestrutura em Terraform (`infra-terraform/` ou equivalente, path final definido no plano de execução), recriando as propriedades de teste de `test/infra/stack.test.ts` via `terraform test` (`.tftest.hcl`) antes de considerar a migração completa. `infra/lib/*.ts` (CDK) é removido só depois que a suíte Terraform equivalente estiver verde — nunca simultaneamente sem cobertura, para não haver janela sem prova de isolamento de GSI3/GSI6. Pipeline de deploy real via GitHub Actions + OIDC (sem credenciais de longa duração), usando o perfil AWS `claude-dev` (conta `975707451904`, `us-east-1`) já confirmado funcional só para bootstrap/setup inicial — nunca como credencial do pipeline em produção.

## References

`NEXT_SESSION_PROMPT.md`, `AGENTS.md` §7 (regra de isolamento de GSI descoberta em M3), `test/infra/stack.test.ts` (suíte a ser recriada), `docs/engineering/change-risk-scale.md` (nível 6).
