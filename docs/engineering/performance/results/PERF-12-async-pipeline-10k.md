# PERF-12 — Async pipeline / Reminder (fatia 10k)

**Escopo desta fatia**: follow-up direto da fatia 1k (`PERF-12-async-pipeline-1k.md`), que encontrou
um bug real (occurrences perdidas sob burst) e foi corrigida. Esta fatia responde a uma pergunta
específica e fechada: **a correção aplicada resolve o problema em 10x o volume que o quebrou, ou o
bug reaparece?** Não é uma investigação aberta — reaproveita a metodologia da fatia 1k.

## Resumo executivo

**A correção NÃO resolveu o problema em 10k — o bug de perda permanente reapareceu, com uma
fração de perda praticamente igual à da fatia 1k.** Dos 10.000 occurrences semeados (burst no
mesmo minuto, `00:30:00 UTC` / `21:30 America/Sao_Paulo`), **apenas 5.338 (53,4%) foram
efetivamente despachados**; os outros **4.662 (46,6%) ficaram presos em `SCHEDULED` sem nunca
serem reivindicados**, pela mesma causa raiz documentada na fatia 1k: o tick do produtor volta a
estourar o timeout (agora 60s, não mais 10s) de forma repetida, e quando o minuto-alvo sai da
janela de lookback (agora 15min, não mais 5min) antes de ser totalmente processado, nenhum
mecanismo de reconciliação recupera as occurrences que ficaram para trás.

