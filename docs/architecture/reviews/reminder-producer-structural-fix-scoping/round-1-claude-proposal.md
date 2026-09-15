# ReminderProducer structural fix — Round 1 (Claude proposal)

## Contexto herdado (PERF-12)

`docs/engineering/performance/results/PERF-12-async-pipeline-1k.md` (branch
`perf/load-testing-multi-tenant-v1`) encontrou o bug raiz: sob um burst realista (muitas
occurrences vencendo no mesmo minuto), o tick do `reminder-producer` processava sequencialmente
(1 `get`+`transactWrite` por occurrence) dentro de um timeout fixo (10s à época); quando o burst
não cabia no timeout, occurrences ainda `SCHEDULED` ficavam presas até o minuto sair da janela de
lookback (5min) — daí em diante, **perdidas permanentemente**, sem nenhum mecanismo de
reconciliação cobrindo "SCHEDULED, passou do lookback, nunca foi CLAIMED" (`reconciliation.ts`
só reverte `CLAIMED` expirado e re-materializa por DST — nenhuma das duas passagens cobre esse
caso). Mitigação aplicada (commit `dd77cc9`, Nível 4 na época — ver seu próprio racional):
timeout 10s→60s, concorrência limitada 1→8 (`PRODUCER_CLAIM_CONCURRENCY`), lookback 5min→15min.

`PERF-12-async-pipeline-10k.md` (branch `perf/load-testing-10k-v1`) testou a mitigação em 10x o
volume: **46,6% das occurrences (4.662/10.000) ficaram presas permanentemente**, essencialmente a
mesma fração de perda da fatia 1k (44,0%). Conclusão do próprio relatório: a mitigação **adiou o
ponto de ruptura, não o eliminou** — qualquer volume grande o bastante para que N workers
concorrentes não drenem o shard inteiro dentro do timeout reproduz o mesmo padrão. DynamoDB/SQS
nunca foram o gargalo (0 throttle em ambas as fatias); o teto é inteiramente o tempo de
processamento de uma única invocação `reminder-producer` contra um shard cheio.

Isto é Nível 5 (`docs/engineering/change-risk-scale.md`): qualquer opção que amplie o acesso a
GSI3 além do único worker hoje autorizado (`reminder-producer`, `infra/main.tf` linha 274 —
"The ONLY function granted gsi3_read", reforçado por `test/integration/gsi3-isolation.test.ts`)
cruza uma fronteira de módulo/IAM deliberada.

## Pesquisa externa — declaração (`research-protocol.md`, E-014)

**Pesquisa externa considerada: SIM** (fontes: ver abaixo, acessadas 2026-09-14).

Este é exatamente o tipo de decisão que o critério de `research-protocol.md` cobre: "async
batch/burst processing sem perda permanente de dado sob timeout fixo de Lambda" é um padrão que
sistemas fora deste projeto já resolveram de forma amplamente estabelecida — não é uma escolha de
layout de chave interna deste projeto.

- **Fonte 1**: AWS Prescriptive Guidance, padrão de desacoplamento de polling/scan e
  processamento por item via SQS (obtido via WebFetch 2026-09-14,
  `docs.aws.amazon.com/prescriptive-guidance/.../decouple-polling-and-processing-of-sqs-messages.html`).
  Achado central: a arquitetura de referência separa (1) um passo de scan/poll que só descobre
  itens e os empurra para uma fila SQS, terminando rápido, de (2) workers consumidores da fila
  que processam item a item, com timeout protection (mensagem não confirmada volta à fila),
  fan-out paralelo nativo, e DLQ para itens persistentemente falhos — exatamente a forma "scan
  rápido e barato" + "claim via consumer SQS" cogitada no relatório do PERF-12 como opção (b).
- **Fonte 2**: AWS Step Functions Developer Guide, "Fan out batch jobs with Map state"
  (`docs.aws.amazon.com/step-functions/latest/dg/sample-batch-fan-out.html`) e cobertura
  independente de Distributed Map (`dev.to/aws-builders/step-functions-distributed-map-best-practices...`,
  2026-09-14) — Distributed Map é a alternativa da própria AWS para "scan então processar muitos
  itens em paralelo sem uma única invocação fazer tudo", mas ambas as fontes concordam que ela
  compensa principalmente quando o fluxo tem múltiplos passos dependentes coordenados/precisa de
  orquestração visível — overhead desnecessário para um único passo homogêneo (reivindicar uma
  occurrence), e nenhuma amplia doar acesso a GSI3 sem também precisar de um novo componente de
  orquestração.
