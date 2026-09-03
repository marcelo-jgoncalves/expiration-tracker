# Bulk Import — Documents + Requirements + Column Mapping — Estado final consolidado (`APPROVED`)

**Status: `APPROVED` via protocolo Claude↔Codex (`AGENTS.md` §4), 5 rodadas reais (`codex exec`,
foreground, `- < arquivo.txt > saida.txt 2>&1`), nota cega por rodada:**

| Rodada | Claude (régua / design) | Codex (régua / design) |
| --- | --- | --- |
| 1 | — / 7.8 | — / 4.7 |
| 2 | 9.1 / 8.9 | 8.7 / 7.8 |
| 3 | 9.3 / 9.1 | **9.5** / 8.8 |
| 4 | (régua fechada) / 9.3 | (régua fechada) / 8.8 |
| 5 | (régua fechada) / 9.4 | (régua fechada) / **9.1** |

Régua fechada na Rodada 3 (Claude 9.3/Codex 9.5, ambos ≥9.0 — `research-protocol.md` gate de
régua estável). Design fechado na Rodada 5 (Claude 9.4/Codex 9.1, ambos ≥9.0, sem arredondar) —
5ª e última rodada permitida pelo protocolo antes de reportar desacordo; convergiu dentro do
limite, com 2 qualificações documentais registradas explicitamente (§9).

