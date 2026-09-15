# ReminderProducer structural fix — Round 3 (Claude closing)

## Resposta aos achados da Round 2 (nota 8.3/10, régua 8.7/10)

Todos os 6 pontos residuais do Codex são procedentes. Incorporo cada um; nenhum é descartado.

**1. Checkpoint/fence idempotente contra amplificação da cadeia de scan.** Cada mensagem de scan
carrega `scanJobId` (determinístico: `hash(shardGeneration|shardIndex|minute)`, mesmo por
construção para a mesma unidade de trabalho, nunca gerado por `newEventId()`) + `pageIndex`
(0, 1, 2... incrementado só pelo próprio scanner ao publicar uma continuação). Antes de processar,
o scanner faz um `PutItem` condicional (`attribute_not_exists`) numa entrada de
"page-in-flight" keyed por `(scanJobId, pageIndex)`, TTL curto (ex. 5 min, maior que o timeout do
scanner) na MESMA tabela principal (nenhuma tabela nova). Uma segunda entrega da mesma mensagem
SQS (at-least-once) encontra a condição já satisfeita, sabe que essa página está (ou já foi)
processada, e não republica a mesma continuação nem os mesmos candidatos — fecha o cenário
"cadeias paralelas" citado pelo Codex. Isso é o MESMO padrão de idempotência condicional
(`attribute_not_exists`/OCC) já usado em todo o resto deste código (claim condicional, outbox),
não um mecanismo novo de classe diferente.

**2. Recuperação de DLQ / identidade idempotente do job.** Uma mensagem de scan (unidade de
trabalho ou continuação) que cai em DLQ da fila de scan é, por construção, identificável
(`scanJobId`+`pageIndex`+`shardGeneration`+`shardIndex`+`minute` no corpo) — um redrive manual ou
automatizado (mesmo runbook padrão de DLQ já usado por `dispatch_queue`'s própria DLQ neste
projeto) reprocessa exatamente essa página, sem ambiguidade sobre "de onde continuar", porque o
checkpoint do item 1 garante que reprocessá-la não duplica trabalho já feito rio abaixo. Alarme
(`ApproximateNumberOfMessagesVisible` > 0 na DLQ de scan) já é o mesmo padrão de alarme que este
projeto já usa para toda outra DLQ (nível de implementação, não uma exceção nova a inventar).

**3. Observabilidade end-to-end nas DUAS filas, não só na de claim.** Aceito integralmente:
`ApproximateAgeOfOldestMessage` reportado para AMBAS as filas (scan e claim), e a métrica
primária de saúde do pipeline deixa de ser só idade de fila — volta a ser baseada em
`scheduledAt`/minuto do candidato mais antigo ainda não `CLAIMED`, o mesmo espírito de
`scheduler_lag_seconds` que o producer já emite hoje, agora calculável a partir do timestamp
embutido na PRÓPRIA mensagem de candidato (`scheduledAt` já é um campo do `ReminderOccurrence`
lido antes de publicar) comparado a `now()` no momento do claim — nenhuma fila precisa ser a
única fonte de verdade da idade.

**4. `TransactionCanceledException` — distinguir motivo, não engolir tudo.** Aceito: o claim
consumer inspeciona `CancellationReasons` da exceção (já exposta pelo SDK DynamoDB) e só trata
como "perdeu a corrida, não é falha" quando o motivo é especificamente `ConditionalCheckFailed`
no item da occurrence (o caso esperado de corrida contra outro claim). Qualquer outro motivo
(throttling, conflito de outbox, erro de validação) permanece como falha real, reportada em
`failed[]`/`ReportBatchItemFailures` — mesmo princípio fail-closed que `unknownEntityType` já
aplica hoje no código atual, só estendido para não mascarar throttling como "corrida perdida".

**5. Backpressure/concorrência explícitos.** Nomeado (nível de implementação, decisão arquitetural
aqui é só QUE controles existem, não os valores exatos): `maximumConcurrency` no
`aws_lambda_event_source_mapping` de AMBAS as filas (scan e claim), dimensionado contra a
capacidade DynamoDB on-demand (que o próprio PERF-12 10k mediu absorvendo 22.502 WCU de pico sem
throttle — folga real já demonstrada empiricamente), mais `reserved_concurrent_executions` como
hoje já existe em `reminder_producer`/`reminder_dispatch` (`infra/main.tf` — mesmo padrão, não um
mecanismo novo).

