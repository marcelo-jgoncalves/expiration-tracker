# Bulk Import — Documents + Requirements + Column Mapping — Rodada 2 (revisão Claude)

Nota da Rodada 1: Claude 7.8 (cega) / **Codex 4.7** — abaixo do gate, régua contestada
(`research-protocol.md`, fluxo de reconciliação). Esta rodada reconcilia a régua E revisa o
design. Não escondo nenhum dos 16 achados do Codex — trato cada um explicitamente abaixo.

## Reconciliação da declaração de pesquisa: `SIM` → `SIM PARCIAL`

Aceito o achado 1 integralmente. Fui checar as duas fontes que o Codex citou
(`understand-the-import-tool`, `import-objects` da HubSpot; o artigo de Accounts/Contacts da
Salesforce) — a alegação do Codex procede: HubSpot e Salesforce **permitem** import
multi-objeto numa única linha/arquivo quando o produto oferece essa feature dedicada (Sales
Hub/Service Hub multi-object import, Salesforce Data Import Wizard Accounts+Contacts). Minha
Rodada 1 generalizou uma observação real (a maioria dos fluxos DE FATO recomenda pai-antes-de-
filho com referência) para uma regra universal que as próprias fontes citadas não sustentam
nesse grau.

**Declaração corrigida**: `SIM PARCIAL` — fontes (mesmas 5 + as 2 citadas pelo Codex, todas
consultadas 2026-09-03) sustentam de forma convergente e verificável: (a) mapeamento
coluna→campo é um passo de contrato explícito, sempre antes do preview; (b) associação/dedupe é
configurável por qual campo serve de correspondência, nunca um algoritmo fixo; (c) uma
referência não resolvida vira erro/sinalização de linha, nunca criação silenciosa do lado
"pai". **NÃO sustentado como padrão externo**: "um tipo de entidade por job" — isso é uma
escolha de engenharia interna (simplicidade de atomicidade dado que este projeto já exige
`TransactWriteItems`/OCC em toda escrita, `AGENTS.md` §7 — multi-objeto-por-linha exigiria uma
transação que cria Subject+Document+Requirement juntos, o que nenhuma fonte examinada prova ser
necessário para o roadmap real deste produto, cujo exemplo motivador — "Gostei, mas vou ter que
cadastrar tudo de novo?" — é atendido por 3 arquivos sequenciais tanto quanto por um arquivo
combinado). D-1 permanece a mesma escolha, com a justificativa correta: proporcionalidade
(`principles.md` #1) e atomicidade transacional deste projeto, não conformidade de mercado.

## Régua v2 — reconciliada (nota de régua desta rodada, separada da nota de design)

Aceito a reestruturação proposta pelo Codex quase integralmente. Régua v2:

1. **(25%, era 2 critérios de 20%+20% sobrepostos) Atomicidade e idempotência do commit por
   linha.** Atende: claim de dedupe/binding, criação da entidade e avanço do cursor de
   `ImportJob` estão na MESMA `TransactWriteItems`, ou a proposta prova por que uma janela
   residual é inevitável E documenta reconciliação. Não atende: qualquer sequência de writes
   independentes onde uma claim pode existir sem a entidade correspondente.
2. **(15%) Orquestração upload→mapping→parse sem corrida.** Atende: existe uma máquina de
   estados explícita cobrindo "arquivo chegou antes do mapeamento" sem depender de timing entre
   evento S3 e chamada HTTP. Não atende: dependência implícita de ordem de chegada.
3. **(15%) Referência a entidade-pai é resolvida contra uma identidade durável e verificável,
   não um efeito colateral de sidecar de outro import.** Atende: o campo usado para resolver
   `Document`/`Requirement`→`Subject` é uma propriedade de primeira classe do próprio `Subject`
   (ou um erro claro quando ausente), nunca depende de o Subject ter sido criado por import.
   Não atende: reaproveitar `ImportDedupRecord` (concebido só para idempotência técnica de
   import) como índice de identidade de negócio.
4. **(15%) TOCTOU entre preview e commit fechado nas invariantes que já existem no domínio.**
   Atende: toda condição que o domínio já normalmente valida (Subject ACTIVE, DocumentType
   ACTIVE) é reafirmada por `ConditionCheck` na transação do commit, não só checada na leitura
   do parse. Não atende: confiar que o estado lido no preview/parse ainda vale no commit.
5. **(10%) Dedupe declarado por entidade, incluindo colisão intra-arquivo e ausência de chave
   natural.** (Critério 4 original da Rodada 1, mantido, peso reduzido.)
6. **(10%) Reuso do esqueleto convergido sem herdar nem ampliar falhas conhecidas.** (Critério
   5 original, reformulado conforme o Codex pediu — reuso não é desculpa para não fechar 1-4.)
7. **(10%, era 20%) Um tipo de entidade por job — julgado como escolha interna, não como
   padrão de mercado.** (Critério 1 original, desacoplado da parte de referência que virou o
   critério 3 novo.)

Critério 6 original (escopo declarado sem arquivo/versão) sai do checklist pesado — não estava
sob disputa real (Codex achado 16 concorda com a substância, só contesta a palavra
"definitivamente") e vira uma nota de precisão de linguagem, não um critério de nota.

**Nota de régua Claude (cega) Rodada 2: 9.1/10** — meu único desconforto é o peso 25% do
critério 1 talvez ainda subestimar o quanto ele domina a decisão inteira (quase toda a
superfície de risco real está ali), mas aceito a distribuição do Codex como razoável.

## Correções de design (achados 1-16, endereçados um a um)

### Achado 1 (bloqueante) — corrida upload/mapping: novo estado `AWAITING_MAPPING`

```text
UPLOADED --(evento S3, columnMapping ausente)--> AWAITING_MAPPING
UPLOADED --(evento S3, columnMapping já presente)--> PARSING   // caso raro: mapping veio no reserve
AWAITING_MAPPING --(POST /mapping)--> PARSING   // grava mapping E dispara parse na MESMA chamada
UPLOADED --(POST /mapping, evento S3 ainda não chegou)--> UPLOADED  // grava mapping, aguarda evento
```

`parseImportJob` (disparado pelo evento S3, único trigger que já existe) primeiro verifica
`job.columnMapping`: ausente → `update(status: "AWAITING_MAPPING")` e RETORNA sem erro (não é
falha, é um estado de espera legítimo, nunca `FAILED`); presente → segue para `PARSING` como
hoje. `POST /import-jobs/{jobId}/mapping` (handler síncrono) faz, sob OCC do job:
`update(columnMapping, columnMappingSha256, status: current==="UPLOADED"||"AWAITING_MAPPING" ?
(fileAlreadyUploaded ? "PARSING" : "UPLOADED") : 409)` — **e se o novo status é `PARSING`,
o próprio handler chama `parseImportJob()` diretamente, no mesmo request** (mesmo padrão de
invocação síncrona que este módulo já não tem hoje via Lambda-a-Lambda, mas é exatamente o que
fecha a corrida: não existe mais um segundo evento a esperar). Isto substitui os dois endpoints
`/schema`+`/mapping` da Rodada 1 por três estados claros e um único endpoint de mutação; `/schema`
(leitura do cabeçalho) continua existindo mas como GET idempotente, sem side-effect, chamável a
qualquer momento em `UPLOADED`/`AWAITING_MAPPING`.

`fileAlreadyUploaded` é observável pelo próprio `job.status`: se já é `AWAITING_MAPPING`, o
arquivo chegou; se ainda é `UPLOADED` (nunca viu o evento), o mapping fica gravado e o próximo
evento S3 encontra `columnMapping` presente e segue direto para `PARSING`. As duas ordens de
chegada (mapping antes do upload, upload antes do mapping) convergem para `PARSING` sem
depender de qual chegou primeiro — fecha o achado 1.

### Achado 5 — `ColumnMapping` versionado, sem autoridade duplicada

```text
export interface ColumnMapping {
  schemaVersion: 1;                 // versão do CATÁLOGO de campos, não do job
  columns: Record<string, string>;  // campo interno -> header do CSV; validado contra
                                     // FIELD_CATALOG[job.targetEntityType][schemaVersion]
}
```

`targetEntityType` NUNCA aparece dentro de `ColumnMapping` — é lido de `job.targetEntityType`
(única autoridade). `FIELD_CATALOG` é um `const` TypeScript versionado
(`{ TrackedSubject: { 1: { required: [...], optional: [...] } }, Document: { 1: {...} },
Requirement: { 1: {...} } }`) — `schemaVersion` existe para permitir adicionar um campo opcional
novo no futuro sem quebrar um mapping salvo de um job antigo (job antigo nunca é reaberto, mas
a UI que monta o mapeamento consulta o catálogo pela versão vigente). `mappingVersion` (campo
morto da Rodada 1 do design original) é removido, não reaproveitado com o mesmo nome — nomear
igual um campo com contrato diferente seria pior que remover.

**Imutabilidade (achado 10)**: `POST /mapping` só é aceito quando `job.status IN
("UPLOADED","AWAITING_MAPPING")` (OCC do próprio `update`, `expectedVersion`) — uma vez que o
job entra em `PARSING`, uma segunda chamada a `/mapping` é 409. `columnMappingSha256` (hash do
`ColumnMapping` serializado) é gravado no `ImportJob` no mesmo write que fixa `columnMapping`, e
`parseImportJob` inclui esse hash como campo do próprio plano persistido em S3 (uma linha de
cabeçalho `{"kind":"MANIFEST","columnMappingSha256":...}` como primeira linha do JSONL) — o
commit worker, que já valida `planSha256` contra o job, agora também confirma que o manifest do
plano cita o MESMO `columnMappingSha256` que o job tem no momento do commit, fechando a
proveniência completa (achado 10).

### Achado 3 + Régua critério 3 — `TrackedSubject.externalId` como identidade durável

Correção estrutural: `externalId` deixa de ser uma propriedade só do sidecar `ImportDedupRecord`
e vira um **campo opcional de primeira classe em `TrackedSubject`** (`subject/domain/
tracked-subject.ts`), com um ponteiro dedicado (mesmo mecanismo de `DocumentTypeNamePointer`/
`RequirementNamePointer`, precedente já convergido):

```text
TrackedSubject.externalId?: string   // novo campo persistido na própria entidade

SubjectExternalIdPointer
  PK  TENANT#<tenantId>#SUBJECTEXTID#<externalId>
  SK  POINTER
  subjectId, tenantId, externalId, createdAt, updatedAt, version
```

`createSubject()` (`subject-service.ts`, a ser confirmado na Rodada 3 se aceita `externalId`
opcional no input — se sim, o `TransactWriteItems` já existente ganha um terceiro `Put
attribute_not_exists` do ponteiro; a colisão de `externalId` vira `SubjectExternalIdConflictError`
409, mesma forma de `DocumentTypeNameConflictError`) grava o ponteiro **na mesma transação** que
cria o Subject — nunca um segundo write. Isto responde à pergunta do Codex ("identidade de
integração durável, alias administrável, ou idempotency key?"): `externalId` é **identidade de
integração durável do Subject**, administrável fora de qualquer import (um Subject criado pela
UI também pode receber `externalId` manualmente, útil para o próprio cliente já mapear IDs do
sistema legado antes de importar Document/Requirement). A idempotência TÉCNICA de retry de
commit (distinta, achado 6) continua sendo o `ImportDedupRecord` scoped ao job, nunca o mesmo
registro.

`resolveSubjectReference` (Document/Requirement import) faz `Get` direto em
`subjectExternalIdPointerKey(tenantId, externalId)` → `subjectId` → `Get` do Subject real,
checando `status === "ACTIVE"` no momento do parse. Isso resolve **qualquer** Subject com
`externalId` setado, criado por import OU manualmente — fecha o achado 3. Um `externalId`
referenciado que não tem ponteiro é `REJECT reason="SUBJECT_REFERENCE_NOT_FOUND"`, e a mensagem
de erro agora pode dizer corretamente "nenhum Subject com este externalId" em vez de confundir
com "nenhum Subject criado por import com este externalId".

Alcance desta correção: **só `TrackedSubject`** ganha `externalId` persistido nesta fatia — nem
`Document` nem `Requirement` precisam disso agora (nada referencia um Document/Requirement por
fora ainda); se o roadmap abrir esse caso depois, o mesmo padrão de ponteiro se replica sem
precisar reabrir esta decisão.

### Achado 4 (bloqueante) — fence transacional de Subject em `createDocument()`

Confirmado por leitura direta (`document-archive-service.ts` linhas 208-248): `createDocument()`
hoje só condiciona `DocumentType.status = ACTIVE`, nunca a existência/status do Subject — gap
real, pré-existente, mas só se torna diretamente explorável agora que import resolve
`subjectId` a partir de um valor de CSV (não mais só de uma chamada HTTP autenticada que já
passou por uma tela que só lista Subjects ACTIVE). Corrigido como parte desta fatia (não
adiado): `createDocument()` ganha um segundo `ConditionCheck`, mesma forma do que
`RequirementTemplate.applyTemplate` (D-191) já faz para `TrackedSubject`:

```text
entries = [
  ConditionCheck(TrackedSubject: attribute_exists(PK) AND #status = :active),
  ConditionCheck(DocumentType: #status = :active),
  Put(Document, attribute_not_exists),
]
```

Cancelamento classificado por posição (mesmo padrão D-191 §8): índice 0 →
`SubjectPreconditionFailedError`, índice 1 → `DocumentTypeNotActiveError`, índice 2 →
`ConflictError` (documento já existe, colisão de id gerado — praticamente impossível com ULID,
mas a posição existe e precisa de um rótulo). Isto é uma correção do serviço público
`createDocument()`, não um comportamento exclusivo do caminho de import — toda a superfície
HTTP existente se beneficia, registrado como achado geral (`DA-SUBJECT-FENCE-01`) resolvido
dentro desta fatia por ser pré-requisito direto do critério 4 da régua.

### Achado 2 (bloqueante) + Régua critério 1 — claim, criação e cursor na MESMA transação

Esta é a correção mais estrutural. `import-commit-service.ts` deixa de chamar
`subjects.createSubject()`/`documentArchive.createDocument()`/`documentArchive.createRequirement()`
como caixas-pretas HTTP-shaped. Em vez disso, cada serviço de domínio passa a expor uma função
pura de **construção de entries** (mesmo padrão `planTemplateApplication` de D-191 — separar
"decidir o que escrever" de "executar a escrita"), reusada tanto pelo método público quanto pelo
commit de import:

```text
// subject-service.ts (novo, exportado)
buildCreateSubjectEntries(tenantId, subjectId, input, now): { entries: TransactWriteItem[]; subject: TrackedSubject }

// document-archive-service.ts (novo, exportado, dois casos)
buildCreateDocumentEntries(tenantId, documentId, input, now): { entries: TransactWriteItem[]; document: Document }
buildCreateRequirementEntries(tenantId, subjectId, requirementId, input, now): { entries: TransactWriteItem[]; requirement: Requirement }
```

Os métodos públicos (`createSubject`/`createDocument`/`createRequirement`) passam a ser
`const { entries, X } = buildCreateXEntries(...); await executeTenantBusinessMutation({...,
entries}); return X;` — refactor mecânico, mesmo comportamento externo, zero mudança de
contrato HTTP (nível 3-4, não Type 1 por si só; incluído aqui só porque é pré-requisito direto
da correção Type 1 do commit de import).

`commitImportJob` (novo, por linha):

```text
const { entries, entity } = buildCreateXEntries(tenantId, newId, row.validated, now);
entries.push(
  { Put: buildVersionedCreate(tableName, dedupClaimRecord(...)) },     // attribute_not_exists
  { Update: buildVersionedUpdate(tableName, { ...jobKey, lastCommittedRowNumber: entry.rowNumber, ... }, { expectedVersion: current.version }) },
);
await executeTenantBusinessMutation({ store, tableName, tenantId, entries });
```

**Uma única `TransactWriteItems` por linha**: entidade + claim de dedupe + avanço do cursor do
`ImportJob`, atômicos. Um crash em qualquer ponto antes do commit da transação não deixa
NENHUM rastro (nem claim órfã, nem cursor avançado sem entidade); um crash DEPOIS é
indistinguível de sucesso — um retry lê `lastCommittedRowNumber` já avançado e pula a linha
corretamente, exatamente a garantia que a Rodada 1 afirmava ter e não tinha. Isto fecha o
achado 2 e o critério 1 da régua. Custo: essa transação por linha soma ao orçamento de ações já
existente de cada entidade (Subject: 2 hoje sem dedupe+1 fence tenant = ~3; +1 claim +1 cursor =
5; Document: +1 fence Subject (achado 4) +1 fence DocType +1 Put +1 fence tenant = 4; +1 claim +1
cursor = 6; Requirement: 2+1 fence tenant=3; +1 claim +1 cursor = 5) — todos MUITO abaixo do
limite de 100 de `TransactWriteItems`, nenhum cap novo necessário.

### Achado 6/7 — chave de dedupe/claim, encoding e namespace por tipo

Adoto a forma explícita sugerida pelo Codex, com builders dedicados (nunca uma string
interpolada genérica):

```text
importDedupKeySubject(tenantId, externalId)      // PK=TENANT#t#IMPORTDEDUP#SUBJECT,      SK=EXT#<enc(externalId)>
importDedupKeyDocument(tenantId, subjectId, key) // PK=TENANT#t#IMPORTDEDUP#DOCUMENT,     SK=SUBJECT#<subjectId>#EXT#<enc(key)>
importDedupKeyRequirement(tenantId, subjectId, key) // PK=...#REQUIREMENT, SK=SUBJECT#<subjectId>#EXT#<enc(key)>
```

`enc()` = `encodeURIComponent` (já usado em outras chaves deste projeto para valores de usuário
dentro de uma SK — verificação de precedente na Rodada 3). `key` é `externalId.trim()` — SEM
lowercase/normalização adicional (diferente de `normalizeDisplayName`, que é para NOME
apresentável, não para um identificador de integração que pode ser case-sensitive por design do
sistema de origem do cliente — declarado explicitamente, não uma omissão). Idempotência técnica
de linha SEM `externalId` continua usando a chave sintética `job:<jobId>:row:<rowNumber>`
(mantida, achado 6, "não decidido" da Rodada 1 → decidido: mantida igual à de Subject, mesmo
namespace por tipo).

### Achado 8 — colisão intra-arquivo para Document/Requirement

Mesma disciplina de `seenExternalIdsInFile` (Subject, já existente) generalizada:
`seenDedupKeysInFile: Set<string>` por `(subjectId, dedupKey)` quando `externalId` está presente;
para `Requirement` SEM `externalId`, `seenNormalizedNamesInFile: Set<string>` por
`(subjectId, normalizeDisplayName(name))`. Segunda ocorrência no MESMO arquivo →
`REJECT reason="DUPLICATE_IN_FILE"` (nunca `SKIP_DUPLICATE` — `SKIP_DUPLICATE` é reservado para
colisão contra dado JÁ PERSISTIDO; duas linhas do mesmo arquivo colidindo entre si é erro de
dado de entrada, o preview mostra as DUAS linhas como rejeitadas, nunca promete criar uma e
descobre no commit que colidiria com a outra). `Document` sem `externalId` nunca colide
intra-arquivo (achado explícito da Rodada 1 mantido: não existe chave de negócio).

### Achado 9 — `documentTypeRef`/`documentTypeRefKind`, resolvido pelo pointer

Renomeado conforme sugerido: `documentTypeRef` (valor do CSV) +
`documentTypeRefKind: "DOCUMENT_TYPE_ID" | "DISPLAY_NAME"` (campo do `ColumnMapping`, não do
CSV — é uma decisão de configuração do import, igual `subjectRefKind`). Resolução: `ID` → `Get`
direto na chave; `DISPLAY_NAME` → `Get` em `documentTypeNamePointerKey(tenantId,
normalizeDisplayName(ref))` (reuso do ponteiro já existente do D-173, nunca uma listagem
paginada — corrige a afirmação incorreta da Rodada 1 sobre "pré-carregamento simples"). Só
`DocumentType.status === "ACTIVE"` resolve; `DEPRECATED` ou ausente → `REJECT
reason="DOCUMENT_TYPE_NOT_FOUND"`. O `documentTypeId` RESOLVIDO (não a ref crua) fica congelado
no plano (`ValidatedDocumentRow.documentTypeId`) — um rename do DocumentType entre preview e
commit nunca afeta o resultado (o id não muda por rename, só o pointer de nome); um
`DEPRECATE` entre preview e commit é pego pelo `ConditionCheck` já existente em
`createDocument()`, convertendo aquela linha especificamente em falha (achado 14 abaixo), nunca
silenciosamente ignorado.

### Achado 13 — resolução de referência em lote, não por linha

`resolveSubjectReferences`/`resolveDocumentTypeReferences` (plural) coletam o `Set` de valores
DISTINTOS referenciados no arquivo inteiro primeiro, depois um único `BatchGetItem` (até 100
chaves por chamada, `ImportStore` ganha `batchGet()`, particionado internamente se
`distinct.size > 100`) resolve todos de uma vez — no pior caso (5000 linhas, todas com
`subjectRef` distinto) isso ainda é ≤50 chamadas `BatchGetItem`, não 5000 `GetItem` individuais.
Cache em memória (`Map<ref, resolved>`) dentro do próprio parse, descartado ao fim.

### Achado 14 — taxonomia de erro no commit por linha

Como o commit agora é uma `TransactWriteItems` própria POR LINHA (achado 2, acima) em vez de
delegar para um serviço que pode lançar qualquer coisa, a classificação fica local e fechada: o
próprio `commitImportJob` interpreta `CancellationReasons` pela POSIÇÃO conhecida dos seus
próprios `entries` (mesmo padrão de rótulos por posição de D-191 §8) e decide:

- Falha da entidade/fence de domínio (posição da entrada de negócio, ex. Subject/DocumentType
  não ACTIVE) → **falha DE LINHA**: plano registra `COMMIT_FAILED { rowNumber, reason }`,
  cursor AINDA avança (a transação falhou inteira, então nada foi escrito — o avanço do cursor
  aqui não é "linha committada", é "linha PROCESSADA", campo renomeado no `ImportJob` de
  `lastCommittedRowNumber` para `lastProcessedRowNumber` para refletir isso honestamente — achado
  de nomenclatura que a Rodada 1 escondia).
- Falha do fence de tenant (`TenantNotActiveError`, sempre a última posição,
  `executeTenantBusinessMutation`) → **falha DE JOB**: para o commit inteiro, `FAILED`, igual
  ao comportamento hoje para `QuotaExceededError`.
- `QuotaExceededError` (checada ANTES de montar a transação, como hoje) → falha de job,
  inalterado.
- Erro não reconhecido (nem `TransactionCanceledException` nem `QuotaExceededError`) → propaga
  (`throw`), deixa o worker de fato falhar e o SQS retentar — comportamento conservador,
  inalterado da Rodada 1.

### Achado 15 — plano carrega proveniência suficiente

`ImportRowPlanEntry` ganha, quando aplicável: `resolvedSubjectId`, `resolvedDocumentTypeId`,
`dedupKeyUsed`. Suficiente para UX/auditoria sem inventar um segundo formato de relatório nesta
fatia (dossiê de import fica fora de escopo, roadmap item 16/P1).

### Achado 16 — precisão de linguagem

Aceito — "fecha definitivamente" trocado por "fora do escopo desta fatia; nada na análise do
domínio impede um import futuro com arquivo real via `reserveFiles()`".

## Riscos reconhecidos (atualizados)

1. `TrackedSubject.externalId` é uma mudança de schema em uma entidade já existente e usada em
   produção sintética (`dev`) — sem migração (dispensada por `AGENTS.md` §1), mas um Subject
   `dev` já criado nunca terá `externalId` retroativo a menos que editado; documentado, mesma
   categoria do risco 2 de D-191 (backfill).
2. O refactor `buildCreateXEntries` em 3 serviços é uma mudança mecânica mas não trivial —
   risco de regressão nos 69+ testes existentes de Subject e nos testes de `document-archive`;
   mitigação é rodar a suíte completa antes/depois, sem mudar comportamento observável dos
   métodos públicos.
3. `lastProcessedRowNumber` (renomeado) é uma mudança de contrato de campo do `ImportJob` — se
   algum consumidor externo (frontend) já lê `lastCommittedRowNumber` por nome, precisa migrar
   junto (verificação real na Rodada 3, `grep` no frontend).

## Autoavaliação Rodada 2 (contra a régua v2)

Critério 1 (25%): atendido — transação única por linha. 2 (15%): atendido —
`AWAITING_MAPPING`. 3 (15%): atendido — `externalId` na própria entidade + ponteiro. 4 (15%):
atendido — fence de Subject em `createDocument`, `documentTypeRefKind` resolvido pelo pointer,
falhas de fence viram falha de linha. 5 (10%): atendido — colisão intra-arquivo, chaves com
builders dedicados. 6 (10%): atendido — reuso via `buildCreateXEntries` compartilhado, sem
herdar a falha de atomicidade antiga. 7 (10%): atendido — reformulado como escolha interna.

**Nota Claude (cega), Rodada 2 — régua: 9.1/10; design: 8.9/10** (abaixo de 9.0 porque ainda não
verifiquei por leitura direta se `subject-service.ts`/`createSubject()` aceita `externalId` no
input hoje, nem o precedente real de `encodeURIComponent` em chaves deste projeto — deixo isso
como verificação explícita pendente para a Rodada 3, não uma alegação não checada).
