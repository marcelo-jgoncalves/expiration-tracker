# PERF-12 / D-300 — resultado da revalidação de 10k, 2026-09-16

**Resultado: drenagem completa sem perda observada nesta população; SLO de cinco
minutos REPROVADO.** PERF-12 permanece em andamento. Não extrapolar o resultado
para 100k/1M, rollback ou entrega no provedor.

## População e evidência

Run `d300-10k-preparation-20260916`, conta dev 975707451904, us-east-1, perfil
claude-dev. Dez tenants sintéticos existentes, 1.000 pares Item/ReminderPolicy
por tenant, criados pelas APIs reais; nenhuma escrita direta no DynamoDB.
Injeção concluída 17:38:53 BRT. As 10.000 ocorrências, com chaves e identidades
persistidas em cohort.json, foram verificadas antes do disparo às 17:40:29.

Disparo programado para **18:49:00 BRT** via Scheduler real. Verificação
automática completa às 18:55:33; nova leitura consistente de todas as chaves
às 19:09:31 confirmou o mesmo resultado. Versões implantadas permaneceram
iguais ao baseline durante o experimento.

Artefatos brutos locais em `docs/engineering/performance/.local/d300-10k-preparation-20260916/`:
manifest.json, cohort.json, occurrences.json, result.json, final.json,
preflight-infra.json, final-infra.json, metrics.json, cold-warm.json,
analysis-leases.json, analysis-phases.json, analysis-metrics.json e
analysis-current-queues.json. Não versionar credenciais/cookies ou dumps locais.

## Resultado da população exata

| Medida | Resultado |
|---|---:|
| Ocorrências esperadas/encontradas | 10.000 / 10.000 |
| TRIGGERED | 10.000 |
| Ausentes / SCHEDULED / CLAIMED / CANCELLED ao final | 0 / 0 / 0 / 0 |
| Dentro de 300 segundos | 7.524 (75,24%) |
| Acima de 300 segundos | 2.476 (24,76%) |
| Primeiro TRIGGERED | 18:50:38.552 BRT |
| Último TRIGGERED | 18:55:23.729 BRT |
| Atraso máximo | 383,729s (6min23,729s) |
| Excesso sobre o limite | 83,729s (27,91%) |

TRIGGERED comprova a transição de dispatch, cuja implementação cria
NotificationIntent na mesma transação. Não comprova entrega do e-mail, nem este
relatório verificou exatamente uma entrega no provedor por ocorrência.

| Percentil | Alvo → TRIGGERED | Alvo → claimedAt | claimedAt → TRIGGERED |
|---|---:|---:|---:|
| p50 | 216,950s | 185,716s | 41,893s |
| p75 | 299,469s | 255,493s | 62,717s |
| p90 | 331,523s | 259,277s | 81,421s |
| p95 | 356,570s | 261,819s | 95,841s |
| p99 | 376,088s | 302,963s | 121,078s |
| máximo | 383,729s | 303,253s | 126,909s |

Percentis calculados a partir dos registros individuais persistidos; não somar
percentis de fases diferentes como se correspondessem à mesma ocorrência.

As quatro leases do minuto-alvo estão COMPLETED, 13 páginas cada (52 total),
com 2.507 + 2.462 + 2.522 + 2.509 = **10.000 candidatos publicados**. Seus
checkpoints finais ocorreram entre 18:53:22.589 e 18:54:03.224 BRT.

## Saúde operacional e localização do atraso

Consulta posterior, com a janela 18:49–19:00 BRT já disponível no CloudWatch:
zero Errors e Throttles nas quatro funções producer, claim consumer, dispatch
e dispatch-outbox-relay. Isso não equivale a provar ausência de todo erro de
negócio ou de toda tentativa duplicada; são as métricas nativas observadas.

SQS no mesmo intervalo (máximos dos datapoints disponíveis, resolução 60s):
idade da mensagem mais antiga = 0s nas três filas; backlog visível máximo
scan=0, claim=0, dispatch=2; mensagens em processamento máximas 1/14/10.
Métricas aproximadas de 60s não excluem microbursts entre amostras.

**Indício mais forte: dispatch-outbox-relay IteratorAge máximo = 127.804ms
(127,804s).** A métrica mede a espera entre a chegada do registro ao stream e
seu envio pelo event-source mapping à função, conforme a
[documentação oficial AWS](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html).
O relay participa tanto das continuações do scan quanto do encaminhamento
claim→dispatch. Sua defasagem é compatível com a espera persistida de até
126,909s após claim, enquanto as filas não mostram backlog sustentado.

As durações máximas individuais das quatro Lambdas ficaram entre 2,09s e
3,32s. REPORT lines separadas por cold/warm também foram coletadas. Portanto,
os dados apontam principalmente para espera entre etapas, e não para uma
invocação isolada gastando minutos. **Inferência de gargalo provável, não causa
raiz fechada**: ainda falta correlacionar outbox criado/publicado e continuação
por página, identificar o componente do atraso de leitura/processamento do
stream e medir o efeito de uma mudança isolada.

O snapshot automático final encontrou uma mensagem em processamento na fila
dispatch, portanto marcou queuesEmpty=false. Na consulta posterior às 19:10,
scan/claim/dispatch e suas três DLQs estavam todas vazias, inclusive mensagens
em processamento/atrasadas. Isso não indica ocorrência perdida da população:
as 10.000 já estavam TRIGGERED. Preservado final.json original; o SLO continua
reprovado independentemente da drenagem posterior dessa mensagem.

## Próxima ação

Investigar a defasagem do relay antes de alterar concorrência ou avançar o
volume: correlacionar timestamps de outbox, publicação SQS e páginas de scan;
verificar volume processado, serialização e configuração do consumidor de
stream. Depois de identificar e corrigir a causa com os gates aplicáveis,
repetir o mesmo degrau de 10k. Não aumentar o limite de cinco minutos para
aprovar retrospectivamente este experimento.

Análise somente leitura na AWS; nenhuma correção de produto ou infraestrutura
foi realizada nesta avaliação. Custos reais não consolidados nesta etapa.