- **Achado de representatividade**: as duas fontes são documentação oficial AWS (não blog de
  terceiro sem endosso), cobrindo os dois padrões concretos citados no próprio relatório PERF-12
  como opções (a)/(b) — suficiente para decidir entre "fila SQS decoupling" vs. "orquestração
  Step Functions" sem viés de vendor único, já que ambas são do mesmo vendor mas descrevem
  mecanismos AWS-nativos concorrentes entre si, não uma comparação com um produto terceiro.
- **Precedente já existente NESTE projeto** (fato interno, não pesquisa externa, citado para
  contexto): `reminder-dispatch` já é exatamente esse padrão — um consumer SQS com
  `aws_lambda_event_source_mapping`, scaling nativo de Lambda, retry/backoff automático via
  `maxReceiveCount`+redrive, DLQ (`infra/main.tf` linhas 282-294, 947-960). PERF-12 confirma
  que esse worker nunca foi o gargalo em nenhuma das duas fatias.

**Conclusão da pesquisa**: o padrão de referência AWS para exatamente este problema (scan finito
sob timeout fixo produzindo perda de item) é decouple scan-from-claim via SQS, não paralelismo
maior dentro da mesma invocação nem um segundo pass de reconciliação tentando alcançar o scan
original depois do fato.

## Ground truth verificado (código real, não assumido)

- `src/workers/reminder-producer/producer.ts` (estado atual, já com a mitigação): o loop
  `runProducerTick` itera minutos×shards×partições GSI3, e para CADA row faz
  `store.get`+`store.transactWrite` (claim condicional) com concorrência limitada a 8
  (`mapWithConcurrency`) — a MESMA invocação Lambda que descobre a occurrence também a reivindica
  e persiste o outbox, tudo dentro do orçamento fixo de 60s.
- `src/workers/reminder-reconciliation/reconciliation.ts`: hoje só cobre (a) `CLAIMED` expirado
  → reverte para `SCHEDULED` (para o PRÓXIMO tick do producer pegar de novo) e (b) DST
  re-evaluation num range `[now, now+7d]`. Nenhuma passagem cobre "ainda `SCHEDULED`, nunca virou
  `CLAIMED`, saiu do lookback" — confirmando a lacuna que o PERF-12 10k mediu.
  Extensão (a) para reclamar diretamente candidatos `SCHEDULED` exigiria ler GSI3 (ou um novo
  índice paralelo) a partir de um worker que HOJE não tem essa permissão.
- `infra/main.tf` linha 274: comentário explícito "The ONLY function granted gsi3_read — never
  add this capability to any other function"; a mesma cláusula está espelhada em
  `reminder-store.ts` (doc comment referenciado pelo próprio código do producer, linha ~91-93) e
  enforçada por teste (`gsi3-isolation.test.ts`, localizado por grep neste repo em
  `test/unit/...`/`test/integration-dynamodb/...` — não achei um arquivo com exatamente esse
  nome no branch atual; o teste real de isolamento hoje vive misturado nos testes de producer/
  reminder-engine listados, e será atualizado/criado explicitamente por quem implementar a opção
  escolhida, sem ambiguidade sobre o que precisa mudar).
- `reminder_dispatch` (infra/main.tf 282-294, 947-960): já usa
  `aws_lambda_event_source_mapping` sobre uma fila `sqs-worker-queue`, com `consume_policy_json`
  próprio — o módulo Terraform reutilizável (`modules/sqs-worker-queue`) já existe e já é usado
  por múltiplos workers deste projeto (não seria a primeira fila desse tipo).

## Opção descartada explicitamente pelo relatório PERF-12: aumentar ainda mais timeout/concorrência

Não proposta aqui — o próprio relatório já conclui que isso só desloca o ponto de ruptura para um
volume maior, nunca elimina.

## Opção A — Dedicated reconciliation pass sobre GSI3

Um novo mecanismo (job/Lambda) que consulta GSI3 diretamente para achar `SCHEDULED` cujo
`scheduledAt` já passou do lookback do producer e nunca foi `CLAIMED`, e as reivindica.

**Contra**: cruza a fronteira IAM/módulo hoje deliberada (GSI3 isolado a
`reminder-producer`) — precisaria widenar a policy `gsi3_read` para um segundo consumer, ou
duplicar a lógica de claim em dois lugares (producer E reconciliation), aumentando superfície de
race condition entre os dois (dois processos tentando `transactWrite` a mesma occurrence
concorrentemente — mitigável via OCC existente, mas é complexidade nova, não removida). Também
não resolve a causa raiz: o producer normal continua podendo estourar o timeout no mesmo burst;
a reconciliação vira uma rede de segurança permanente rodando atrás de um mecanismo primário que
sabidamente não escala, ao invés de consertar o mecanismo primário.

