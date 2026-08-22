---
status: approved
owner: engineering
authority: design
---

# Reconciliação Codex — rodada 2 (desenho final, entrega 1)

Convergência Claude↔Codex sobre mecanismo real de rollback para `cd.yml` (`AGENTS.md` §4).
Claude propôs alias+versão (round1); Codex propôs o mesmo mecanismo com manifesto S3 persistido,
`terraform plan -out=tfplan`/`apply tfplan`, e compensação de falha parcial (round1, nota cega).
Claude aceitou a proposta do Codex como base com 3 ajustes (round2 crítica): bucket S3 dedicado
(não reusar buckets de tenant), gate de aprovação humana no `workflow_dispatch` de rollback, e
fatiamento de canários semânticos como entrega 2 separada. Codex concordou com os 3 e produziu
este desenho final reconciliado.

Concordo com os três ajustes. Eles preservam a proposta-base e tornam a entrega 1 mais segura,
operacionalmente isolada e implementável nesta sessão.

## Desenho final reconciliado — entrega 1

### 1. Versionamento e alias das Lambdas

Todas as 13 funções passam a usar:

- `publish = true` em `aws_lambda_function`;
- alias estável `live`, gerenciado pelo Terraform;
- alias apontando inicialmente para `aws_lambda_function.this.version`;
- gatilhos reais apontando para o alias qualificado, nunca para `$LATEST`.

O módulo Lambda passa a expor:

- `function_name`: nome não qualificado, para observabilidade e operações administrativas;
- `published_version`: versão imutável criada pelo deploy;
- `live_alias_arn`: ARN qualificado `:live`;
- `live_alias_invoke_arn`: URI qualificada para API Gateway;
- `live_alias_name`: `live`.

Os consumidores serão ajustados assim:

- API Gateway integra e concede permissão de invocação ao alias;
- EventBridge Scheduler invoca o ARN do alias e sua role recebe permissão sobre esse ARN;
- event source mappings SQS usam o ARN qualificado do alias;
- permissões SNS/Lambda usam o alias quando o SNS for o invocador;
- alarmes continuam usando o nome não qualificado quando a intenção for observar a função como
  um todo, evitando mudar silenciosamente a semântica atual de métricas.

O deploy normal continua responsável por avançar `live` para a nova versão. O rollback
emergencial altera somente aliases e não executa `terraform apply`.

### 2. Plano Terraform exato

O CD passa de dois cálculos independentes para:

```
terraform plan -out=tfplan
terraform show tfplan
terraform apply tfplan
```

Assim, o plano exibido no run é exatamente o plano aplicado. O arquivo `tfplan` é efêmero e não
integra o manifesto, pois pode conter valores sensíveis e não é necessário para o rollback de
alias.

Esta entrega não promove o plano produzido pelo job de CI para o CD. Ela elimina a discrepância
interna do próprio CD entre o plano exibido e o apply executado; promoção cross-workflow do plano
da CI fica fora do escopo.

### 3. Bucket S3 dedicado aos manifestos

Será criado um módulo Terraform específico para um bucket operacional:

```
exptrk-<env>-deploy-manifests
```

O bucket:

- não armazena dados de tenant nem dados pessoais;
- tem Block Public Access integral;
- usa Object Ownership `BucketOwnerEnforced`;
- usa criptografia server-side SSE-S3;
- tem versionamento habilitado;
- usa `force_destroy = false`;
- possui lifecycle para manifestos históricos, inicialmente 180 dias;
- não expira o ponteiro `current-healthy`;
- recebe tags comuns do projeto.

Estrutura de objetos:

```
deployments/<deploymentId>.json
pointers/current-healthy.json
rollbacks/<rollbackId>.json
```

O manifesto de deploy contém, no mínimo:

```json
{
  "schemaVersion": 1,
  "deploymentId": "<github-run-id>-<github-run-attempt>",
  "commitSha": "<sha>",
  "createdAt": "<UTC ISO-8601>",
  "environment": "dev",
  "workflowRunUrl": "<url>",
  "previousHealthyDeploymentId": "<id ou null>",
  "functions": {
    "<function-name>": { "version": "42", "alias": "live" }
  },
  "postCheck": { "type": "shallow", "status": "passed" },
  "status": "healthy"
}
```

O ponteiro `pointers/current-healthy.json` contém o `deploymentId` saudável mais recente e é
atualizado somente depois de: (1) `terraform apply tfplan` terminar; (2) os aliases serem
conferidos; (3) o pós-check raso passar; (4) o manifesto imutável ser persistido. Se apply ou
pós-check falhar, o ponteiro saudável não é avançado.

O acesso do workflow ao bucket deve ser limitado a `ListBucket`, `GetObject`, `PutObject` e
leitura de versionamento apenas nesse bucket/prefixos. Nenhum bucket de documentos de tenant
será reutilizado.

### 4. Workflow manual de rollback

Será criado `.github/workflows/rollback.yml`, disparado exclusivamente por `workflow_dispatch`.

Entradas: `environment` (nesta entrega, só `dev`); `deployment_id` (opcional; vazio = usa
`previousHealthyDeploymentId` do manifesto apontado por `current-healthy`); `confirmation` (deve
corresponder literalmente, ex. `ROLLBACK dev`).

O job usa `environment: dev`. O environment `dev` deverá ter ao menos um required reviewer
configurado nas configurações do GitHub — critério operacional obrigatório da entrega: o YAML
referencia o environment, mas o required reviewer é proteção do repositório, não recurso do
workflow.