Declaração E-014: **`SIM` (Rodada 1) → corrigida para `SIM PARCIAL` na Rodada 2**, após o Codex
demonstrar por leitura direta que HubSpot/Salesforce permitem import multi-objeto por linha em
fluxos dedicados — a generalização "nunca multi-entidade-por-linha" da Rodada 1 não procedia
como universal. Fontes finais (Drata/Vanta não se aplicam aqui — são do D-191; 7 fontes,
consultadas 2026-09-03): HubSpot (*Understand the import tool*, *Import objects*, *Associate
records during import*, *Set your import file column headers*), Salesforce (*Data Import
Wizard*/*Business Accounts and Contacts*), Airtable (*Import a spreadsheet or CSV*, *Merge
records during import*), Zendesk (*Bulk importing organizations*). Padrão convergente mantido:
mapeamento coluna→campo é contrato explícito antes do preview; associação/dedupe é configurável
por campo de correspondência escolhido; referência não resolvida vira erro de linha, nunca
criação silenciosa do lado pai. **Não sustentado como padrão externo** (corrigido): "um tipo de
entidade por `ImportJob`" — mantido como escolha de engenharia interna (proporcionalidade +
atomicidade transacional que este projeto já exige em toda escrita), não conformidade de
mercado.

Régua final (v3, ver histórico de reconciliação em round2/round3): C1 atomicidade/idempotência/
progresso por linha 25% · C2 orquestração upload/mapping/parse OCC-safe 15% · C3 identidade e
resolução de referências 15% · C4 fences de invariantes de domínio no commit 15% · C5 dedupe e
colisões 10% · C6 integridade/proveniência do plano e do resultado 10% · C7 contrato de
mapping/schema 5% · C8 um tipo por job/compatibilidade com o esqueleto existente 5%.

---

## 1. Escopo

Estende `src/modules/import/` (hoje só `TrackedSubject`, D-042/W3-07) para cobrir
`ImportTargetEntityType = "TrackedSubject" | "Document" | "Requirement"` + mapeamento de coluna
configurável. **Um `ImportJob` continua UM tipo de entidade só** — onboarding completo de um
tenant novo é 3 jobs sequenciais (Subjects → Documents → Requirements), nunca um arquivo
combinado. `Document`/`Requirement` referenciam um `TrackedSubject` **já existente** (criado
neste tenant, por qualquer via) por uma coluna de referência resolvida contra identidade
durável — nunca criam o Subject por efeito colateral.

**Fora de escopo, deliberado**: nenhum arquivo real anexado a `Document` (bulk import cria
apenas o shell de metadado — `DocumentVersion` exige `reserveFiles()`/`fileSetSealed=true`,
D-163, que CSV não tem como prover; `DocumentVersion.origin="IMPORT"` já existe no domínio e
fica reservado para quando o roadmap chegar em "processamento em lote de documentos com
OCR/IA", P0.2 segunda metade — decisão de escopo desta fatia, não impossibilidade
arquitetural). Nenhuma criação automática de `DocumentType`/`Subject` a partir de uma linha de
Document/Requirement.

## 2. Entidades e campos novos

```text
TrackedSubject.externalId?: string        // NOVO campo de 1ª classe — create-only nesta
                                            // fatia (updateSubject() não ganha essa capacidade)

SubjectExternalIdPointer                   // mesmo mecanismo de DocumentTypeNamePointer/
  PK   TENANT#<tenantId>#SUBJECTEXTID#<externalId>   // RequirementNamePointer
  SK   POINTER
  subjectId, tenantId, externalId, createdAt, updatedAt, version

ImportJob.columnMapping: ColumnMapping     // substitui o `mappingVersion: number` morto
ImportJob.columnMappingSha256: string
ImportJob.lastProcessedRowNumber: number   // renomeado de `lastCommittedRowNumber` — reflete
                                             // "linha processada" (sucesso OU falha), não só sucesso
ImportJob.status: ... | "AWAITING_MAPPING" // novo estado entre UPLOADED e PARSING

ImportRowOutcome                           // NOVO — resultado durável por linha, nunca mutação
  PK   TENANT#<tenantId>#IMPORTJOB#<jobId>  // do plano JSONL (que continua imutável em S3)
  SK   ROWOUTCOME#<rowNumber padded a 6 dígitos>
  outcome: "COMMITTED" | "FAILED"
  entityId?: string           // só se COMMITTED
  failureReason?: string      // só se FAILED
  createdAt

ImportDedupRecord                          // namespaced por tipo (era só Subject)
  PK   TENANT#<tenantId>#IMPORTDEDUP#<entityType>
  SK   EXT#<externalId>                                        // Subject (inalterado)
     | SUBJECT#<subjectId>#EXT#<externalId>                    // Document/Requirement
```

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

`targetKind` é redundante com `job.targetEntityType` por design DEFENSIVO (handler rejeita 400
se divergir) — nunca fonte de verdade independente. União discriminada real (TypeScript), nunca
`Record<string,string>` cru — `FIELD_CATALOG` (`const` TypeScript por `targetEntityType` +
`schemaVersion`) valida obrigatoriedade de campo em runtime.

Zero GSI novo.

## 3. Orquestração upload → mapping → parse (OCC-safe, sem chamada síncrona pesada)

```text
UPLOADED --(evento S3, columnMapping ausente)--> AWAITING_MAPPING
UPLOADED --(evento S3, columnMapping já presente)--> PARSING
AWAITING_MAPPING --(POST /mapping)--> PARSING       // grava mapping + emite outbox no MESMO TWI
UPLOADED --(POST /mapping, arquivo ainda não chegou)--> UPLOADED   // só grava mapping
```

`GET /import-jobs/{jobId}/schema` (novo, leitura pura, permitido em `UPLOADED`/
`AWAITING_MAPPING`): `Range` GET dos primeiros 64 KiB do objeto S3 (nunca o arquivo inteiro);
`sniffCsvHeaderAndSample()` corta o buffer no último `\n` real fora de aspas ANTES de rodar
`parseCsv()` (nunca deixa um registro truncado por corte de Range chegar ao parser); descarta
do sufixo qualquer sequência UTF-8 multibyte incompleta causada pelo corte de Range antes de
decodificar com `TextDecoder({fatal:true})` (distingue corte mecânico de byte real inválido,
400 `INVALID_UTF8`); sem `\n` seguro no range inteiro → 400 `HEADER_TOO_LARGE`. Resposta
`{ headers, sampleRows, objectETag }` — `objectETag` é **só diagnóstico de UI, não
autoritativo** (qualificação registrada em §9).

`POST /import-jobs/{jobId}/mapping`: grava `columnMapping`+`columnMappingSha256` sob OCC
(`expectedVersion`); se o resultado calculado é `PARSING`, a MESMA `TransactWriteItems` inclui
`Put(OutboxEvent "SQS_IMPORT_PARSE_V1", {tenantId, jobId})` (`AGENTS.md` §7 — evento crítico no
mesmo TWI do agregado). `OutboxDestination` ganha esse literal novo; fila SQS+DLQ dedicada,
sender registrado no relay, IAM restrito — mesmo padrão dos destinos já existentes
(`SQS_REMINDER_DISPATCH_V1` etc.). O handler HTTP nunca lê S3 nem faz parse — só um `Update`
pequeno.

`parseImportJob(deps, tenantId, jobId)` (função pura, dois triggers possíveis — evento S3 e a
fila nova, discriminados só no handler Lambda por forma de envelope, nunca dentro da função):
a PRIMEIRA mutação é um `Update` condicional (`version = job.version AND status IN (UPLOADED,
AWAITING_MAPPING)`) que É o claim — só um vencedor possível entre entregas concorrentes de
QUALQUER combinação dos dois triggers; o perdedor retorna `SKIPPED_ALREADY_CLAIMED` sem ler S3
nem produzir plano.

## 4. Resolução de referência — identidade durável, batched, nunca criação silenciosa

`Subject`: `subjectRefKind="EXTERNAL_ID"` resolve via `SubjectExternalIdPointer` (Get direto) →
`subjectId` → `Get TrackedSubject`, checa `status="ACTIVE"`; `"SUBJECT_ID"` resolve por `Get`
direto. `DocumentType`: `documentTypeRefKind="DISPLAY_NAME"` resolve via
`documentTypeNamePointerKey` já existente (D-173, nunca listagem paginada); `"DOCUMENT_TYPE_ID"`
por `Get` direto; só `status="ACTIVE"` resolve; o `documentTypeId` RESOLVIDO fica congelado no
plano (rename entre preview/commit não afeta; `DEPRECATE` é pego pelo `ConditionCheck` do
commit, vira falha de linha, não de job). Referência que não resolve →
`REJECT reason="SUBJECT_REFERENCE_NOT_FOUND" | "DOCUMENT_TYPE_NOT_FOUND"`.

Resolução em **duas fases de `BatchGetItem`** (nunca uma leitura por linha): fase 1 resolve o
`Set` de valores de referência DISTINTOS do arquivo → pointers; fase 2 resolve o `Set` de ids
distintos obtidos da fase 1 → entidades reais (`status` confirmado no momento do parse); ambas
com retry de `UnprocessedKeys`. Pior caso (5000 linhas, todas distintas): ~100 chamadas
`BatchGetItem` no total, não 5000 `GetItem`.

## 5. Fences de domínio no commit

`createDocument()` (`document-archive-service.ts`) ganha um SEGUNDO `ConditionCheck` —
`TrackedSubject: attribute_exists(PK) AND status=ACTIVE` — além do já existente
`DocumentType.status=ACTIVE`. Correção do serviço público inteiro (gap pré-existente
`DA-SUBJECT-FENCE-01`, não exclusivo do caminho de import), classificado por `{entries,
labels}` (mesmo formato de `RequirementTemplate.applyTemplate`, D-191 §8 — nunca índice
literal). `createRequirement()` já tinha o fence de Subject equivalente (D-191, verificado).

## 6. Atomicidade e idempotência do commit por linha — `Document`/`Requirement`

`buildCreateDocumentEntries`/`buildCreateRequirementEntries` (novo, exportado de
`document-archive-service.ts`, mesmo padrão de planejador puro que
`RequirementTemplate.applyTemplate` já usa) constroem `{entries, labels, entity}` sem executar a
escrita — reusados pelo método público (comportamento externo inalterado) E pelo commit de
import, que monta:

```text
TENTATIVA (uma TransactWriteItems): entries(entidade) + Put(dedup record, attribute_not_exists,
  se houver chave de negócio) + Put(ImportRowOutcome COMMITTED, attribute_not_exists,
  entityId=<gerado>) + Update(ImportJob.lastProcessedRowNumber, expectedVersion)
  [+ fence de tenant, sempre por último]

SE cancela por fence de DOMÍNIO (nunca fence de tenant):
  FALLBACK (segunda TransactWriteItems, sempre em seguida): Put(ImportRowOutcome FAILED,
  attribute_not_exists, failureReason=<código>) + Update(cursor, expectedVersion)
  [+ fence de tenant]
```

Um crash antes de qualquer transação não deixa rastro; um crash depois é indistinguível de
sucesso — retry encontra `ImportRowOutcome` já presente e nunca reexecuta nada. Corrida de
cursor entre duas tentativas concorrentes da mesma linha: o `Update` perdedor falha por
`expectedVersion`, releitura confirma `lastProcessedRowNumber >= rowNumber`, resultado é
descartado sem duplicar `ImportRowOutcome` nem regredir o cursor.

**`TrackedSubject` fica FORA desta correção, deliberadamente** (Bloqueante 3 da Rodada 3):
`createSubject()` tem contagem de `TenantEntitlement` + retry de contenção — não é refatorável
em builder puro sem reabrir uma decisão nível 5-6 própria. O caminho de Subject import continua
usando `subjects.createSubject()` como caixa-preta HTTP-shaped, exatamente como hoje — a janela
de "claim órfã" de D-042 permanece aceita como está, não expandida nem reduzida por esta fatia.

## 7. Dedupe e colisão intra-arquivo

| Tipo | Chave forte | Fallback fraco | Intra-arquivo |
| --- | --- | --- | --- |
| `TrackedSubject` | `externalId` (agora campo 1ª classe + pointer) | `type+displayNameNormalized` | inalterado (`seenExternalIdsInFile`) |
| `Requirement` | `externalId` opcional (`ImportDedupRecord`) | `subjectId+nameNormalized` via `RequirementNamePointer` (D-191, reuso) | "primeiro vence" — 2ª ocorrência da mesma chave → `REJECT reason="DUPLICATE_IN_FILE"` |
| `Document` | `externalId` opcional (`ImportDedupRecord`) | **nenhum** (sem identidade de negócio — dois documentos do mesmo tipo no mesmo Subject são legítimos) | mesma regra, só quando `externalId` presente |

"Primeiro vence" alinhado ao precedente REAL já existente (`seenExternalIdsInFile` — verificado
por leitura direta: primeira ocorrência segue para `CREATE_*`, ocorrências seguintes são
`REJECT`), não "rejeitar as duas linhas" (imprecisão da Rodada 2, corrigida na Rodada 3).

## 8. Limites de `externalId`

Envelope único para os 3 tipos: ≤200 bytes UTF-8 (`Buffer.byteLength`, orçamento no schema E no
serviço); `checkControlChars()` (reuso de `import-row.ts`) + rejeição de `#` (gramática de
chave — `#` é o delimitador estrutural de toda chave composta deste projeto; motivo é manter a
gramática simples e extensível, não uma prova de colisão imediata — `subjectId`/`documentId`/
etc. são sempre ULID sem `#`, gerados pelo sistema, então nenhum limite novo é necessário para
eles). `externalId` com `#` → `REJECT reason="EXTERNAL_ID_CONTAINS_RESERVED_CHARACTER"`.
`.trim()` apenas — sem `normalizeDisplayName()` (identificador de integração, não nome
apresentável, pode ser case-sensitive por design do sistema de origem do cliente).
`canonicalJsonStringify()` (chaves ordenadas alfabeticamente, recursivamente em todo nível;
arrays preservam ordem; lança em tipo não coberto) para `columnMappingSha256` — um único call
site.

## 9. Qualificações registradas (divergência residual não bloqueante, Codex Rodada 5)

1. **`objectETag` de `/schema` é não-autoritativo; existe um TOCTOU aceito entre `/schema` e o
   parse real.** O Codex contestou a fundamentação exata ("`planSha256` protege o JSONL do
   plano, não os bytes brutos do CSV" — CSVs diferentes podem produzir o mesmo plano em
   princípio), mas concordou que a invariante que importa para correção (commit nunca aplica um
   plano diferente do que o preview mostrou) permanece válida, e que a mutabilidade da chave de
   upload já existe idêntica no fluxo shipped de Subject — não é regressão desta fatia. Aceito
   como risco pré-existente registrado, não como gap resolvido por engenharia nesta fatia.
2. **O orçamento de 200 bytes de `Requirement.name` (D-191) não é hoje uma invariante universal
   de domínio** — `createRequirement()` não chama `assertTemplateItemSizes()`/equivalente; o
   schema HTTP atual limita 200 CODE POINTS, não bytes. Bulk import deve reusar explicitamente
   `MAX_NAME_BYTES` (ou promover uma validação de bytes comum a todos os caminhos de
   `Requirement.name`) na implementação — registrado como pré-requisito da Fase 3, não como algo
   já coberto por D-191 sozinho.

## 10. Refactors de nível 3-4 incluídos como pré-requisito direto (não decisões Type 1 novas)

- `createDocument()` ganha o `ConditionCheck` de Subject (§5) — muda comportamento externo
  observável (um 404/409 novo em um caso hoje silenciosamente aceito), mas é correção mecânica
  de um gap já existente, pré-requisito direto de C4 da régua.
- `document-archive-service.ts` exporta `buildCreateDocumentEntries`/`buildCreateRequirementEntries`;
  métodos públicos passam a delegar a eles — zero mudança de contrato HTTP.
- `parseCsv()` ganha strip de BOM UTF-8 (bug real preexistente, verificado por leitura direta,
  corrigido por estar no mesmo arquivo que esta fatia já toca).
