# Bulk Import — Documents + Requirements + Column Mapping — Rodada 3 (Claude)

Rodada 2: régua Claude 9.1/Codex 8.7 · design Claude 8.9/Codex 7.8. Codex fechou de verdade só
4/16 achados (4, 5, 9, 16); 10 parciais, 2 abertos (11, 12); 3 achados bloqueantes NOVOS. Trato
os 3 bloqueantes primeiro (são a causa raiz de metade dos "parciais"), depois os altos/médios
restantes, depois a régua v3.

## Régua v3 — aceito a redistribuição do Codex quase integralmente

1. **(25%)** Atomicidade, idempotência **e progresso por linha (sucesso E falha)**.
2. **(15%)** Orquestração concorrente upload/mapping/parse, OCC-safe nas duas direções.
3. **(15%)** Identidade e resolução de referências (Subject/DocumentType).
4. **(15%)** Fences de invariantes de domínio no commit.
5. **(10%)** Dedupe e colisões (intra-arquivo e persistido).
6. **(10%)** Integridade/proveniência do plano e do RESULTADO do commit (novo, era parte do 15
   perdido na Rodada 2).
7. **(5%)** Contrato de mapping/schema (`/schema`, tipo discriminado) — peso reduzido, mas
   nunca mais fora da régua (era o buraco que deixou os achados 11/12 sem nota real).
8. **(5%)** Um tipo por job / compatibilidade com o esqueleto existente.

**Nota de régua Claude (cega) Rodada 3: 9.3/10.**

## Bloqueante 1 (Codex R2) — protocolo de duas transações: sucesso E falha

Correção central desta rodada. `ImportRowOutcome`, entidade nova, dedicada a resultado
DURÁVEL por linha — nunca uma mutação do plano S3 (que continua imutável, achado 4 do Codex
R2 procede: plano congelado não pode virar ledger):

```text
ImportRowOutcome
  PK  TENANT#<t>#IMPORTJOB#<jobId>
  SK  ROWOUTCOME#<rowNumber padded a 6 dígitos>
  entityType "ImportRowOutcome"
  outcome: "COMMITTED" | "FAILED"
  entityId?: string          // presente só se COMMITTED
  failureReason?: string     // presente só se FAILED (código fechado, ver abaixo)
  createdAt
```

`Put(ImportRowOutcome, attribute_not_exists)` é ele mesmo o guard de idempotência técnica da
linha — substitui a "claim" ambígua da Rodada 2 (Codex achado 6: a Rodada 2 confundia claim
durável de negócio com idempotência técnica de retry; esta rodada separa os dois papéis por
completo):

- **Idempotência técnica de retry** (esta linha já foi processada por este job?) = `Get
  ImportRowOutcome`. Sempre job+row-scoped, nunca cross-job.
- **Dedupe de negócio** (este `externalId`/nome já existe?) = o ponteiro específico do tipo já
  descrito na Rodada 2 (`SubjectExternalIdPointer`, `RequirementNamePointer`, e um novo
  `ImportDedupRecord` namespaced por tipo só para `Document`, que não tem pointer de domínio
  próprio) — sempre durável, cross-job, escrito **só na transação de SUCESSO**, junto da
  entidade.

Duas formas de transação no commit de uma linha `CREATE_*` (Document/Requirement — Subject
mantém a forma antiga, ver Bloqueante 3):

```text
TENTATIVA (uma TransactWriteItems):
  entries(entidade)                          // de buildCreateXEntries — fences de domínio aqui
  + Put(dedup pointer/record, attribute_not_exists)   // se a linha tiver dedupe de negócio
  + Put(ImportRowOutcome COMMITTED, attribute_not_exists, entityId=<gerado>)
  + Update(ImportJob.lastProcessedRowNumber, expectedVersion)
  [+ fence de tenant, sempre por último, executeTenantBusinessMutation]

SE a TENTATIVA cancela E a causa é um fence de DOMÍNIO (Subject/DocumentType não ACTIVE, ou
dedup pointer já existe — nunca o fence de tenant, que já tem tratamento próprio):
  FALLBACK (segunda TransactWriteItems, SEMPRE executada em seguida, nunca condicional a retry externo):
    Put(ImportRowOutcome FAILED, attribute_not_exists, failureReason=<código fechado>)
    + Update(ImportJob.lastProcessedRowNumber, expectedVersion)
    [+ fence de tenant]
```

