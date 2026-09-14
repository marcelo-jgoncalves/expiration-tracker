# PERF-12 — Async pipeline / Reminder (fatia 1k)

**Escopo desta fatia**: autorizado explicitamente por Marcelo a testar **somente o volume de
1.000 occurrences** nesta rodada. Os volumes 10k/100k/1M do plano de ação (§17) **não foram
executados** — ver "Próximos passos" ao final. Este documento cobre apenas o resultado do
degrau de 1k.

## Resumo executivo

O teste de 1k **encontrou um gargalo real e reprodutível** no ReminderProducer, não hipotético:
com 1.000 occurrences agendadas para o mesmo minuto (burst realista — ex. fim de mês, muitos
itens com o mesmo vencimento), o tick do produtor **estoura o timeout de Lambda (10s)
repetidamente**, e — mais grave — uma fração das occurrences **fica presa em `SCHEDULED` sem
nunca ser reivindicada**, porque o timeout consome minutos suficientes para que essas
occurrences saiam da janela de lookback (5 minutos) antes de serem processadas, e **nenhum
mecanismo de reconciliação existente recupera esse caso** (a reconciliação de CLAIMS só reverte
claims expirados de volta para `SCHEDULED` — que já estava nesse estado — e a reconciliação DST
só re-materializa occurrences ausentes, não re-expõe occurrences que já existem mas saíram do
lookback). Ver seção "Achado principal" para o traçado completo.

DynamoDB e SQS **não gargalaram em nenhum momento** — zero throttling, zero erros de
infraestrutura, idade da fila sempre em 0s. O teto é inteiramente o loop sequencial do
ReminderProducer (um `get` + um `transactWrite` por occurrence, um shard de cada vez, sem
paralelismo) combinado com o timeout de 10s da função.

## Metodologia

### Tenant e dados

- **Tenant reaproveitado**: "PERF Test Tenant" (`org_01M2GE4F1SZPSJ47HCGRXH4XMN`), o mesmo do
  PERF-04/05/11 — ver `docs/engineering/performance/baseline/PERF-04-test-tenant.md`. Uma
  tentativa de criar um tenant novo dedicado (`POST /bff/organizations`) foi feita primeiro e
  **bloqueada pelo produto**: `409 CONFLICT — "You have already created an organization"` (regra
  de 1 organização por usuário Cognito). Criar um segundo usuário Cognito só para este teste foi
  considerado fora de proporção para uma fatia de 1k: os 1.000 registros foram semeados no tenant
  existente, mas **todos com o prefixo `PERF-12 1k`** (nome do item, categoria `PERF-12-1k`, nome
  da política) para ficarem claramente identificáveis e fáceis de limpar depois, sem se misturar
  com os 7 items/2 subjects do PERF-04/05/11.
- **1.000 Items** via `POST /bff/api/items` (categoria `PERF-12-1k`, `dueDate` = hoje
  2026-09-14, nomes `PERF-12 1k Item 0001`..`1000`).
- **1.000 ReminderPolicy** (`scope: ITEM`) via `POST /bff/api/reminders/policies`, um por item,
  cada um com um único trigger `offsetIso: "P0D"`, `localTime: "19:10"`,
  `timeZone: "America/Sao_Paulo"` — ou seja, **todas as 1.000 occurrences materializadas foram
  agendadas para o mesmo minuto** (`2026-09-14T22:10:00.000Z`), deliberadamente, para simular um
  burst realista (ex. muitos vencimentos no mesmo dia) e estressar o ReminderProducer num único
  tick.
- Seed feito via a API real do produto (nunca escrita direta no DynamoDB), mesma disciplina do
  PERF-04 — script `docs/engineering/performance/.local/` (não commitado; usa a mesma sessão BFF
  obtida por `perf-04-auth.mjs`, `X-Organization-Id` para apontar ao tenant, `X-CSRF-Token` +
  `Sec-Fetch-Site: same-origin` para passar no CSRF).
- **Respeito à quota de aplicação** (`API_REQUEST`, 100 req/60s por tenant — o mesmo limitador que
  o PERF-11 encontrou): seed pausado a ~85 req/min (700ms entre requisições), levando ~26 minutos
  para os 2.000 requests (1.000 items + 1.000 policies). 42 requisições transitórias retornaram
  `429 QUOTA_EXCEEDED` durante uma janela em que dois processos de seed concorrentes (erro
  operacional deste teste, corrigido matando o processo duplicado) competiram pela mesma quota;
  todas foram re-tentadas com sucesso. **Resultado final confirmado: exatamente 1.000 pares
  item+policy criados** (`ok` count = 1000 no log do seed).
