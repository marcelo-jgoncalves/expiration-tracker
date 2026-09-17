# PERF-12 — latência residual da rodada de 10k, 2026-09-17

Status: causa dominante localizada; nenhuma alteração de arquitetura ou infraestrutura aplicada.

## Resultado observado

A rodada `d300-10k-recovery2-20260917`, com alvo `2026-09-17T16:00:00Z`, terminou com
10.000/10.000 occurrences em `TRIGGERED`, sem ausentes, erros, throttles ou mensagens em DLQ.
O SLO de máximo em 300 segundos, porém, foi reprovado:

| Percentil | scheduledAt → TRIGGERED |
|---|---:|
| p50 | 200,244 s |
| p90 | 301,424 s |
| p95 | 324,778 s |
| p99 | 353,130 s |
| máximo | 359,983 s |

A decomposição das próprias occurrences mostra dois componentes:

- `scheduledAt → claimedAt`: p50 126,888 s; p90 222,560 s; p95 248,012 s;
  máximo 305,243 s;
- `claimedAt → TRIGGERED`: p50 41,391 s; p90 96,439 s; p95 106,842 s;
  máximo 138,360 s.

## Causa dominante confirmada

A cadeia de paginação do scan depende do mesmo relay de DynamoDB Streams que publica os 10.000
outboxes de dispatch. Cada página grava um outbox de continuação; esse registro precisa atravessar
o stream compartilhado antes que a próxima página do shard seja colocada na fila de scan. Durante
o burst, os outboxes de dispatch elevaram `IteratorAge` do `dispatch-outbox-relay` até **138.952 ms**.
As continuações ficaram intercaladas com esse volume e o scan avançou em ondas:

| Minuto UTC | Páginas processadas | Claims concluídos |
|---|---:|---:|
| 16:01 | 24 | 4.800 |
| 16:02 | 3 | 600 |
| 16:03 | 29 | 4.026 |
| 16:04 | 7 | 530 |
| 16:05 | 5 | 44 |

Os logs do relay para `tenantId=SYSTEM` registram exatamente a mesma quantidade de publicações
de continuação em cada minuto (24, 3, 29, 7 e 5). Isso liga a interrupção da paginação ao atraso
do stream, e não à fila de scan. A fila apresentou idade máxima de apenas 1 segundo.

O mapping do relay usa `BatchSize=25`, `MaximumBatchingWindow=0` e
`ParallelizationFactor=1`. A documentação da AWS confirma que, por padrão, cada shard do
DynamoDB Stream é processado por uma única instância e em ordem; `ParallelizationFactor` pode
subir até 10 preservando a ordem das alterações de cada item. Fontes oficiais:
[processamento de DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)
e [parâmetros do event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-params.html).

## Latência-base do agendamento

Há ainda um custo estrutural anterior ao scan. O Scheduler configurado com
`FlexibleTimeWindow=OFF` invocou consistentemente cerca de 30 segundos depois do instante nominal.
Isso está dentro do contrato oficial de precisão de 60 segundos do EventBridge Scheduler. Como o
tick nominal `15:59:59Z` só examina até o minuto `15:59`, o minuto-alvo `16:00` foi adquirido pelo
tick `16:00:59Z`, recebido às `16:01:29Z`: cerca de **89 segundos após o scheduledAt** antes do
início do trabalho útil. Fonte: [precisão do EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html).

Esse custo não explica sozinho a reprovação: após o scan começar, a contenção do relay acrescentou
até aproximadamente 216 segundos ao claim das últimas ocorrências.

## Causas descartadas nesta rodada

- **Replay/duplicação antiga:** 10.080 publicações válidas no relay, exatamente 10.000 dispatches
  e 80 continuações; 80 páginas processadas com 80 message IDs distintos.
- **Dispatch como gargalo primário:** concorrência máxima observada de 43; fila com idade máxima
  de 1 segundo; nenhum erro ou throttle. O trecho pós-claim ainda contribui para a cauda, mas segue
  as ondas de entrada produzidas pelo relay.
- **Claim consumer saturado:** concorrência máxima observada de 54, fila sem idade mensurável e
  10.000 resultados `CLAIMED` sem erro/throttle.
- **Capacidade DynamoDB/SQS:** nenhum throttle e nenhuma DLQ na janela.

## Próximo experimento controlado

O próximo passo de menor alcance é executar o item 17.5 variando somente o
`ParallelizationFactor` do mapping do relay (primeiro 2, depois 4 se necessário), mantendo
batch size, scan, claim e dispatch constantes. Medir `IteratorAge`, distribuição de páginas por
minuto, latência de claim e duplicidade. A mudança afeta todas as categorias de outbox desse stream
e precisa de revisão do diff e dos invariantes de ordenação antes do deploy.

Separar a continuação em outro consumidor/stream ou mudar o protocolo de publicação pode remover
o acoplamento de forma definitiva, mas é redesenho arquitetural. Não deve ser adotado antes de o
experimento simples demonstrar se a capacidade do relay já basta para cumprir o SLO.

O teste de 100k continua suspenso: além do gate de SES, multiplicaria justamente a contenção agora
confirmada e não produziria uma medida útil da arquitetura pretendida.
