# Round 4 (Claude) — Revision

**Claude's own blind score for Round 3 (recorded now that Codex's Round 3 score, 8.7/10, exists):
8.5/10.** Ten of eleven groups converged; the daily-reindex-as-sweeper claim was the one real
remaining gap — I claimed a discovery guarantee the worker's actual access pattern (`GSI8SK < now`
candidates only) cannot provide. Fixing all three remaining points precisely.

## 1. Sweeper de reparo real — novo access pattern que enumera, não que descobre por vencimento

Corrigido: a extensão do worker `requirement-reindex` (GSI8, `queryDue`) NUNCA poderia ser o
sweeper autoritativo — seu próprio critério de descoberta (`GSI8SK < now`) é exatamente o dado
potencialmente obsoleto que o reparo precisa corrigir, um problema circular que a Rodada 3 não
tinha visto.

Substituo por um sweep distinto, `requirement-evidence-daily-sweep` (novo worker agendado,
diário, mesmo padrão de `EventBridge Scheduler` que `document_file_reconciliation_handler` já usa
— nenhum mecanismo de agendamento novo), cujo access pattern de descoberta é **`GSI1`, partição
`REQSTATUS#SATISFIED`** (`requirementGsi1Keys`, já existe, já serve listagem por status — reuso
de um índice existente, não um índice novo): pagina TODOS os `Requirement`s com
`status = "SATISFIED"` de um tenant (o único status para o qual `evidenceValidUntil`/evidência
importa — `MISSING`/`PENDING`/`NOT_SATISFIED`/`NOT_APPLICABLE` não têm campo de validade "correto"
para divergir), e para CADA UM releitura a `DocumentVersion` viva via
`evidenceDocumentId`/`evidenceSeq` e re-deriva.

Isto fecha, por enumeração completa (não por um filtro de data potencialmente obsoleto), os
quatro casos que o Codex listou: `validUntil` mudou para uma data anterior ao cache;
evidência ficou inelegível sem o ponteiro GSI8 saber; Requirement sem ponteiro GSI8 nunca
descoberto; `validUntil` foi de indefinido para definido. Todos os quatro têm em comum
`status = SATISFIED` no momento da falha (ou tinham antes de a mudança tornar isso incorreto) —
GSI1 por status é o índice certo porque não depende de nenhum valor cacheado de tempo, só do
status persistido, que já é reescrito toda vez que `linkEvidence`/`unlinkEvidence` roda.

**Caso residual reconhecido explicitamente**: um Requirement cujo status DEVERIA ter mudado de
`SATISFIED` para `NOT_SATISFIED` (porque a evidência ficou inelegível) mas cujo `status`
persistido ainda diz `SATISFIED` (porque o evento que deveria tê-lo atualizado se perdeu) — este
sweep AINDA o encontra, porque o sweep varre por `status` cacheado, e nesse caso o cache está
"felizmente" errado na direção que o inclui no scan (SATISFIED demais, não de menos). O caso
oposto — um Requirement que deveria estar `SATISFIED` mas ficou preso em `NOT_SATISFIED`/`PENDING`
por um evento perdido — não seria pego por este sweep (ele só varre `SATISFIED`). Fechamento desse
caso residual: o sweep TAMBÉM varre `GSI1PK = TENANT#t#REQSTATUS#PENDING` (evidência existe mas
não está `ACCEPTED` ainda — o outro estado onde uma `DocumentVersion` subjacente pode ter mudado
sem o Requirement saber) — dois status varridos, não um, ambos por enumeração completa via GSI1,
nenhum novo índice.

**Custo/cardinalidade**: bounded por tenant (paginação sobre um subconjunto já pequeno por
natureza — Requirements SATISFIED+PENDING de UM tenant, não um scan de tabela inteira) — mesmo
perfil de custo que qualquer outro worker diário já aprovado neste projeto.

## 2. Idempotência ponta-a-ponta do starter — preservada explicitamente

Corrigido: `putIfAbsent(ExtractionRun) === false` NUNCA é tratado como conclusão por si só —
`startExtractionRun` continua, no retry, chamando `StartExecution` com o MESMO nome determinístico
de execução Step Functions (derivado de `{tenantId, documentId, versionId, pipelineVersion}` —
`pipelineVersion` faz parte da identidade explicitamente, para que uma nova versão do pipeline
legitimamente gere um novo run mesmo para a mesma `DocumentVersion`) — exatamente o comportamento
que `start-extraction-run.ts` já tem hoje (chamar `startExecution` mesmo quando o Put falhou por
já existir), preservado sem mudança nesta migração. A migração troca só a IDENTIDADE
(`versionId` em vez de `itemId`+`documentId` antigo), nunca a disciplina de "sempre tentar
`StartExecution` de novo, nunca tratar Put-duplicado como sucesso terminal sem isso".

## 3. IAM completo do refresh worker — listado explicitamente

Corrigido, a frase "fila + leitura/escrita de Requirement" da Rodada 3 estava incompleta. IAM real
do `requirement-evidence-refresh-handler`:

- `sqs:ReceiveMessage`/`DeleteMessage`/`GetQueueAttributes` na fila
  `requirement-evidence-refresh-queue` (consumo, igual a todo worker SQS deste projeto).
- `dynamodb:GetItem` em `DocumentVersion` (releitura fresca, item 5 da Rodada 3).
- `dynamodb:Query` no índice reverso `GSI_EVIDENCE` (candidatos de Requirement por versão).
- `dynamodb:GetItem`/`UpdateItem` em `Requirement` (releitura + escrita OCC).
- Mesma política de least-privilege escopada só a essas ações/recursos, nunca uma policy geral de
  tabela (`AGENTS.md` §7).

O `requirement-evidence-daily-sweep` (item 1) precisa adicionalmente de `dynamodb:Query` em
`GSI1` (as duas partições `REQSTATUS#SATISFIED`/`REQSTATUS#PENDING` por tenant) — GSI1 não é
GSI3/GSI6, não aciona a exceção de isolamento de `AGENTS.md` §7.

## Nomenclatura mecânica corrigida (achado do Codex, não uma decisão)

`TransactConditionCheckEntry`, não `TransactConditionCheck` — nome do tipo real usado na
Rodada 3's item 2 (cerca de tenant), corrigido para a próxima fase de implementação usar o nome
certo desde o início.
