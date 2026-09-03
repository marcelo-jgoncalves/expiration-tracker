# Bulk Import — Documents + Requirements + Column Mapping — Rodada 1 (proposta Claude)

Escopo: item P0.2 do `docs/project/roadmap-competitivo-2026-09-01.md` ("Bulk Onboarding /
Importação em Massa") — estender `src/modules/import/` (hoje só `TrackedSubject`, ~69 testes,
D-042/W3-07) para cobrir **Document + Requirement + mapeamento de coluna configurável**,
mantendo preview/dedupe/resume. Nível 5-6 de `change-risk-scale.md` (novo `ImportTargetEntityType`,
novos registros de dedupe, novo contrato de mapeamento que persiste em `ImportJob`) — protocolo
`AGENTS.md` §4 obrigatório.

## Pesquisa externa considerada

`SIM` (fontes abaixo — a decisão inteira é informada por padrão externo: "importador CSV
configurável com mapeamento de coluna, preview, dedupe e associação a registros existentes" é
um problema extremamente bem resolvido fora deste projeto; nenhuma parte relevante desta rodada
é layout de chave DynamoDB puro — mesmo o formato de `ImportJob`/`ImportDedupRecord` já existente
foi *desenhado* seguindo este padrão em D-042, então estendê-lo continua sob o mesmo guarda-chuva).

Fontes (consultadas 2026-09-03):

