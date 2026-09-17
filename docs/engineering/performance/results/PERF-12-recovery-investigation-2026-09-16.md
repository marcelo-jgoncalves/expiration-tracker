# PERF-12 — recuperação e limites do experimento, 2026-09-16

Continuação da [investigação de causas adicionais](PERF-12-additional-causes-2026-09-16.md).
AWS somente leitura; reproduções locais executam funções reais com o
InMemoryReminderStore já usado pelos testes. Nenhum defeito foi corrigido ou
injetado na AWS. Os achados de recuperação abaixo são prioritários antes de
considerar o pipeline robusto, mesmo que a latência de 10k venha a melhorar.

## R1 — claim revertido fica sem caminho de retomada após scan COMPLETED

**Confirmado no código e reproduzido localmente. Não ocorreu na população AWS
de 10k, cujas reconciliações reportaram zero reversões.**

Sequência reproduzida:

1. Ocorrência CLAIMED expira; o scan do minuto/shard já está COMPLETED.
2. reconcileExpiredClaims muda a ocorrência para SCHEDULED e remove GSI6PK/SK
   de WORKSTATE#CLAIMED. Não publica candidato nem reabre a lease de scan.
3. runEnumerationTick visita o minuto ainda dentro do lookback, encontra a
   lease COMPLETED e não inicia nova cadeia.
4. Um dispatch antigo que chega depois encontra SCHEDULED e retorna
   SKIPPED_NOT_CLAIMED, sendo confirmado pelo consumidor.
5. A recuperação SCANLEASE só encontra IN_PROGRESS expiradas; a ocorrência
   também saiu do índice de claims expirados. Nenhum desses mecanismos a retoma.

Saída da reprodução, com as quatro leases do minuto concluídas:

```json
{"reproduced":true,"reverted":1,"status":"SCHEDULED","hasClaimRecoveryPointer":false,"completedLeases":4,"newScanChains":0,"oldDispatch":"SKIPPED_NOT_CLAIMED"}
```

Fontes: src/workers/reminder-reconciliation/reconciliation.ts,
src/workers/reminder-scan/enumerate-and-lease.ts,
src/runtime/aws/handlers/reminder-reconciliation-handler.ts e
src/workers/reminder-dispatch/dispatch.ts. O comentário da reconciliação ainda
pressupõe que o próximo lookback relerá GSI3, válido no LEGACY mas não para uma
lease PAGED já concluída. D-300 §7 preservou CLAIMS/DST sem mudar essa interação.

Uma mensagem de claim residual pode resgatar a ocorrência por acaso; isso não
é uma garantia de recuperação. A hipótese de sequência sem esse resíduo é
suficiente para reproduzir o defeito. A mesma fronteira COMPLETED merece teste
de materialização tardia/visibilidade tardia de GSI3; não foi simulada na AWS.

Correção requer definir uma retomada durável e idempotente quando se desfaz um
claim, incluindo execução fora do lookback. Não basta aumentar TTL ou esperar
a duplicação do relay resgatar o caso. A escolha entre republicar candidato e
reabrir scan altera o protocolo de recuperação e deve passar pelos gates de
arquitetura aplicáveis; esta investigação não aprova silenciosamente um desenho.

## R2 — falhas de transação são confirmadas como LOST_CLAIM_RACE

**Confirmado e reproduzido por injeção local após a fronteira do store.**
claimReminderOccurrence captura qualquer TransactionCanceledException e retorna
LOST_CLAIM_RACE. O consumer considera esse retorno sucesso e não inclui a
mensagem em batchItemFailures. O helper de chasing tem o mesmo padrão.

Injeções separadas de CancellationReasons no erro:

| Código injetado | Resultado atual |
|---|---|
| TransactionConflict | LOST_CLAIM_RACE |
| ProvisionedThroughputExceeded | LOST_CLAIM_RACE |
| ValidationError | LOST_CLAIM_RACE |

Nenhuma transação da reprodução foi aplicada. A ocorrência continuou SCHEDULED.
A [API DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)
documenta causas distintas para cancelamento; o nome da exceção sozinho não
prova que outra execução concluiu o claim. Falhas transitórias precisam chegar
ao mecanismo de retry; falhas permanentes precisam de tratamento visível, não
confirmação silenciosa. Mesmo ConditionalCheckFailed exige identificar a entrada
e distinguir o estado efetivo, em vez de presumir sucesso alheio.

