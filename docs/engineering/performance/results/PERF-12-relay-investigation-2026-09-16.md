# PERF-12 — investigação do relay após o teste de 10k

Investigação somente leitura em dev, 2026-09-16. Complementa o
[resultado de carga](PERF-12-10k-revalidation-2026-09-16.md). Nenhuma mudança de
produto ou infraestrutura foi implantada nesta investigação.

## Conclusão e limites

**Defeito confirmado: republicação sistemática de imagens antigas do outbox.**
Os 10.000 eventos de dispatch da população exata foram publicados duas vezes
pelo relay. As 52 continuações do scan do minuto-alvo também foram publicadas
duas vezes. Há espera mensurável no relay tanto para dispatch quanto para
continuações de scan. A duplicação gera trabalho adicional nessa mesma etapa;
sua contribuição quantitativa ao SLO precisa de repetição após correção isolada.
Não afirmar que eliminar as duplicações, sozinho, garantirá os cinco minutos.

## Evidência correlacionada

Janela CloudWatch Logs: 21:49–22:00 UTC (18:49–19:00 BRT). Agrupamento por
eventId, sem count_distinct aproximado: 10.092 eventos, exatamente duas linhas
PUBLISHED por evento, total 20.184. Também houve 30.276
SKIPPED_ALREADY_PUBLISHED e 10.000 SKIPPED_WRONG_DESTINATION. Sem linhas
FAILED, HANDLER_ERROR, schema-invalid ou failed-to-parse nessa consulta.

Query consistente das partições de outbox dos dez tenants encontrou 10.000
eventos SQS_REMINDER_DISPATCH_V1. Join por tenantId + aggregateId com as
ocorrências persistidas confirmou 10.000 identidades únicas da população;
join por eventId com os logs confirmou duas publicações para cada uma.
Os outros 92 eventos publicados são continuações SYSTEM, 52 do minuto-alvo.

| Intervalo, 10.000 eventos | p50 | p95 | p99 | Máximo |
|---|---:|---:|---:|---:|
| Outbox criado → primeiro log PUBLISHED | 41,818s | 95,800s | 121,021s | 126,850s |
| Primeiro log PUBLISHED → TRIGGERED | 0,067s | 0,305s | 1,238s | 6,383s |
| Primeiro → segundo log PUBLISHED | 64,583s | 116,965s | 126,500s | 127,066s |

O primeiro log é emitido **depois** de SendMessage e markPublished; não é o
timestamp exato de entrada na SQS. Dispatch pode terminar antes desse log
(mínimo observado -606ms), e relógios entre funções não são um tracing causal
perfeito. Portanto, a segunda linha é um intervalo observado, não uma medida
exata de latência de SQS. Ainda assim, a concentração de espera antes do log
é clara. Para as 2.476 ocorrências atrasadas, a espera criação→primeiro log
foi de 37,998s a 126,850s, mediana 61,591s.

Nas 52 continuações do minuto-alvo, criação→primeiro log variou de 0,125s a
70,597s. Como páginas dependem de continuações, essa espera também alonga o
scan. Não somar percentis entre etapas ou atribuir toda a espera à duplicação.

## Mecanismo no código

1. INSERT contém status PENDING; publishOne tenta adquirir lease.
2. tryAcquireLease atualiza leaseOwner/leaseExpiresAt, gerando MODIFY ainda PENDING.
3. O envio SQS termina; markPublished grava PUBLISHED e remove a lease.
4. Mais tarde, o relay processa a imagem histórica do passo 2. publishOne vê
   PENDING nessa imagem, apesar de o item atual já estar PUBLISHED.
5. A condição persistida é somente attribute_not_exists(leaseOwner) OR
   leaseExpiresAt < :now. Como a lease foi removida, passa e envia novamente.

Fontes: src/workers/dispatch-outbox-relay/relay.ts,
src/shared/outbox/persistence/dynamodb-outbox-relay-store.ts e
src/runtime/aws/handlers/dispatch-outbox-relay-processor.ts.
O fake em test/unit/dispatch-outbox-relay/relay.test.ts também permite
readquirir depois de markPublished; testar apenas uma imagem já PUBLISHED e
concorrência simultânea não cobre o replay de uma imagem antiga PENDING.

A AWS documenta NewImage como imagem do item após aquela modificação, não uma
leitura atual: [DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html).
O mapping observado usa batch 25, parallelization factor 1, sem FilterCriteria;
o handler processa os registros sequencialmente. Assim, tráfego geral da tabela
e escritas extras do relay competem pelo processamento. Isso descreve o caminho
de amplificação; não prova que aumentar concorrência seja a primeira correção.

## Atraso anterior ao relay

As quatro continuações iniciais do minuto 18:49 só foram criadas entre
18:50:31.021 e 18:50:31.555 BRT, aproximadamente 91s após o alvo. Sua espera
inicial no relay foi apenas 397–665ms. Esse atraso anterior é separado.

Logs de enumeração confirmam: a execução concluída às 18:49:31.217 enumerou
até o minuto 18:48; a execução às 18:50:31.575 enumerou até 18:49. A segunda
enumeração levou 2,374s, portanto não gastou 91s executando código.
O handler usa o scheduledTime recebido e aplica floor de minuto.
O Scheduler está ENABLED, rate(1 minute), flexible window OFF, sem StartDate,
com input aws.scheduler.scheduled-time. Não há captura do input original
nesta evidência para separar exatamente fase do rate e atraso de invocação.

A AWS especifica precisão de 60s para invocações e distingue horário agendado
do momento de execução: [tipos de schedule](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html),
[atributos de contexto](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-context-attributes.html).
Não atribuir os 91s inteiros ao relay nem declarar falha do Scheduler com base
nesses dados. Instrumentar scheduledTime/receivedAt ajuda a fechar essa parcela.

## Defeito adjacente em retries

O processor retorna record.eventID em batchItemFailures.itemIdentifier.
Para DynamoDB Streams, a AWS exige dynamodb.SequenceNumber:
[partial batch failures](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html).
Corrigir e testar as duas saídas (FAILED e exceção). Nenhuma delas foi observada
na janela, portanto este defeito não é causa demonstrada do atraso do teste.

## Remediação e critério de revalidação

1. Condicionar a aquisição atomicamente ao status persistido PENDING, além da
   disponibilidade da lease. Não substituir por um Get seguido de Update sem
   condição. Garantir que item ausente não seja criado pela aquisição.
2. Cobrir replay de imagem antiga após publicação, concorrência, lease expirada,
   registro ausente e recuperação após falha de envio. Verificar a condição real
   do adapter, além do fake; preservar tolerância a duplicatas legítimas de uma
   entrega at-least-once.
3. Corrigir o identificador de partial failure em alteração separadamente
   verificável. Instrumentar o atraso inicial antes de mudar a semântica do tick.
4. Executar gates aplicáveis e deploy via pipeline. Repetir o mesmo degrau de
   10k; comparar duplicações, IteratorAge, espera outbox e SLO de 300s.
5. Só então avaliar filtro/concorrência se necessário. Não avançar 100k/1M
   enquanto o degrau de 10k continuar reprovado.

## Artefatos locais

Diretório .local/d300-10k-preparation-20260916/ (relativo a performance):
relay-query-{outcomes,publications,failures,timeline}.json,
relay-{dispatchTimes,scanTimes}.json, relay-system-raw.json,
relay-tenant-1.json até relay-tenant-10.json, relay-target-scan-outbox.json,
relay-correlation.json e producer-investigation-result.json. Dumps permanecem
locais; este relatório preserva os agregados e a metodologia.