- Verificado via `reminder-materialization-trigger` (CloudWatch Logs): eventos `POLICY_CHANGED`
  com `materialized: 1` confirmam que a materialização automática (outbox → SQS → trigger
  worker → `ReminderMaterializer.materialize()`) funcionou para os 1.000 items/policies, sem
  nenhuma escrita manual no DynamoDB.

### Disparo do pipeline

Nenhuma invocação manual foi necessária — o `reminder-producer` já roda via EventBridge Scheduler
(`rate(1 minute)`, `infra/modules/reminder-schedule/main.tf`) em produção/dev o tempo todo. O
teste consistiu em semear os dados e observar os ticks reais que passaram a cobrir o minuto-alvo
(`22:10 UTC` / `19:10 America/Sao_Paulo`).

## 17.2 — Reminder Producer

### Achado principal: timeout de Lambda + occurrences presas fora do lookback

| Métrica | Valor |
|---|---|
| Timeout configurado da função | 10.000 ms (`AWS::Lambda::Function Timeout`, `exptrk-dev-reminder-producer`) |
| Memória | 256 MB |
| Reserved concurrency | não configurada neste ambiente (achado já registrado no PERF-01) |
| Shards ativos (`DEFAULT_SHARD_COUNT`) | 4 |
| Lookback da janela de scan | 5 minutos (+ minuto atual = 6 minutos/partições por tick) |
| Partições escaneadas por tick (normal, sem burst) | 4 shards × 6 minutos = 24 queries GSI3 |

Sequência observada (todos os horários em UTC, via CloudWatch Logs Insights sobre
`/aws/lambda/exptrk-dev-reminder-producer`):

1. **22:00–22:10** — ticks normais, ~550–820 ms cada, `scanned: 0, claimed: 0` (nenhuma
   occurrence agendada ainda para essas janelas).
2. **22:10:59 em diante** (assim que o minuto 22:10 — onde as 1.000 occurrences estão — entra na
   janela de lookback) — **a função passa a estourar o timeout de 10.000 ms de forma consistente**
   (`Status: timeout` na REPORT line), por **7 minutos consecutivos** (22:11 a 22:17), com
   múltiplas invocações/retries sobrepostas no mesmo minuto.
3. A partir de **22:17:32**, os ticks voltam a completar normalmente (`scanned: 0, claimed: 0`),
   mas agora escaneando janelas **22:11–22:16, 22:12–22:17, etc. — o minuto 22:10 já saiu da
   janela de lookback de 5 minutos** e nunca mais é escaneado por um tick normal.

| Janela | Duração do tick | Status |
|---|---|---|
| 22:00–22:10 (pré-burst) | 515–820 ms | OK |
| 22:11–22:17 (burst) | 10.000 ms (timeout) em quase todas as invocações da janela | **TIMEOUT** |
| 22:18–22:21 (drenagem) | 2.1s → 3.2s → normalizando | recuperando |
| ≥22:17:32 | 515–820 ms | OK, mas minuto 22:10 já fora do lookback |

**Nenhuma dessas invocações chegou a logar `"reminder-producer tick complete"`** durante a janela
de timeout — o handler é morto pelo Lambda runtime no meio do loop `for (const row of rows)`
(`src/workers/reminder-producer/producer.ts`), então não há um "scanned/claimed final" por tick
para essa janela; o progresso real só pôde ser inferido indiretamente via o volume de mensagens
processadas pelo `reminder-dispatch` (seção 17.3).

**Por que isso acontece**: o loop do produtor (`runProducerTick` em
`src/workers/reminder-producer/producer.ts:145-274`) processa **uma occurrence por vez,
sequencialmente** — para cada linha: um `store.get` (ler a occurrence) + um `store.transactWrite`
(claim + evento de outbox), sem nenhum paralelismo (`Promise.all`) nem batching. Com ~250
occurrences por shard concentradas no minuto 22:10 (1.000 ÷ 4 shards), a 10s de orçamento não é
suficiente para processar nem um shard inteiro nesse ritmo (round-trips do DynamoDB seriais
custam ~dezenas de ms cada, mas a soma de ~500 chamadas seriais — get+write por occurrence —
facilmente excede 10s).

**Por que isso é grave, não só "lento"**: como cada invocação retentada recomeça o scan do zero
(minutos mais antigos primeiro, todos já vazios/já processados, até chegar de novo no minuto
"quente"), o produtor consegue fazer *algum* progresso a cada tentativa antes de ser morto — os
claims que já completaram (`transactWrite` bem-sucedido) são duráveis mesmo que o Lambda seja
morto logo depois. Isso explica o padrão observado: um volume crescente de occurrences chegou ao
`reminder-dispatch` durante os 7 minutos de timeout (progresso real, só que caro e não observável
via log de "tick complete"). **Mas assim que o minuto 22:10 sai da janela de lookback de 5
minutos, as occurrences que ainda não tinham sido reivindicadas simplesmente param de ser
escaneadas** — nenhum tick subsequente as toca.

