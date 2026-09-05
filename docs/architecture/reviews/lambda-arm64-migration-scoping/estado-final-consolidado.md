# Estado Final Consolidado — Migração de Lambdas para ARM64 (Graviton2)

**Status: `APPROVED` E `IMPLEMENTADO` — protocolo Claude↔Codex (`AGENTS.md` §4) completo, 3
rodadas, nota cega final Claude 9,4/Codex 9,5 (ambos ≥9,0, sem arredondar). Origem: pedido direto
de Marcelo (2026-09-05), registrado em `docs/project/roadmap-competitivo-2026-09-01.md` §17.1,
com autorização explícita para implementar assim que o design fechasse.**

## Contexto

Todas as Lambdas do projeto rodavam em x86_64 — nunca decidido explicitamente, era o default
implícito do provider (`aws_lambda_function` nunca declarava `architectures`). Graviton2/arm64
reduz custo (~20% por GB-segundo) sem perda de compatibilidade para workloads Node.js puro.

## Pesquisa externa (E-014): SIM

Fontes primárias AWS (citadas pelo Codex, verificadas): AWS Lambda architecture docs
(`docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html`); AWS Compute Blog, "Migrating
AWS Lambda functions to Arm-based AWS Graviton2 processors" — até 34% melhor price/performance,
20% menor cobrança de duração para funções sem dependência nativa; AWS Lambda pricing (abas
separadas x86/Arm, confirmando a diferença de preço real).

## Achados reais que fecharam as 3 rodadas (verificados empiricamente, não por argumento)

1. **`architectures` é atualização in-place, não recriação** — inicialmente levantado como risco
   pela proposta, CONFIRMADO empiricamente via `terraform plan` REAL contra `dev`
   (`AWS_PROFILE=claude-dev`): todas as ~50 Lambdas mostraram "will be updated in-place" para a
   mudança, nenhuma "must be replaced". Verificado duas vezes (antes/depois de `git stash`).
2. **Achado de drift pré-existente, isolado e confirmado NÃO relacionado**: o plano mostra 4
   `aws_lambda_permission` sendo substituídas (`function_name` mudando para forma qualificada por
   alias `:live`) — verificado que essas 4 substituições aparecem IDENTICAMENTE com ou sem a
   mudança de arquitetura (`git stash`/`pop` isolando a variável). Registrado como dívida
   separada, não corrigido aqui.
3. **Contagem de Lambdas corrigida**: 52 instâncias reais do módulo `lambda-function`
   (`infra/main.tf`), não ~30 como a proposta inicial presumiu; `infra/tests/stack.tftest.hcl`
   ainda enumera exatamente 32 nomes (`lambda_function_names` output) — drift real e
   pré-existente, nomeado, fora de escopo desta decisão (corrigir a enumeração raiz é mudança
   própria).
4. **Layer ADOT arm64 verificado AO VIVO contra a conta AWS real** (`aws lambda
   get-layer-version --profile claude-dev`): `arn:aws:lambda:us-east-1:901920570463:layer:
   aws-otel-nodejs-arm64-ver-1-30-0:4` existe, `CreatedDate` na mesma janela de publicação
   (2025-01-03) que a versão amd64:4 já usada — confirma que é o par certo, não uma versão
   desalinhada.
5. **Fixture de teste raiz corrigido**: `infra/tests/stack.tftest.hcl` passava `adot_layer_arn`
   amd64 para o root module — combinação incoerente com o novo default arm64 do módulo — corrigido
   para arm64.
6. **Cobertura de validação completada**: além de rejeitar múltiplos valores e string não
   reconhecida, novo teste prova que `architectures = []` (lista vazia) também é rejeitado.

## Design final (implementado)

1. Nova `variable "architectures"` (`infra/modules/lambda-function/variables.tf`), tipo
   `list(string)`, default `["arm64"]`, validação: exatamente 1 valor, `x86_64` ou `arm64`.
2. `aws_lambda_function.this` ganha `architectures = var.architectures`
   (`infra/modules/lambda-function/main.tf`) — todas as ~52 Lambdas migram de uma vez (nenhum
   override por módulo — mesma arquitetura para todo o projeto, sem razão técnica para misturar).
3. `infra/env/dev.tfvars`'s `adot_layer_arn` trocado para a variante arm64 (versão `:4`, mesma
   versão da anterior amd64, verificada ao vivo).
4. Testes: módulo `lambda-function` ganha 4 runs novos (default arm64, override para x86_64,
   rejeição de múltiplos valores, rejeição de valor desconhecido, rejeição de lista vazia) — 7/7
   passa. Root `stack.tftest.hcl` fixture ADOT corrigido para arm64 — 23/23 passa.
5. Nenhuma mudança de runtime (`nodejs24.x` já suporta ambas arquiteturas) nem de bundling
   (`esbuild`'s `platform: "node"` é agnóstico de arquitetura).

## Escopo explicitamente fora desta decisão

Corrigir o drift de enumeração de Lambdas (32 nomeados vs. 52 reais em `stack.tftest.hcl`) —
achado real, mas ortogonal, registrado como dívida separada. Corrigir as 4 substituições de
`aws_lambda_permission` (drift pré-existente, confirmado não relacionado a esta mudança).

## Verificação ao vivo (smoke pós-deploy) — pendente até o merge/CD

Combinado com o Codex: confirmar após o CD real que `test-ping-handler` + uma rota HTTP real
(ex. `items-handler`) + um worker/handler assíncrono pesado (`parser-sandbox` ou um worker de
purga de 300s) estão rodando em `arm64` (`aws lambda get-function-configuration
--profile claude-dev` mostra `"Architectures": ["arm64"]`) e respondendo normalmente.
