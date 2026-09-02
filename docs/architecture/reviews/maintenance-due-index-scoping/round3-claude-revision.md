# MaintenanceDueIndex — Rodada 3 (revisão Claude)

Resposta aos 8 achados bloqueantes de `round2-codex-critique.md` (nota 6,4/10). Diferente das rodadas
anteriores, 3 destes achados são **erros factuais concretos** cometidos pela Rodada 2 (não subespecificação) —
corrigidos por leitura direta do código real nesta rodada, não por promessa.

## Correção factual #1 — `requirement-reindex` VOLTA ao escopo do GSI8 (achado #2)

A Rodada 2 errou ao excluí-lo. `reindex.ts:46-47` (lido nesta rodada):

```
if (!requirement.evidenceValidUntil) continue; // never expires
if (new Date(requirement.evidenceValidUntil).getTime() >= nowMs) continue; // still valid
```

`evidenceValidUntil` **é** um `dueAt` natural — o worker já compara diretamente contra `now`. Volta para o
inventário de 9 workers migrados para GSI8 (era a contagem certa da Rodada 1; a exclusão da Rodada 2 foi o
erro, não a inclusão original). `GSI8SK = evidenceValidUntil`; pointer gravado por qualquer mutação que
resolve `evidenceState`/`evidenceValidUntil` do `Requirement` (`linkEvidence`/`unlinkEvidence`/
`updateRequirement`, `requirement.ts`) sempre que o resultado é `SATISFIED`; removido/recalculado nessas
mesmas mutações quando o status muda. O próprio `runRequirementReindex` (worker) remove implicitamente o
pointer ao transacionar `status: nextStatus` para `NOT_SATISFIED` — a escrita normal do agregado.

## Correção factual #2 — matriz da §4 reescrita com valores confirmados linha a linha

| Worker | Entidade(s) real(is) | `dueAt` real (confirmado) | Evidência |
|---|---|---|---|
| `membership-purge` | `Membership` | `removedAt + 30d` | `membership-purge/purge.ts` (fence já lido Rodada 1) |
| `invitation-purge` | `Invitation` | `revokedAt`(REVOKED) / `expiresAt`(PENDING) + retenção | `invitation-purge/purge.ts:73-86` |
| `document-file-reconciliation` | `DocumentFile` | deadline no `GSI5SK` | `reconciliation.ts:34` |
| `requirement-reindex` | `Requirement` | `evidenceValidUntil` (**corrigido — worker tem dueAt real**) | `reindex.ts:46-47` |
| `quota-telemetry-purge` | `TenantQuotaRecord` **e** `EphemeralTelemetryMutation` (**corrigido — matriz da R2 omitiu o segundo tipo, já presente no union de `candidate-source.ts:40`**) | `resetAt + 30d` (**corrigido — não `resetAt` puro**) | `quota-telemetry-purge/purge.ts:54` |
| `security-audit-purge` | `SecurityAuditRecord` (`AuditEvent`/`MembershipAuditEvent`) | `occurredAt` + retenção fixa (re-afirmado no delete, mesmo padrão de `quota-telemetry-purge`) | achado #9 da R1, confirmado |
| `transient-purge` | `WebhookInbox` **e** `UploadSlot` | `WebhookInbox`: `createdAt + 7d` (**corrigido — não `receivedAt`**); `UploadSlot`: `computeUploadSlotPurgeAfter(reservedAt, wasConfirmed)` (**corrigido — fórmula real, não "depende do estado" vago**) | `transient-purge/purge.ts:65-67,70-74` |
| `delivery-record-purge` | `NotificationIntent`/`NotificationAttempt` | `createdAt + 180d` (**corrigido — não `deliveredAt/failedAt`**) | `delivery-record-purge/purge.ts:66-67` |
| `core-user-data-purge` | `ExpirationItem`/`ReminderPolicy` (**corrigido — nomeado explicitamente, não "dados de usuário core" vago**) | `deletedAt + 30d` | `core-user-data-purge/purge.ts:5,32` |

9 workers migrados (não 8) — a contagem da Rodada 1 estava certa; a exclusão da Rodada 2 foi revertida acima.
Isso também resolve a inconsistência "8 workers vs. 9 políticas" que a própria Rodada 2 introduziu (achado #7
do Codex) — volta a ser 9 e 9, consistente.

## Correção factual #3 — plano de rollout sem `reset-dev-data` (achado #1)

Confirmado por leitura direta (`scripts/reset-dev-data.ts:348-385`): o script só **apaga** (Fase B,
`deleteAllItems`/`realBatchWriteDelete`), nunca recria. A alegação da Rodada 2 era falsa; removida
inteiramente. Plano real, sem inventar um mecanismo que não existe:

