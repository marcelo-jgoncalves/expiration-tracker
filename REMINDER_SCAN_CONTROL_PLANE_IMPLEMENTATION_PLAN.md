# Plano específico de implementação — ReminderScan Control Plane

Status: proposta executiva para leitura e avaliação  
Decisão vinculada: [D-301](docs/architecture/reviews/reminder-scan-control-plane/DECISION.md)  
Data: 2026-09-17  
Escopo: implementar, migrar e validar o plano de controle dedicado do ReminderScan

## 1. O que este plano resolve

O pipeline atual já processa 10.000 lembretes sem perda, mas não cumpre o limite de 300 segundos.
O resultado mais recente foi:

| Configuração | Resultado | Máximo | `IteratorAge` máximo |
|---|---:|---:|---:|
| relay global PF1 | 10.000/10.000 | 359,983s | 138,952s |
| relay global PF2 | 10.000/10.000 | 331,173s | 119,939s |

As continuações que liberam a próxima página do scan disputam o mesmo DynamoDB Stream e o mesmo
relay usados por milhares de outboxes de dispatch. Aumentar paralelismo melhora a cauda, mas não
elimina a disputa nem permite crescer de quatro cadeias sequenciais para o volume de 1 milhão.

O objetivo desta mudança é assegurar:

- isolamento físico entre coordenação do scan e tráfego de negócio;
- escala horizontal configurável por geração de shards;
- nenhuma perda quando qualquer Lambda, stream ou fila falhar;
- rollback seguro sem duas cadeias válidas processando a mesma página;
- evidência progressiva em 1k, 10k, 100k e 1M;
- manutenção do SLO `scheduledAt → TRIGGERED <= 300s`.

## 2. Resultado esperado

```text
Scheduler
   |
   v
Enumerator
   |
   | lease + outbox, uma transação
   v
ReminderScanControlTable
   |
   v
Control Stream -> ScanControlRelay -> reminder-scan queue
                                        |
                                        v
                                     ScanPage
                                        |
                                        v
                                reminder-claim queue
                                        |
                                        v
                              pipeline de claim/dispatch

ControlReconciler -> recupera leases vencidas e outboxes pendentes
```

O tráfego de occurrences, claims, intents e dispatches continua na tabela principal. A tabela nova
guarda somente coordenação `SYSTEM`: cursor, owner, versão, epoch e outboxes de continuação.

## 3. Limites do escopo

### Incluído

- tabela DynamoDB de controle, stream, GSI de recovery, TTL e PITR;
- relay, fila, DLQ, mapping e reconciliador exclusivos;
- modelo de lease/outbox e contrato de mensagem v2;
- adaptação do enumerador e do `ScanPage`;
- publicação limitada em paralelo para a claim queue;
- sharding versionado e suporte a gerações simultâneas durante migração;
- métricas, alarmes, testes de falha, rollout e rollback;
- validações 1k, 10k, 100k e 1M;
- coorte controlada para validar e-mail no teste de 100k.

### Fora desta implementação

- troca do SQS Standard por FIFO;
- migração do relay para EventBridge Pipes;
- mudança do modelo tenant-facing de occurrences ou intents;
- ativação de 100.000 envios reais de e-mail;
- otimizações do frontend ou de APIs HTTP;
- remoção imediata do backend antigo após o cutover.

## 4. Modelo de dados a implementar

Tabela: `exptrk-${environment}-reminder-scan-control`.

| Propriedade | Configuração inicial |
|---|---|
| Chave | `PK` + `SK`, ambas string |
| Billing | on-demand |
| Stream | `NEW_AND_OLD_IMAGES` |
| TTL | `purgeAfterTtl` |
| Recovery index | GSI1 esparso, `GSI1PK` + `GSI1SK`, projeção `ALL` |
| Backup | PITR habilitado |
| Criptografia | chave gerenciada AWS |

### 4.1 Identidade da cadeia

```text
chainId = v{shardFnVersion}#s{shardId}#m{minuteISO}
PK      = SCAN#{chainId}
```

Uma biblioteca única deve criar e interpretar essa chave. Handlers não podem concatená-la.

### 4.2 Lease

