# PERF-12 — investigação de causas adicionais, 2026-09-16

Complemento ao [diagnóstico do relay](PERF-12-relay-investigation-2026-09-16.md),
com consultas somente leitura. Janela principal: 18:49–19:00 BRT; métricas
complementares incluem 18:48. Nenhuma alteração de runtime/infra foi aplicada.

## 1. Scan publica novamente antes de rejeitar uma página antiga — confirmado

runScanPage, em src/workers/reminder-scan/scan-page.ts, verifica existência,
status IN_PROGRESS e ownerToken da lease antes de consultar GSI3. Entretanto,
não compara o cursor recebido com o cursor atual nesse ponto. Publica todos
os candidatos da página e só depois tenta o checkpoint, cuja condição rejeita
o cursor antigo. Isso preserva o avanço correto, mas desperdiça leitura/envio
em replays de páginas anteriores da mesma cadeia ainda ativa.

Join das correlações das 52 continuações do minuto-alvo com os logs de scan:

| Resultado da população exata | Quantidade |
|---|---:|
| PROCESSED | 52 |
| LOST_CHECKPOINT_RACE | 48 |
| STALE_NO_OP | 4 |

Na janela, claim consumer registrou 10.000 CLAIMED, 9.064
SKIPPED_NOT_SCHEDULED e 536 LOST_CLAIM_RACE: **19.600 tentativas para 10.000
ocorrências**. As 48 páginas rejeitadas são compatíveis com 48 × 200 = 9.600
candidatos extras; as quatro duplicatas finais encontraram lease COMPLETED.
Não há retry de negócio necessário para explicar esse padrão: o relay já
publicou duas vezes cada continuação. O defeito de scan amplifica essa entrada
duplicada, mas também pode ocorrer com redelivery legítimo de SQS.

Dispatch registrou exatamente 10.000 TRIGGERED e 10.000 ALREADY_TRIGGERED.
A idempotência absorveu os envios repetidos; não há evidência de 20.000
transições nem de entrega duplicada ao provedor neste levantamento.

Remediação proposta: detectar cursor obsoleto e lease expirada antes de ler e
publicar candidatos, mantendo a condição transacional final. A leitura inicial
não elimina a corrida entre execuções simultâneas; candidatos e claims devem
continuar idempotentes. Testes devem distinguir replay após checkpoint de
concorrência real, além de preservar recuperação após falha antes do checkpoint.

## 2. Cadeias de páginas acumulam espera no relay — quantificado

Cada shard teve 13 páginas, cuja próxima continuação passa pelo relay compartilhado.
Somando criação→primeiro log PUBLISHED das 13 continuações de cada cadeia:

| Shard | Criação inicial → conclusão | Soma de espera até logs | Residual |
|---|---:|---:|---:|
| 0 | 171,568s | 149,712s | 21,856s |
| 1 | 200,661s | 179,468s | 21,193s |
| 2 | 211,729s | 190,022s | 21,707s |
| 3 | 186,370s | 162,873s | 23,497s |

O log ocorre após envio e marcação PUBLISHED, podendo sobrepor processamento
downstream. Portanto, residual é uma decomposição aproximada, não CPU exclusiva
ou tracing exato. Mesmo com essa ressalva, a espera ocupa aproximadamente
87–90% do intervalo observado de cada cadeia. Aumentar concorrência da fila
de claim não remove essa dependência entre páginas.

As 104 execuções de scan correlacionadas ao alvo somaram 139,096s de tempo de
operação, incluindo repetições e execuções sobrepostas. Esse total não pode ser
somado ao tempo de parede. Na janela inteira, nenhuma página individual passou
de 2,476s. Não há sinal de uma página isolada executando por minutos.

## 3. Quatro leitores do mesmo stream — risco estrutural confirmado, efeito incerto

Mappings Enabled do stream exptrk-dev-table: dispatch-outbox-relay,
notification-router, notification-email-outbox-relay e
notification-whatsapp-outbox-relay. Todos sem FilterCriteria, batch 25 e
ParallelizationFactor 1. A AWS recomenda até dois leitores Lambda simultâneos
por shard para tabelas não globais; mais leitores podem causar throttling:
[documentação AWS](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html).

IteratorAge máximo observado: dispatch 127,804s; router 66,170s; email 2,711s;
WhatsApp 2,995s. O atraso desigual é compatível com trabalho diferente em cada
consumidor; **não prova throttling compartilhado**. Lambda Throttles=0 mede
invocações, não exclui limitação na leitura do stream. LastProcessingResult=OK
é apenas o estado atual, não um histórico da janela.

