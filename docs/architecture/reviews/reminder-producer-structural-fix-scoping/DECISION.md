# ReminderProducer structural fix — Decisão (D-299)

## Status

**APROVADO** via protocolo Claude↔Codex (`AGENTS.md` §4), 4 rodadas (mínimo do protocolo é 3;
convergência só ocorreu na 4ª). Notas cegas finais: **Claude 9,1/10, Codex 9,2/10** — ambos ≥9,0
sem arredondar.

## Decisão

Adotar a **Opção B revisada**: redesenhar o `reminder-producer` desacoplando **descoberta** (scan
GSI3) de **reivindicação** (claim), via duas filas SQS, na forma final abaixo:

- **Fila de scan**: uma unidade de trabalho por (shard, minuto) elegível. O scanner (a MESMA
  função/role `reminder-producer` de hoje — única detentora de `gsi3_read`) processa **uma página**
  de `queryGsi3` por invocação (nunca o shard inteiro), publica os candidatos dessa página na fila
  de claim, e só então publica uma mensagem de continuação (`LastEvaluatedKey`). Progresso é
  **retomável e idempotente** via uma máquina de estados de lease por página
  (`IN_PROGRESS`/`ownerToken`/`leaseUntil`/`COMPLETED`, condicional, mesma tabela principal) —
  não um marcador único, que uma rodada intermediária do protocolo provou converter a garantia
  at-least-once do SQS em perda silenciosa quando a execução morre no meio do trabalho.
- **Fila de claim**: candidatos discriminados pelo `GSI3SK` bruto (preserva a distinção
  `ReminderOccurrence`/`DocumentChasingOccurrence` do M10 cluster 4). Um claim consumer novo (ou
  seguindo o padrão já usado por `reminder-dispatch`) executa o mesmo `get`+`transactWrite`
  condicional que o código atual já faz, distinguindo corretamente `CancellationReasons` (só
  `ConditionalCheckFailed` conta como corrida perdida entre claims concorrentes).
- Ambas as filas usam o módulo Terraform já existente (`modules/sqs-worker-queue`, o mesmo de
  `dispatch_queue`) — DLQ, alarme e idade de fila (`ApproximateAgeOfOldestMessage`) nativos,
  `ReportBatchItemFailures` nos dois event-source-mappings, `maximumConcurrency` +
  `reserved_concurrent_executions` com a invariante explícita de que a segunda deve ser ≥ a soma
  dos máximos da primeira.

**Fronteira GSI3 preservada por construção**: nenhuma policy `gsi3_read` nova é concedida — só a
função scanner (a mesma `reminder-producer` de hoje) lê o índice; o claim consumer nunca precisa
dele. `test/integration/gsi3-isolation.test.ts`-equivalente continua válido sem alteração.

## Por que esta opção, e não a reconciliação dedicada (Opção A)

Uma passagem de reconciliação dedicada consultando GSI3 diretamente exigiria conceder `gsi3_read`
a um segundo worker — cruzando a fronteira IAM hoje deliberadamente restrita a um único função — e
ainda deixaria o mecanismo primário (o producer) sem correção real: o burst continuaria podendo
estourar o timeout da MESMA forma, só que agora com uma rede de segurança correndo atrás dele
permanentemente. A Opção B corrige a causa raiz (nenhuma invocação, nem de scan nem de claim,
precisa mais processar uma unidade de trabalho ilimitada dentro de um timeout fixo) em vez de
adicionar uma segunda camada de mitigação sobre um mecanismo que já provou não escalar
(exatamente o padrão de falha que a mitigação timeout/concorrência/lookback já tentou e o PERF-12
10k mediu não ter resolvido).

## Trajetória de convergência (notas cegas, sem arredondar)

| Rodada | Claude | Codex | Achado principal fechado nessa rodada |
|---|---|---|---|
| R1 | 8,3/10 | 5,2/10 | — (proposta inicial: só a etapa de claim tinha sido desacoplada, o scan GSI3 continuava uma única invocação monolítica) |
| R2 | 8,8/10 | 8,3/10 | Scan paginado/retomável (LastEvaluatedKey como continuação), discriminação de tipo GSI3, tratamento de falha parcial de `SendMessageBatch` |
| R3 | [fechamento] | 8,4/10 | Checkpoint/fence, recuperação de DLQ, observabilidade nas duas filas, `CancellationReasons`, backpressure — mas o fence proposto (marcador único sem estado) ainda tinha um buraco real de perda silenciosa |
| R4 | 9,1/10 | 9,2/10 | Fence substituído por máquina de estados com lease (`IN_PROGRESS`/`ownerToken`/`leaseUntil`/`COMPLETED`) — **CONVERGIDO** |

## Pesquisa externa (research-protocol.md, E-014)

**SIM** — 3 fontes oficiais AWS verificadas e citadas nas rodadas: AWS Prescriptive Guidance
(padrão de desacoplar scan/poll de processamento via SQS), AWS Lambda Developer Guide ("Using
Lambda with Amazon SQS" — at-least-once, partial batch response, idempotência) e AWS SQS API
Reference (`SendMessageBatch`, falha parcial mesmo com HTTP 200). Uma quarta fonte citada na
Round 1 (`dev.to`, blog não-oficial) foi corretamente contestada pelo Codex e removida da lista de
fontes que fundamentam a decisão na Round 2 — mantida só como contexto de leitura.

## Escopo desta decisão

**Só arquitetural**, por instrução explícita da tarefa. Não foi escrito código de implementação.
Ficam para uma sessão de implementação dedicada: nomes exatos das filas/handlers, dimensionamento
de lease/timeout Lambda/visibility timeout SQS/`maxReceiveCount` (a invariante entre eles foi
nomeada, não os valores), testes (incl. atualização de `test/integration/gsi3-isolation.test.ts`
para cobrir a nova role do claim consumer), e a decisão sobre se/como `reminder-reconciliation`
existente precisa de algum ajuste (a expectativa arquitetural é que não precise — ele continua
cobrindo `CLAIMED` expirado e DST exatamente como hoje, já que o claim consumer ainda escreve
`claimExpiresAt` do mesmo jeito que o producer atual).

## Resumo executivo (não-técnico)

O sistema de lembretes automáticos tem um mecanismo (`reminder-producer`) que, a cada minuto,
procura lembretes que precisam ser disparados e os enfileira para envio. Um teste de carga
recente mostrou que, sob picos grandes de volume (muitos lembretes vencendo no mesmo minuto),
quase metade dos lembretes podia ficar presa e nunca ser enviada — um problema real de
confiabilidade, não hipotético. Uma correção rápida já havia sido tentada (dar mais tempo e mais
paralelismo ao processo), mas o teste em volume 10x maior provou que essa correção só adiava o
problema, não o resolvia. Depois de um debate técnico estruturado de 4 rodadas entre duas IAs
revisoras independentes (mínimo de 3 rodadas exigido pelo processo do projeto, chegando à
aprovação só na 4ª), foi decidida uma correção estrutural: dividir o trabalho em passos pequenos e
reiniciáveis, cada um garantidamente concluído dentro do tempo disponível, em vez de depender de
processar um pico inteiro de uma vez só. Isso segue o mesmo padrão que a AWS recomenda oficialmente
para este tipo de problema, e reaproveita um mecanismo que este próprio projeto já usa e já provou
funcionar sob 10x o volume em outro componente do sistema. Nenhum código foi escrito ainda — esta
etapa definiu só o desenho; a implementação fica para a próxima etapa.