- HubSpot Knowledge Base — "Guidelines for importing files"
  (https://knowledge.hubspot.com/import-export/guidelines-for-importing-files) e "Associate
  records during import" (https://knowledge.hubspot.com/import-export/associate-records-during-import):
  HubSpot importa **um tipo de objeto por arquivo** (ou um arquivo por aba numa importação
  multi-objeto), e associa um objeto a outro **já existente** via uma coluna que casa por um
  "unique value" (ID interno, e-mail, ou uma "external ID" customizada) — nunca por criar os
  dois lados na mesma linha de um único arquivo genérico.
- HubSpot — "Set your import file column headers"
  (https://knowledge.hubspot.com/import-export/how-to-format-your-import-files): o mapeamento
  coluna→campo é um passo explícito da UI, feito DEPOIS do upload e ANTES do preview — o
  cabeçalho do arquivo nunca precisa bater com o nome do campo interno.
- Salesforce Help — "Prepare Your Data for Import" / Data Import Wizard
  (https://help.salesforce.com/s/articleView?id=sf.import_preparing.htm): mesma ordem
  recomendada — importar a entidade "pai" (Contas) primeiro, depois a "filha" (Contatos) num
  arquivo separado que referencia a pai por um campo de match (nome da conta ou External ID).
  "Update or Add" usa um External ID Field explícito por objeto.
- Airtable Support — "Import a spreadsheet or CSV"
  (https://support.airtable.com/docs/importing-csv-and-excel-files-into-airtable) e "Merge
  records during import" (https://support.airtable.com/docs/merge-import): o assistente de
  import tem um passo de mapeamento coluna→campo com preview lado a lado, e o merge/dedupe é
  configurado escolhendo QUAL coluna é a chave de correspondência (nunca um algoritmo fixo) —
  campos não mapeados viram colunas novas em vez de serem descartados silenciosamente.
- Zendesk Help Center — "Bulk importing users and organizations"
  (https://support.zendesk.com/hc/en-us/articles/4408828702490): confirma o mesmo padrão em um
  produto de nicho de atendimento (não CRM) — usuários e organizações são arquivos separados,
  ligados por um campo de referência (nome/domínio da organização), nunca combinados numa linha.

**Representatividade**: a amostra cobre CRM enterprise (Salesforce), CRM/marketing mid-market
(HubSpot), planilha genérica (Airtable) e um produto de nicho vertical de atendimento (Zendesk)
— reduz viés de um nicho só. **Padrão convergente encontrado, forte**: (1) **um tipo de entidade
por arquivo/import job**, nunca múltiplas entidades relacionadas numa única linha de CSV
genérico; (2) entidades relacionadas são ligadas por uma **coluna de referência que casa contra
um valor de identidade já existente** (ID interno, e-mail, "External ID" nomeado), resolvida
DEPOIS que a entidade pai já existe; (3) **mapeamento coluna→campo é um passo de UI/contrato
explícito, dissociado do cabeçalho real do arquivo**, sempre antes do preview; (4) dedupe/merge
é configurável por QUAL campo serve de chave de correspondência, não um algoritmo fixo por tipo.
**Divergência/lacuna**: nenhuma das fontes cobre bem "o que fazer quando a referência ao pai não
resolve" com o mesmo rigor transacional que este projeto já exige (`AGENTS.md` §7,
`TransactWriteItems`/OCC) — HubSpot/Salesforce toleram uma linha de erro pós-hoc e reprocessamento
manual, postura mais frouxa do que o padrão `REJECT`/`SKIP_DUPLICATE` linha-a-linha já fechado
neste módulo (D-042). Essa parte é desenhada internamente, julgada pelo checklist abaixo, não por
conformidade de mercado.

## Checklist de critérios pesados (sub-rubrica desta decisão, subordinada a `joint-review-criteria.md`)

1. **(20%) Um tipo de entidade por `ImportJob`, resolução de referência só contra o que já
   existe.** Atende: `Document`/`Requirement` referenciam um Subject por uma coluna de
   referência resolvida contra dado JÁ PERSISTIDO (Subject existente ou criado por um job
   anterior já commitado) — nunca contra outra linha do MESMO arquivo em edição. Não atende:
   qualquer forma de "grafo de linhas" resolvido dentro do mesmo commit.
2. **(20%) Mapeamento de coluna é um contrato versionado, nunca inferido do cabeçalho.**
   Atende: existe uma estrutura `ColumnMapping` explícita, gravada no `ImportJob` ANTES do
   parse, e o parser só lê por essa estrutura — trocar o cabeçalho do CSV nunca muda o
   comportamento sem o usuário reconfigurar o mapeamento. Não atende: heurística de
   auto-detecção de coluna por nome como ÚNICO caminho (fallback é aceitável, autoridade não).
3. **(20%) Referência não resolvida é um REJECT de linha, nunca um Document/Requirement
   órfão nem um Subject fabricado por engano.** Atende: uma coluna de referência que não casa
   com nenhum Subject conhecido produz `REJECT reason=SUBJECT_REFERENCE_NOT_FOUND` na própria
   linha, visível no preview antes do commit. Não atende: criar o Subject silenciosamente, ou
   deixar `subjectId` ausente/nulo persistir.
4. **(15%) Dedupe declarado por entidade, honesto sobre a ausência de chave natural forte.**
   Atende: a proposta nomeia explicitamente qual campo é a chave forte de cada tipo (ou declara
   que não existe uma para `Document`) e não finge uma chave inexistente. Não atende: aplicar o
   mesmo mecanismo de `externalId`+fallback de nome do Subject a uma entidade sem equivalente
   real.
5. **(15%) Reuso do esqueleto já convergido — `ImportJob`/dedupe/cursor de commit — sem
   reescrever a máquina de estados.** Atende: `ImportTargetEntityType` vira união discriminada,
   `commitImportJob`/`parseImportJob` continuam genéricos por um `EntityImportPlan` polimórfico,
   nenhum novo status de `ImportJobStatus`. Não atende: um segundo pipeline de import paralelo
   por tipo de entidade.
6. **(10%) Escopo declarado do que fica de fora — nenhum arquivo real, nenhuma criação
   automática de Subject a partir de Document/Requirement.** Atende: a proposta nomeia
   explicitamente que bulk import de Document é metadado (shell), sem `DocumentVersion`/arquivo
   (isso é o "processamento em lote de documentos com OCR/IA" que o próprio roadmap separa como
   etapa POSTERIOR). Não atende: fingir que anexar arquivo em massa está resolvido aqui.

## Escopo confirmado por leitura direta do código

- `Document` (`document.ts`) exige `subjectId` + `documentTypeId` (catálogo D-173, já
  implementado) + `hasValidity`; não tem `name` nem chave natural. `Requirement`
  (`requirement.ts`) exige `subjectId` + `name` (único por Subject via `RequirementNamePointer`,
  transacional — confirmado em `document-archive-service.ts` linhas 668-736, mesmo mecanismo do
  D-191/`RequirementTemplate.applyTemplate`).
- `DocumentVersion.origin` já inclui o valor `"IMPORT"` (`document-version.ts` linha 30) —
  sinal de que um caminho de import para versão já foi antecipado no design do domínio, mas
  **nenhuma versão pode ser aceita sem arquivo real**: `commitUpload`/`acceptVersion` exigem
  `fileSetSealed=true` via `reserveFiles()` (D-163 §2/§4, `document-archive-service.ts` linha
  436) — bulk import por CSV não tem arquivo, então **não pode** produzir uma `DocumentVersion`
  ACCEPTED. Isto fecha definitivamente a pergunta "Document import cria versão?" como NÃO nesta
  fatia — `origin=IMPORT` fica reservado para quando o roadmap chegar em "processamento em lote
  de documentos com OCR/IA" (P0.2, segunda metade), que é o item que de fato terá arquivo.
- `RequirementTemplate.applyTemplate` (D-191, já implementado) resolve exatamente o problema de
  "criar N `Requirement` num Subject com dedupe transacional por nome" — é o precedente interno
  mais próximo do que `commitImportJob` precisa fazer para `Requirement`, mas ele aplica UM
  template a UM Subject por chamada HTTP síncrona; bulk import aplica potencialmente milhares de
  linhas cruzando MUITOS Subjects, então a forma de invocação é diferente (linha a linha, no
  worker assíncrono) mesmo reusando a mesma primitiva transacional de `Put attribute_not_exists`
  do ponteiro.
- `import-row.ts`/`import-parse-service.ts` hoje têm o mapeamento de coluna **fixo e hardcoded**
  em `mapCsvRowsToNamedFields`/o array literal `displayname/type/externalid/notes/tags`
  (`import-parse-service.ts` linhas 67-74) — `mappingVersion` no `ImportJob` é campo morto,
  nunca lido. Nenhuma infra de mapeamento configurável existe hoje, esta fatia introduz a
  primeira.

## Decisões propostas

### D-1. `ImportTargetEntityType` vira união de 3 valores; um `ImportJob` continua UM tipo só

```text
export type ImportTargetEntityType = "TrackedSubject" | "Document" | "Requirement";
```

Critério 1/5: nenhum job mistura tipos. Onboarding completo de um cliente novo = **3 jobs em
sequência** (Subjects → Documents → Requirements), exatamente a ordem recomendada por
Salesforce/HubSpot/Zendesk (pai antes de filho). A UI (fora de escopo desta fatia, backend
apenas) apresenta isso como um wizard de 3 passos, não 3 features desconectadas.

### D-2. Mapeamento de coluna configurável — `ColumnMapping` como contrato explícito no job

```text
export interface ColumnMapping {
  targetEntityType: ImportTargetEntityType;
  columns: Record<string, string>;  // chave = nome do campo interno, valor = cabeçalho real do CSV
}
```

`ImportJob.columnMapping: ColumnMapping` substitui o `mappingVersion: number` morto (campo
removido — nunca teve um leitor real, D-0 desta fatia). Fluxo novo: `POST .../reserve` continua
igual (presigned upload), mas o `POST .../request-commit` de hoje vira **dois** passos novos
antes do preview existir:

1. `POST /import-jobs/{jobId}/schema` (worker síncrono, leve): lê só o CABEÇALHO do CSV
   (primeira linha, sem parse de linhas de dado) e devolve `{ headers: string[] }` — nunca lido
   por si só, serve a UI para montar o mapeamento.
2. `POST /import-jobs/{jobId}/mapping` com `ColumnMapping` no corpo: valida contra um catálogo
   fixo por `targetEntityType` (`REQUIRED_FIELDS`/`OPTIONAL_FIELDS`, listas TypeScript
   `const`, não vindas de dado externo) — todo campo obrigatório do tipo-alvo precisa estar em
   `columns`; um cabeçalho referenciado que não existe no CSV real é 400 imediato. Grava
   `columnMapping` no `ImportJob` (status continua `UPLOADED`) e SÓ ENTÃO dispara o parse
   (evento S3 já disparado pelo upload original, mas `parseImportJob` agora espera
   `columnMapping` presente — se ausente, falha com `MAPPING_NOT_CONFIGURED`, nunca adivinha).

Critério 2: `mapCsvRowsToNamedFields` deixa de usar nomes de coluna fixos — recebe
`columnMapping.columns` e projeta `header→internalField` explicitamente. O mapeamento V1
existente de Subject (displayName/type/externalId/notes/tags) continua funcionando por um
`DEFAULT_SUBJECT_MAPPING` que a UI pode pré-preencher quando os cabeçalhos batem — mas o
`ImportJob` sempre grava o mapeamento EFETIVO usado, nunca depende do default silenciosamente
em runtime.

### D-3. Referência a Subject — coluna de referência resolvida contra o que já existe

Campo novo, obrigatório no mapeamento de `Document`/`Requirement`: `subjectRef` (campo interno)
→ mapeado para uma coluna do CSV cujo VALOR é OU o `externalId` de um Subject (mesmo conceito já
usado por `ImportDedupRecord`) OU — quando a coluna mapeada for explicitamente marcada
`subjectRefKind: "SUBJECT_ID"` no `ColumnMapping` — o `subjectId` real (UUID interno), para
integrações que já conhecem o id.

Resolução no parse worker (novo, `resolveSubjectReference`): dado `subjectRef` de uma linha,
1) se `subjectRefKind === "SUBJECT_ID"`, faz `GetItem` direto na chave do Subject; 2) senão,
resolve via `ImportDedupRecord` (`importDedupKey(tenantId, externalId)` já existente — reuso
literal, critério 5) e cai para `TrackedSubject.status === "ACTIVE"` do resultado. Não resolve
→ `REJECT reason="SUBJECT_REFERENCE_NOT_FOUND"` (critério 3). Isto fecha a pergunta central de
phase 1 ("subjectId/externalId reference vs. combined multi-entity-per-row") a favor da
referência simples — nenhuma linha cria seu próprio Subject.

### D-4. Dedupe por tipo — honesto sobre a ausência de chave natural

| Tipo | Chave forte | Fallback fraco | Nota |
| --- | --- | --- | --- |
| `TrackedSubject` | `externalId` (existente) | `type+displayNameNormalized` (existente) | inalterado |
| `Requirement` | `externalId` OPCIONAL no CSV (novo `ImportDedupRecord` por `(tenantId, subjectId, externalId)`) | `subjectId+nameNormalized` via o **`RequirementNamePointer` já existente** (D-191) — `Get` direto na chave do ponteiro, não uma segunda estrutura | reuso do mecanismo do template, critério 5 |
| `Document` | `externalId` OPCIONAL no CSV, mesma forma de `ImportDedupRecord` | **nenhum** — `Document` não tem nome nem combinação de campos que sirva de identidade de negócio (dois documentos do mesmo `documentTypeId` no mesmo Subject são um caso legítimo, ex. duas apólices) | critério 4: declarado, não fabricado |

`ImportDedupRecord` (hoje `PK=TENANT#t#IMPORTDEDUP#SUBJECT`) vira namespaced por tipo:
`PK=TENANT#t#IMPORTDEDUP#<entityType>`, `SK=EXT#<subjectId?>#<externalId>` para `Requirement`/
`Document` (o `subjectId` entra na chave porque `externalId` de Document/Requirement só precisa
ser único DENTRO de um Subject — diferente do Subject, cujo `externalId` é único no tenant
inteiro). Sem `externalId` no CSV para uma linha de `Document`, a linha nunca dedupe contra
outra — sempre cria, e o CSV é a única defesa do próprio usuário contra repetição (documentado,
não escondido).

### D-5. `EntityImportPlan` polimórfico — um pipeline, três formas de linha

```text
export type ImportRowPlanEntry =
  | { rowNumber; action: "CREATE_SUBJECT"; row: ValidatedSubjectRow }
  | { rowNumber; action: "CREATE_DOCUMENT"; row: ValidatedDocumentRow; subjectId: string }
  | { rowNumber; action: "CREATE_REQUIREMENT"; row: ValidatedRequirementRow; subjectId: string }
  | { rowNumber; action: "SKIP_DUPLICATE"; reason: ...; entityType: ImportTargetEntityType }
  | { rowNumber; action: "REJECT"; reason: ImportRowRejectionCode | "SUBJECT_REFERENCE_NOT_FOUND"; field? };
```

`parseImportJob`/`commitImportJob` continuam genéricos (critério 5): um `switch` sobre
`job.targetEntityType` escolhe o validador de linha (`validateSubjectRow`/
`validateDocumentRow`/`validateRequirementRow`, cada um em seu próprio arquivo de domínio) e o
criador (`subjects.createSubject`/`documentArchive.createDocument`/
`documentArchive.createRequirement`, todos já existentes e reusados sem alteração de contrato) —
a MÁQUINA (status, cursor `lastCommittedRowNumber`, checagem de `planSha256`, política de
fail-fast por `QuotaExceededError`) não sabe qual entidade está criando, só invoca o par
validador/criador do tipo do job.

`ValidatedDocumentRow`: `{ rowNumber, subjectId, documentTypeId, hasValidity, externalId? }`.
`documentTypeId` no CSV é o `displayName` normalizado de um `DocumentType` (D-173) resolvido
contra o catálogo do tenant no pré-carregamento (mesmo padrão do `existingActive` de Subject
hoje) — um `documentTypeId` que não resolve é `REJECT reason="DOCUMENT_TYPE_NOT_FOUND"`, nunca
cria um `DocumentType` novo silenciosamente (fora de escopo desta fatia, critério 6).

`ValidatedRequirementRow`: `{ rowNumber, subjectId, name, notes?, applicability, externalId? }`.

### D-6. Commit transacional por linha, reusando os serviços existentes sem contorná-los

`commitImportJob` continua criando UMA entidade por iteração do loop (nunca batching de N
linhas numa `TransactWriteItems` — isso reabriria a mesma classe de risco que D-191 fechou com
um cap de itens, e bulk import não tem cap natural de linhas por commit-step, só o teto global
de `MAX_IMPORT_ROWS`). Para `Requirement`, chama `documentArchive.createRequirement()` tal como
está — já transacional (Put Requirement + Put pointer + fence) — não reimplementa a transação
aqui. Para `Document`, chama `documentArchive.createDocument()` (a ser verificado no serviço
real na Rodada 2 se a assinatura aceita `externalId`/proveniência — se não aceitar, o dedup
record é escrito pelo worker de import, fora da transação do Document, aceitando a mesma janela
de "claim órfã" que `commitImportJob` já aceita hoje para Subject em caso de crash entre os dois
writes, D-042 já documentado).

## Riscos reconhecidos

1. **Falta de chave natural para `Document`** (D-4) significa que reimportar o mesmo CSV sem
   `externalId` duplica documentos — aceito e declarado, não escondido; a mitigação é UX (avisar
   o usuário) fora do escopo backend desta fatia.
2. **`resolveSubjectReference` lê por linha** quando `subjectRefKind !== "SUBJECT_ID"` (um `Get`
   no `ImportDedupRecord` por linha de Document/Requirement) — ao contrário do pré-carregamento
   único que Subject import já faz hoje via GSI7. Até `MAX_IMPORT_ROWS=5000`, isso é até 5000
   `GetItem` por commit — aceitável em custo, mas é uma divergência de padrão dentro do mesmo
   módulo que espero ver contestada; alternativa (pré-carregar todos os `ImportDedupRecord` do
   tenant) tem o mesmo formato do pré-carregamento de Subject e pode ser a correção certa.
3. **Dois novos endpoints síncronos** (`/schema`, `/mapping`) antes do fluxo assíncrono
   conhecido — divergem da forma "reserve→worker" atual; risco de superfície de API maior do
   que o mínimo necessário.

## Autoavaliação Rodada 1 (contra o checklist acima)

Critério 1: atendido (D-1/D-3). 2: atendido (D-2). 3: atendido (D-3). 4: atendido (D-4,
declarado sem chave para Document). 5: atendido (D-5/D-6, reuso de `createRequirement`/pointer
existente, zero pipeline paralelo). 6: atendido (D-0/escopo confirmado, sem versão/arquivo, sem
criação automática de DocumentType/Subject). Pontos que espero ver contestados: o custo por
linha do risco 2, e se dois endpoints síncronos novos (D-2) são a forma certa ou se deveriam ser
parte do payload de `reserve`.

**Nota Claude (cega), Rodada 1: 7.8/10.**
