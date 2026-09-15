# ReminderProducer structural fix — Implementation Plan (D-300)

## Status

**APROVADO** via protocolo Claude↔Codex (`AGENTS.md` §4), 6 rodadas (mínimo do protocolo é 3;
convergência só ocorreu na 6ª — a mais longa até hoje neste projeto, refletindo a complexidade real
de transformar D-299's decisão arquitetural em um plano executável sem lacunas). Notas cegas
finais: **Claude 9,3/10, Codex 9,3/10** — ambos ≥9,0 sem arredondar.

Este documento consolida o plano final. As rodadas completas (`round-1` a `round-6`, prefixo
`-claude-proposal`/`-claude-revision`/`-codex-prompt`/`-codex-output`/`-claude-selfgrade`) ficam
neste mesmo diretório como registro de auditoria — cada rodada de crítica do Codex encontrou pelo
menos um bug de correção real (não apenas polimento), listados na trajetória abaixo. Este DECISION
é a única fonte que um implementador precisa ler para executar sem reabrir julgamento de design.

## Pesquisa externa (research-protocol.md, E-014)

**SIM PARCIAL** (declarado na Rodada 1, mantido). O macro-padrão (desacoplar scan de claim) já foi
pesquisado externamente em D-299. Nesta camada de implementação, o sub-item verdadeiramente novo —
dimensionamento de visibility timeout SQS relativo a timeout Lambda e sua interação com
`maxReceiveCount`/DLQ para um consumidor que segura uma lease de idempotência — foi tratado com um
checklist derivado do AWS Lambda Developer Guide ("Using Lambda with Amazon SQS") e da página
"Amazon SQS visibility timeout" (mesmas fontes já citadas em D-299, relidas com foco neste ângulo
específico). O gate operacional de rollback (Rodada 6) também consultou a AWS Lambda API Reference
(`UpdateEventSourceMapping`/`GetEventSourceMapping`, estado `Disabled` vs. `Disabling`) — pesquisa
feita pelo próprio Codex durante a rodada, citada inline no `round-6-codex-output.txt`.

## Plano final (por item da tarefa original)

### 1. Nomes exatos

- Fila de scan: `module.reminder_scan_queue`, `${local.name_prefix}-reminder-scan` (+ `-dlq`).
- Fila de claim: `module.reminder_claim_queue`, `${local.name_prefix}-reminder-claim` (+ `-dlq`).
- Scan: a MESMA Lambda/módulo `reminder_producer` de hoje (única detentora de `gsi3_read`),
  handler `reminder-producer-handler.ts`, agora dual-trigger (EventBridge Scheduler — enumeração +
  acquire/reclaim; SQS scan queue — checkpoint/continuação), controlado por env var `SCAN_MODE:
  "LEGACY" | "PAGED"` + `SCAN_MODE_EPOCH: integer`.
- Claim: NOVA Lambda `module.reminder_claim_consumer`,
  `${local.name_prefix}-reminder-claim-consumer`, handler
  `src/runtime/aws/handlers/reminder-claim-consumer-handler.ts`.
- Worker puro: `src/workers/reminder-scan/scan-page.ts` (uma página de `queryGsi3Page` → lease
  transition + candidatos) e claim helpers `claimReminderOccurrence`
  (nova, extraída, espelha a forma de `claimChasingOccurrence` já existente em
  `producer.ts:200-214`) + `claimChasingOccurrence` (reaproveitada, cancellation-reason corrigido).
- Lease table: reusa a tabela principal (sem tabela nova), `PK: SCAN#<shardFnVersion>#<shardId>#
  <minuteISO>`, `SK: LEASE`.
- Destinos outbox novos: `SQS_REMINDER_SCAN_CONTINUATION_V1` (outbox-atômico — cobre acquire,
  reclaim E checkpoint, não só checkpoint). Candidatos de claim (`SQS_REMINDER_CLAIM_CANDIDATE_V1`)
  NÃO passam pelo outbox — `SendMessageBatch` direto, chunks de ≤10, checkpoint só avança após
  todos os chunks da página serem aceitos (ver §5).

### 2. Máquina de estados de lease por página — schema e transições exatas

Item: `{ PK, SK: "LEASE", entityType: "ReminderScanLease", status: "IN_PROGRESS"|"COMPLETED",
ownerToken (uuid, constante durante toda a cadeia), leaseUntil (ISO string), lastEvaluatedKey
(objeto serializado canonicamente, campos em ordem fixa — não `JSON.stringify` cru — ausente na
página 1), pagesProcessed, candidatesPublished, version, purgeAfterTtl (epoch seconds, atributo TTL
real da tabela, `leaseUntil + 7d`), GSI6PK: "SCANLEASE#IN_PROGRESS" (presente só enquanto
IN_PROGRESS, removido em COMPLETED), GSI6SK: "<leaseUntil-ISO>#<shardFnVersion>#<shardId>#
<minuteISO>" }`.

Todas as transições usam `occ.ts` (nunca `UpdateItem`/`PutItem` cru), UMA `TransactWriteItems` por
transição contendo o write da lease + (exceto em COMPLETED) um `appendToTransaction` para
`SQS_REMINDER_SCAN_CONTINUATION_V1`:

| Transição | Builder | Condição | Outbox? |
|---|---|---|---|
| Acquire fresco | `buildConditionalPut`, `version:1`, `pagesProcessed:0` | `attribute_not_exists(PK)` | SIM (start, `lastEvaluatedKey` ausente) |
| Reclaim | `buildConditionalPut`, reinicia `version:1`/contadores, novo `ownerToken` | `status = :inProgress AND leaseUntil < :leaseNow` | SIM (start) |
| Checkpoint, mais páginas | `buildUnscopedVersionedUpdate` (novo builder-irmão de `occ.ts`, generaliza `scope` para opcional) | `ownerToken = :myToken AND leaseUntil >= :leaseNow AND` (`attribute_not_exists(lastEvaluatedKey)` **se** invocação é página 1, **ou** `lastEvaluatedKey = :myStartKey` se é continuação — dois branches de código distintos, nunca um OR) | SIM (continuação, `lastEvaluatedKey: nextKey`) |
| Checkpoint, última página | mesmo builder, `set: {status:"COMPLETED"}`, remove GSI6PK/GSI6SK | mesma condição acima | **NÃO** |
| Mensagem stale/duplicada | nenhum write | — | ack, no-op |

`buildUnscopedVersionedUpdate` (novo, em `occ.ts`): mesmo núcleo privado de
`buildScopedVersionedUpdate`, `scope` torna-se opcional (zero placeholders/condição quando
ausente) — testado para provar que a saída dos builders tenant/account-scoped existentes fica
byte-a-byte inalterada. `:leaseNow` (nunca `:now`, que colide com o placeholder reservado de
`updatedAt`) é `new Date().toISOString()` comparado lexicograficamente contra `leaseUntil`
(também ISO) — ordem cronológica preservada por construção.

### 3. Dimensionamento (timeouts/visibility/maxReceiveCount) com invariantes nomeadas

- Scan Lambda: 60-90s (200 candidatos/página, até 20 chunks de `SendMessageBatch`, ver §5) →
  visibility da fila de scan = **540s** (regra fixa do módulo, 6x). Claim Lambda: 10s (inalterado)
  → visibility da fila de claim = 60s (6x).
- Lease duration: **200s** — invariante: ≥2× timeout do scan Lambda (evita que o próprio retry de
  uma invocação ainda viva dispute a lease consigo mesma) E < visibility da fila de scan (evita que
  uma redelivery chegue enquanto a lease original ainda está viva).
- `maxReceiveCount = 5` (fixo pelo módulo, ambas as filas).
- Batch size: scan = 1 (mensagens causalmente encadeadas — concorrência aqui recriaria a corrida
  que a lease existe para eliminar); claim = 10 (mesmo valor explícito de `reminder-dispatch`,
  `infra/main.tf:955-960`).
- `reserved_concurrent_executions`/`maximum_concurrency`: scan = **10** (cadeias
  genuinamente concorrentes ficam limitadas a `gerações ativas × shards` ≤ 8 na prática, mesmo com
  até 16 minutos de lookback × gerações × shards sendo avaliados por tick); claim = **50**.
- Modelo de capacidade: pior caso é os 10.000 ocorrências landing em um ÚNICO (shard, minuto) — não
  uma divisão uniforme (não há prova de hashing uniforme). 50 páginas encadeadas, ~2s/hop
  (**assunção de engenharia explícita, não medida** — a ser revisada após a primeira carga real em
  produção) → ~125s estimados para drenar o pior caso, dentro da margem da janela de 5 minutos que
  PERF-12 trata como limite de falha.

### 4. Rastreamento/logging/métricas/erros/outbox/writes — concreto

- **Correlation ID**: o `correlationId` original do tick (gerado uma vez por
  `reminder-producer-handler.ts`, inalterado) propaga via `MessageAttribute "correlationId"` em
  TODAS as mensagens (candidatos E continuações), lido de volta via `correlationIdFromSqsRecord()`
  (mecanismo já existente, `context.ts`), envolvendo todo trabalho em `runWithContext`.
- **Logging**: `SecureLogger`, nunca `console.*`. Eventos: `"reminder-scan page complete"`,
  `"reminder-scan lease acquire failed"`, `"stale continuation no-op"`, `"reminder-claim occurrence
  claimed"`/`"lost race"`, `"stale epoch, dropped"` — todos com `shardId`/`tickMinute`/
  `pageNumber`/`occurrenceKey` no `baseContext`.
- **Métricas** (EMF via `emitMetric`, disciplina de cardinalidade de dimensão preservada — nunca
  tenantId/occurrenceId como dimensão): namespace `ExpirationTracker/ReminderProducer` (scan,
  reaproveitando o namespace existente) — `PagesScanned`, `CandidatesPublishedPerPage{entityType}`,
  `LeaseAcquireOutcome{outcome: acquired|reclaimed|contended}`, `CandidateSenderFault`,
  `ScanMessageValidationFailure`, `StaleEpochMessageDropped`, `PageDurationMs`. Namespace NOVO
  `ExpirationTracker/ReminderClaimConsumer` — `ClaimOutcome{outcome}`. Namespace
  `ExpirationTracker/ReminderReconciliation` (existente) ganha `ReconciliationScanLeaseReclaimed`.
  `ApproximateAgeOfOldestMessage` das DLQs continua nativo (sem métrica custom duplicada).
- **Alarmes novos**: `Sum(LeaseAcquireOutcome{reclaimed}) > 0`/5min E
  `Sum(ReconciliationScanLeaseReclaimed) > 0`/5min (detecção independente de cadeia travada — o
  segundo funciona mesmo após a janela de lookback, via a nova 3ª passada de reconciliação);
  `CandidateSenderFault > 0` (qualquer ocorrência, paging imediato).
- **Taxonomia de erro**: tabela completa de outcome por falha (queryGsi3Page transitório → retry;
  payload malformado → retry + alarme; lease contention → no-op; `SendMessageBatch` sender-fault →
  throw, sem checkpoint; `transactWrite` cancelado com `getCancellationReasonCodes()[0] ===
  "ConditionalCheckFailed"` no índice 0 (sempre o Update da ocorrência, constante nomeada
  `OCCURRENCE_UPDATE_TX_INDEX = 0`) → lost-race no-op; qualquer outro motivo → retry; discriminador
  GSI3 desconhecido → throw, preserva `shouldAlarm()` fail-closed existente). Nenhuma subclasse
  nova de `AppError` é necessária — toda contenção de lease é log/métrica, nunca exceção.
- **Outbox**: aplica-se ao boundary scan→continuação (novo, TODAS as transições de lease — acquire,
  reclaim, checkpoint) E ao boundary claim→dispatch (já existente, inalterado). NÃO se aplica a
  candidatos de claim (sem transação de agregado por trás). O evento de continuação carrega, dentro
  de `data`, um `SqsCommandEnvelope` COMPLETO (mesmo padrão de `DispatchCommand` em
  `producer.ts:246-284` — o relay não envelopa nada, só encaminha `event.data` cru), com
  `tenantId: "SYSTEM"` (sentinela formalizado em `events.ts`, documentado como nunca-consumível por
  lógica de autorização/particionamento por tenant) e `rolloutEpoch` obrigatório.
- **DynamoDB writes**: só builders de `occ.ts` (`buildConditionalPut`,
  `buildUnscopedVersionedUpdate`, `buildVersionedUpdate` inalterado no boundary de claim).

### 5. `SendMessageBatch` — limite real de 10, checkpoint nunca avança sobre candidato não publicado

Chunks de ≤10. Falha `SenderFault: true` em qualquer entrada → invocação inteira falha (throw) SEM
checkpoint — a página inteira é reprocessada do zero na próxima tentativa (reclaim), nunca
silenciosamente descartada. Falhas retryable → chunk inteiro reenviado (não só entradas falhas),
até 3 tentativas com backoff de `nextAttemptDelayMs` (reaproveitado de `outbox.ts`).

### 6. Plano de testes (inventário completo nos arquivos de rodada 3/4/6 deste diretório)

Unitário: acquire/reclaim/checkpoint (branches página-1 vs. continuação separados), lease expirada
não pode renovar mesmo com token/cursor/version corretos, serialização canônica de
`ExclusiveStartKey`, classificação `SenderFault` vs. retryable, `getCancellationReasonCodes` para
ambos `claimReminderOccurrence`/`claimChasingOccurrence`, saída de `buildUnscopedVersionedUpdate`
idêntica byte-a-byte aos builders existentes. Contrato: fixtures válidas/inválidas para os 3 schemas
novos em `test/contract/schemas.test.ts` (arquivo único consolidado, não um por schema).
Integração: sucessor-antes-do-checkpoint-do-predecessor (agora provavelmente impossível, testado);
morte após checkpoint/antes do relay (sweeper recovery); página final sem outbox; burst PERF-12 de
10k em um único shard; rollback com mensagens já enfileiradas; wiring do relay/sweeper para o novo
destino. DynamoDB Local: paginação real de `queryGsi3Page`, transação de checkpoint.
`infra/tests/stack.tftest.hcl`: NOVO `run` block provando que `reminder_claim_consumer` não tem
`gsi3_read` (a fronteira GSI3 preservada por construção, D-299), mais invariantes de concorrência/
batch/visibility das duas filas novas.

### 7. `reminder-reconciliation` — MUDANÇA CONFIRMADA (corrige a expectativa original de D-299)

D-299 previa "sem mudança". Este plano corrige essa expectativa, com razão registrada: a detecção
independente de lease travada (item explícito do escopo desta tarefa) não tem outra implementação
que funcione mesmo após a janela de lookback de 15 minutos do produtor sem OU criar um novo
Lambda+schedule (superfície desnecessária) OU reaproveitar o componente que já roda uma varredura
periódica apropriadamente escopada. `reminder-reconciliation.ts` ganha uma 3ª passada
(`SCANLEASE`, além de `CLAIMS`/`DST` existentes), na MESMA execução a cada 5 minutos, consultando
`GSI6PK = "SCANLEASE#IN_PROGRESS" AND GSI6SK < now` (mesma leitura de índice que a passada `CLAIMS`
já faz, sem grant de IAM novo — a role já tem `gsi6Read()`, embora o comentário do header do
handler ("exatamente dois papéis") esteja desatualizado — Terraform hoje autoriza 4 papéis; ação de
limpeza de comentário registrada como item separado, não parte deste design). Ganha também a env
var `SCAN_MODE_EPOCH` (nova, adicionada ao ambiente desta Lambda em `infra/main.tf`). A lógica de
`CLAIMS`/`DST` existente permanece byte-a-byte inalterada — comprovado por teste rodando a lógica
de claim extraída contra as fixtures que reconciliation já usa.

### 8. Migração/rollout

Big-bang no nível de código (D-299 rejeitou dois caminhos de claim permanentemente concorrentes),
mas staged no nível de infraestrutura via env var de deploy `SCAN_MODE`/`SCAN_MODE_EPOCH` (não um
flag permanente — removido junto com o código `LEGACY` numa 3ª mudança posterior):
- **Apply 1**: filas + claim consumer + event-source-mappings `enabled=true` (inertes — nada
  publica ainda), código novo de port/handler deployado mas `SCAN_MODE=LEGACY` mantém o
  comportamento de hoje.
- **Apply 2**: `SCAN_MODE=PAGED`.
- **Rollback**, sequência com gates explícitos: (1) `enabled=false` nas duas mappings; (2) **gate**:
  poll até ambas reportarem `State=="Disabled"` (não apenas apply bem-sucedido — estado transitório
  `Disabling` é distinto); (3) **gate**: espera de 90s (≥ maior timeout Lambda entre as duas
  filas) só começa após (2); (4) `SCAN_MODE=LEGACY`.
- **Roll-forward** (reversão do rollback): (1) `SCAN_MODE_EPOCH = N+1` deployado PRIMEIRO; (2)
  `SCAN_MODE=PAGED`; (3) reabilita as mappings. Qualquer mensagem residual de antes do rollback
  carrega epoch ≤ N, provavelmente inválida no momento em que um handler a lê sob o novo epoch —
  fechando o problema de "replay de trabalho antigo pode não ser semanticamente válido" por
  construção de ordem, não só por idempotência.
- **Ocorrências já `SCHEDULED` no cutover**: confirmado seguro — GSI3 é consultado do zero a cada
  cadeia, nenhum estado por ocorrência depende de qual mecanismo está rodando.

## Trajetória de convergência (notas cegas, sem arredondar)

| Rodada | Claude | Codex | Achado principal fechado nessa rodada |
|---|---|---|---|
| R1 | 7,8/10 | 4,3/10 | — (proposta inicial: ownerToken novo por invocação não conseguia adquirir a própria lease; `SendMessageBatch` com limite errado (25 em vez de 10); `queryGsi3` sem suporte a paginação real; `buildVersionedUpdate` exige `tenantId` que a lease não tem) |
| R2 | 8,4/10 | 6,2/10 | Ownership constante durante a cadeia; port `queryGsi3Page`; `buildUnscopedVersionedUpdate` proposto; mas checkpoint-antes-de-continuação ainda perdia trabalho numa janela real |
| R3 | 8,7/10 | 7,4/10 | Checkpoint tornado atômico via outbox+relay (reaproveitando `DispatchOutboxRelay` já existente) — fecha a janela de perda para transições página-a-página; mas acquire/reclaim inicial ainda não era atômico, e detecção de lease travada falhava após a janela de lookback |
| R4 | 9,0/10 | 8,4/10 | TODAS as transições de lease (acquire/reclaim/checkpoint) unificadas sob o mesmo outbox atômico; detecção de lease travada movida para uma 3ª passada de `reminder-reconciliation` (GSI6); faltava `leaseUntil >= now` na condição de checkpoint |
| R5 | 9,2/10 | 8,2/10 | `leaseUntil >= :now` adicionado (mas com colisão de placeholder `:now`); mecanismo de epoch/fence para mensagens residuais de rollback; ainda faltava fechar contradição real: o relay NÃO envelopa `event.data`, o evento de continuação precisava carregar o `SqsCommandEnvelope` completo, não só os campos internos |
| R6 | 9,3/10 | 9,3/10 | Placeholder `:leaseNow` (sem colisão); forma correta do wire (evento carrega o comando completo, mesmo padrão de `DispatchCommand` já usado); `rolloutEpoch` obrigatório nos dois schemas e em todo emissor (incluindo a nova passada de reconciliação); ordem explícita de gates no rollback/roll-forward — **CONVERGIDO** |

## Escopo desta decisão

Plano de implementação completo — nomes, schemas, dimensionamento, observabilidade, testes,
migração — pronto para execução direta sem decisão de design pendente. Nenhum código foi escrito
nesta fase (só planejamento, por instrução explícita da tarefa). A única mudança de escopo em
relação a D-299 é a extensão de `reminder-reconciliation` (§7 acima), registrada como emenda
formal com razão, não como contradição silenciosa.