O workflow: (1) assume role AWS por OIDC; (2) valida a confirmação literal; (3) lê
`pointers/current-healthy.json`; (4) resolve o manifesto-alvo; (5) valida schema, ambiente, nomes
das 13 funções e versões numéricas; (6) confirma com `aws lambda get-function` que cada
versão-alvo existe; (7) captura o mapa corrente dos aliases antes de qualquer mutação; (8)
atualiza sequencialmente os 13 aliases com `aws lambda update-alias`; (9) confirma cada alias com
`aws lambda get-alias`; (10) executa o pós-check raso; (11) grava registro em
`rollbacks/<rollbackId>.json`; (12) atualiza `current-healthy` para o manifesto restaurado
somente se todo o processo e o pós-check passarem.

O workflow não aceita nomes ou versões livres fornecidos pelo operador. O manifesto persistido é
a fonte do mapa completo, reduzindo rollback parcial por erro de entrada.

### 5. Compensação de falha parcial

Antes da primeira troca, o workflow salva o mapa corrente (`function-name -> current alias
version`). Se uma atualização falhar no meio: (1) interrompe as atualizações restantes; (2)
tenta restaurar, em ordem reversa, todos os aliases já alterados; (3) verifica o resultado da
compensação; (4) grava o registro de rollback com uma destas classificações:
`failed_before_routing_change`, `partial_failure_compensated`,
`partial_failure_compensation_failed`, `routing_restored_health_unverified`, `completed`.

A distinção operacional permanece explícita: `routing_restored` (os aliases apontam para as
versões solicitadas) vs. `health_verified` (o pós-check raso passou). Um rollback pode, portanto,
restaurar roteamento sem afirmar falsamente que a aplicação está semanticamente saudável. Se a
compensação também falhar, o workflow termina com erro, não altera `current-healthy` e inclui no
summary o mapa esperado e o mapa efetivamente observado.

### 6. Pós-check da entrega 1

Deliberadamente raso: `describe-table`/`describe-user-pool`/`get-queue-attributes` (já
existentes) + `aws lambda get-alias` para as 13 funções + confirmação de que cada alias aponta
exatamente para a versão declarada no manifesto. Prova existência dos recursos e restauração do
roteamento — não prova comportamento funcional dos handlers.

## Arquivos exatos da entrega 1

**Criados**: `infra/modules/deploy-manifest-bucket/{main,variables,outputs,versions}.tf` +
`tests/deploy_manifest_bucket.tftest.hcl`; `.github/workflows/rollback.yml`.

**Modificados**: `infra/modules/lambda-function/main.tf` (`publish=true` +
`aws_lambda_alias.live`), `outputs.tf` (versão publicada + ARNs qualificados), `tests/*.tftest.hcl`;
`infra/main.tf` (instancia bucket, faz wiring dos ARNs qualificados para API Gateway/Scheduler/
SQS/SNS); `infra/outputs.tf` (nome/ARN do bucket, mapa `function_name -> published_version`);
`infra/modules/api-gateway/{main,variables}.tf` + testes (integração/permissão usam `:live`);
`infra/modules/reminder-schedule/{main,variables}.tf` + testes (targets/políticas apontam para
alias); `infra/tests/stack.tftest.hcl` (cobertura raiz); `.github/workflows/cd.yml`
(`plan -out=tfplan`/`apply tfplan`, coleta de versões, verificação de aliases, pós-check raso,
persistência do manifesto, avanço de `current-healthy` só após sucesso completo, summary com
deploymentId/commit/versões).

Não há necessidade de modificar código TypeScript dos handlers nem schemas de domínio/API.

## Critérios de aceitação

As 13 funções têm versão publicada e alias `live`; todos os invocadores usam o alias (nenhum
`$LATEST` em produção); o plano exibido pelo CD é o mesmo arquivo aplicado; deploy saudável cria
manifesto e avança `current-healthy`; deploy com pós-check falho não avança o ponteiro; rollback
exige aprovação pelo environment protegido; rollback para o manifesto anterior restaura as 13
versões; falha parcial exercita a compensação em teste controlado; o registro distingue
roteamento restaurado de saúde verificada; `terraform test`/`validate`/gates existentes
permanecem verdes.

## Fora do escopo explícito da entrega 1

Canários semânticos por handler; modo dry-run/evento sintético reconhecido pelos workers;
validação end-to-end de API Gateway/SQS/Scheduler/SES/DynamoDB; promoção automática baseada em
canários; rollback automático sem decisão humana; weighted aliases/traffic shifting/CodeDeploy;
rollback de recursos Terraform; aplicação de plano Terraform histórico; rollback de
schema/IAM/filas/schedules/API Gateway/Cognito; rollback ou compensação de dados DynamoDB;
reversão de efeitos externos já produzidos (e-mails enviados); remoção automática de versões
antigas de Lambda; promoção cross-workflow do plano da CI; suporte multiambiente além de `dev`.

A entrega 2 deverá desenhar canários por classe de handler e só então decidir se o ponteiro
`current-healthy` pode representar saúde semântica, em vez da definição mais limitada de "apply,
roteamento e pós-check raso concluídos".

## Avaliação final

Nota do Codex para o desenho final reconciliado: **9.2/10** — atinge o gate de 9.0 e pode ser
implementado sem mais rodadas de desenho, mantendo a entrega 2 de canários semânticos registrada
explicitamente como follow-up.

Nota do Claude (concordância pós-reconciliação): os 3 ajustes pedidos foram todos endereçados de
forma concreta e não deixada implícita (bucket dedicado com política de acesso restrita definida;
`environment: dev` com required reviewer explicitamente declarado como critério operacional;
canários fatiados com escopo da entrega 2 explicitamente descrito) — **9.1/10**. Convergido,
aprovado para implementação da entrega 1 nesta sessão.