**Confirmação de que ficaram presas**: o total de occurrences efetivamente despachadas
(`reminder-dispatch`, contagem de linhas `"event":"reminder-dispatch outcome"`) **estabilizou em
560 de 1.000** (verificado repetidamente ao longo de ~5 minutos após os ticks voltarem ao normal,
sem nenhum crescimento adicional) — ou seja, **~440 das 1.000 occurrences permaneceram em
`SCHEDULED`, sem nunca serem reivindicadas**, e não há, hoje, nenhum mecanismo automático que as
recupere:
- A reconciliação de `CLAIMS` (a cada 5 min) só reverte occurrences `CLAIMED` cujo `claimExpiresAt`
  expirou de volta para `SCHEDULED` — essas occurrences já estavam `SCHEDULED`, então essa
  passagem não faz nada por elas (comentário do próprio código,
  `src/workers/reminder-reconciliation/reconciliation.ts:9`: "SCHEDULED, conditionally, so the
  next producer tick's lookback window picks it up" — dependência circular: a suposição é que o
  *próximo tick normal* vai pegar, o que é falso quando o minuto já saiu do lookback).
- A reconciliação `DST` (diária) só **materializa occurrences ausentes** comparando com o
  `idempotencyKey` esperado; como a occurrence **já existe** (só está presa, não ausente),
  `putIfAbsent` é um no-op e nada muda.
- Conclusão: sem intervenção manual (ex. um script de reparo que reconstrua o GSI3SK ou force um
  re-scan do minuto 22:10), essas ~440 occurrences **nunca disparariam o lembrete**. Este é o
  achado mais importante do PERF-12 nesta fatia — não é sobre throughput, é sobre correção sob
  burst.

### DynamoDB durante o burst

| Métrica | Valor | Throttling? |
|---|---|---|
| `ConsumedWriteCapacityUnits` (pico, 1 min) | 4.972 unidades (22:11 UTC) | Não |
| `ConsumedReadCapacityUnits` (pico, 1 min) | 2.574 unidades (22:22 UTC, já em drenagem) | Não |
| `ThrottledRequests` (tabela) | 0 em toda a janela | — |
| `Throttles` (Lambda `reminder-producer`) | 0 | — |

DynamoDB (modo on-demand) absorveu o burst sem nenhum throttle — **o teto não é capacidade de
DynamoDB**, é puramente o timeout de 10s combinado com processamento sequencial no Lambda.

## 17.3 — Reminder Dispatch (consumer SQS)

| Métrica | Valor |
|---|---|
| Occurrences efetivamente despachadas (estabilizado) | 560 de 1.000 (56%) |
| `ApproximateAgeOfOldestMessage` (fila `exptrk-dev-reminder-dispatch`) | sempre **0s** durante toda a janela — a fila nunca acumulou backlog visível |
| `ApproximateNumberOfMessages` / `...NotVisible` (leitura pontual) | 0 / 0 — consistente com consumo tão rápido quanto a chegada |
| Concorrência máxima observada (`ConcurrentExecutions`) | 13 (batch size 10, sem reserved/max concurrency configurados — mesmo achado do PERF-01) |
| Duração média por invocação | 187–625 ms (janelas de 1 min, pico de burst) |
| Duração máxima observada | 2.083 ms |
| Invocações totais (janela de 30 min) | 491 |
| Erros (`Errors`, Lambda) | 0 |
| DLQ (`reminder-dispatch-dlq`) | sem mensagens observadas |

O `reminder-dispatch` em si **nunca foi o gargalo** — ele processou tudo que chegou quase
instantaneamente (por isso a fila SQS nunca mostrou idade > 0s: o consumo acompanhou a produção
o tempo todo, mesmo que a produção estivesse anormalmente lenta/travada). O teto está
inteiramente a montante, no ReminderProducer.

## 17.4 — Outbox relay (`dispatch-outbox-relay`)

Comportamento serial atual medido, sem nenhuma mudança de paralelismo (conforme instrução do
plano "testar serial atual antes de qualquer paralelismo"):

| Métrica | Valor |
|---|---|
| Batch size (event source mapping, DynamoDB Streams) | 25 |
| Invocações totais (janela de 30 min) | 4.613 — reflete o fan-out natural do Streams (toda escrita de item/policy/claim gera pelo menos um registro de stream) |
| Duração média por invocação | 51–147 ms |
| Duração máxima observada | 2.633 ms |
| Erros | não observados nas amostras coletadas |