**6. `SendMessageBatch`, `ReportBatchItemFailures`, contrato de mensagem — formalizados.**
- Retry só das entradas em `Failed[]`; falha/timeout da chamada inteira tratada como resultado
  AMBÍGUO (pode ter parcialmente publicado) — nesse caso a página inteira NÃO confirma (mensagem
  de scan não é acked), reprocessa do zero; o checkpoint do item 1 já garante que candidatos
  publicados na tentativa anterior não duplicam efeito (a duplicação na fila de claim é
  inofensiva por OCC, como já estabelecido na Round 2 e não contestado pelo Codex).
- `ReportBatchItemFailures` habilitado nos DOIS event-source-mappings (scan→scanner,
  claim→claim-consumer) — item só é confirmado individualmente quando processado com sucesso,
  nunca o batch inteiro tratado como unidade de sucesso/falha.
- Contrato de mensagem de candidato: `PK`+`SK`+`GSI3SK` BRUTO como única autoridade (retiro a
  alternativa "ou já pré-parseado" que o Codex corretamente rejeitou como fonte de verdade
  duplicada) — o claim consumer roda os MESMOS parsers fail-closed (`parseGsi3Sk`/
  `parseChasingGsi3Sk`) que o producer já roda hoje, sem duplicar a decisão de tipo em dois
  lugares.

## Checklist — versão final (reconciliada, sem mudança de peso desde a Round 2, âncoras
completadas conforme o Codex pediu)

1. **Correção estrutural / progresso durável e retomável** (40%) — âncora "atende" agora inclui
   explicitamente: avanço de cursor é idempotente via checkpoint condicional por
   `(scanJobId, pageIndex)`, não só "após publish confirmado".
2. **Recuperação operacional** (25%) — âncora "atende" agora inclui explicitamente: DLQ de AMBAS
   as filas com identidade de job reprocessável, alarme de backlog em ambas, métrica de idade
   baseada em `scheduledAt` do candidato mais antigo (não só idade de mensagem SQS).
3. **Preserva fronteira IAM/GSI3** (20%) — inalterado da Round 2 (Codex concordou que o peso
   estava correto).
4. **Alinhamento com padrão AWS + simplicidade** (15%) — âncora "não atende" agora inclui
   explicitamente: qualquer encadeamento sem proteção contra duplicação at-least-once
   (amplificação de cadeia) conta como NÃO atendendo este critério, mesmo que reaproveite SQS
   corretamente em outros aspectos.

## Fontes desta rodada (verificação adicional das 3 já citadas + 1 nova, todas oficiais AWS)

Reaproveito as 3 fontes da Round 2 (`Query.Pagination.html`, `API_SendMessageBatch.html`,
`with-sqs.html`, todas `docs.aws.amazon.com`, citadas pelo próprio Codex e já verificadas) para
fundamentar os itens 1 e 6 acima. Nenhuma fonte nova necessária para os itens 2-5 — são
composições diretas de mecanismos (DLQ, CloudWatch, `maximumConcurrency`,
`CancellationReasons`) já documentados e já em uso neste mesmo projeto (`dispatch_queue`,
`reserved_concurrent_executions` em `reminder_producer`/`reminder_dispatch`), não um padrão novo
exigindo pesquisa externa adicional.

## Decisão final proposta

**Opção B, forma final**: descoberta paginada e idempotente (checkpoint condicional por página)
publicando numa fila de scan retomável → candidatos discriminados por `GSI3SK` bruto publicados
numa fila de claim → claim consumer com claim condicional OCC existente, distinção correta de
`CancellationReasons`, `ReportBatchItemFailures` nas duas pontas, DLQ+alarme+idade em ambas as
filas, backpressure explícito via `maximumConcurrency`/`reserved_concurrent_executions`. Fecha
todos os 6 achados da Round 2 sem introduzir nenhum mecanismo de coordenação além dos já nativos
de DynamoDB (OCC, `LastEvaluatedKey`, checkpoint condicional) e SQS (visibility timeout, DLQ,
partial batch response) — nenhum serviço AWS novo além de uma segunda fila SQS (módulo Terraform
já existente e reutilizado, não inventado).
