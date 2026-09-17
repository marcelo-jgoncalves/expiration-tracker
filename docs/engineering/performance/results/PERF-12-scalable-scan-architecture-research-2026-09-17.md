# PERF-12 — pesquisa para arquitetura escalável do ReminderScan

Status: pesquisa e recomendação preliminar; decisão Type 1 e implementação ainda pendentes de
protocolo arquitetural. Fontes consultadas em 2026-09-17 são documentação oficial da AWS.

## Decisão recomendada

Separar completamente o plano de controle do scan do plano de dados de reminders:

1. tabela DynamoDB on-demand exclusiva para `ReminderScanLease` e seus outboxes de continuação;
2. stream e relay exclusivos dessa tabela, sem registros de occurrences, claims ou dispatches;
3. fila SQS Standard exclusiva de páginas, consumida com batch 1 e concorrência dimensionada;
4. claim queue permanece separada e recebe candidatos em `SendMessageBatch`;
5. reconciliação exclusiva encontra leases expiradas e outboxes pendentes;
6. shard generation dimensionada por volume, começando por ensaio em 64 shards para 1M;
7. enumerador usa o minuto corrente observado na execução como limite superior, mantendo o
   lookback e as leases idempotentes.

O relay dedicado pode reutilizar o protocolo já testado de lease de outbox e marcação `PUBLISHED`.
EventBridge Pipes é uma alternativa válida ao Lambda relay, mas não é a recomendação inicial:
entrega do stream ao SQS também é at-least-once e exigiria desenhar como registrar publicação e
como recuperar eventos após a retenção do stream. Reutilizar o relay existente reduz novidade no
protocolo enquanto a tabela/stream dedicados removem a causa do head-of-line blocking.

## Por que o desenho atual não escala horizontalmente até 1M

Com página de 200, 1.000.000 occurrences exigem aproximadamente 5.000 páginas. Com quatro shards
e uma cadeia causal sequencial por shard, cada shard precisa concluir cerca de 1.250 páginas. Mesmo
a 1 segundo por página isso levaria aproximadamente 20,8 minutos. `ParallelizationFactor` no relay
reduz espera de stream, mas não muda essa fronteira matemática.

Para orçamento de 180 segundos de scan após a latência do Scheduler, a quantidade aproximada de
shards é:

`ceil((occurrences / pageSize) × pageDurationSeconds / scanBudgetSeconds)`

| Duração por página | Shards mínimos calculados | Degrau prático |
|---|---:|---:|
| 1,0 s | 28 | 32 ou 64 |
| 1,5 s | 42 | 64 |
| 2,0 s | 56 | 64 ou 128 |

O número definitivo deve vir de teste. Sessenta e quatro shards é o primeiro ensaio razoável para
1M porque dá folga para skew e páginas mais lentas. A geração de shards já versionada permite
migração sem reinterpretar occurrences antigas.

## Modelo de consistência e falhas

Cada transição `acquire`, `reclaim` ou `checkpoint-with-more-pages` continua gravando na mesma
`TransactWriteItems`:

- a nova versão da lease, com `ownerToken`, epoch e cursor;
- um outbox imutável com ID determinístico da versão da lease e o comando da próxima página.

Como os dois itens ficam na tabela de controle, a transação preserva a propriedade atual: não
existe checkpoint confirmado sem continuação durável. O stream dedicado aciona apenas o relay de
controle. Duplicatas continuam permitidas e inofensivas: SQS/Lambda entrega pelo menos uma vez, e
o consumidor valida epoch, owner, versão e cursor antes de consultar GSI3.

Falhas ficam cobertas assim:

| Falha | Recuperação |
|---|---|
| worker cai antes do checkpoint | mensagem SQS reaparece; página é reprocessada |
| transação é cancelada | mensagem falha ou vira race benigna somente quando comprovadamente condicional |
| relay cai antes/depois do envio | lease do outbox + idempotência; eventual duplicata é aceita |
| stream/relay fica indisponível | sweeper lê índice de outboxes pendentes e republica |
| cadeia perde progresso | reconciliador encontra lease expirada e cria nova geração de owner/outbox |
| rollback deixa mensagens antigas | `SCAN_MODE_EPOCH` as descarta antes de tocar a lease |
| poison message | partial batch response, retry limitado e DLQ com alarme |

Enviar a continuação diretamente ao SQS depois do checkpoint foi rejeitado como desenho final:
DynamoDB e SQS não compartilham transação, criando janela de checkpoint sem mensagem. É possível
compensar com estados intermediários e reconciliação, mas isso recria uma outbox menos simples e
mais difícil de provar.

