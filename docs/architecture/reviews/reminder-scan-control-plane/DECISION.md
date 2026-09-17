---
status: APPROVED_BY_OWNER
decision: D-301
date: 2026-09-17
owner: Marcelo
risk: 6
supersedes: D-299/D-300 only where explicitly stated
---

# D-301 — Plano de controle dedicado e horizontal para ReminderScan

Plano operacional para leitura e avaliação:
[REMINDER_SCAN_CONTROL_PLANE_IMPLEMENTATION_PLAN.md](../../../../REMINDER_SCAN_CONTROL_PLANE_IMPLEMENTATION_PLAN.md).

> **Emenda normativa:** [D-302](AMENDMENT-001.md) substitui a descoberta por GSI3 por uma
> DueWorkTable autoritativa e consistente, torna Enumerator/ScanPage Lambdas distintas e incorpora
> os gates da revisão independente. Em qualquer divergência, D-302 prevalece.

## 1. Decisão

O ReminderScan passa a ter um plano de controle fisicamente separado do plano de dados de
occurrences, claims, notification intents e dispatches. A solução final contém:

1. tabela DynamoDB on-demand exclusiva para leases e outboxes de continuação;
2. DynamoDB Stream e relay Lambda exclusivos da tabela de controle;
3. fila SQS Standard exclusiva de páginas de scan, com batch 1;
4. geração de shards versionada e dimensionável, sem número fixo de quatro shards como teto;
5. publicação de candidatos na claim queue em lotes de dez com concorrência interna limitada;
6. reconciliação própria de leases e outboxes de controle;
7. enumeração limitada pelo minuto corrente observado na execução, não pelo minuto nominal do
   Scheduler recebido com até 59 segundos de atraso;
8. rollout/rollback por backend explícito e epoch monotônico.

D-299/D-300 continuam normativos para paginação por cursor, lease ownership, checkpoint
condicional, idempotência, epoch fencing, partial batch response e fail-closed. D-301 substitui:

- armazenamento das scan leases/outboxes na tabela principal;
- uso do `DispatchOutboxRelay` global para continuações;
- dimensionamento inicial de quatro shards como configuração final;
- `scheduledTime` como limite superior exclusivo da enumeração;
- envio estritamente sequencial dos lotes de candidatos dentro de uma página.

## 2. Autoridade e protocolo Type 1

Risco **nível 6**: muda topologia AWS, modelo de dados de coordenação e protocolo operacional do
pipeline crítico de reminders.

O protocolo Claude↔Codex foi dispensado pela regra de `docs/engineering/ai-governance.md` §2:

1. Marcelo pediu explicitamente “a melhor solução possível e pensando sempre em escalabilidade”,
   recebeu a recomendação de plano de controle dedicado, autorizou pesquisa oficial e, após o
   resultado, determinou “vamos direto à transformação da pesquisa em decisão type 1 com modelo
   de dados e etc.”; isso registra a escolha direta do responsável final;
2. esta seção registra explicitamente a dispensa e sua razão;
3. §13 registra todas as alternativas tecnicamente viáveis e por que não foram escolhidas.

Uma revisão independente posterior continua recomendada como verificação, mas não é gate de
validade desta decisão humana. Qualquer alteração dos invariantes de atomicidade, recuperação,
isolamento ou shard generation desta decisão exige novo Type 1; detalhes locais de implementação
que preservem esses invariantes seguem o gate correspondente ao diff real.

## 3. Pesquisa externa

**Pesquisa externa: SIM.** Checklist derivado das fontes oficiais e usado como régua da decisão:

- entrega SQS/Lambda é at-least-once; todo consumidor precisa ser idempotente;
- Standard queue escala horizontalmente e não deve depender de ordenação física;
- checkpoint e continuação precisam permanecer atomicamente vinculados;
- stream de controle não pode compartilhar throughput/leitores com o stream global;
- no máximo dois leitores simultâneos por shard de DynamoDB Streams é o limite recomendado;
- retries, partial batch response e DLQ precisam cobrir poison/transient failures;
- Scheduler tem precisão de 60 segundos, logo o desenho não pode assumir disparo no segundo zero;
- sharding e concorrência devem provar 10k, 100k e 1M dentro do SLO, sem depender de tuning global;
- rollback deve invalidar mensagens antigas sem reutilizar epoch;
- custo em repouso e sob burst deve crescer de forma previsível.

