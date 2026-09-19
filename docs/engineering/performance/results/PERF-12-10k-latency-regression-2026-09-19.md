# PERF-12 — revalidação de 10k (cohort de e-mail SES), latência regrediu apesar de zero perda

Data: 2026-09-19. Runbook: `scripts/perf-reminder-burst.mjs`, run id `d302-10k-email-cohort`,
alvo `2026-09-19T01:15:00.000Z`. Tenants: cohort novo de simuladores SES (7 `success@`/1 `bounce@`/
1 `complaint@`/1 `suppressionlist@simulator.amazonses.com`), não os tenants Gmail do PERF-11-b —
ver commit que adicionou `perf-12-email-cohort-tenant-setup.mjs`.

## Resultado

`10.000/10.000 TRIGGERED`, zero perdido, zero duplicata visível na entidade final (`assess()` do
harness rejeitaria duplicata/registro estranho). **`accepted: false`** — SLO de 300s reprovado:

| percentil | segundos |
|---|---:|
| p50 | 245,7 |
| p75 | 317,3 |
| p90 | 366,4 |
| p95 | 392,5 |
| p99 | 421,8 |
| p100 (máximo) | **535,98** |

Isto é **pior** que os dois runs de 10k que motivaram D-301/D-302 originalmente (359,983s e
331,173s, 2026-09-17) — a correção resolveu o problema que ela mirava, mas o número de ponta a
ponta regrediu em vez de melhorar.

## Causa raiz identificada (evidência direta, corrigida após 1ª hipótese incompleta)

**O scan em si está rápido** — não é mais o gargalo. Os 4 shards completaram em 19-22s
(`01:16:56`→`01:17:14-18`), publicando os 10.000 candidatos certos (2.554+2.446+2.556+2.444).

**1ª hipótese testada e descartada como causa dominante**: `reminder-claim-consumer` tem
`MaximumConcurrency=50` no event source mapping, e os logs mostram `"outcome":"CLAIMED"` 20.000
vezes para 10.000 candidatos (confirmado no código-fonte que loga uma vez por registro — não é bug
de log). Isso é real, mas a métrica por minuto mostra que **`claim-consumer` terminou todo o
trabalho em ~2 minutos** (1000 invocações às 01:17, 56 às 01:18, nada depois) — ele não é a causa
da cauda de 9 minutos observada.

**Causa raiz real, confirmada por `IteratorAge`**: `dispatch-outbox-relay` — a Lambda que lê o
DynamoDB Stream **global e compartilhado** da tabela principal para publicar os outboxes de
dispatch — teve `IteratorAge` subindo de 49,8s (01:17) até um pico de **275,8s (~4,6 min, 01:22)**,
caindo depois para 194,2s (01:23). **Este é exatamente o mesmo sintoma que motivou D-301/D-302
originalmente** (então 138,952s de máximo) — só que agora pior, e no lado da pipeline que o
D-301/D-302 nunca tocou. O D-301/D-302 deu ao *scan* uma tabela/stream/relay dedicados; o
**dispatch continua no stream global compartilhado com todo o tráfego de negócio da tabela
principal** (writes de tenant, outras entidades, etc.) — a mesma classe de contenção de
head-of-line blocking, só que do outro lado do pipeline.

`reminder-dispatch` em si não tem teto de concorrência configurado e processou a 9.240 invocações
espalhadas por 7 minutos (~22/min, concorrência máxima só 17) — consistente com estar faminto de
mensagens (a fila `reminder-dispatch` amostrada por minuto mostrou profundidade visível zero o
tempo todo, ou seja, mensagens chegavam devagar demais para se acumular, não é fila lotada que o
`dispatch` não dá conta de processar).

A duplicação real (`CLAIMED` 20.000/10.000, `scan-page` 86/52 invocações) continua um achado
válido e provavelmente digno de investigação separada, mas não é a causa dominante da latência
observada.

**Achado adicional, reforça a conclusão**: `parallelization_factor=4` no
`aws_lambda_event_source_mapping.dispatch_outbox_relay_from_stream` — a mitigação "PF4" registrada
como "pré-registrada, passo final de tuning vertical" após o experimento PF2 (fator 2, que reduziu
o máximo de 359,983s para 331,173s mas não bastou) — **já estava ativa neste teste**, e mesmo assim
o `IteratorAge` (275,8s) ficou pior que o próprio PF2 (119,9s de IteratorAge). Subir ainda mais o
`parallelization_factor` (máximo permitido pela AWS é 10) não tem base de evidência para funcionar
— o comentário original já tratava 4 como o teto útil do tuning vertical puro. **O
`dispatch-outbox-relay` também não é exclusivo de reminders** — é o relay compartilhado de outbox
usado por múltiplos tipos de evento no sistema (ex. `ImportCommitWorker`/`SQS_IMPORT_COMMIT_V1`,
`infra/main.tf:2497`) — isolar esse relay inteiro seria uma mudança de escopo sistêmico, não
específica de reminders. A correção proposta (ver `docs/architecture/adr/` D-30X) isola só o
outbox de dispatch de reminders numa tabela/stream/relay dedicados, em paralelo ao relay
compartilhado existente (que continua servindo todo o resto sem mudança) — mesmo padrão do
D-301/D-302 para o scan.