```json
{
  "PK": "SCAN#v2#s17#m2026-09-17T18:49:00.000Z",
  "SK": "LEASE",
  "entityType": "REMINDER_SCAN_LEASE",
  "status": "IN_PROGRESS",
  "ownerToken": "uuid",
  "version": 3,
  "rolloutEpoch": 4,
  "leaseUntil": "ISO UTC",
  "lastEvaluatedKey": "canonical cursor",
  "pagesProcessed": 2,
  "candidatesPublished": 400,
  "createdAt": "ISO UTC",
  "updatedAt": "ISO UTC",
  "purgeAfterTtl": 0,
  "GSI1PK": "LEASE#IN_PROGRESS",
  "GSI1SK": "{leaseUntil}#{chainId}"
}
```

Quando concluída, a lease muda para `COMPLETED`, perde o cursor e sai do GSI1.

### 4.3 Outbox de continuação

```json
{
  "PK": "SCAN#v2#s17#m2026-09-17T18:49:00.000Z",
  "SK": "OUTBOX#4",
  "entityType": "REMINDER_SCAN_CONTINUATION_OUTBOX",
  "eventId": "deterministic-id",
  "destination": "SQS_REMINDER_SCAN_CONTINUATION_V2",
  "status": "PENDING",
  "payload": {},
  "attemptCount": 0,
  "nextAttemptAt": "ISO UTC",
  "createdAt": "ISO UTC",
  "purgeAfterTtl": 0,
  "GSI1PK": "OUTBOX#PENDING",
  "GSI1SK": "{nextAttemptAt}#{eventId}"
}
```

Cada versão de lease admite no máximo um outbox. O ID é determinístico para que retry não crie
uma continuação logicamente diferente.

### 4.4 Transações

| Operação | Escritas atômicas | Condições principais |
|---|---|---|
| Acquire | criar lease v1 + outbox v1 | cadeia ausente |
| Checkpoint | avançar lease + criar outbox da nova versão | owner, epoch, versão, cursor e lease válidos |
| Complete | avançar lease para `COMPLETED` | mesmas fences; não cria outbox |
| Reclaim | trocar owner, avançar versão + criar outbox | lease ativa e vencida |

Não haverá uma operação que confirme novo cursor antes de tornar a continuação durável.

## 5. Contrato entre os componentes

O comando `reminder.scan-continuation.v2` carrega:

- `controlBackend=DEDICATED_V1`;
- `shardFnVersion` e `shardId`;
- minuto UTC;
- `ownerToken`;
- `leaseVersion`;
- cursor opcional;
- `rolloutEpoch`;
- IDs de mensagem, correlação e deduplicação.

Antes de consultar GSI3, o consumidor compara todos os campos posicionais com a lease. Mensagem
antiga, duplicada ou de outro backend/epoch termina sem produzir candidato.

## 6. Plano de implementação por fatias

Cada fatia deve ser implantável e observável. O tráfego real só muda na fatia 6.

### Fatia 1 — Domínio e persistência

Entregas:

- tipos `ReminderScanLeaseV2` e `ReminderScanContinuationOutbox`;
- codec único de `chainId` e cursor;
- porta `ReminderScanControlStore`;
- adapter DynamoDB com acquire/checkpoint/complete/reclaim;
- builder de condições sem strings divergentes entre caminhos;
- testes unitários e DynamoDB de atomicidade e concorrência.

Arquivos prováveis:

- novo diretório `src/workers/reminder-scan-control/`;
- tipos compartilhados sob `src/workers/reminder-scan/` ou módulo próprio;
- testes em `test/unit/reminder-scan-control/` e `test/integration-dynamodb/`.

Gate: provar que nenhuma falha entre lease e outbox deixa checkpoint sem continuação.

### Fatia 2 — Infraestrutura isolada, ainda sem tráfego

Entregas Terraform:

- tabela e GSI1;
- stream habilitado;
- `reminder-scan-control-relay` Lambda;
- `reminder-scan-v2` SQS e DLQ;
- mappings criados desabilitados;
- IAM mínimo por componente;
- métricas e alarmes base;
- outputs necessários para composição.

Gate: `terraform fmt`, `validate`, testes do módulo/root e plan revisado. O apply ocorrerá somente
pela pipeline de CD após merge; nunca localmente.

### Fatia 3 — Relay e recovery

Entregas:

- filtro do stream somente para outbox de continuação;
- lease condicional de publicação;
- `SendMessageBatch` para a fila v2;
- marcação `PUBLISHED` somente após aceitação pelo SQS;
- partial batch response;
- reconciliador por GSI1 para lease vencida e outbox pendente;
- DLQ e redrive respeitando backend/epoch.