## Dimensionamento dos serviços

- **SQS Standard:** apropriada porque a lease fornece ordenação lógica e idempotência. A AWS
  descreve throughput muito alto e quase ilimitado para filas Standard. FIFO acrescentaria
  ordenação que o protocolo já garante e limitaria concorrência aos message groups.
- **Lambda do scan:** batch 1; `MaximumConcurrency` pelo menos igual ao número de shards ativos
  mais margem para gerações sobrepostas. Standard mode começa com cinco batches e cresce até 300
  invocações adicionais por minuto; se os testes de 1M mostrarem que essa rampa consome o SLO,
  provisioned pollers são uma alavanca posterior, não o default.
- **Publicação de candidatos:** manter lotes de dez, mas substituir os 20 envios sequenciais de uma
  página cheia por concorrência interna pequena e limitada, inicialmente 4 ou 5. O checkpoint só
  avança quando todos os lotes forem aceitos.
- **Tabela de controle:** on-demand, stream habilitado e GSI esparso para leases/outboxes vencidos.
  Seu volume cresce com páginas, não com occurrences: cerca de 5.000 continuações para 1M a 200
  registros por página.
- **Relay:** batch e paralelização medidos isoladamente. Como o stream contém apenas controle, seu
  `IteratorAge` deixa de depender dos milhões de writes de negócio.

## Correção do minuto do Scheduler

EventBridge Scheduler possui precisão de 60 segundos mesmo com flexible window desligada. Hoje o
handler usa o `scheduledTime` nominal; o tick nominal `15:59:59` recebido em `16:00:29` não inclui
o minuto `16:00`, que espera o tick seguinte e perde aproximadamente 60 segundos completos.

O limite superior deve ser `floor(receivedAt)`/relógio corrente, enquanto `scheduledTime` permanece
como telemetria. O lookback inclui minutos anteriores, portanto uma invocação atrasada não pula
trabalho; leases condicionais tornam ticks sobrepostos benignos. Não se deve escanear minuto futuro
para tentar eliminar os 0–59 segundos restantes, pois isso permitiria claim antes do vencimento.

## Alternativas avaliadas

| Alternativa | Veredito |
|---|---|
| aumentar `ParallelizationFactor` do relay global | mitigação temporária; não remove competição nem limite de quatro cadeias |
| segundo mapping filtrado no stream atual | rejeitado; continua compartilhando shards e a AWS recomenda no máximo dois leitores por shard |
| EventBridge Pipe no stream atual | rejeitado pelo mesmo compartilhamento; filtro não cria isolamento físico |
| tabela de controle + EventBridge Pipe | viável; reconsiderar após definir confirmação/reconciliação da publicação |
| Step Functions Distributed Map | inadequado para paginação por cursor; acrescenta execuções/transições sem remover a sequência de cada Query |
| SQS FIFO | desnecessário inicialmente; Standard + fencing já tolera duplicatas e escala melhor |
| schedule individual por occurrence | rejeitado por cardinalidade, custo operacional e precisão de 60 segundos do Scheduler |

## Evidência oficial usada

- [Lambda com SQS: entrega at-least-once e necessidade de idempotência](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [Escalonamento de SQS/Lambda e provisioned pollers](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)
- [Throughput horizontal e batching no SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-throughput-horizontal-scaling-and-batching.html)
- [DynamoDB Streams: ordenação, parallelization factor e limite recomendado de leitores](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)
- [Transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [EventBridge Pipes com DynamoDB: ordem e entrega at-least-once](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-dynamodb.html)
- [Retries, partial batch failure e DLQ em Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-error-troubleshooting.html)
- [Precisão de 60 segundos do EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html)
- [Limites do Distributed Map](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html)

## Gates antes da implementação

1. modelar capacidade para 10k, 100k e 1M com duração observada por página;
2. especificar chaves, GSI, TTL e lifecycle da tabela de controle;
3. provar por testes de falha todas as linhas da tabela acima;
4. planejar migração de leases/outboxes atuais e rollback por epoch;
5. definir alarmes de `IteratorAge`, idade de fila, lease vencida, outbox pendente e DLQ;
6. executar o protocolo arquitetural independente antes do merge, ou registrar nova autorização
   explícita se a exceção vigente for usada;
7. validar em degraus 1k → 10k → 100k → 1M, sem mudar mais de uma variável por experimento.