## Pesquisa externa (AWS, antes de propor solução, `AGENTS.md` §4)

- [Optimize Lambda scaling with Amazon SQS event sources (AWS re:Post)](https://repost.aws/knowledge-center/lambda-sqs-scaling)
- [Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)
- [Introducing Maximum Concurrency of AWS Lambda functions when using Amazon SQS as an event source](https://aws.amazon.com/blogs/compute/introducing-maximum-concurrency-of-aws-lambda-functions-when-using-amazon-sqs-as-an-event-source/)
- [AWS Lambda now supports Maximum Concurrency for Amazon SQS](https://aws.amazon.com/about-aws/whats-new/2023/01/aws-lambda-maximum-concurrency-amazon-sqs-event-source)
- [Faster polling scale-up rate for SQS event sources](https://aws.amazon.com/blogs/compute/introducing-faster-polling-scale-up-for-aws-lambda-functions-configured-with-amazon-sqs/)

Achados relevantes:
- `MaximumConcurrency`, quando atingido, **deveria impedir** overpull/reentrega excessiva (a AWS
  documenta isso como o próprio propósito do recurso) — então o teto de 50 não é a causa direta da
  duplicação; é uma restrição de throughput independente e paralela.
- Ramp-up de polling: começa em 5 lotes concorrentes, escala até +300 instâncias/minuto (com o
  polling acelerado). Um teto de 50 é atingido em bem menos de um minuto — não é o ramp-up que
  explica a lentidão observada, é o teto em si sendo baixo demais para o volume.
- Prática recomendada: dimensionar `MaximumConcurrency`/reserved concurrency pela capacidade real
  do sistema downstream, não por um valor arbitrário — e garantir idempotência (que já existe aqui)
  combinada com relato de falha por item do lote (`batch item failures`, já em uso neste pipeline).

## Alavancas identificadas

1. **Provável causa real, nível 5-6 (Type 1)**: aplicar ao *dispatch outbox* o mesmo padrão já
   provado pelo D-301/D-302 para o *scan* — tabela/stream/relay dedicados, tirando-o do stream
   global compartilhado. É literalmente o mesmo problema (head-of-line blocking num
   `DynamoDBStreams` compartilhado), só que do outro lado do pipeline que nunca foi redesenhado.
   Pesquisa externa já feita para o D-301/D-302 (`docs/engineering/performance/results/
   PERF-12-scalable-scan-architecture-research-2026-09-17.md`) já cobre o padrão de mitigação —
   não é preciso repetir a pesquisa do zero, é avaliar se o MESMO desenho se aplica ao dispatch.
   Exige protocolo Claude↔Codex (`AGENTS.md` §4) antes de implementar — mudança de topologia AWS
   e modelo de coordenação, mesmo nível de risco do D-301/D-302 original.
2. **Subir/remover `MaximumConcurrency=50` em `reminder-claim-consumer`** — alavanca independente,
   de baixo risco (`change-risk-scale.md` nível 4, não exige o protocolo), evidência de que a conta
   tem folga (zero throttle, 1000 disponível vs. pico de 54 usado). Não é mais a causa dominante
   (claim-consumer terminou em ~2min), mas continua sendo uma melhoria real e barata — pode ser
   aplicada já, independente da rodada Codex sobre o item 1.
3. **Investigar por que `scan-page` é invocado ~1,65x mais que páginas reais e `claim-consumer`
   loga `CLAIMED` 2x** — reduziria trabalho desperdiçado, mas não é a causa dominante da latência
   medida nesta rodada; prioridade menor que o item 1.

## Status: rodada Claude↔Codex pendente, Codex bloqueado

`codex exec` confirmou bloqueio de uso (`ERROR: You've hit your usage limit... try again at
Sep 23rd, 2026 8:24 PM`) — mesma conta/janela já observada em sessão anterior via a UI do Codex,
não recurso à parte. Prompt completo preparado para a Rodada 1, pronto para disparar assim que o
Codex estiver disponível (ver `docs/engineering/performance/.local/codex-prompt-perf12-concurrency-round1.txt`,
gitignored — reconstruível a partir deste documento se necessário). Não bloqueante: a alavanca 1
(subir `MaximumConcurrency`) é nível 4, não exige o protocolo por si só; decisão de prosseguir com
ela antes da rodada Codex registrada em `NEXT_SESSION_PROMPT.md`.