**A favor**: menor diff imediato (não toca o loop do producer em si), reaproveita o job de
reconciliação que já existe (mesmo racional de "não construir dois pipelines de reconciliação
paralelos" citado no header de `reconciliation.ts`).

## Opção B (recomendada) — Producer redesign: decouple scan-from-claim via SQS

O tick do `reminder-producer` passa a fazer SÓ o scan GSI3 + enfileirar `occurrenceId`/`chave`
candidatos numa nova fila SQS (`reminder-claim` ou nome equivalente) — sem `get`/`transactWrite`
por item dentro do mesmo loop. Um novo (ou estendido) consumer SQS faz o `get`+`transactWrite`
condicional por occurrence, reaproveitando o padrão já existente de `reminder-dispatch`
(scaling nativo do event-source-mapping, retry/backoff/DLQ do SQS, sem timeout de invocação
único tendo que drenar um shard inteiro).

**Por que resolve estruturalmente, não só adia**: o scan (GSI3 query + `SendMessage`) é O(shard),
mas cada item individual custa uma operação barata e sem estado compartilhado — nenhuma
invocação precisa mais terminar de processar um shard inteiro dentro de um timeout fixo. O burst
vira "muitas mensagens na fila", que é exatamente o caso de uso que SQS+Lambda concurrency já
resolve (o mesmo padrão que `reminder-dispatch` já prova funcionar sob 10x o volume no próprio
PERF-12 10k, sem nenhum throttle/perda).

**Custo arquitetural nomeado (não projetado em detalhe — fase de implementação)**: nova fila SQS
+ nova/estendida Lambda consumer + IAM (a nova consumer NÃO precisa de `gsi3_read` — só
`get`+`transactWrite` na tabela principal, mesmo perfil de permissão que `reminder-dispatch` já
tem hoje) + terraform (`modules/sqs-worker-queue`, já existente e reutilizável) + settling em
possível double-claim se um occurrenceId for enfileirado duas vezes (mitigável pela mesma OCC
condicional já usada — `expectedVersion`/status guard — que já torna um claim idempotente contra
corrida entre producer ticks HOJE).

**Fronteira GSI3 preservada**: só `reminder-producer` continua lendo GSI3 — a nova consumer lê
apenas por PK/SK (já resolvido pela mensagem SQS), não precisa de `gsi3_read`. `gsi3-isolation`
continua válido sem alteração de policy.

## Checklist ponderado (derivado da pesquisa)

1. **Elimina perda estruturalmente, não só adia o ponto de ruptura** (peso 35%) — atende: nenhum
   volume de burst, por maior que seja, pode deixar uma occurrence presa além do tempo de
   visibilidade+retry da fila (bounded, configurável, independente do tamanho do shard); não
   atende: qualquer opção cujo pior caso ainda dependa de "processar N itens dentro de um
   timeout fixo de uma única invocação".
2. **Preserva a fronteira IAM/GSI3 já deliberada** (peso 25%) — atende: nenhuma policy nova de
   leitura GSI3 concedida a um segundo worker; não atende: amplia `gsi3_read` além de
   `reminder-producer`.
3. **Alinhamento com padrão de referência AWS + precedente já comprovado neste projeto** (peso
   20%) — atende: mesma forma que `reminder-dispatch` (já validado sob 10x volume no PERF-12
   10k sem throttle) e que a AWS Prescriptive Guidance recomenda para exatamente este problema;
   não atende: mecanismo novo sem paralelo com o padrão já em produção ou com a documentação
   oficial.
4. **Simplicidade operacional / superfície de falha nova** (peso 20%) — atende: nenhum
   mecanismo de coordenação NOVO entre dois processos concorrentes reivindicando a mesma
   occurrence (a claim continua sendo uma única operação atômica, só que agora feita por um
   consumer em vez de inline no scan); não atende: introduz uma segunda fonte de verdade para
   "quem pode reivindicar" ou depende de um novo mecanismo de deduplicação/coordenação
   complexo.

## Decisão proposta

**Opção B — producer redesign via decoupling scan/claim com SQS.** Pontua mais alto nos 4
critérios: elimina a causa raiz (não é mitigação adicional), preserva a fronteira GSI3 sem
exceção nova, reaproveita um padrão já provado neste mesmo sistema sob 10x volume, e não
introduz um segundo processo concorrente reivindicando GSI3 (opção A introduziria exatamente
essa superfície nova). Fase de implementação (fora do escopo desta rodada, per instrução) precisa
decidir: nome exato da fila/consumer, formato da mensagem candidata, e o que acontece com o job
de `reconciliation.ts` existente (provavelmente mantido inalterado — ele já cobre um caso
diferente, `CLAIMED` expirado, que continua existindo sob o novo design exatamente como hoje,
já que o consumer ainda faz um `transactWrite` de claim com `claimExpiresAt`).