A aritmética otimista do plano desta tarefa ("10k a 8x de concorrência ≈ 1,25k-equivalente
sequencial, deveria caber em 60s") **não se confirmou na prática**: os timeouts persistiram por
**~20 minutos consecutivos** (00:32–00:52 UTC), quase 3x mais tempo que os ~7 minutos observados
na fatia 1k com o código antigo. A correção (60s + concorrência 8 + lookback 15min) melhorou a
taxa de sucesso marginalmente (53,4% vs. 56,0% na fatia 1k — na prática, estatisticamente igual,
dentro do ruído) mas **não eliminou a perda**; ela apenas mudou a escala em que o mesmo padrão de
falha ocorre. DynamoDB e SQS novamente não gargalaram em nenhum momento — o teto continua sendo
inteiramente o ReminderProducer.

## Confirmação de que a correção está deployada

```
$ aws lambda get-function-configuration --function-name exptrk-dev-reminder-producer --region us-east-1 --query Timeout
60
```

Confirmado antes de iniciar o teste: timeout = 60.000 ms (era 10.000 ms na fatia 1k).

## Metodologia — abordagem de economia de tokens

A fatia 1k custou ~250k tokens de agente, majoritariamente por causa de seeding serial (1.000
chamadas de API sequenciais, um único tenant, respeitando a quota de 100 req/60s por tenant, ~26
minutos) com o agente monitorando interativamente o tempo todo. Para 10k, a abordagem foi
deliberadamente diferente:

1. **Seeding paralelo entre tenants existentes**: os 10 tenants sintéticos do PERF-11-b
   (`org_01M2H00W3C1JKN4R98DR6T8AJJ` .. `org_01M2H02ZRNDJ0XDX2D02ZPYMAX`, sessões em
   `docs/engineering/performance/.local/perf-11b-session-{1..10}.json`, já em disco) já existiam.
   Como o `reminder-producer` escaneia **globalmente** (GSI3, não particionado por tenant —
   confirmado na fatia 1k), semear 1.000 items+policies em **cada um** dos 10 tenants (10 × 1.000 =
   10.000 total), todos com trigger no mesmo minuto-alvo, produz um burst global genuíno de 10k
   occurrences no tick do produtor — enquanto o seeding de cada tenant respeita sua **própria**
   quota de 100 req/60s de forma independente das demais.
2. **Um único script robusto rodando 10 workers concorrentes em processo**
   (`docs/engineering/performance/traces/perf-12-seed-10k.mjs`), um por tenant, cada um com seu
   próprio ritmo de 700ms/request + backoff exponencial em `429`, sem nenhuma chamada de ferramenta
   interativa por item. O script rodou em background (~37 min de wall-clock, incluindo o burst em
   si) e foi verificado por poll pontual em arquivos de progresso
   (`docs/engineering/performance/.local/perf-12-10k-progress/tenant-{1..10}-summary.json`,
   atualizados a cada 100 itens) em vez de streaming contínuo de output.
3. **Coleta de métricas em passes únicos**: cada métrica (duração de tick do produtor, contagem de
   dispatch, throttling de DynamoDB/SQS/Lambda, backlog de fila) foi obtida via uma consulta
   CloudWatch Logs Insights ou uma chamada `get-metric-statistics` cobrindo toda a janela de
   interesse (`00:29`–`01:01 UTC`), não via polling repetido por métrica.
4. **Reuso, não reinvenção**: o script de seed é uma adaptação direta de `perf12-seed.mjs` (fatia
   1k) e `perf-11b-multi-tenant-setup.mjs`; a análise de causa raiz do produtor reaproveita
   integralmente a explicação já documentada na fatia 1k (`producer.ts`, loop sequencial por
   occurrence, lookback, reconciliação).

### Achado operacional durante a preparação (não um bug de produto)

Os arquivos de sessão do PERF-11-b (`perf-11b-session-{i}.json`) armazenam `cookieHeader` mas
**não** um campo `csrfTokenValue` separado — diferente do formato usado pela fatia 1k
(`perf-04-session-cookies.json`, que tem ambos). Uma tentativa inicial de reusar o mesmo padrão de
headers (`sess.csrfTokenValue`) produziu `403 CSRF_CHECK_FAILED` (enviando `X-CSRF-Token:
undefined`) e foi inicialmente mal-diagnosticada como sessão expirada. Corrigido extraindo o valor
do cookie `__Host-et_csrf` diretamente de `cookieHeader` via regex — as sessões originais (obtidas
às ~22:18 UTC do dia anterior) continuavam válidas, sem necessidade de reautenticação. O script de
seed final (`perf-12-seed-10k.mjs`) já inclui esse fallback (`csrfFromCookieHeader`).

### Tenants e dados

- 10 tenants: `org_01M2H00W3C1JKN4R98DR6T8AJJ` .. `org_01M2H02ZRNDJ0XDX2D02ZPYMAX` (ver tabela
  completa em `PERF-11b-multi-tenant-load-testing.md`).
- 1.000 Items + 1.000 ReminderPolicy por tenant (`POST /bff/api/items`, `POST
  /bff/api/reminders/policies`), categoria `PERF-12-10k`, nomes prefixados `PERF-12 10k T{01..10}
  Item {0001..1000}` / `... Policy {0001..1000}`, `dueDate` 2026-09-14, trigger único
  `offsetIso: "P0D"`, `localTime: "21:30"`, `timeZone: "America/Sao_Paulo"` — todos os 10.000
  occurrences materializados para o **mesmo minuto**, `2026-09-15T00:30:00.000Z`.
- Resultado do seed: **10.000/10.000 items e 10.000/10.000 policies criados, 0 falhas** em
  qualquer um dos 10 tenants (`perf-12-10k-seed-summary.json`), via API real (nenhuma escrita
  direta no DynamoDB). Início: `2026-09-14T23:53:40Z`. Fim: `2026-09-15T00:30:52Z` (~37 min
  wall-clock, incluindo a folga deixada até o minuto-alvo).

## 17.2 — Reminder Producer

| Métrica | Fatia 1k (antes da correção) | Fatia 10k (depois da correção) |
|---|---|---|
| Timeout configurado | 10.000 ms | **60.000 ms** |
| Concorrência dentro do tick | sequencial (1 por vez) | **8 occurrences em paralelo** (`Promise`/bounded concurrency) |
| Lookback | 5 min | **15 min** |
| Occurrences no burst | 1.000 (1 tenant) | **10.000 (10 tenants, GSI3 global)** |
| Duração da janela de timeout | ~7 min consecutivos (22:11–22:17) | **~20 min consecutivos (00:32–00:52 UTC)**, com ticks normais intercalados por sobreposição de invocações concorrentes |
| Occurrences despachadas (estabilizado) | 560/1.000 (56,0%) | **5.338/10.000 (53,4%)** |
| Occurrences perdidas permanentemente | ~440 (44,0%) | **~4.662 (46,6%)** |

Sequência observada (CloudWatch Logs Insights, `/aws/lambda/exptrk-dev-reminder-producer`, todos
os horários UTC):

1. `00:30:30` — último tick normal antes do burst entrar no lookback: `scanned:0, claimed:0`,
   1.364 ms, janela `00:14`–`00:29`.
2. `00:32:29` em diante — assim que o minuto `00:30` (onde os 10.000 occurrences estão) entra na
   janela de lookback, a função passa a **estourar o timeout de 60.000 ms repetidamente**, com
   múltiplas invocações sobrepostas (EventBridge dispara a cada 1 min, mas cada invocação pode
   levar até 60s, gerando sobreposição — concorrência máxima observada de Lambda: **6**).
3. Timeouts consecutivos observados até `00:52:22` — **~20 minutos**, com uma janela intermediária
   confusa em que ticks ora completam rápido (1.3–4.6s, refletindo invocações que pegaram um shard
   já vazio) ora estouram o timeout (invocações que pegaram um shard ainda cheio) — o mesmo padrão
   de sobreposição já visto na fatia 1k, só que numa janela mais longa.
4. A partir de `00:53:32`, os ticks voltam a completar normalmente e de forma estável
   (1.6–4.6 s, `scanned:0, claimed:0`), mas o minuto `00:30` já não aparece mais em
   `minutesScanned` desde o tick de `00:47:33` (janela `00:31`–`00:46`) — **o minuto-alvo saiu da
   janela de lookback de 15 minutos antes de ser totalmente drenado**.

**Nenhuma invocação durante a janela de timeout logou `"reminder-producer tick complete"`** — mesmo
padrão da fatia 1k: o handler é morto pelo runtime no meio do processamento, sem produzir um
scanned/claimed final para essa invocação especificamente.

### DynamoDB e Lambda durante o burst

| Métrica | Valor | Throttling? |
|---|---|---|
| `DynamoDB ThrottledRequests` (tabela) | 0 em toda a janela (00:29–01:01) | Não |
| `ConsumedWriteCapacityUnits` (pico, 1 min) | 22.502 unidades (00:32 UTC) | Não (on-demand absorveu sem throttle, ~4,5x o pico da fatia 1k, proporcional ao volume 10x) |
| `Lambda Throttles` (`reminder-producer`) | 0 | — |
| `Lambda Errors` (`reminder-producer`, soma na janela) | ~40 (1–3/min entre 00:31–00:51) | Contabiliza os próprios timeouts como erro de invocação — não é um erro de infraestrutura separado |
| `ConcurrentExecutions` (`reminder-producer`, pico) | 6 | Longe de qualquer limite de conta — corrobora que o teto não é concorrência de Lambda disponível, é tempo de processamento por invocação |

Confirmação rápida (não re-derivada do zero, reaproveitando a conclusão já estabelecida na fatia
1k e no PERF-11-b): DynamoDB em modo on-demand segue absorvendo o burst sem nenhum throttle mesmo
em 4,5x o pico de escrita da fatia 1k. **O teto continua não sendo infraestrutura.**

## 17.3 — Reminder Dispatch (consumer SQS)

| Métrica | Valor |
|---|---|
| Occurrences efetivamente despachadas (estabilizado, confirmado sem crescimento por ≥7 min: 00:54–01:01 UTC) | 5.338 de 10.000 (53,4%) |
| `ApproximateAgeOfOldestMessage` (fila `exptrk-dev-reminder-dispatch`) | máximo 2s pontual, predominantemente 0s durante toda a janela |
| DLQ (`exptrk-dev-reminder-dispatch-dlq`) | 0 mensagens |
| `Errors` (Lambda `reminder-dispatch`) | 0 em toda a janela |
| Concorrência máxima (`ConcurrentExecutions`) | 23 (pico em 00:31, drenando rapidamente para 8-9) |

Mesma conclusão da fatia 1k: o `reminder-dispatch` **nunca foi o gargalo**, mesmo em 10x o volume —
consumiu tudo que o produtor conseguiu produzir, praticamente em tempo real (fila sem backlog
relevante), sem nenhum erro.

## 17.4 — A pergunta central: a correção resolveu o problema?

**Não.** A aritmética do plano desta tarefa previa que 10.000 occurrences a 8x de concorrência
(~1.250 unidades-de-tempo sequenciais-equivalentes) caberiam dentro do orçamento de 60s, por
analogia com o fato de que 1.000 occorrences sequenciais não coube em 10s. Isso **não se confirmou
empiricamente**:

- Na prática, o tick continuou estourando o timeout de 60s por **~20 minutos consecutivos**
  (quase 3x a duração da janela de timeout da fatia 1k), não por um único tick.
- A fração de occurrences perdidas permanentemente ficou **estatisticamente igual** entre as duas
  fatias: 44,0% (1k) vs. 46,6% (10k) — ou seja, **o volume 10x maior não piorou proporcionalmente a
  fração perdida** (o que seria o pior cenário), mas também **não foi resolvido pela correção**
  (60s + concorrência 8 + lookback 15min ainda deixa quase metade das occurrences presas).
- A causa raiz é a mesma da fatia 1k, ainda não coberta por nenhum mecanismo de reconciliação: uma
  occurrence `SCHEDULED` cujo minuto-alvo sai da janela de lookback antes do produtor conseguir
  reivindicá-la fica presa permanentemente. Aumentar o timeout e paralelizar dentro do shard
  **adia** o ponto de ruptura (funciona até um certo volume) mas não o **elimina** — em qualquer
  volume grande o suficiente para que 8 workers concorrentes não deem conta de todo o shard dentro
  do timeout configurado (qualquer que seja), o mesmo padrão de perda reaparece.
- **Implicação prática**: aumentar ainda mais o timeout (ex. para o teto de 900s do Lambda) ou a
  concorrência (16, 32...) empurraria o problema para volumes ainda maiores, mas não é uma correção
  estrutural — é a mesma mitigação de curto prazo já identificada como tal na fatia 1k, agora
  confirmada por medição a não escalar linearmente com o volume de forma confiável. A correção
  estrutural real precisa de um dos dois: (a) um mecanismo de reconciliação dedicado que
  explicitamente recupere occurrences `SCHEDULED` cujo `scheduledAt` já passou do lookback mas
  nunca foram `CLAIMED` (não implementado em nenhuma das duas fatias), ou (b) um redesenho do
  produtor que não dependa de terminar de processar um shard inteiro dentro de uma única invocação
  de timeout fixo (ex. paginação/checkpoint entre invocações, ou distribuir o shard por múltiplas
  invocações Lambda concorrentes desde o início).

## Verificação — isolamento dos dados

- Todos os 10.000 items/policies usam o prefixo `PERF-12 10k T{01..10}` / categoria `PERF-12-10k`,
  distintos dos dados do PERF-04/05/11 (`PERF Test Tenant`) e da fatia 1k (`PERF-12-1k`, mesmo
  tenant) — nenhuma mistura.
- Nenhum tenant de terceiro foi tocado — todas as chamadas usaram `X-Organization-Id` apontando
  explicitamente para um dos 10 tenants sintéticos do PERF-11-b, validado no backend
  (`RequestContextResolver`) contra a membership real de cada usuário Cognito sintético.
- Nenhuma escrita direta no DynamoDB — 100% via API real do produto.
- Dois items de teste de sessão avulsos (`PERF-12 10k session-check`, criados durante a validação
  do formato de sessão) foram criados por engano em `org_01M2GE4F1SZPSJ47HCGRXH4XMN` (tenant
  PERF-04/05/11/1k) e em `org_01M2H00W3C1JKN4R98DR6T8AJJ` (tenant 01 do PERF-11-b/10k) — **ambos
  já deletados** (`DELETE /bff/api/items/{id}`, confirmado `204`) antes da escrita deste relatório.

### Sobre as ~440 occurrences presas da fatia 1k

Verificado explicitamente (conforme pedido): a janela de dispatch nas últimas horas não mostra
nenhuma atividade correspondente aos items `PERF-12 1k` — as ~440 occurrences que ficaram presas em
`SCHEDULED` na fatia 1k (minuto-alvo `2026-09-14T22:10:00Z`) **continuam presas**. O lookback
ampliado para 15 minutos (parte da correção) não foi suficiente para alcançá-las retroativamente:
mesmo 15 minutos é uma janela pequena demais para cobrir um gap de várias horas entre o minuto-alvo
original e qualquer tick executado depois. Isso é esperado e não é uma falha da correção — só
confirma que a correção atual **não tem, e nunca teve a intenção de ter**, um mecanismo de
recuperação retroativa; ela só reduz a chance de uma occurrence sair do lookback **durante** o
processamento do próprio burst, o que — como este teste mostrou — ainda falha em volumes grandes o
suficiente. As ~4.662 occurrences novas presas por este teste de 10k estão no mesmo estado e
sujeitas à mesma limitação.

## Recomendação sobre os dados de teste

Os 10 tenants sintéticos e os ~13.000 items/policies acumulados neles (3 do PERF-11-b + 1.000 do
PERF-12-10k, por tenant) devem ser considerados descartáveis, mesmo destino recomendado no
PERF-11-b — nenhuma exclusão foi feita nesta tarefa (fora de escopo, decisão de Marcelo).

## Próximos passos

- **100k / 1M**: continuam fora de escopo desta tarefa (Marcelo decide separadamente se e quando
  prosseguir). Dado que a correção já não se sustenta em 10k, repetir o padrão em 100k/1M sem antes
  endereçar a causa raiz (reconciliação dedicada ou redesenho do produtor) provavelmente só
  reproduziria a mesma proporção de perda, não traria informação nova relevante.
- **Correção estrutural pendente**: a issue real (perda permanente sob burst) segue sem correção
  estrutural após duas fatias de teste. Candidatos, em ordem de esforço crescente: (1) job de
  reconciliação dedicado para occurrences `SCHEDULED` fora do lookback nunca reivindicadas
  (cobertura de gap hoje inexistente em `reminder-reconciliation.ts`); (2) redesenho do produtor
  para não depender de terminar um shard inteiro numa única invocação (checkpointing entre
  invocações, ou fan-out de shard/minuto para múltiplas invocações Lambda paralelas desde o
  EventBridge Scheduler).
- 17.5 (experimentação de SQS) e 17.6 (redesenho horizontal): permanecem não avaliados, mesma
  lógica da fatia 1k — o gargalo real continua sendo o ReminderProducer, não o consumer SQS.

## Scripts e arquivos

- `docs/engineering/performance/traces/perf-12-seed-10k.mjs` — seed paralelo 10 tenants ×
  1.000 (committed).
- `docs/engineering/performance/traces/perf-12-refresh-sessions.mjs` — utilitário de
  reautenticação de sessões (não precisou ser usado nesta execução; committed para reuso futuro).
- `docs/engineering/performance/.local/perf-12-10k-seed-summary.json`,
  `perf-12-10k-progress/tenant-{1..10}-summary.json`, `perf-12-10k-progress/tenant-{1..10}.jsonl`
  — resultado do seed (gitignored).

## Tempo total desta tarefa (comparação de economia de tokens)

Do início da preparação (leitura dos relatórios de referência) até a coleta final de métricas:
**~1h10 de wall-clock** (23:53 UTC início do seed até ~01:01 UTC estabilização confirmada do
dispatch), a maior parte disso (37 min) sendo o próprio seeding paralelo + ~30 min de burst/
drenagem observados via poll esparso, não centenas de chamadas de ferramenta individuais por item
— consistente com o objetivo desta tarefa de manter o custo de agente baixo apesar do volume 10x
maior que a fatia 1k.