**Coexistência temporária com critério objetivo de encerramento** (não "sem shim" como a Rodada 1 preferia —
correto reconhecer aqui que o princípio geral de `AGENTS.md` §1 vale para campo/contrato duplicado, não para
uma janela de leitura em dois mecanismos por um deploy): cada candidate-source migrado consulta **primeiro**
GSI8 (`Query`); para cada worker, um script de backfill one-shot novo (`scripts/backfill-gsi8-<worker>.ts`,
um por worker, reaproveitando a MESMA função `isEligible*`/fence já exportada do `purge.ts`/`reindex.ts` real
daquele worker — nunca reimplementada) faz um `Scan` completo da tabela UMA vez, escreve o ponteiro GSI8 em
todo item elegível existente que ainda não o tem. Critério objetivo de encerramento: o backfill script termina
imprimindo a contagem de itens elegíveis sem ponteiro escrito (deve ser 0 ao final) — só quando essa contagem
é 0 nesse worker, o deploy seguinte remove o `Scan` de fallback do candidate-source correspondente. Cada
worker migra independentemente; nunca dois mecanismos "para sempre" — a janela de coexistência é o tempo entre
2 deploys do MESMO worker, não um estado permanente do sistema.

## Correção factual #4 — revalidação genuinamente atômica (achado #4)

Aceito sem ressalva: `Get` separado + cache não é atômico. Correção real de design: para os workers com fence
de `TenantLifecycleRecord` (`membership-purge`, `core-user-data-purge`, `delivery-record-purge`,
`invitation-purge`, `security-audit-purge`, `quota-telemetry-purge`, `transient-purge`), o delete/update do
candidato passa a ser um `TransactWriteItems` de 2 itens: `ConditionCheck` em `TenantLifecycleRecord` (
`status = ACTIVE`) **+** `Delete`/`Update` condicional do candidato (mesma condição de campo já usada,
ex. `deletedAt = :deletedAt`) — mesmo `TransactWriteItems` do agregado, mesma disciplina que `AGENTS.md` §7 já
exige para outbox/eventos críticos. Isso é mudança real de implementação (nível 3-4 por worker, cabe dentro da
decisão desta rodada — não é decisão nova, é fechar a lacuna que a invariante do design sempre exigiu).
Substitui o cache de lifecycle por tenant dentro do loop (que continua existindo só como otimização de
short-circuit ANTES de tentar a transação — nunca como a fonte real da condição).

## Correção factual #5 — custo de `KEYS_ONLY` sem alegar "zero adicional" (achado #5)

Removida a alegação de custo zero. Modelo honesto, por worker: hoje, o `Scan` avalia até `Limit × MAX_PAGES`
itens da tabela inteira por invocação (`100 × 25 = 2.500` itens avaliados, cobrados em RCU mesmo os
descartados pelo `FilterExpression` pós-leitura) para produzir 0 a `Limit` candidatos reais. Com GSI8
`KEYS_ONLY`: 1 `Query` ordenada e esparsa (só candidatos reais, RCU proporcional só a eles, tipicamente ordens
de magnitude menor que o `Scan` full-table) + 1 leitura adicional por candidato real (`GetItem` ou a
`TransactWriteItems`/`ConditionCheck` do achado #4 acima, que já precisa ler o estado atual de qualquer forma
para montar a condição) + a escrita do delete/update. Para workers cujo candidate-source hoje já retorna
atributos completos direto do `Scan` sem `Get` extra (achado real do Codex), essa leitura adicional por
candidato **é** custo novo, não absorvido — mas é custo proporcional ao número de candidatos reais processados
por invocação (tipicamente dezenas), não ao tamanho da tabela inteira (a base de RCU do `Scan` hoje). Não há
número exato sem medição real contra `dev` (fora de escopo de uma rodada de design) — a alegação passa a ser
"ordem de magnitude menor na maioria dos casos reais, com uma leitura extra por candidato genuinamente nova
para alguns workers", não "zero".

## Correção factual #6 — poison records/DLQ, especificação completa (achado #6)

- **Condição exata do update de falha**: `ConditionExpression` re-afirma `GSI8SK` observado no momento da
  `Query` (mesma disciplina OCC de todo o projeto) **e** `maintenanceAttemptCount` esperado — evita que 2
  invocações concorrentes apliquem backoff duplicado ao mesmo candidato.
- **Resultado ambíguo** (a chamada pode ter aplicado a mutação mas a resposta falhou por timeout/rede): a
  atualização de backoff é idempotente por construção — reaplicar o mesmo cálculo de backoff a partir do
  `maintenanceAttemptCount` já persistido (não de um contador local em memória) produz o mesmo resultado ou um
  avanço seguro, nunca duplica penalidade além do que o estado persistido já reflete.