Gate: falhas injetadas antes/depois do envio e antes/depois de `PUBLISHED`, demonstrando eventual
entrega sem perda e duplicata inofensiva.

### Fatia 4 — Enumerator v2

Entregas:

- cálculo de `upperBoundMinute` pelo instante observado;
- geração de chaves para lookback e todas as gerações ativas;
- `BatchGetItem` consistente em grupos de até 100;
- acquire de cadeias ausentes com concorrência limitada;
- telemetria separando atraso do Scheduler e duração da enumeração;
- feature flag `SCAN_CONTROL_BACKEND`, inicialmente `MAIN_TABLE`.

Gate: testes de fronteira de minuto, atraso de 0–59s, ticks sobrepostos, lookback e duas gerações.

### Fatia 5 — ScanPage v2

Entregas:

- validar backend/epoch/owner/version/cursor antes de ler GSI3;
- uma página por mensagem, inicialmente `Limit=200`;
- lotes de dez para a claim queue;
- até cinco lotes simultâneos por página;
- checkpoint somente quando todos os lotes forem aceitos;
- nenhum acesso tenant-facing a partir do relay/reconciliador.

Gate: testes de duplicação, stale message, falha parcial de chunk, redelivery e crash antes do
checkpoint. `test/integration/reminder-scan-engine.test.ts` deve ganhar o fluxo v2 completo.

### Fatia 6 — Canário sem cutover

Entregas:

- backend dedicado habilitado para uma coorte sintética isolada;
- execução de uma página, depois múltiplas páginas;
- falhas controladas de worker, relay e recovery;
- dashboard com métricas de controle;
- registro de custo e capacidade consumida.

Gate: zero perda, zero efeito duplicado, DLQ vazia após recovery e nenhuma escrita indevida na
tabela principal além do pipeline normal de claims.

### Fatia 7 — Cutover controlado

Procedimento:

1. pausar novas aquisições no backend antigo;
2. esperar scan queue, leases e outboxes antigos drenarem;
3. confirmar zero lease antiga `IN_PROGRESS` e DLQs vazias;
4. incrementar `SCAN_MODE_EPOCH`;
5. selecionar `DEDICATED_V1`;
6. habilitar mapping, relay e reconciliador v2;
7. reativar enumeração;
8. executar 1k e observar os gates;
9. executar 10k somente após 1k aprovado.

Gate: duas execuções consecutivas de 10k com máximo até 300s, sem perda, erro, throttle ou DLQ.

### Fatia 8 — Escala 100k e e-mail

O teste separará duas perguntas:

1. o pipeline interno processa 100.000 reminders dentro do orçamento?
2. o canal de e-mail funciona de ponta a ponta?

A primeira usa todos os registros. A segunda usa uma coorte pequena e explicitamente delimitada,
com endereços sintéticos controlados e quota SES confirmada antes do início. Serão medidos intent,
router, fila/relay, worker, aceitação SES, bounce, complaint e DLQ. `RECIPIENT_NOT_FOUND` não será
aceito como prova de entrega.

Gate: capacidade do pipeline e entrega pelo provedor registradas como resultados separados.

### Fatia 9 — Escala 1M

Antes de semear:

- medir p95/p99 real de página no teste de 100k;
- recalcular `requiredShards`;
- confirmar concorrência Lambda, quotas SQS, capacidade DynamoDB e orçamento;
- começar com geração de 64 shards; usar 128 se a medição não der 30% de margem;
- documentar custo esperado e condição de interrupção.

Gate: 1M completo ou identificação honesta de quota externa, sem reduzir a coorte ou o denominador.

### Fatia 10 — Consolidação

Entregas:

- sete dias de estabilidade antes de remover recursos antigos;
- runbooks e diagramas atualizados;
- backend antigo removido em mudança própria e reversível;
- D-301 marcada `IMPLEMENTED_AND_VALIDATED` apenas após todos os gates obrigatórios.

## 7. Dimensionamento inicial

| Volume | Page size | Páginas aproximadas | Shards iniciais |
|---:|---:|---:|---:|
| 1k | 200 | 5 | 4 |
| 10k | 200 | 50 | 4, testar 8 se necessário |
| 100k | 200 | 500 | 16 |
| 1M | 200 | 5.000 | 64 |

Fórmula:

```text
requiredShards = ceil(
  (occurrences / pageSize) * observedPageSeconds / scanBudgetSeconds
)
```

