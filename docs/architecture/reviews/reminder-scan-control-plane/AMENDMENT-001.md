---
status: APPROVED_BY_OWNER
decision: D-302
amends: D-301
date: 2026-09-17
owner: Marcelo
risk: 6
---

# D-302 — Índice autoritativo de trabalho devido e hardening da D-301

## 1. Motivo

A revisão independente da D-301 encontrou duas lacunas de correção no uso do GSI3:

1. o bucket é por minuto, mas `scheduledAt` tem precisão de segundos; consultar o minuto corrente
   pode publicar uma occurrence futura e o claim atual não verifica `scheduledAt <= now`;
2. GSI é eventualmente consistente; marcar uma cadeia `COMPLETED` após uma leitura vazia pode
   perder uma occurrence ainda não visível no índice.

Uma janela de estabilização reduziria a probabilidade, mas não provaria ausência de perda. D-302
remove o GSI3 do caminho autoritativo de descoberta em vez de transformar consistência eventual
em premissa oculta.

## 2. Decisão

Adicionar uma segunda tabela dedicada, sem stream:

`exptrk-${environment}-reminder-due-work`

Ela é o índice autoritativo de trabalho agendado. Toda criação, reagendamento ou cancelamento de
`ReminderOccurrence` e `DocumentChasingOccurrence` atualiza a occurrence e seu `DueWorkItem` na
mesma `TransactWriteItems`, mesmo quando os itens pertencem a tabelas diferentes.

O ScanPage consulta essa tabela por partição minuto+geração+shard, com `ConsistentRead=true` e
condição de sort key `scheduledAt <= observedNow`. GSI3 permanece temporariamente para
compatibilidade, auditoria e rollback, mas deixa de ser fonte de completude do backend dedicado.

Essa decisão preserva a tabela de controle da D-301 exclusivamente para lease/outbox. A tabela de
due work não possui stream, portanto suas escritas não competem com continuações no
`ScanControlRelay`.

## 3. Autoridade Type 1

Marcelo apresentou a revisão e determinou “prossiga” após a avaliação que classificou os itens 2
e 3 como bloqueantes arquiteturais. Isso constitui escolha direta do responsável final para
incorporar as correções. O protocolo multiagente continua dispensado pela mesma regra e condições
registradas na D-301: decisão direta do owner, dispensa explícita e alternativas abaixo.

## 4. Modelo `DueWorkItem`

```text
PK = DUE#v{shardFnVersion}#s{shardId}#m{minuteISO}
SK = AT#{scheduledAt}#K#{entityKind}#T#{tenantId}#I#{occurrenceId}
```

| Campo | Regra |
|---|---|
| `entityType` | `REMINDER_DUE_WORK` |
| `entityKind` | `REMINDER` ou `CHASING` |
| `tenantId` | tenant autorizado da occurrence |
| `occurrencePK`, `occurrenceSK` | chave da linha autoritativa na tabela principal |
| `occurrenceId` | ID determinístico existente |
| `scheduledAt` | ISO UTC original, também presente no `SK` |
| `shardFnVersion`, `shardId` | geração usada na materialização |
| `createdAt`, `updatedAt` | ISO UTC |
| `purgeAfterTtl` | retenção alinhada à occurrence ou sete dias após consumo, o que for maior |

A ordenação ISO UTC canônica permite:

```text
PK = bucket da cadeia
SK <= AT#{observedNow}#\uFFFF
```

O sentinela alto inclui todas as entidades exatamente no instante observado. Logo uma passagem no
minuto corrente nunca retorna trabalho futuro. A Query é feita na tabela base e admite consistência
forte.

## 5. Protocolo de escrita

### 5.1 Materialização

Substituir `putIfAbsent(occurrence)` nos dois materializers por transação:

1. `Put` condicional da occurrence na tabela principal;
2. `Put` condicional do `DueWorkItem` na tabela de due work.

Ambos usam identidade determinística. Retry que encontra os dois itens existentes retorna
`skippedExisting`. Estado unilateral é erro de integridade e vai para reconciliação; nunca é
tratado como sucesso silencioso.

### 5.2 Cancelamento e reagendamento

Toda transição que remove `GSI3PK/GSI3SK` por cancelamento também remove o `DueWorkItem` na mesma
transação. Reagendamento cancela/remove o item antigo e materializa occurrence+due work novos com
identidade nova.

### 5.3 Claim

O claim consumer faz leitura consistente da occurrence e exige:

- status `SCHEDULED`;
- `scheduledAt <= now`;
- identidade correspondente ao comando.

A transação `SCHEDULED → CLAIMED` também remove o `DueWorkItem` e grava o outbox de dispatch. Se
uma duplicata chega depois, o estado da occurrence torna a operação no-op. A remoção do due work
não é usada como prova isolada de claim.

### 5.4 Recovery

O reconciliador compara amostras/partições vencidas do due-work ledger com a tabela principal:

- due work sem occurrence válida: remove como órfão após condição;
- occurrence `SCHEDULED` sem due work: recria o item deterministicamente;
- due work vencido ainda `SCHEDULED`: republica candidato com fence;
- occurrence já CLAIMED/TRIGGERED/CANCELLED: remove due work residual.

Esse caminho fecha estados unilaterais causados por dados legados, falha de migração ou defeito de
writer, embora a escrita normal seja atômica.

## 6. Scan e paginação

- Enumerator e ScanPage serão Lambdas separadas;
- Enumerator usa `BatchGetItem` na tabela de controle e trata todos os `UnprocessedKeys` com
  backoff+jitter; chave não respondida nunca equivale a lease ausente;
- ScanPage consulta DueWorkTable, não GSI3, com `ConsistentRead=true`;
- Query usa limite de 200 e pagina exclusivamente por `LastEvaluatedKey`;
- linha desconhecida ou inválida lança erro tipado, incrementa `UnknownDueWorkEntity` e impede
  checkpoint;
- cinco chunks concorrentes são permitidos; falha de qualquer um impede checkpoint;
- reclaim sempre incrementa `version` e preserva cursor;
- lease, timeout e visibility timeout são validados por relações configuracionais, não apenas
  comentários.

## 7. Migração

Não haverá cutover direto de GSI3 para due work.

1. criar DueWorkTable sem stream e IAM mínimo;
2. implantar dual-write apenas nos writers de occurrence, mantendo leitura GSI3;
3. executar backfill idempotente de occurrences `SCHEDULED` das gerações ativas;
4. repetir backfill até uma passagem produzir zero criação;
5. reconciliar contagens e amostras por minuto/shard e validar base items;
6. habilitar backend dedicado em canário usando DueWorkTable;
7. drenar leases antigas, incrementar epoch e fazer cutover conforme D-301;
8. manter GSI3 e writers compatíveis durante a janela de rollback;
9. remover dual-write/GSI3 deste domínio somente em decisão posterior e após estabilidade.

O dual-write permitido aqui é occurrence→índice durante migração. Continua proibido executar duas
máquinas de leases/outboxes como backends ativos simultaneamente.

## 8. Gates incorporados da revisão

- parser desconhecido atual de `scan-page.ts` deve deixar de executar `continue` e falhar fechado;
- nenhuma occurrence pode ser claimed antes de `scheduledAt`;
- integração prova que visibilidade do GSI3 é irrelevante ao backend dedicado;
- `BatchGetItem.UnprocessedKeys` tem retry e falha segura;
- `acquire → checkpoint → crash → expiry → reclaim` mantém versão monotônica e invalida mensagens
  anteriores;
- quatro chunks aceitos + quinto falho não checkpointam; retry duplica candidatos sem efeito;
- `items.length < Limit` nunca determina fim; somente ausência de `LastEvaluatedKey`;
- testes de config provam headroom da conta e as relações de timeout/lease/visibility;
- rollout prova exclusão mútua de backends e monotonicidade de epoch.

## 9. Observabilidade adicional

- `UnknownDueWorkEntity` e, enquanto GSI3 existir, `UnknownGsi3Entity`;
- `BatchGetUnprocessedKeys` e `BatchGetRetryExhausted`;
- `DueWorkMissing`, `DueWorkOrphan`, `DueWorkRepaired`;
- `EarlyClaimRejected`;
- `ScanChainCompletionAge`, `CheckpointRace`, `LeaseReclaim`, `ExpiredLeaseAge`;
- duração p50/p95/p99 de página e falhas/retries de chunks;
- gerações/shards ativos, concorrência ScanPage/Claim e idade das filas.

## 10. Alternativas rejeitadas

### A. Apenas filtro `scheduledAt <= now`

Evita claim antecipado, mas uma cadeia concluída não volta para buscar linhas futuras do minuto.

### B. Janela fixa de estabilização do GSI3

Reduz risco, mas DynamoDB não oferece limite formal de convergência do GSI. Não prova completude.

### C. Reabrir buckets por tempo indefinido

Eventualmente encontra a linha, mas custo cresce com `minutos × shards` e não define conclusão.

### D. Usar o stream da tabela principal como fonte autoritativa

Reintroduz dependência do stream global que causou o head-of-line blocking do PERF-12.

### E. Gravar due work na própria tabela de controle

Foi rejeitado porque o stream da tabela de controle receberia todos os registros de negócio e
poderia voltar a atrasar outboxes de continuação. A separação física das duas tabelas preserva o
isolamento buscado pela D-301.

## 11. Efeito sobre D-301

D-302 substitui na D-301:

- Query GSI3 por Query consistente na DueWorkTable;
- afirmação de que a tabela dedicada contém somente leases/outboxes como topologia completa;
- conclusão do minuto baseada em visibilidade eventual;
- IAM de ScanPage, que passa a ler DueWorkTable e a tabela principal por chave;
- plano de migração, que ganha dual-write temporário e backfill do índice autoritativo.

Todo o restante permanece: ControlTable/stream/relay dedicados, outbox transacional de
continuação, SQS Standard, sharding versionado, chunks limitados, recovery, epoch e gates de carga.
