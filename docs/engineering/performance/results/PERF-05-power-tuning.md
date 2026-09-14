# PERF-05 — Lambda Power Tuning

## Metodologia

Ferramenta oficial open-source [AWS Lambda Power Tuning](https://github.com/alexcasalboni/aws-lambda-power-tuning)
(alexcasalboni), publicada na AWS Serverless Application Repository (SAR), implantada como stack
CloudFormation **isolado e independente** do Terraform deste projeto — não gerencia, não referencia
e não é referenciado por `infra/`. Decisão explícita do usuário: ferramenta diagnóstica descartável,
não uma dependência de produto.

- **App SAR**: `arn:aws:serverlessrepo:us-east-1:451282441545:applications/aws-lambda-power-tuning`,
  versão `4.4.0`.
- **Stack**: `perf-tuning-lambda-power-tuning` (conta `975707451904`, região `us-east-1`, perfil
  `claude-dev`), criado via `aws serverlessrepo create-cloud-formation-template` +
  `aws cloudformation create-stack --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND`.
- **State machine**: `arn:aws:states:us-east-1:975707451904:stateMachine:powerTuningStateMachine-26d9cbc0-b061-11f1-b8bc-0affce8a4e05`
  (Output `StateMachineARN` da stack). Fica disponível para reuso futuro (ex.: PERF-11, ou uma nova
  rodada pós-mudança de código) — não precisa ser reimplantado, e pode ser destruído a qualquer
  momento com `aws cloudformation delete-stack --stack-name perf-tuning-lambda-power-tuning` sem
  qualquer efeito no produto.
- **Valores de memória testados**: `256, 512, 1024, 1769` MB (alinhado à lista do plano).
- **Parâmetros de execução**: `num=10` invocações por valor de memória (40 invocações reais por
  função), estratégia `balanced` (custo x duração), `parallelInvocation` variando entre `true`/`false`
  entre tentativas (ver "Achado" abaixo).

**Como funciona**: a state machine cria aliases temporários da função-alvo em cada valor de memória,
invoca a função `num` vezes por alias medindo duração e custo real, escolhe a configuração "ótima"
segundo a estratégia, e por fim **restaura a configuração original de memória** da função (ver seção
de verificação abaixo). Isso significa que a ferramenta *modifica temporariamente* a memória
configurada da função-alvo durante o teste — comportamento esperado e aprovado, não um bug.

## Funções testadas

Todas as 8 funções listadas no plano existem na conta `dev` e foram testadas:

| Função | Status |
|---|---|
| `exptrk-dev-bff-handler` | OK — dado coletado |
| `exptrk-dev-items-handler` | OK — dado coletado (retry após throttling, ver achado) |
| `exptrk-dev-subjects-handler` | OK — dado coletado (retry) |
| `exptrk-dev-document-archive-handler` | OK — dado coletado |
| `exptrk-dev-reminder-producer` | OK — dado coletado, **único com lógica de negócio real exercitada** |
| `exptrk-dev-reminder-dispatch` | OK — dado coletado (retry) |
| `exptrk-dev-dossier-export-generation-handler` | OK — dado coletado |
| `exptrk-dev-pdf-parser-task-handler` | **Não foi possível medir de forma útil** — ver caveat abaixo |

## Achado: throttling por execução concorrente acidental

Na primeira rodada, dois scripts de orquestração ficaram rodando em paralelo por um erro
operacional (um processo em background que não foi de fato interrompido antes de iniciar o
seguinte), disparando invocações concorrentes demais para a mesma função e gerando
`Lambda.TooManyRequestsException` (429) em `items-handler`, `subjects-handler`,
`reminder-dispatch` e `pdf-parser-task-handler`. Essas 4 execuções retornaram `{}` (sem dado
utilizável). Foram re-executadas individualmente (`parallelInvocation:false`, sem concorrência
externa) e as 3 primeiras produziram dados válidos; `pdf-parser-task-handler` continuou falhando
por um motivo diferente (ver abaixo). Nenhuma invocação de produção real foi afetada — apenas as
próprias invocações de teste da ferramenta.

## Caveat importante: payload sintético sem sessão autenticada real

`bff-handler`, `items-handler`, `subjects-handler` e `document-archive-handler` esperam eventos
`APIGatewayProxyEventV2` (HTTP API) com claims JWT válidas do authorizer. Sem um token de sessão
real, o teste usou um evento sintético mínimo (`requestContext.authorizer.jwt.claims` com
`sub`/`jti`/`iat`/`exp` fabricados, rota `GET /items`) — suficiente para passar da extração de
claims e do parsing sem lançar `TypeError`, mas que **é rejeitado pela validação de rota/autorização
de negócio em ~27ms**, antes de qualquer lógica de domínio real (DynamoDB, etc.) ser executada.
Por isso a duração medida para essas 4 funções (e para `reminder-dispatch` e
`dossier-export-generation-handler`, testadas com `{"Records":[]}` — um lote SQS vazio que retorna
imediatamente) é **overhead fixo de invocação/roteamento**, não representativo do custo real de
processar um request de negócio completo. Construir payloads plenamente autenticados e válidos
para cada rota estava fora do escopo de tempo desta rodada.

A única função testada com uma carga que exercita lógica de negócio real de ponta a ponta foi
`exptrk-dev-reminder-producer` — o payload `{"scheduledTime": "..."}` aciona um scan real na tabela
DynamoDB do tenant (`runProducerTick`), e os números abaixo refletem isso claramente (variação
grande entre memórias, ao contrário do resto).

`exptrk-dev-pdf-parser-task-handler` espera um `RunDeterministicParserInput` estruturado
(`pipelineVersion` etc.) que não foi reconstruído dentro do orçamento desta tarefa — toda tentativa
(payload `{}`) falhou com `InternalError: Unknown pipelineVersion: undefined`. **Não há dado de
power tuning para esta função nesta rodada.**

## Resultados

Dados extraídos do estado `Analyzer` de cada execução da state machine (array `stats`, mais preciso
que o resumo final `output`, que só reporta o "vencedor" da estratégia `balanced`).

### `exptrk-dev-reminder-producer` — única com lógica de negócio real

| Memória (MB) | Duração média (ms) | Custo médio/invocação (USD) |
|---|---|---|
| 256 | 2187.50 | 7.44e-06 |
| 512 | 808.73 | 5.51e-06 |
| 1024 | 930.53 | 1.27e-05 |
| 1769 | **170.99** | 4.04e-06 |

**Recomendação: 1769 MB.** Ganho de ~12.8x em latência (2187ms → 171ms) vs. 256 MB, e ainda assim o
*menor* custo médio por invocação entre as 4 opções (mais vCPU proporcional a memória processa o
scan/paginação mais rápido, então a fatura por invocação cai apesar do preço/ms subir) — não há
trade-off aqui, 1769 MB vence em latência E custo simultaneamente. 1024 MB é uma anomalia (pior que
512 MB) provavelmente por variância de amostra (`num=10` é pequeno) ou por um salto de vCPU
fracionário desfavorável nessa faixa — recomenda-se re-testar com `num` maior antes de aplicar em
produção, mas o sinal para não ficar em 256 MB é forte e consistente.

### Demais funções (overhead de invocação/roteamento apenas — ver caveat acima)

| Função | 256 MB | 512 MB | 1024 MB | 1769 MB |
|---|---|---|---|---|
| `bff-handler` | 26.76 ms / $9.18e-08 | 24.60 ms / $1.70e-07 | 26.87 ms / $3.81e-07 | 26.85 ms / $6.58e-07 |
| `items-handler` | 26.83 ms / $9.52e-08 | 27.00 ms / $1.90e-07 | 26.71 ms / $3.81e-07 | 26.89 ms / $6.34e-07 |
| `subjects-handler` | 26.88 ms / $9.18e-08 | 26.86 ms / $1.84e-07 | 26.73 ms / $3.67e-07 | 26.93 ms / $6.58e-07 |
| `document-archive-handler` | 26.82 ms / $9.18e-08 | 27.08 ms / $1.90e-07 | 27.09 ms / $3.81e-07 | 27.02 ms / $6.58e-07 |
| `reminder-dispatch` | 27.02 ms / $9.52e-08 | 27.03 ms / $1.90e-07 | 26.95 ms / $3.81e-07 | 26.66 ms / $6.58e-07 |
| `dossier-export-generation-handler` | 24.46 ms / $8.5e-08 | 26.78 ms / $1.84e-07 | 26.55 ms / $3.67e-07 | 26.98 ms / $6.58e-07 |

**Recomendação para essas 6 funções: manter 256 MB** — dentro do ruído de medição (±2-3ms) a
duração não varia com memória porque o request sintético nunca chega a executar trabalho
CPU-bound (falha em validação/roteamento em ~27ms fixos). Custo por invocação sobe linearmente
com memória sem nenhum ganho de latência observado, então subir memória aqui seria estritamente
pior dado **este** teste. Esta recomendação é **de baixa confiança** e não deve ser tratada como
definitiva — precisa ser revalidada com payloads de negócio reais (sessão autenticada válida,
corpo de request real) antes de qualquer decisão de produção, porque é plausível que a lógica de
negócio real (queries DynamoDB, serialização, etc.) seja sensível a CPU/memória do mesmo jeito que
`reminder-producer` demonstrou ser.

`Cold InitDuration` e percentis p50/p95/p99 não foram coletados nesta rodada — a ferramenta de
power tuning mede duração média de `num=10` invocações (majoritariamente warm, já que roda em
rajada), não percentis nem separa cold start. Para esses dados, ver a metodologia de
`results/PERF-02-cold-start.md` (CloudWatch Logs Insights sobre `REPORT` nativo) se necessário no
futuro.

## Escopo: diagnóstico apenas, nenhuma mudança aplicada

Nenhuma configuração de memória de nenhuma função de produto foi alterada permanentemente por este
trabalho. A ferramenta restaura a configuração original ao final de cada execução — verificado
explicitamente após as rodadas para `exptrk-dev-items-handler`, `exptrk-dev-reminder-producer` e
`exptrk-dev-bff-handler` via `get-function-configuration`: todas permanecem em **256 MB**, o valor
original antes de qualquer teste.

Qualquer mudança real de memória (a começar pela recomendação forte de `reminder-producer` → 1769
MB) requer uma decisão e PR de Terraform separados, revisados normalmente — fora do escopo desta
tarefa.