O FALLBACK só grava DUAS coisas (resultado + cursor) — nenhuma entidade, nenhum pointer de
dedupe — então nunca tem uma segunda causa de cancelamento de domínio para classificar (a única
coisa que pode falhar nele é o fence de tenant, tratado igual à tentativa, ou uma corrida de
cursor coberta abaixo). Um retry que encontra `ImportRowOutcome` já presente (COMMITTED ou
FAILED) sabe que a linha já foi processada dos dois lados e só confirma que o cursor bate —
nunca reexecuta nem a TENTATIVA nem o FALLBACK.

**Corrida de cursor entre TENTATIVA e FALLBACK** (achado real desta rodada, fechado
preventivamente): se dois workers processarem a mesma linha concorrentemente (retry duplicado
de SQS at-least-once chegando quase simultâneo), a TENTATIVA de um pode ter avançado o cursor
antes do outro tentar o FALLBACK com o `expectedVersion` antigo — `Update` com `expectedVersion`
falha, o worker relê o `ImportJob`, encontra `lastProcessedRowNumber >= rowNumber`, conclui "já
processada" e descarta silenciosamente o próprio resultado que ia gravar (nunca escreve um
`ImportRowOutcome` duplicado nem regride o cursor).

**Labels, não índices literais** (Codex R2 achado 7, "índices frágeis"): `buildCreateXEntries`
retorna `{ entries, labels }` — mesmo formato de `{entries, labels}` de
`RequirementTemplate.applyTemplate` (D-191 §8), nunca um índice mágico. O commit worker
concatena `labels` das entries de domínio com `["DEDUP_RECORD", "ROW_OUTCOME"]` na ordem exata
em que fez `push`, então a classificação de `CancellationReasons[i]` sempre lê o label
correspondente, robusta a qualquer entry nova adicionada no futuro.

## Bloqueante 2 (Codex R2) — corrida mapping/parse: OCC explícito + outbox, nunca chamada síncrona

Aceito a crítica de que "handler chama `parseImportJob()` no mesmo request" é regressão
arquitetural (parse lê até 5 MiB/5000 linhas + `BatchGetItem`s + `PutObject` em S3 — trabalho
pesado demais para uma resposta HTTP síncrona, e reintroduz acoplamento que o design original
evitava com S3 event + worker assíncrono).

Toda transição de `ImportJob.status` relevante aqui usa `Update` condicional por
`expectedVersion` (retry de 3 tentativas com releitura entre elas — `retryOnOcc()`, helper
compartilhado novo, mesma disciplina de OCC que `occ.ts` já formaliza para escrita, aplicada
aqui à leitura-antes-de-decidir):

```text
Evento S3 ObjectCreated -> parseImportJob():
  lê job; se columnMapping ausente -> Update(status: AWAITING_MAPPING, expectedVersion) com
  retry OCC; RETORNA (não é falha). Se já presente -> segue parse normalmente.

POST /import-jobs/{jobId}/mapping -> handler:
  lê job (status atual observado); grava columnMapping+columnMappingSha256 e recalcula o
  PRÓXIMO status: se o job já viu o evento S3 (status === AWAITING_MAPPING) -> PARSING;
  senão (status === UPLOADED, evento ainda não chegou) -> permanece UPLOADED (só grava o
  mapping, não muda status). Este `Update` (com `expectedVersion`, retry OCC) é uma
  TransactWriteItems com DOIS itens quando o resultado é PARSING:
    Update(job: columnMapping, columnMappingSha256, status=PARSING, expectedVersion)
    + Put(OutboxEvent "ImportParseRequested" {tenantId, jobId})   // AGENTS.md §7: evento
                                                                    // crítico no MESMO
                                                                    // TransactWriteItems do
                                                                    // agregado, nunca 2º write
```