O relay lê da mesma stream que recebe tanto os `ItemCreated`/`PolicyChanged` do seed quanto os
claims do producer — por isso o volume de invocações (4.613) é bem maior que 1.000: cada
`POST /items` e `POST /reminders/policies` também passa pelo mesmo outbox (destinos
`REMINDER_MATERIALIZATION_TRIGGER_QUEUE`, roteados pelo mesmo Lambda/event-source-mapping,
`infra/main.tf:993-998`).

## 17.5 — Experimentação de SQS (batch_size / MaximumConcurrency / reserved concurrency)

**Não realizada nesta fatia**, por decisão consciente: o achado principal (17.2) já mostra que o
gargalo real está no ReminderProducer (timeout de 10s + processamento sequencial), não no SQS/
`reminder-dispatch` (que nunca acumulou backlog). Rodar experimentos de `batch_size`/
`MaximumConcurrency` no consumer SQS antes de entender e corrigir o gargalo do produtor
produziria dados sem sinal útil — otimizar a etapa que não é o gargalo. Fica como follow-up
explícito para quando o volume 10k+ for retomado (e, possivelmente, só depois de o próprio
ReminderProducer ser corrigido/redesenhado — ver 17.6).

## 17.6 — Redesenho horizontal

**Não avaliado nesta fatia**, conforme escopo do plano ("só se benchmark provar necessidade"). O
que o teste de 1k mostrou é mais específico e mais urgente que "o modelo atual não escala": há um
**bug de correção** (occurrences perdidas permanentemente sob burst, não um problema de
throughput) que provavelmente precisa ser corrigido **antes** de qualquer decisão de redesenho —
um redesenho horizontal herdaria o mesmo defeito se não tratar explicitamente o caso "tick não
termina a tempo de esvaziar sua própria janela". Não avaliado se esse bug já existe em produção
hoje (não há evidência de burst de volume comparável em produção ainda), mas o mecanismo é real e
independente de escala: qualquer burst grande o suficiente para uma única invocação de 10s não
processar o triggerá.

## Verificação — isolamento dos dados

- Todos os 1.000 items/policies criados usam o prefixo `PERF-12 1k` / categoria `PERF-12-1k`,
  facilmente distinguíveis dos 7 items/2 subjects pré-existentes do PERF-04/05/11 no mesmo tenant
  (`org_01M2GE4F1SZPSJ47HCGRXH4XMN`).
- Nenhum outro tenant foi tocado — todas as chamadas usaram `X-Organization-Id` apontando
  explicitamente para o tenant PERF, e a sessão usada pertence ao usuário
  `marcelo.mjgoncalves+perf-test-2026-09-14@gmail.com` (mesmo usuário do PERF-04/05/11).
  organizationIdHint é resolvido/validado no backend (`RequestContextResolver`) contra a
  membership real do usuário — não há como a chamada ter afetado um tenant de terceiro.
- Nenhuma escrita direta no DynamoDB foi feita em nenhum momento — 100% via API real do produto.
- Os ~440 items com occurrence presa em `SCHEDULED` continuam no tenant PERF; não há impacto em
  nenhum tenant real/de produção.

## Próximos passos

- **10k / 100k / 1M**: **pendentes de revisão destes resultados por Marcelo antes de prosseguir**
  — instrução explícita de escopo desta tarefa. O achado de 1k (occurrences perdidas sob burst
  no mesmo minuto) é motivo forte para **corrigir o ReminderProducer antes de escalar o teste**:
  repetir o mesmo padrão em 10k (2.500 occurrences/shard no mesmo minuto) provavelmente pioraria
  a fração perdida, não apenas o tempo total.
- Candidatos de correção a avaliar (não implementados nesta tarefa — puramente diagnóstico):
  aumentar o timeout do `reminder-producer` (hoje 10s) como mitigação de curto prazo; paralelizar
  o processamento de occurrences dentro de um shard (`Promise.all`/`mapWithConcurrency`, o mesmo
  padrão já usado em `reminder-dispatch-handler.ts`); ampliar o lookback quando o tick anterior
  não completou; ou um mecanismo de reconciliação dedicado para occurrences `SCHEDULED` cujo
  `scheduledAt` já passou do lookback mas nunca foram `CLAIMED` (hoje esse caso não é coberto por
  nenhuma das duas passagens de reconciliação existentes).
- 17.5 (experimentação de SQS) fica para quando o volume 10k+ for retomado.
- 17.6 (redesenho horizontal) permanece não avaliado — decisão de Marcelo após ver o achado de
  correção acima, provavelmente antes mesmo de decidir sobre escala.