Os números são valores iniciais. O teste anterior determina a configuração do próximo; não se
aumenta simultaneamente page size, shards e concorrência, pois isso impede atribuir causa ao ganho.

## 8. Configurações iniciais

| Componente | Valor inicial | Motivo |
|---|---:|---|
| Query GSI3 | 200 registros | comportamento já medido |
| candidatos por batch SQS | 10 | limite do `SendMessageBatch` |
| batches paralelos por página | 5 | reduz sequência sem fan-out ilimitado |
| scan queue batch | 1 | uma cadeia/página por invocação |
| relay stream batch | 100 | stream contém somente controle |
| relay PF | 2 | baseline conservadora no stream isolado |
| scan queue retention | 14 dias | janela de investigação e redrive |
| DLQ `maxReceiveCount` | 5 | distingue transiente de poison |
| TTL de controle | 7 dias | janela operacional pós-conclusão |
| `MaximumConcurrency` | shards ativos + 25% | comporta gerações sobrepostas/recovery |

Timeout, visibility timeout e lease serão derivados em Terraform com a relação:

```text
visibility timeout >= 6 × Lambda timeout
lease duration > pior duração permitida da página + margem de checkpoint
```

## 9. Observabilidade para decidir, não apenas operar

Métricas obrigatórias:

- atraso Scheduler → recebimento;
- duração e contenção do enumerador;
- páginas por minuto e por shard generation;
- candidatos e retries por página;
- idade de lease e tempo de recovery;
- idade de outbox pendente;
- `IteratorAge` do stream exclusivo;
- idade, profundidade e in-flight das filas;
- `scheduledAt → claimedAt` e `claimedAt → TRIGGERED`;
- erros, throttles e DLQs.

Alarmes iniciais:

- qualquer mensagem em DLQ;
- erro ou throttle maior que zero;
- mensagem de scan com mais de 60s;
- `IteratorAge >30s` por dois períodos;
- lease/outbox sem recovery por mais de 120s;
- leases ativas sem página concluída durante um minuto.

O dashboard deve exibir a decomposição de latência. Uma melhora no total sem queda na etapa
correta não será aceita como confirmação da hipótese.

## 10. Estratégia de testes

### Testes locais

- codec de chaves/cursor e round-trip;
- todas as condições de acquire/checkpoint/complete/reclaim;
- concorrência real entre dois owners;
- outbox determinístico;
- mensagens stale por backend, epoch, owner, versão e cursor;
- falha em cada batch de candidatos;
- limite real de concorrência interna;
- minuto observado, atraso e virada de minuto;
- duas gerações de shards ativas.

### Testes de integração

- transações e GSI no DynamoDB;
- stream → relay → SQS;
- duplicate delivery e partial batch response;
- crash antes/depois de cada fronteira persistente;
- reconciliador fora do lookback;
- IAM impedindo acesso cruzado;
- DLQ/redrive sem ignorar epoch.

### Testes em AWS

| Degrau | Condição de avanço |
|---|---|
| canário | fluxo e recovery comprovados |
| 1k | zero perda/efeito duplicado/DLQ |
| 10k | duas passagens, máximo <=300s |
| 100k | pipeline aprovado e coorte de e-mail aprovada separadamente |
| 1M | SLO atendido ou limite externo documentado e decidido |

Testes longos serão acompanhados por avaliações agendadas próximas ao tempo esperado de conclusão,
sem polling contínuo. Cada avaliação define quando olhar novamente conforme o estado encontrado.

## 11. Rollback

Rollback nunca alterna o backend com mensagens antigas ainda válidas.

1. pausar novas aquisições;
2. incrementar epoch;
3. invalidar ou drenar mensagens do epoch anterior;
4. confirmar a saúde do backend escolhido;
5. selecionar o backend;
6. reativar com o novo epoch.

Não copiar cursor entre tabelas e não reduzir/reutilizar epoch. Recursos antigos permanecem
disponíveis por sete dias após o cutover para permitir retorno controlado.

## 12. Segurança e isolamento

- nenhum dado pessoal na tabela de controle;
- relay sem acesso à tabela principal;
- reconciliador sem escrita tenant-facing;
- `ScanPage` com leitura apenas de GSI3 e escrita limitada à tabela de controle;
- claim consumer continua sem permissão de leitura em GSI3;
- cursor completo não aparece em logs;
- DLQ e logs usam redação existente;
- assertions Terraform verificam recursos exatos de cada role.