- **Loop continua após falha individual**: já é o comportamento real hoje (todo `purge.ts` real lido usa
  `try/catch` por candidato dentro do `for`, sem `throw` que aborte o loop inteiro — a Rodada 1 presumiu
  incorretamente que havia abort total; correção: só a exceção não tratada por um bug real aborta, não o fluxo
  normal de falha de elegibilidade/condição).
- **Operação/redrive/permissão da quarentena**: `GSI8PK = "DLQ#<workerType>"` entra na MESMA política IAM do
  worker (não uma nova) — a condição `LeadingKeys` de cada worker passa a listar 2 valores, não 1:
  `["WORK#<type>", "DLQ#<type>"]` (`ForAllValues:StringEquals` já suporta lista). Redrive é uma operação
  manual futura (fora de escopo de implementação desta rodada de design): mover o item de volta ao namespace
  ativo com `maintenanceAttemptCount` resetado, mesma disciplina de redrive de DLQ SQS que o projeto já usa
  em outro lugar (`AGENTS.md` §7).
- **Métrica de quarentena não é nativa do CloudWatch** (aceito): corrigido para métrica customizada EMF
  (`@aws-lambda-powertools`-style ou `console.log` em formato EMF, sem nova dependência de runtime pesada) —
  cada worker emite `MaintenanceQuarantined{workerType}` no momento em que move um item para `DLQ#<type>`;
  alarme CloudWatch real sobre essa métrica customizada, não sobre uma métrica nativa que não existe.

## Correção factual #7 — IAM completo, contagem consistente (achado #7)

Contagem corrigida (9 workers, ver correção #2) resolve a inconsistência 8-vs-9. Lista completa de
ações/recursos por política de worker: `dynamodb:Query` no ARN do índice GSI8 (condicionado
`LeadingKeys IN ["WORK#<type>", "DLQ#<type>"]`), `dynamodb:GetItem`/`dynamodb:TransactWriteItems` na tabela
base (já concedido pela política geral tenant-scoped existente — nenhuma mudança aqui, os workers já fazem
isso hoje). **Sobre prova de negação cross-namespace**: aceito que um `terraform test` sozinho só prova a
FORMA da policy, não o comportamento real do IAM — a fatia de implementação de cada worker migrado ganha um
teste de integração real contra `dev` (`aws --profile claude-dev`, mesmo padrão que outras fatias desta sessão
já usam para prova ao vivo) tentando `Query` com `GSI8PK` de outro worker e confirmando `AccessDeniedException`
— gate de aceite explícito da fatia, não só do design.

## Correção factual #8 — gatilho de shard com métrica real (achado #8)

Substituído "métrica nativa por namespace" (não existe, aceito) por: cada worker emite métrica EMF customizada
`MaintenanceThrottled{workerType}` no `catch` de qualquer `ProvisionedThroughputExceededException`/retry do
SDK durante a `Query` GSI8 — mesmo mecanismo de EMF do achado #6 acima, reusado, não um segundo mecanismo.
Alarme CloudWatch sobre essa métrica customizada por worker. Dual-read explicitado: durante o período de
resharding de UM worker específico, o candidate-source desse worker consulta AMBOS `WORK#<type>` (residual,
itens que ainda não migraram de shard) e `WORK#<type>#<shard>` (novo), união dos resultados — mesmo padrão de
coexistência com critério de encerramento da correção #3 acima (mesmo mecanismo, reusado, não inventado de
novo). Critério de conclusão: contagem de itens em `WORK#<type>` (sem shard) chega a 0 — mesma disciplina do
backfill script.

## Autoavaliação Claude (nota cega, registrada antes de ver a crítica da Rodada 3 do Codex)

**8,9/10.** Os 3 erros factuais concretos da Rodada 2 (`requirement-reindex`, `reset-dev-data`, matriz) estão
corrigidos por leitura direta do código, não por retórica — cada correção cita a linha real que a desmente ou
confirma. Os 5 achados de subespecificação (IAM completo, custo honesto, DLQ operacional, revalidação
transacional real, gatilho de shard com métrica real) ganharam mecanismo concreto e verificável, reusando
primitivas que o projeto já tem (EMF, `TransactWriteItems`, `ForAllValues:StringEquals` com lista). Não é 9+
ainda porque: (a) o modelo de custo do achado #5 continua qualitativo ("ordem de magnitude menor"), não
quantitativo — só uma medição real contra `dev` fecha isso com números, e essa medição é trabalho de
implementação, não de design; (b) o backfill script novo (`scripts/backfill-gsi8-<worker>.ts`, 9 arquivos) é
um componente novo não verificado nesta rodada — só a intenção de reusar a função `isEligible*` de cada worker
foi verificada como existente e exportável, o script em si não foi escrito nem revisado; (c) o teste de IAM
real contra `dev` (correção #7) foi prometido como gate de fatia de implementação, mas nenhuma fatia rodou
ainda — é um compromisso de processo, não uma prova.
