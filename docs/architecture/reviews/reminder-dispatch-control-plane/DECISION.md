---
status: APPROVED_BY_OWNER (protocolo dispensado)
decision: D-303
date: 2026-09-19
owner: Marcelo
risk: 6
mirrors: D-301/D-302 (mesmo padrão, aplicado ao lado oposto do pipeline)
---

# D-303 — Outbox/stream/relay dedicados para o dispatch de reminders

## 1. Decisão

O outbox de dispatch de reminders (criação de `NotificationIntent` na transição
`ReminderOccurrence CLAIMED→TRIGGERED`, hoje publicado via `dispatch-outbox-relay` lendo o
DynamoDB Stream **global e compartilhado** da tabela principal) passa a usar uma tabela/stream/
relay/fila **dedicados**, isolados do stream principal — mesmo padrão físico que D-301/D-302 já
aplicou ao lado do *scan*. Nenhum outro consumidor do `dispatch-outbox-relay` compartilhado (ex.
`ImportCommitWorker`/`SQS_IMPORT_COMMIT_V1`, `infra/main.tf:2497`) é tocado — este é um outbox
físico **novo e paralelo**, exclusivo do dispatch de reminders; o relay/stream compartilhado
continua existindo e servindo todo o resto do sistema sem mudança.

## 2. Motivação — achado real, medido, não hipotético

Revalidação de 10k do D-301/D-302 em 2026-09-19 (`docs/engineering/performance/results/
PERF-12-10k-latency-regression-2026-09-19.md`): 10.000/10.000 `TRIGGERED`, zero perda, mas SLO de
300s reprovado (p100=535,98s) — **pior** que os dois runs de 10k que motivaram D-301/D-302
originalmente (359,983s/331,173s). O scan em si ficou rápido (19-22s, D-301/D-302 funcionando como
desenhado). A causa raiz medida: `dispatch-outbox-relay`'s `IteratorAge` subiu a um pico de 275,8s
(~4,6min) — o mesmo sintoma de head-of-line blocking que motivou D-301/D-302, agora do lado que
nunca foi redesenhado. `reminder-dispatch` em si não tem teto de concorrência e ficou faminto de
mensagens (fila com profundidade visível zero o tempo todo) — não é ele o gargalo, é o que
alimenta sua fila.

**Mitigação vertical já esgotada**: `parallelization_factor=4` no event source mapping do relay
(o "PF4" pré-registrado como "passo final de tuning vertical" após PF2 não ter bastado) já estava
ativo neste teste e ainda assim produziu IteratorAge pior que o PF2 anterior (119,9s). Subir mais
(máximo AWS permite é 10) não tem base de evidência para ajudar — o próprio comentário original já
tratava 4 como teto útil desse tipo de tuning.

## 3. Autoridade e protocolo Type 1

Risco **nível 6**: nova topologia AWS (tabela/stream/relay/fila dedicados), mesmo nível do D-301
original.

O protocolo Claude↔Codex foi dispensado por decisão direta do Marcelo (`ai-governance.md` §2):