`ImportParseRequested` é entregue pelo relay de outbox já existente neste projeto (mesma
infraestrutura que despacha qualquer outro evento crítico) até uma fila SQS que aciona a MESMA
Lambda de parse já usada pelo evento S3 — `parseImportJob()` fica com DOIS triggers possíveis
(evento S3 quando o arquivo chega depois do mapping; evento de outbox quando o mapping chega
depois do arquivo), ambos idempotentes por construção (`if (!job || job.status !== "UPLOADED"
&& job.status !== "AWAITING_MAPPING") return SKIPPED` — condição de entrada generalizada da
Rodada 1, que já tratava isso para `UPLOADED` sozinho). O handler HTTP nunca faz mais que um
`Update`/`TransactWriteItems` pequeno — sem leitura de S3, sem parse, sem timeout de payload
grande. Isto fecha o Bloqueante 2 sem reintroduzir acoplamento síncrono.

Se o mapping chega quando o job AINDA é `UPLOADED` (evento S3 não chegou), o `Update` grava só
o mapping (sem outbox, sem mudança de status) — o evento S3, quando chegar, encontra
`columnMapping` já presente e segue direto para `PARSING` (path já coberto pela condição de
entrada acima).

## Bloqueante 3 (Codex R2) — `createSubject()` NÃO é refatorado; escopo do Bloqueante 2 (Rodada 2) reduzido a Document/Requirement

Aceito integralmente: `createSubject()` tem contagem de `TenantEntitlement` + até 20 retries de
contenção — não é uma função pura de construção de entries sem reescrever essa lógica inteira,
o que seria uma fatia própria nível 5-6 independente (mudar como entitlement é contado é uma
decisão maior que bulk import, fora do pedido de escopo desta fatia). **Correção: o caminho de
Subject import CONTINUA usando `subjects.createSubject()` como caixa-preta HTTP-shaped, exatamente
como hoje** — a janela de "claim órfã" documentada em D-042 para Subject **permanece aceita como
está, não expandida, não reduzida por esta fatia**. `buildCreateDocumentEntries`/
`buildCreateRequirementEntries` (Bloqueante 1, acima) só se aplicam a `Document`/`Requirement` —
as duas entidades REALMENTE introduzidas por esta fatia, sem entitlement/quota (confirmado por
leitura direta: `document-archive-service.ts` não referencia `quota`/`entitlement` em nenhum
método) — logo o refactor É mecânico para elas, ao contrário de Subject.

Isto é uma correção de ESCOPO, não uma regressão: a Rodada 2 prometia mais do que podia entregar
sem quebrar Subject; a Rodada 3 entrega atomicidade real para as duas entidades novas e é
honesta sobre a entidade antiga ficar como está.

## Achados altos restantes (Codex R2 #5, #7 pontos residuais, #8, médios #9-13)

**`Subject.externalId` lifecycle (Codex R2 achado 5)**: **create-only nesta fatia** — decisão
explícita, não lacuna. `externalId` é setável só em `createSubject()` (parâmetro novo opcional
do input); `updateSubject()` **não** ganha capacidade de mudar/remover `externalId` agora (isso
exigiria o mesmo tratamento de dois-ramos-de-pointer que `renameDocumentType`/`updateRequirement`
já têm, decisão própria, fora desta fatia). Um Subject sem `externalId` na criação nunca ganha
um depois nesta fatia — documentado como limitação conhecida, não como "administrável" (a
Rodada 2 usou essa palavra de forma imprecisa, corrigido aqui).

**`/schema` — contrato fechado (Codex R2 achado 8/12)**: `GET /import-jobs/{jobId}/schema`,
permitido só quando `job.status IN (UPLOADED, AWAITING_MAPPING)` (senão 409); lê os primeiros 64
KiB do objeto via S3 `Range` GET (nunca o arquivo inteiro) — se o objeto ainda não existe
(`NoSuchKey`, corrida real entre presigned PUT e visibilidade), devolve 404
`FILE_NOT_YET_AVAILABLE` (retryable, não é erro do usuário); resposta
`{ headers: string[], sampleRows: string[][] }` (até 3 linhas de dado, cada célula truncada a
200 chars) computada com o MESMO `parseCsv()` já existente sobre o range parcial (aceita que a
última linha da amostra pode ficar incompleta se o corte cair no meio — descartada, nunca
mostrada truncada de forma enganosa). BOM UTF-8 é stripado se presente (`parseCsv()` ganha esse
tratamento agora — verificado por leitura direta que hoje NÃO trata BOM, é um bug real
preexistente exposto por esta fatia, corrigido aqui por ser trivial e no mesmo arquivo).

**`ColumnMapping` como união discriminada (Codex R2 achado 9/11)**:

