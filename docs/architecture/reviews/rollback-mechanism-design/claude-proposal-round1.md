---
status: draft
owner: engineering
authority: evidence
---

# Proposta Claude (rodada 1, nota cega) — mecanismo real de rollback para `cd.yml`

Achado que motiva isso: rodada focada de revisão (`full-audit-round1-focused-round2-summary.md`)
— nenhum mecanismo de rollback/roll-forward existe hoje; `cd.yml` só faz `terraform apply` para
frente, sem forma de reverter rápido se um deploy quebrar algo (como o próprio bug real do
EventBridge Scheduler desta sessão mostrou: um erro sutil só apareceu depois do deploy).

## Restrições que a proposta deve respeitar

- `AGENTS.md` §7: toda implantação real é via pipeline (`cd.yml`, apply em push a `main`), nunca
  `terraform apply` local — rollback precisa ser um mecanismo de pipeline, não um passo manual.
- As 13 funções Lambda hoje são `aws_lambda_function` simples (sem `publish=true`, sem alias) —
  cada `apply` sobrescreve o código de `$LATEST` diretamente, sem histórico versionado no lado da
  AWS.
- `infra/modules/lambda-function` é o módulo reusado pelas 13 funções — mudança ali afeta todas.

## Proposta: versionamento + alias `live`, rollback via workflow manual que só troca alias

1. **`infra/modules/lambda-function`**: adicionar `publish = true` ao `aws_lambda_function`
   (cada `apply` bem-sucedido publica uma versão numerada imutável do código, além de
   `$LATEST`). Adicionar `aws_lambda_alias "live"` apontando para essa versão publicada. Todo
   gatilho real (SQS event source mapping, EventBridge Scheduler target, API Gateway integration)
   passa a apontar para o **ARN do alias** (`function_arn:live`), não para `$LATEST` — padrão
   documentado da AWS para releases seguras.
2. **`cd.yml` (deploy normal)**: sem mudança de fluxo — `terraform apply` já move o alias `live`
   para a versão nova publicada, automaticamente, porque o alias é gerenciado como recurso
   Terraform apontando para `aws_lambda_function.this.version`.
3. **Novo workflow `rollback.yml` (`workflow_dispatch` manual, nunca automático)**: recebe
   `function_name` (ou "all") e `target_version` (número, ou "previous" = a versão que estava
   publicada antes do deploy anterior, lida do último `terraform show` salvo — ver item 4).
   Executa `aws lambda update-alias --name live --function-version <target_version>` via CLI
   direto (não Terraform) para reverter em segundos, sem esperar um `terraform apply` completo.
   **Depois** de um rollback manual, o próximo `cd.yml` normal precisa reconciliar o estado
   Terraform (ele veria o alias "fora" do que o state espera e o reaplicaria para a versão mais
   recente de novo) — isso é aceitável: rollback manual é uma mitigação de emergência de minutos,
   não substitui corrigir e re-deployar a causa raiz.
4. **Rastreamento de "versão anterior"**: `cd.yml` já grava um "Deploy summary" (job existente)
   — estender para incluir a lista `função: versão publicada` naquele deploy, como um artifact do
   workflow run (não em S3/Terraform state) recuperável via `gh run view --log` ou artifact
   download. `rollback.yml` com `target_version=previous` lê o artifact do run de deploy anterior
   mais recente via `gh api`/`actions/download-artifact`.
5. **Pós-check de rollback**: `rollback.yml` termina com o mesmo smoke test raso que `cd.yml` já
   tem (describe-table/describe-user-pool/get-queue-attributes) + `aws lambda get-alias` para
   confirmar a versão do alias mudou de fato.

## O que esta proposta explicitamente NÃO resolve

- Rollback de infraestrutura (Terraform) em si — só de código Lambda. Uma mudança de schema
  DynamoDB/IAM/SQS não tem rollback automático aqui; esse risco maior fica registrado como
  limite explícito, não escondido.
- Rollback de dado (nenhuma mudança de estado do DynamoDB é revertida por isto).

## Alternativas consideradas e rejeitadas

- **Terraform `apply` de um plano salvo anterior**: mais "correto" architeturalmente, mas lento
  (minutos, não segundos) para uma emergência, e reintroduz exatamente a race de lock de state
  que `cd.yml` já teve que corrigir nesta sessão (dois applies quase simultâneos). Alias é mais
  rápido e não toca o state.
- **Reverter o commit e deixar o `cd.yml` normal rodar**: correto para a correção definitiva, mas
  não é "rollback rápido" — ainda espera CI+CD completos (minutos), inclui rebuild do bundle
  esbuild (não determinístico, achado separado desta sessão), e depende de mais um ciclo de PR.
  Alias-swap é o complemento rápido, não substituto.