Fontes oficiais:

- [Lambda com SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [Escalonamento SQS/Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)
- [Throughput horizontal e batching SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-throughput-horizontal-scaling-and-batching.html)
- [DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)
- [Transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [Precisão do EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html)
- [EventBridge Pipes com DynamoDB](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-dynamodb.html)
- [Falhas e retry em Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-error-troubleshooting.html)

Pesquisa preparatória e capacidade: [PERF-12 scalable scan research](../../../engineering/performance/results/PERF-12-scalable-scan-architecture-research-2026-09-17.md).

## 4. Topologia final

```text
EventBridge Scheduler
        |
        v
ReminderScan Enumerator -------- reads active shard generations/config
        |
        | TransactWrite(lease + continuation outbox)
        v
ReminderScanControlTable --stream--> ScanControlRelay --> reminder-scan SQS
        ^                                                   |
        |                                                   v
ScanControlReconciler <------------------------------- ScanPage Lambda
                                                            |
                                                            | Query DueWorkTable page
                                                            | SendMessageBatch x N, bounded parallel
                                                            v
                                                     reminder-claim SQS
                                                            |
                                                            v
                                                   Claim/Dispatch pipeline
```

O plano de controle contém apenas coordenação `SYSTEM`; occurrences e dados de tenant permanecem
na tabela principal. Conforme D-302, o índice autoritativo fica na DueWorkTable sem stream.
ScanPage recebe leitura da DueWorkTable, leitura por chave da occurrence e read/write apenas na
tabela de controle. O relay de controle não recebe permissões na tabela principal.

## 5. Modelo de dados

Tabela por ambiente: `exptrk-${environment}-reminder-scan-control`.

- billing: on-demand;
- chave: `PK` string + `SK` string;
- stream: `NEW_AND_OLD_IMAGES`;
- TTL: `purgeAfterTtl`;
- PITR: habilitado;
- criptografia: chave gerenciada AWS no estágio atual, compatível com as demais tabelas auxiliares;
- GSI1 esparso para recuperação, projeção `ALL` enquanto os dois tipos abaixo compartilham o índice.

### 5.1 Chave canônica da cadeia

`chainId = v{shardFnVersion}#s{shardId}#m{minuteISO}`

`minuteISO` permanece UTC e truncado ao minuto. A função que constrói/parseia `chainId` é única,
pura e coberta por round-trip tests; nenhum handler concatena a chave diretamente.

### 5.2 ReminderScanLease

| Campo | Valor/regra |
|---|---|
| `PK` | `SCAN#${chainId}` |
| `SK` | `LEASE` |
| `entityType` | `REMINDER_SCAN_LEASE` |
| `status` | `IN_PROGRESS` ou `COMPLETED` |
| `ownerToken` | ULID/UUID novo em acquire/reclaim |
| `version` | inteiro monotônico, começa em 1 |
| `rolloutEpoch` | inteiro monotônico do backend ativo |
| `leaseUntil` | ISO UTC; obrigatório em `IN_PROGRESS` |
| `lastEvaluatedKey` | serialização canônica; ausente antes da primeira página e após `COMPLETED` |
| `pagesProcessed` | contador monotônico dentro do owner atual |
| `candidatesPublished` | contador monotônico dentro do owner atual |
| `createdAt`, `updatedAt` | ISO UTC |
| `purgeAfterTtl` | epoch seconds; sete dias após conclusão/última lease |
| `GSI1PK` | `LEASE#IN_PROGRESS` somente enquanto ativa |
| `GSI1SK` | `${leaseUntil}#${chainId}` |

`COMPLETED` remove `GSI1PK/GSI1SK`. A condição de checkpoint exige simultaneamente status ativo,
owner, epoch, versão, lease não expirada e cursor inicial exato.

### 5.3 ReminderScanContinuationOutbox

| Campo | Valor/regra |
|---|---|
| `PK` | `SCAN#${chainId}` |
| `SK` | `OUTBOX#${leaseVersion}` |
| `entityType` | `REMINDER_SCAN_CONTINUATION_OUTBOX` |
| `eventId` | determinístico de `chainId + ownerToken + leaseVersion` |
| `destination` | `SQS_REMINDER_SCAN_CONTINUATION_V2` |
| `status` | `PENDING` ou `PUBLISHED` |
| `payload` | envelope definido em §6 |
| `attemptCount` | inteiro não negativo |
| `nextAttemptAt` | ISO UTC |
| `leaseOwner`, `leaseExpiresAt` | somente enquanto um relay/sweeper detém publicação |
| `createdAt`, `publishedAt` | ISO UTC |
| `purgeAfterTtl` | epoch seconds; sete dias após `publishedAt` ou criação |
| `GSI1PK` | `OUTBOX#PENDING` enquanto pendente |
| `GSI1SK` | `${nextAttemptAt}#${eventId}` |

A chave por versão impede duas continuações diferentes para a mesma transição. A transação que
avança a lease inclui exatamente um `Put` condicional do outbox correspondente quando existe
próxima página; checkpoint para `COMPLETED` não cria outbox.

### 5.4 Configuração da geração

Configuração continua versionada em infraestrutura/configuração implantada:

```json
{
  "shardFnVersion": 2,
  "shardCount": 64,
  "activatedAt": "<ISO UTC>",
  "retireAfter": "<ISO UTC após maior horizonte de reminder>"
}
```

Occurrences já materializadas nunca mudam de geração. Durante migração podem existir duas
gerações ativas; concorrência e orçamento consideram a soma dos shards ativos.

## 6. Contrato `reminder.scan-continuation.v2`

```json
{
  "messageVersion": 2,
  "messageId": "deterministic-event-id",
  "commandType": "reminder.scan-continuation.v2",
  "createdAt": "ISO UTC",
  "correlationId": "corr_*",
  "tenantId": "SYSTEM",
  "deduplicationKey": "chainId|ownerToken|leaseVersion",
  "data": {
    "controlBackend": "DEDICATED_V1",
    "shardFnVersion": 2,
    "shardId": 17,
    "minuteISO": "ISO UTC minute",
    "ownerToken": "owner",
    "leaseVersion": 3,
    "lastEvaluatedKey": "canonical optional cursor",
    "rolloutEpoch": 4
  }
}
```

Todos os campos são obrigatórios exceto `lastEvaluatedKey`. `leaseVersion` passa a fazer parte do
fence; uma mensagem só executa quando todos os campos de posição coincidem com a lease.

## 7. Transições e invariantes

### 7.1 Acquire

Transação: `Put lease(version=1, IN_PROGRESS)` com `attribute_not_exists(PK)` +
`Put outbox(version=1, PENDING)` com condição de ausência.

### 7.2 Checkpoint com próxima página

Depois de todos os candidatos da página serem aceitos pela claim queue:

1. `Update lease`: cursor novo, `version + 1`, lease renovada e contadores;
2. `Put outbox` da nova versão;
3. as duas operações pertencem à mesma `TransactWriteItems`.

### 7.3 Complete

`Update lease` condicional para `COMPLETED`, remove cursor e GSI de lease expirada, incrementa
versão e não cria continuação.

### 7.4 Reclaim

Somente lease `IN_PROGRESS` com `leaseUntil < now`. Substitui owner, incrementa versão e epoch
corrente, reinicia a página a partir do cursor persistido e cria outbox na mesma transação. Não
volta ao início da partição: candidatos anteriores já foram checkpointados.

### 7.5 Invariantes não negociáveis

- nenhum checkpoint com próxima página existe sem outbox durável;
- nenhuma continuação executa sem igualdade de backend, epoch, owner, versão e cursor;
- candidato pode duplicar após crash, mas claim continua idempotente;
- falha de um chunk impede checkpoint da página;
- somente cancelamento comprovadamente condicional vira race benigna;
- outbox `PUBLISHED` nunca volta a `PENDING`; recovery cria/toma lease, não regride status;
- nenhuma entidade tenant-facing lê/escreve a tabela de controle;
- nenhum stream global participa do caminho de continuação.

## 8. Relay, fila e consumidor

### 8.1 ScanControlRelay

- event source mapping no stream exclusivo;
- filtro por `entityType=REMINDER_SCAN_CONTINUATION_OUTBOX`;
- batch inicial 100, batching window 0, `ParallelizationFactor=2`;
- partial batch response;
- lease condicional do outbox antes do `SendMessageBatch`;
- marca `PUBLISHED` e remove GSI somente depois da aceitação pelo SQS;
- role: stream read + controle-table outbox update + `sqs:SendMessage` somente na scan queue;
- sem acesso a DueWorkTable, tabela principal ou filas de dispatch.

Os números são baseline, não dogma arquitetural; podem mudar por experimento sem reabrir Type 1.

### 8.2 reminder-scan SQS

- Standard queue;
- batch 1;
- visibility timeout >= 6 × timeout da Lambda conforme prática já adotada;
- redrive para DLQ após cinco receives;
- retenção 14 dias;
- `MaximumConcurrency >= soma(shards ativos) + 25%`, limitado por quota da conta;
- alarmes de idade, visível, in-flight e DLQ.

FIFO foi rejeitada: existe no máximo uma continuação válida por cadeia e a lease fornece a ordem
lógica. Standard tolera duplicatas e oferece escala sem atrelar concorrência a message groups.

### 8.3 ScanPage

- exatamente uma página por mensagem;
- `Query` consistente na DueWorkTable com `Limit=200` inicialmente;
- até 20 lotes de dez candidatos numa página cheia;
- lotes publicados com concorrência limitada inicial 5, preservando retry por chunk;
- espera todos os lotes; só então faz checkpoint;
- batch size, concorrência de chunks e page size são alavancas experimentais independentes.

## 9. Enumeração e tempo

O Scheduler mantém `rate(1 minute)` e `FlexibleTimeWindow=OFF`. O handler calcula:

`upperBoundMinute = floor(min(receivedAt, nowInjected))`

`scheduledTime` é preservado para atraso/telemetria, mas não limita descoberta. Isso faz uma
invocação nominal `15:59:59`, recebida `16:00:29`, adquirir o minuto `16:00` sem esperar o próximo
tick. Nunca se adquire minuto futuro.

Para evitar custo `lookback × shards` em reads sequenciais:

- gerar todas as chaves de lease do lookback e gerações ativas;
- usar `BatchGetItem` consistente em lotes de até 100;
- processar aquisições ausentes com concorrência limitada;
- leases expiradas ficam prioritariamente com o reconciliador; o enumerador pode tentar reclaim
  sem violar condição, mas não depende disso para recuperação.

## 10. Capacidade e orçamento do SLO

Orçamento operacional para `scheduledAt → TRIGGERED <= 300s`:

| Etapa | orçamento p99 | cap de experimento |
|---|---:|---:|
| Scheduler + enumeração | 60s | 65s |
| scan + claim | 120s | 150s |
| claim → TRIGGERED | 90s | 120s |
| margem não alocada | 30s | — |

Gate final continua sendo o máximo da coorte <=300s; percentis por etapa explicam falha, não
substituem o gate.

`requiredShards = ceil((occurrences/pageSize) × observedPageSeconds / scanBudgetSeconds)`.

Degraus de validação:

| Volume | shard generation inicial | páginas aproximadas |
|---:|---:|---:|
| 10k | 4 e depois 8 se necessário | 50 |
| 100k | 16 | 500 |
| 1M | 64 | 5.000 |

Antes de cada aumento, recalcular com p95/p99 real de página e skew observado. Se 64 não der 30%
de margem em 1M, testar 128; não elevar silenciosamente concorrência global.

## 11. Reconciliação e observabilidade

### 11.1 ScanControlReconciler

Execução por minuto, separada do reconciliador de claims:

- query `GSI1PK=LEASE#IN_PROGRESS AND GSI1SK < now`, reclaim limitado/paginado;
- query `GSI1PK=OUTBOX#PENDING AND GSI1SK < retryCutoff`, republicação limitada/paginada;
- cursor próprio persistente se uma rodada atingir seu orçamento;
- mesmos fences e condições do caminho primário;
- DLQ/redrive nunca ignora epoch ou owner.

### 11.2 Métricas obrigatórias

- `SchedulerReceiveDelayMs`;
- `EnumerationDurationMs`, `LeasesAcquired/Reclaimed/Contended`;
- `ScanPageDurationMs`, `CandidatesPerPage`, `CandidateBatchRetry`;
- `LeaseAge`, `LeaseRecoveryLag`, `PendingOutboxAge`;
- relay `IteratorAge`, `Published`, `LeaseHeld`, `PublishFailure`;
- SQS age/depth/in-flight/DLQ;
- `scheduledAt→claimedAt` e `claimedAt→TRIGGERED` por percentil;
- dimensões de shard generation e outcome, nunca tenantId em métricas de alta cardinalidade.

Alarmes iniciais: qualquer DLQ >0; Errors/Throttles >0; oldest scan message >60s; relay IteratorAge
>30s por dois períodos; lease/outbox recovery lag >120s; nenhuma página concluída num minuto com
leases ativas.

## 12. Migração, rollout e rollback

Não há dual-write de lease/outbox entre backends: isso criaria duas cadeias válidas.

### 12.1 Rollout

1. criar tabela, relay, reconciliador, alarmes e nova fila/mapping desabilitados;
2. implantar readers V1/V2 e `SCAN_CONTROL_BACKEND=MAIN_TABLE`, sem mudar tráfego;
3. canário sintético direto no backend dedicado, com fila produtiva ainda isolada;
4. pausar somente novas aquisições; deixar scan queue/leases antigas drenarem;
5. confirmar zero leases antigas `IN_PROGRESS`, scan queue/DLQ vazias e outboxes antigas drenadas;
6. incrementar `SCAN_MODE_EPOCH` (nunca reutilizar), definir backend `DEDICATED_V1`, habilitar relay,
   mapping e reconciliador dedicados;
7. reativar enumeração e executar canários 1k → 10k;
8. manter recursos antigos legíveis por sete dias; depois remover em decisão operacional separada.

### 12.2 Rollback

1. pausar aquisições;
2. incrementar epoch novamente;
3. drenar/invalidar mensagens do epoch anterior;
4. selecionar backend anterior somente se seu writer/relay ainda estiver implantado e saudável;
5. reativar com novo epoch;
6. nunca copiar cursor entre backends nem reduzir epoch.

Rollback não depende de restaurar tabela. Se a falha estiver no plano antigo, roll-forward no
dedicado é preferível.

## 13. Opções consideradas

### A. Apenas `ParallelizationFactor` no relay global

Útil como mitigação/experimento. Rejeitada como final: 10k fator 2 reduziu máximo de 359,983s para
331,173s, ainda fora do SLO; não remove competição nem o limite de cadeias.

### B. Segundo mapping filtrado no stream principal

Rejeitada. Filtro reduz invocações, não cria stream físico independente; a AWS recomenda no máximo
dois leitores por shard e o projeto já possui múltiplos consumidores.

### C. EventBridge Pipe no stream principal

Rejeitada pelo mesmo acoplamento físico. Pipes mantém ordem e entrega at-least-once, mas não elimina
o backlog do stream compartilhado.

### D. Tabela dedicada + EventBridge Pipe

Viável e candidata futura para simplificar o relay. Não escolhida inicialmente porque o protocolo
atual de outbox lease/mark/sweeper já existe e fecha recuperação além da retenção do stream. Trocar
topologia e semântica de publicação simultaneamente ampliaria a mudança.

### E. Continuação direta para SQS após checkpoint

Rejeitada. DynamoDB e SQS não compartilham transação; crash entre checkpoint e send perde a cadeia.
Estados compensatórios recriariam uma outbox com prova mais complexa.

### F. SQS FIFO

Viável, mas não escolhida. Ordenação vem da lease/cursor; Standard oferece escala superior e o
consumidor já precisa tolerar duplicatas por contrato at-least-once.

### G. Step Functions Distributed Map

Rejeitada. Query pagination depende causalmente do cursor da página anterior; Distributed Map não
remove essa dependência e adiciona transições/cotas/custo.

### H. Schedule por occurrence

Rejeitada por cardinalidade, custo operacional e mesma precisão de 60 segundos do Scheduler.

### I. Manter quatro shards e paralelizar páginas do mesmo shard

Rejeitada. DynamoDB Query só revela o próximo cursor após a página atual; especular ranges mudaria
chaves/modelo e complicaria completude. Sharding versionado é a horizontalização explícita.

## 14. Segurança e isolamento

- tabela de controle não contém PII nem conteúdo de reminder;
- `tenantId=SYSTEM` somente nos comandos de controle;
- ScanPage lê DueWorkTable e occurrences somente pelas superfícies aprovadas na D-302;
- relay tem acesso somente à tabela/stream/fila de controle;
- reconciliador não recebe escrita na tabela principal;
- payload e DLQ passam por `SecureLogger`/redação; cursor não é logado integralmente;
- IAM tests provam listas exatas de roles por tabela, stream, GSI e queue;
- poison/replay/stale epoch falham fechado sem mutação tenant-facing.

## 15. Testes e gates

### Unitários/contrato

- chaves e parser round-trip;
- acquire/checkpoint/complete/reclaim com todas as condições;
- outbox determinístico por versão;
- stale backend/epoch/owner/version/cursor;
- concorrência de chunks limitada e checkpoint após aceitação integral;
- motivos de cancelamento: somente condição esperada é benigno;
- cálculo de upper bound por `receivedAt`, atraso e virada de minuto;
- capacity formula e gerações simultâneas.

### Integração

- DynamoDB Local: transação lease+outbox, GSI recovery, TTL fields;
- SQS: duplicate/redelivery/partial batch/DLQ;
- falhas injetadas antes/depois de send e checkpoint;
- crash do relay antes/depois de marcar `PUBLISHED`;
- reconciliador recupera lease e outbox fora do lookback;
- IAM/infra assertions impedem acesso cruzado.

### AWS dev

1. canário de uma página e falhas controladas;
2. 1k, depois 10k com máximo <=300s e 30% de margem desejada;
3. 100k com capacidade e e-mail avaliados separadamente;
4. 1M somente após recalcular shards e quotas;
5. em todos: zero perda, zero duplicata efetiva, DLQ vazia, deploy estável, rollback/roll-forward
   exercitado e custo registrado.

## 16. Critérios de conclusão

D-301 só fica `IMPLEMENTED_AND_VALIDATED` quando:

- backend dedicado está implantado e o principal não publica continuações;
- todas as falhas de §7/§11 têm testes e evidência AWS proporcional;
- mudança de minuto reduz o atraso observado sem claim antecipado;
- 10k passa com máximo <=300s em duas repetições consecutivas;
- 100k passa no pipeline de reminders; entrega de e-mail mantém gate separado de SES;
- 1M passa ou produz limite/quota externo explicitamente aprovado, sem reduzir denominador;
- rollback/roll-forward por epoch foi exercitado;
- documentos canônicos e runbooks refletem a topologia efetiva.

Até lá, status permanece `APPROVED_BY_OWNER`, depois `IMPLEMENTING`, sem declarar o pipeline
horizontalmente validado.