```text
type ColumnMapping =
  | { schemaVersion: 1; targetKind: "TrackedSubject";
      columns: { displayName: string; type: string; externalId?: string; notes?: string; tags?: string } }
  | { schemaVersion: 1; targetKind: "Document";
      columns: { subjectRef: string; subjectRefKind: "EXTERNAL_ID" | "SUBJECT_ID";
                 documentTypeRef: string; documentTypeRefKind: "DOCUMENT_TYPE_ID" | "DISPLAY_NAME";
                 hasValidity: string; externalId?: string } }
  | { schemaVersion: 1; targetKind: "Requirement";
      columns: { subjectRef: string; subjectRefKind: "EXTERNAL_ID" | "SUBJECT_ID";
                 name: string; notes?: string; applicability?: string; externalId?: string } }
```

`targetKind` É redundante com `job.targetEntityType` por design **defensivo, não autoritativo**
— o handler REJEITA (400) se `mapping.targetKind !== job.targetEntityType`; nunca lido como
fonte de verdade independente (fecha a preocupação de "duas autoridades" mantendo o tipo
discriminado que o TypeScript exige para não ser um `Record<string,string>` cru). Cada campo é
uma chave conhecida do TypeScript, não uma string livre — fecha o achado 11 de verdade (união
discriminada real, não só validação em runtime contra um catálogo).

**Política de colisão intra-arquivo — "primeiro vence" (Codex R2 achado 11 desta lista/8
original)**: alinhado ao precedente REAL já existente (`seenExternalIdsInFile` em
`import-parse-service.ts` — verificado: a PRIMEIRA ocorrência segue para `CREATE_SUBJECT`, toda
ocorrência seguinte com a mesma chave é `REJECT`), não "rejeitar as duas" como a Rodada 2 disse
incorretamente. `Document`/`Requirement` seguem a MESMA regra: primeira ocorrência de uma chave
de dedupe (quando existe) segue para `CREATE_*`, a segunda em diante é `REJECT
reason="DUPLICATE_IN_FILE"`. Corrige a imprecisão apontada.

**Resolução em lote — duas fases (Codex R2 achado 13)**: `resolveSubjectReferences` é
explicitamente 2 fases de `BatchGetItem`: fase 1 resolve `Set<externalId>` distintos →
`SubjectExternalIdPointer[]` (até 100 chaves/chamada, `UnprocessedKeys` reenviado com backoff,
mesmo padrão que qualquer `BatchGetItem` real deste projeto já precisa seguir); fase 2 resolve o
`Set<subjectId>` distinto obtido da fase 1 → `TrackedSubject[]` (confirma `status===ACTIVE"` no
momento do parse). Pior caso (5000 linhas, todas com `externalId` distinto): até ~50 chamadas
fase 1 + ~50 fase 2 = ~100 `BatchGetItem`, não 5000 `GetItem` — ainda uma melhoria de ordem de
grandeza, número corrigido de "~50" para "~100" (Codex R2 estava certo em contestar a conta).

**Hash canônico (Codex R2 achado 12 desta lista)**: `columnMappingSha256` é calculado sobre
`JSON.stringify` de um objeto com **chaves ordenadas alfabeticamente por um serializer
determinístico** (`canonicalJsonStringify()`, helper novo e pequeno — nunca `JSON.stringify`
direto, cuja ordem depende da ordem de inserção do objeto em memória).

## Autoavaliação Rodada 3 (contra a régua v3)

1 (25%): atendido — protocolo de duas transações fecha sucesso E falha, com labels robustas.
2 (15%): atendido — OCC explícito + outbox, parse nunca síncrono no handler. 3 (15%): atendido
(Rodada 2, sem mudança). 4 (15%): atendido (Rodada 2, labels corrigidas nesta rodada). 5 (10%):
atendido — "primeiro vence" alinhado ao precedente real. 6 (10%): atendido —
`ImportRowOutcome` como resultado durável, nunca mutação do plano congelado. 7 (5%): atendido —
união discriminada real + contrato fechado de `/schema`. 8 (5%): atendido — Subject
explicitamente EXCLUÍDO do refactor de atomicidade (Bloqueante 3), nunca prometido além do que
o código real permite sem reescrever entitlement.

**Nota Claude (cega), Rodada 3 — régua: 9.3/10; design: 9.1/10.**