## 13. Custos e capacidade

O custo novo vem de uma tabela on-demand pequena, writes de lease/outbox por página, invocações do
relay/reconciliador e mensagens da fila de controle. O volume do plano de controle cresce com
número de páginas, não diretamente com occurrences: 1M com página 200 produz aproximadamente
5.000 páginas/continuações, além de leases e retries.

Antes de 100k e 1M será registrado:

- quantidade real de reads/writes na tabela principal e na de controle;
- invocações e duração por Lambda;
- requests SQS;
- custo SES somente da coorte autorizada;
- projeção mensal para frequência produtiva esperada.

Não há compromisso de provisioned concurrency/pollers no desenho inicial. Esses mecanismos serão
considerados apenas se a rampa de polling aparecer como parcela relevante do SLO.

## 14. Riscos principais e controles

| Risco | Controle |
|---|---|
| duas cadeias válidas no cutover | sem dual-write, drain + epoch monotônico |
| checkpoint sem continuação | lease e outbox na mesma transação |
| duplicação após crash | claim idempotente e fences completos |
| recovery cria nova ordem incorreta | cursor persistido + versão/owner/epoch |
| excesso de concorrência | limites explícitos por fila e dentro da página |
| hot shard/skew | gerações versionadas e medição por shard |
| Scheduler atrasar até 59s | upper bound pelo instante observado |
| SES contaminar teste de capacidade | pipeline e coorte de e-mail medidos separadamente |
| custo inesperado em 1M | projeção e stop conditions antes da injeção |
| rollback reativar mensagem antiga | incremento obrigatório de epoch |

## 15. Sequência de PRs sugerida

1. domínio, store e testes de atomicidade;
2. Terraform da tabela/fila/roles/métricas, mappings desabilitados;
3. relay e reconciliador dedicados;
4. enumerador v2 e feature flags;
5. ScanPage v2 e publicação limitada em paralelo;
6. canário e observabilidade;
7. cutover de `dev`;
8. ajustes derivados dos testes, sem misturar variáveis;
9. remoção do backend antigo após estabilidade.

Cada PR deve explicar o comportamento antes/depois, listar invariantes tocados, passar os gates
do repositório e mostrar o plan Terraform quando houver infraestrutura. Nenhum PR deve combinar
cutover com remoção do rollback.

## 16. Critérios finais de aceite

O trabalho termina somente quando todos os itens abaixo forem verdadeiros:

- [ ] plano de controle dedicado implantado e saudável;
- [ ] stream global não publica continuações de scan;
- [ ] testes de falha e recovery aprovados;
- [ ] nenhum caminho perde página ou confirma cursor sem continuação;
- [ ] duas execuções 10k consecutivas com máximo <=300s;
- [ ] 100k aprovado no pipeline;
- [ ] e-mail validado com coorte controlada e evidência SES;
- [ ] 1M aprovado ou limitação externa submetida a decisão explícita;
- [ ] rollback e roll-forward exercitados em AWS;
- [ ] custo registrado;
- [ ] runbooks, diagramas e decisão atualizados;
- [ ] recursos antigos removidos somente depois da janela de estabilidade.

## 17. Pontos para avaliação do Marcelo

A decisão D-301 já aprovou a direção arquitetural. Para avaliar este plano de execução, os pontos
mais relevantes são:

1. **Isolamento:** tabela/stream/relay próprios são proporcionais ao problema observado?
2. **Escala:** 64 shards como primeiro ensaio de 1M oferece equilíbrio adequado entre margem e
   custo, mantendo o cálculo por medição?
3. **Migração:** drain sem dual-write e epoch monotônico dão o nível de segurança esperado?
4. **Evidência:** duas passagens de 10k, depois 100k e 1M, são gates suficientes?
5. **E-mail:** separar capacidade de 100k de uma coorte limitada de entrega real atende ao objetivo?
6. **Retenção:** sete dias para dados de controle e para manter o backend anterior são adequados?
7. **Operação:** os alarmes e o recovery por minuto cobrem a expectativa de suporte?

Qualquer mudança nesses sete pontos deve ser registrada antes da fatia correspondente. Ajustes de
page size, batch, paralelismo e alarm thresholds podem ser feitos por experimento, desde que não
alterem atomicidade, isolamento, recovery ou o protocolo de cutover aprovado.