Filtro no mapping pode reduzir invocações/trabalho, mas não transforma quatro
consumidores em dois. Uma eventual reorganização de consumidores é decisão de
arquitetura, sujeita aos gates próprios; não alterar a topologia junto com a
correção pontual e perder a capacidade de medir seu efeito isolado.

O router está depois de TRIGGERED. Seus 66,170s não explicam diretamente o
SLO medido até TRIGGERED, mas mostram que esse SLO não representa entrega ao
destinatário. Trabalho downstream ainda gera tráfego na tabela compartilhada.

## 4. Atraso inicial anterior à fila interna da Lambda — localização melhorada

Já confirmado: o minuto 18:49 só teve continuações iniciais criadas às
18:50:31.021–31.555; enumeração durou 2,374s. AsyncEventAge do producer teve
máximo de apenas 78ms na janela ampliada. Essa métrica mede espera após Lambda
receber/enfileirar o evento, conforme a
[documentação AWS](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html).
Assim, não há fila interna de Lambda de 91s sustentando esse atraso.

O schedule usa rate(1 minute), sem StartDate explícito, e o código enumera pelo
scheduledTime recebido, arredondado para baixo. Os logs mostram consistentemente
o minuto anterior ao relógio de execução. A fase do rate e o intervalo até a
invocação são a hipótese principal para essa parcela, não cold start ou scan
demorado. Falta o scheduledTime original no log do producer para fechar a
decomposição em segundos; não inferir seu valor exato da CreationDate.
Instrumentar scheduledTime e receivedAt antes de decidir entre alinhar schedule
e mudar o minuto de referência, preservando a semântica aprovada de lookback.

## 5. Tracing apresentou falhas — confirmado, impacto no SLO não demonstrado

No claim consumer, busca de falhas encontrou 23 registros de telemetria:
17 timeouts do exporter OTLP, dois Internal Server Error do exporter e quatro
falhas do collector awsxray, com soma de rejected_items=406. Essa soma é dos
registros, não uma contagem de traces únicos perdidos. Não eram falhas de claim.

PostRuntimeExtensionsDuration máximo: producer 199,80ms; claim 559,72ms;
dispatch 499,81ms; relay 540,28ms. Isso não demonstra uma extensão bloqueando
por minutos nem mede todo overhead de instrumentação dentro do handler.
Tratar exportação/amostragem de traces como frente de observabilidade; não
desativar tracing e declarar resolvido o problema de performance sem comparar.

## 6. Claims expiraram antes do dispatch — risco de recuperação, sem efeito nesta janela

120 ocorrências foram TRIGGERED após claimExpiresAt. Todas as 10.000 terminaram
na versão 3, coerente com SCHEDULED→CLAIMED→TRIGGERED. Reconciliações às
18:51:16 e 18:56:16 reportaram claimsReverted=0 e scanLeaseReclaimed=0.
Portanto, não houve ciclo de reset/reclaim observado que explique este teste.

Entretanto, claim TTL de 120s é menor que a espera pós-claim máxima observada
de 126,909s. Outro alinhamento temporal da reconciliação pode provocar trabalho
adicional. Revalidar esse cruzamento após reduzir a espera; não aumentar TTL
apenas para ocultar o gargalo e atrasar recuperação legítima.

## Prioridades e evidência preservada

Primeiro: corrigir republicação do relay e cobrir replay obsoleto no scan com
testes que preservem as garantias de recuperação. Depois, repetir 10k com
timestamps do Scheduler observáveis. Tratar quatro consumidores, configuração
do relay e tracing como hipóteses/frentes separadas, conforme os resultados.

Não há prova de saturação de capacidade do DynamoDB: as consultas de
ReadThrottleEvents/WriteThrottleEvents e SystemErrors não retornaram datapoints;
ausência não foi convertida em zero. Latências máximas de serviço disponíveis:
Query 59,898ms, GetItem 221,050ms e TransactWriteItems 321,325ms; não incluem todo
tempo de rede/retries do SDK. Os dados favorecem espera/repetição entre etapas.

Artefatos locais em performance/.local/d300-10k-preparation-20260916/:
additional-query-*.json, additional-detail-*.json, additional-target-scan-logs.json,
additional-scan-chain.json, additional-metrics.json, extensions-metrics.json,
additional-stream-mappings.json e stream-age-comparison.json.