Na AWS, TransactionConflict da tabela somou **20 eventos** na janela 18:49–19:00.
É métrica de tabela/itens, não identificação dos 536 LOST_CLAIM_RACE do consumer:
não atribuir os 20 ao claim nem classificar todos os 536 como conflitos benignos.
Os logs atuais perderam CancellationReasons ao converter tudo no mesmo outcome.
As 10.000 ocorrências concluíram; não houve perda observada nesse experimento.

O padrão de captura genérica também aparece no checkpoint de scan. Ali, uma
falha pode atrasar retomada até expirar a lease; precisa de revisão dirigida
das razões de cancelamento, separada do replay de cursor já comprovado.

## R3 — as notificações do teste foram canceladas por falta de destinatário

**Confirmado por leitura consistente dos 10.000 NotificationIntent.** IDs obtidos
dos outboxes de criação, join tenantId+itemId com a população: 10.000 matches,
10.000 itens únicos. Todos com status CANCELLED e motivo RECIPIENT_NOT_FOUND.
Logs do router entre 18:30 e 19:15 corroboram 10.000 CANCELLED e 10.000
NOOP_NOT_PENDING; a segunda passagem lê a modificação do intent já cancelado.

Isso não invalida a medição explicitamente definida até TRIGGERED. Porém, o
teste não exercitou roteamento com destinatário resolvido, entrega ao provedor,
nem a carga de escritas que essas etapas acrescentariam ao stream compartilhado.
Não apresentar esse resultado como capacidade ponta a ponta de notificações.
Futuro ensaio desse escopo deve usar destinatários de teste controlados e
critérios próprios de entrega, sem enviar mensagens a terceiros por inferência.

## Scheduler — atraso fixo observado também fora do burst

Consulta ampliada 18:30–19:15 encontrou 45 enumerações. Diferença entre horário
de conclusão e último minuto enumerado: mínimo 90,463s, mediana 91,076s, máximo
93,233s. O comportamento antecede o burst e permanece depois dele: não é um
atraso criado pela carga de 10k. Com AsyncEventAge máximo de 78ms e enumeração
de poucos segundos, os dados apontam para fase/entrega do schedule e referência
temporal do tick. Ainda falta scheduledTime original no log do producer para
separar esses componentes; não alegar causa exata além dessa fronteira.

## Stream e router — o que continua sem prova causal

O inventário de métricas GetRecords disponível traz ReturnedRecordsCount,
ReturnedBytes e SuccessfulRequestLatency, mas não uma série de throttling que
permita atribuir a espera aos quatro leitores. Mantida como hipótese, não fato.

No código, o router busca AppConfig antes de descartar registros de entidades
irrelevantes. O adapter faz GetLatestConfiguration a cada chamada e ignora
NextPollIntervalInSeconds. A [API AppConfig](https://docs.aws.amazon.com/appconfig/2019-10-09/APIReference/API_appconfigdata_GetLatestConfiguration.html)
orienta aguardar esse intervalo. Esse acesso cria custo/latência evitáveis em
batches que nem contêm intents, mas a consulta ampliada não encontrou erros
de leitura de flags. Não atribuir os 66s de IteratorAge só ao AppConfig sem
medição dos spans ou experimento isolado. Corrigir cache exige preservar a
semântica de atualização do kill switch.

## Encaminhamento e reprodução

Prioridade: fechar R1/R2 e os defeitos já identificados de relay/scan antes de
avançar volume. Fazer regressões que comprovem retomada durável, classificação
de cancelamento, replay e recuperação após falha, além do caminho feliz de 10k.
Não usar a ausência de Lambda Errors como prova de ausência desses defeitos.

Reprodução local (nenhum SDK/AWS no script):

```powershell
npx tsx docs/engineering/performance/.local/d300-10k-preparation-20260916/recovery-repro.ts
```

O script usa uma ocorrência sintética do dump local apenas como fixture; injeta
CLAIMED/lease COMPLETED no store em memória e chama as funções reais. Os asserts
caracterizam o defeito atual, não são o critério de sucesso de uma futura correção.
Resultados em recovery-repro-result.json e claim-error-repro-result.json.
Demais artefatos locais: deep-{enumeration,routerFailures,routerOutcomes}.json,
deep-notification-intents.json, deep-conflict-metrics.json e
deep-stream-metric-inventory.json, no mesmo diretório ignorado.