1. Marcelo pediu explicitamente ("pode fazer também outras correções que a princípio exigiriam o
   protocolo") para prosseguir sem a rodada formal, no contexto desta mesma sessão de investigação
   do achado acima — decisão dele, não proposta minha validada por outro agente.
2. Esta seção registra explicitamente a dispensa e por quê.
3. §7 (Opções consideradas) registra as alternativas tecnicamente viáveis mesmo sem debate formal.

**Ressalva honesta, diferente de D-301**: Marcelo autorizou dispensar o protocolo de forma geral
para esta investigação, mas não viu ESTE desenho específico linha a linha antes de eu escrevê-lo —
diferente de D-301, onde ele já tinha recebido a recomendação e mandado prosseguir com ela
nomeada. Mitigado por isto ser um espelho direto de um padrão já `APPROVED`/implementado/validado
(D-301/D-302), não uma arquitetura nova do zero — o risco de estar tecnicamente errado é menor que
o de uma decisão Type 1 genuinamente original. Uma revisão (Codex, quando disponível, ou o próprio
Marcelo antes do rollout real) continua recomendada antes de aplicar em `dev`, mesmo não sendo gate
de validade desta decisão.

## 3.1 Pesquisa externa (`AGENTS.md` §4, feita mesmo com o protocolo formal dispensado)

- [DynamoDB Streams is not an outbox (Allen Helton, Ready Set Cloud)](https://www.readysetcloud.io/blog/allen.helton/dynamodb-streams-is-not-an-outbox/) —
  confirma diretamente o desenho proposto: "salvar o evento de domínio e a mutação de dados na
  mesma transação `TransactWriteItems`, em tabelas separadas" garante atomicidade sem depender do
  stream da tabela de negócio carregar o outbox.
- [Implementing the transactional outbox pattern with Amazon EventBridge Pipes (AWS Compute Blog)](https://aws.amazon.com/blogs/compute/implementing-the-transactional-outbox-pattern-with-amazon-eventbridge-pipes/) —
  a alternativa "sem tabela de outbox dedicada" da própria AWS não trata contenção/throughput de
  stream compartilhado; o único mecanismo de isolamento que oferece é filtro na saída, que já
  tínhamos descartado como Opção J abaixo (mesmo motivo da Opção B de D-301). Confirma que a
  Opção D de D-301 §13 ("tabela dedicada + Pipe", não escolhida por reaproveitar o outbox já
  existente) continua a alternativa correta a não escolher agora pelo mesmo motivo original.
- [Troubleshoot Lambda IteratorAge metric increases for DynamoDB streams (AWS re:Post)](https://repost.aws/knowledge-center/dynamodb-lambda-iteratorage) —
  confirma que IteratorAge crescente é o sintoma correto de "publisher ficando para trás", e que
  mais de 2 leitores por shard é anti-padrão documentado pela própria AWS — o stream principal
  desta tabela já tem múltiplos consumidores reais (dispatch-outbox-relay compartilhado serve
  vários tipos de evento), reforçando que a mitigação correta é isolar o outbox de alto volume,
  não adicionar mais leitores ao mesmo stream.

## 4. Topologia proposta (espelha D-301/D-302 §4)

```text
reminder-claim-consumer
        |
        | TransactWriteItems (ReminderOccurrence CLAIMED->TRIGGERED
        |   + NotificationIntent + ReminderDispatchOutbox — 3 itens,
        |   2 tabelas, mesma transação atômica)
        v
ReminderDispatchOutboxTable --stream--> ReminderDispatchOutboxRelay --> notification-router queue
```

`TransactWriteItems` da DynamoDB suporta múltiplas tabelas na mesma transação — a atomicidade
entre a transição de estado da ocorrência e o outbox não depende de as duas linhas viverem na
mesma tabela. Isso preserva o invariante mais importante do padrão outbox (nunca existe transição
sem outbox correspondente) sem exigir que o outbox compartilhe stream com a tabela principal.

## 5. Modelo de dados (sketch — detalhamento fica para a implementação)

Tabela `exptrk-${environment}-reminder-dispatch-outbox`, mesmo padrão de D-301/D-302 §5: on-demand,
PK/SK simples, stream `NEW_AND_OLD_IMAGES`, TTL `purgeAfterTtl`, PITR habilitado. Chave por
`occurrenceId`+`version` (mesma disciplina anti-republicação dupla do D-301 §5.3). Relay dedicado:
mesmo desenho de lease/outbox/reconciliador de D-301 §7/§8, adaptado para publicar na fila de
notification-router em vez da scan queue.

## 6. Rollout

Mesmo runbook de D-301/D-302 §12: implantação escura (tabela/relay/fila desabilitados) → dual-read
sem dual-write → canário pequeno → cutover por epoch → 1k → 10k (repetir exatamente esta
revalidação) → 100k só depois de 10k passar. Não há necessidade de backfill (diferente do
DueWorkTable) — o outbox de dispatch é sempre de vida curta (criado e consumido em segundos),
nunca existe um backlog histórico para migrar.

## 7. Opções consideradas

Mesmas 9 opções de D-301 §13 se aplicam estruturalmente (mesma classe de problema — contenção de
DynamoDB Streams compartilhado). Delta específico deste caso, não coberto lá:

### J. Filtrar o relay compartilhado por tipo de evento (só reminders num mapping dedicado)

Rejeitada pelo mesmo motivo da opção B de D-301: filtro reduz invocações mas não cria stream
físico independente — a contenção de shard/IteratorAge do stream principal continua a mesma
independente de quantos mappings filtrados existirem sobre ele.

### K. Não fazer nada; aceitar SLO mais frouxo para bursts de 10k+

Considerada seriamente, dado o padrão observado neste programa (todo problema real só aparece em
escala, nunca em 1k). Rejeitada como decisão FINAL sem antes tentar a correção estrutural — mas
registrada aqui como resposta honesta à pergunta aberta do Marcelo: **é genuinamente possível que,
mesmo após esta correção, uma rajada de 10k+ no mesmo minuto sempre produza uma cauda mais longa
que qualquer SLO fixo de 300s**, dado que o modelo de capacidade original (`reminder-producer-
implementation-plan-scoping/DECISION.md` §3) já era uma "assunção de engenharia, não medida" desde
o início. Se a revalidação pós-D-303 ainda reprovar, a resposta honesta muda de "precisamos
corrigir mais uma coisa" para "o SLO de 300s pode não ser a métrica certa para este volume" — essa
reavaliação fica registrada como gatilho explícito, não escondida.

## 8. Critério de conclusão

`IMPLEMENTING` até: implementado, canário de 1k aprovado, revalidação de 10k repetida com máximo
<=300s (ou decisão explícita do Marcelo de relaxar o SLO, se a opção K acima se confirmar
necessária mesmo após a correção).
