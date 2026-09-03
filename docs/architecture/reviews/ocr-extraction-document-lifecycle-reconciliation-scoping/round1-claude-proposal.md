# Round 1 (Claude) — OCR/AI Extraction ↔ Document Lifecycle Reconciliation, Design Proposal

> Phase 2 of the P0.4 divide-and-conquer plan. Phase 1 (scoping) found M7's extraction pipeline
> live and dual-wired against the OLD `document` module, disconnected from the new Document
> Lifecycle (`document-archive`, D-143+). This round investigates the open question Phase 1 left
> unresolved (which upload pipeline is authoritative today) and proposes a reconciliation design.
> Change-risk-scale level: **5-6** (re-keys a live event trigger, redesigns a cross-aggregate OCC
> transaction, defines a new cross-module data-flow contract — Requirement/RequirementTemplate
> have never received AI-derived data before). Protocol `AGENTS.md` §4 applies.

## Pesquisa externa considerada (E-014)

**SIM PARCIAL.**

The specific pattern this decision touches — OCR/document-AI extraction with a
suggested/confirmed human-review loop and confidence scoring — is a pattern well-established
outside this project:

- **AWS Textract + Augmented AI (A2I) "Human Review Workflows"** (docs.aws.amazon.com/textract/latest/dg/a2i-textract.html,
  accessed 2026-09-03): the reference architecture for exactly this shape — a model produces
  candidate field values with confidence scores, values below a confidence threshold (or a
  sampled percentage) are routed to a human reviewer, and the *reviewer's corrected value*, not
  the raw model output, is what downstream systems commit. This project's
  `ExtractedField.state = PENDING_CONFIRMATION|CONFIRMED|REJECTED` +
  `candidateValue` vs `confirmedValue` is structurally the same shape.
- **Hyperscience "Hyperscience Platform" human-in-the-loop documentation**
  (hyperscience.com/platform/human-in-the-loop, accessed 2026-09-03): confirms the same
  three-way pattern — auto-accept above a confidence bar, human review below it, and a
  cross-extractor **agreement/disagreement** signal (multiple models disagreeing forces review
  even above the individual confidence bar). This project's `ExtractionAgreement =
  SINGLE_SOURCE|MATCH|MISMATCH` (`extracted-field.ts:20-23`) mirrors this directly — a MISMATCH
  always routes to `PENDING_CONFIRMATION` regardless of either source's individual confidence.
- **DocuSign Insight / Intelligent Insights** (support.docusign.com, "Extracted data review",
  accessed 2026-09-03) documents the same suggested-vs-confirmed distinction for contract
  metadata extraction, confirming this is not just an AWS-specific idiom but a cross-vendor
  convention for document-AI products generally.

**Representativeness**: these three span (a) the underlying cloud OCR primitive this project
already builds on (Textract/A2I), (b) a specialized document-intelligence platform vendor
(Hyperscience), and (c) a contract-lifecycle-adjacent product (DocuSign) — reducing single-vendor
bias for the specific claim "suggested value + confidence + human confirm/reject is the
established shape," which is the part of this decision informed by external pattern.

**Escopo (why PARCIAL, not SIM)**: the *human-review-loop shape itself* (state machine,
confidence/agreement semantics, suggested-vs-confirmed distinction) is already correctly built in
this codebase (`extracted-field.ts`, `confirm-reject-field.ts`) and is **not being redesigned by
this round** — it is retained as-is. What this round actually decides is internal: which
DynamoDB aggregates the OCC transaction touches, which S3 key format triggers extraction, and how
extracted values flow into `Requirement`/`RequirementTemplate`. No external pattern answers "does
`DocumentFile` or `DocumentVersion` own the S3 object reference in this specific schema" — that
depends only on this project's own D-143/D-163 key design, already fixed by prior decisions this
round does not reopen. The checklist below is scoped only to the SIM-PARCIAL part.

### Checklist de critérios de nota (sub-rubrica desta decisão)

1. **(peso 30%) Preserva o mecanismo de revisão humana existente sem redesenhar sua semântica.**
   Atende: `PENDING_CONFIRMATION`/`CONFIRMED`/`REJECTED`, `confidence`, `sources`, `agreement`,
   `candidateValue`/`confirmedValue` continuam exatamente como estão — a proposta só muda QUE
   agregados a transação de confirmação toca, nunca a máquina de estados do campo em si. Não
   atende: qualquer redesign do vocabulário SUGGESTED/CONFIRMED ou de `ExtractionAgreement`.
2. **(peso 25%) Nunca perde a garantia MISMATCH-sempre-revisão.** Atende: a proposta não introduz
   nenhum caminho que auto-confirme um campo com `agreement = MISMATCH`. Não atende: qualquer
   atalho que resolva mismatch automaticamente para reduzir carga operacional.
3. **(peso 25%) O valor que chega em `Requirement`/`DocumentVersion` é sempre o `confirmedValue`
   humano, nunca o `candidateValue` bruto do modelo.** Atende: o fluxo de escrita em
   `Requirement.evidenceValidUntil`/`DocumentVersion.validUntil` só é alcançável a partir de
   `confirmField`, nunca de `startOcr`/`run-bedrock-extraction`/`run-deterministic-parser`
   diretamente. Não atende: qualquer caminho que grave um `candidateValue` não confirmado num
   campo de negócio real.
4. **(peso 20%) Confiança/proveniência continuam auditáveis fim a fim** (qual fonte, qual
   confiança, quem confirmou, quando) mesmo depois da re-chave para os novos agregados. Atende:
   nenhum campo de proveniência existente é descartado na migração. Não atende: perda de
   `sources`/`confidence`/`agreement` ao trocar `Document`(old) por `DocumentFile`/`DocumentVersion`.

## Achado central: qual pipeline é autoritativo hoje em `dev`

**O módulo `document` (antigo) é o único pipeline ponta-a-ponta funcional hoje. `document-archive`
recebe tráfego HTTP real (ambos os handlers estão montados e roteáveis), mas seu próprio
mecanismo de promoção quarentena→clean está incompleto em produção — arquivos enviados por ele
nunca saem de `SCANNING`.** Não é um caso de "rename in place"; é migrar um trigger vivo mais
completar um sub-sistema que ficou pela metade.

Evidência (leitura direta, não inferência):

1. **Ambos os handlers HTTP estão live.** `infra/main.tf:370-402` (`document_archive_handler`,
   `document_archive_guest_handler`) e `infra/main.tf:1122-1165` (`documents_handler`,
   `guest_documents_handler`) são todos módulos `lambda-function` reais, montados no mesmo API
   Gateway (`infra/main.tf:432-443` passa os quatro ARNs de invocação ao roteador). Um comentário
   pré-existente confirma tráfego real do lado antigo: `infra/main.tf:916` — *"`documents_handler`
   (real traffic already)"*.
2. **Os dois módulos escrevem no MESMO par de buckets quarentena/clean**
   (`module.document_buckets`), mas com formatos de chave deliberadamente diferentes e
   namespaced para nunca colidir: o antigo usa `tenant/<t>/item/<i>/document/<d>/slot/<s>/<random>`
   (comentário em `document-archive-service.ts:567-571`, citando a convenção do M6); o novo usa
   `document-archive/tenant/<t>/document/<d>/version/<s>/file/<f>`
   (`document-archive-service.ts:572-574`, cujo próprio comentário já registra: *"the S3 event
   handler routes on this prefix to pick the right parser (D-163 §7, **deferred**)"*).
3. **O único handler real de resultado de scan de malware (`malware-result-handler.ts`,
   `infra/main.tf:1331-1353`, fila real `malware_result_queue`) só reconhece DOIS formatos de
   chave de quarentena**: `parseQuarantineKey` (módulo `document` antigo) e
   `parseSubmissionQuarantineKey` (módulo `subject`) — `malware-result-handler.ts:8,11,59,75`. Se
   nenhum dos dois casar, o handler loga `"malware-result unrecognized key shape"` e retorna sem
   nunca chamar `applyFileScanResult`/`confirmFileScanClean` (`malware-result-handler.ts:75-79`) —
   **e sem empurrar o item para `batchItemFailures`, então a SQS o trata como processado com
   sucesso e o descarta.** O prefixo `document-archive/...` nunca é reconhecido por este handler.
4. **`applyFileScanResult`/`confirmFileScanClean` (`document-archive/application/apply-file-scan-result.ts`)
   existem no código do módulo novo mas não têm NENHUM call site em `src/runtime/aws/handlers/**`**
   (grep confirmado, zero ocorrências) — a doc-comment de `confirmFileScanClean`
   (linhas 203-210) já registra isso explicitamente: *"called only once the caller (**a future
   S3/GuardDuty event worker, out of scope for this slice**) has already copied `sourceObject` to
   `cleanObject`"*. Esse worker nunca foi construído.
5. Consequência: um arquivo enviado hoje via `document-archive` fica preso em
   `scanStatus = PENDING_UPLOAD`/`SCANNING` para sempre (até o `document_file_reconciliation_handler`
   — `infra/main.tf:1453-1511` — eventualmente marcar `TIMEOUT` pelo reconciliador GSI8), nunca
   chega a `CLEAN`, nunca é copiado para o clean bucket, e portanto nunca poderia disparar
   extração mesmo que o trigger `clean_object_created` (`infra/main.tf:1964-1983`) já entendesse
   seu formato de chave (não entende — `parseCleanKey`, usado só por
   `extraction-starter-handler.ts:9,42`, casa apenas `clean/<t>/<i>/<d>` de 3 segmentos, o que o
   caminho `document-archive/tenant/.../file/...` de 4 pares nunca produziria mesmo se fosse
   copiado literalmente).

**Conclusão**: `document` (antigo) é autoritativo para tráfego real de upload em `dev` hoje — é o
único caminho que completa o ciclo upload→quarentena→scan→clean. `document-archive` está montado,
recebe requisições HTTP (criação de `Document`/`DocumentVersion`/reserva de `DocumentFile`,
geração de presigned URL), mas nenhum arquivo enviado por ele jamais termina de ser processado —
não porque D-163-D-168 tenham removido algo do antigo, mas porque a metade final do novo pipeline
(promoção quarentena→clean) nunca foi implementada. Isso é maior que uma lacuna de re-chaveamento
de extração: é uma lacuna de produto pré-existente que este item de trabalho tropeça, não causa.

## Escopo desta decisão (o que ESTE protocolo decide, não a implementação completa do gap acima)

Fechar o gap #5 acima (`WorkerPromoteDocumentArchiveFile`, quarentena→clean para
`document-archive`) É pré-requisito físico para qualquer re-chaveamento de extração — sem isso
não existe evento "clean" para o `document-archive` disparar. Duas opções:

**Opção A (proposta)**: construir o worker de promoção que falta, then re-key extraction contra
`DocumentFile`/`DocumentVersion`. Um único item de trabalho maior, sequenciado internamente.

**Opção B**: reconciliar extração deixando-a acoplada ao módulo antigo por mais um milestone,
tratando o gap de promoção do `document-archive` como item de backlog separado e não-relacionado.

Proponho **Opção A** — não porque a promoção pendente seja no escopo original do P0.4, mas porque
tratar extração como "resolvida" enquanto ela continua lendo o módulo `document` cujo próprio
ciclo de vida (`Document.status` ACTIVE/ARCHIVED sem estado de revisão real,
`advance-after-evidence.ts`) já foi suplantado conceitualmente por `DocumentVersion`/`Requirement`
produziria uma segunda dívida de reconciliação idêntica a esta assim que o worker de promoção for
finalmente construído por outro item de trabalho. Re-chavear uma vez, contra o alvo certo, é mais
barato que re-chavear duas vezes.

### 1. Trigger de extração — de `Document`(antigo) para `DocumentFile`/`DocumentVersion`

- Novo worker `document-archive-file-promoter` (SQS, alimentado pelo `malware_result_handler`
  existente — adicionar reconhecimento do prefixo `document-archive/` ao lado dos dois já
  existentes, roteando para `applyFileScanResult`/`confirmFileScanClean` em vez de
  `processMalwareResult`). Ao promover, grava em uma NOVA convenção de clean key,
  `document-archive/clean/<tenantId>/<documentId>/<seq>/<fileId>`, e emite `S3 Object Created`
  no clean bucket como hoje.
- Novo `parseDocumentArchiveCleanKey` (mesmo padrão de `clean-key.ts`, arquivo próprio em
  `document-archive/domain/`, nunca reaproveitando `parseCleanKey` do módulo antigo — os dois
  formatos coexistem permanentemente, um por módulo, até o antigo ser desligado).
- `extraction-starter-handler.ts` passa a tentar `parseDocumentArchiveCleanKey` PRIMEIRO,
  fallback para `parseCleanKey` (antigo) — os dois pipelines continuam coexistindo durante a
  transição, nenhum removido nesta rodada (D-190/D-191 já estabeleceram o padrão de migração
  progressiva por GSI, aplico o mesmo princípio: o trigger novo primeiro, desligamento do antigo
  como item de trabalho subsequente, não parte desta decisão).
- `startExtractionRun` passa a aceitar `{tenantId, documentId, seq, fileId}` em vez de
  `{tenantId, itemId, documentId}` — `ExtractionRun`/`ExtractedField` já são chaveados só por
  `documentId` (`TENANT#t#DOC#d`), então o `documentId` do `document-archive` (que já é
  globalmente único por Document, não por-item como o antigo) substitui o antigo sem mudar o
  formato de chave do `ExtractionRun` em si — apenas a fonte do valor.

### 2. Transação OCC de confirmação — de 4-way (`ExpirationItem`/`Document`/`ExtractionRun`/`ExtractedField`) para `DocumentVersion`/`ExtractionRun`/`ExtractedField` (3-way) + `Requirement` condicional (4-way só quando aplicável)

- `Document`(old)/`ExpirationItem` saem da transação de confirmação. `DocumentVersion` entra no
  lugar de `Document`(old) — é o agregado que hoje carrega `validUntil` e é o alvo natural de
  "este campo extraído é uma data de validade".
- Diferente do antigo (`ExpirationItem` sempre presente), nem toda `ExtractedField` confirmada
  tem uma `Requirement` esperando o valor — só campos cujo `fieldName` mapeia para "data de
  validade" (`field-schema.ts` já distingue tipos de campo) precisam propagar a um `Requirement`.
  Proponho uma variante do 3-way base + `Requirement` condicional (4-way só quando o campo
  confirmado for do tipo validade E a `DocumentVersion` correspondente estiver linkada como
  evidência de pelo menos um `Requirement` ativo) — mantendo o princípio já estabelecido em
  `confirm-reject-field.ts`'s doc comment ("reject nunca toca ExpirationItem") mas generalizado:
  a transação sempre atualiza `DocumentVersion`, e condicionalmente atualiza o(s) `Requirement`(s)
  cujo `evidenceVersionId` aponta para essa versão — reusando a MESMA função `linkEvidence`'s
  cache-refresh interno (`document-archive-service.ts:1056-1060`) para nunca duplicar a lógica de
  derivação de status.
- Isto é uma mudança de FORMA em relação ao 4-way fixo antigo (agora é "3-way sempre + N
  Requirements condicionais", não um número fixo) — decisão explícita a submeter à crítica do
  Codex, não um detalhe implícito.

### 3. `document-classifier.ts` — achado que corrige o enquadramento da Fase 1

`document-classifier.ts` **não é** um classificador de tipo de documento de negócio (não decide
"isto é uma CNH" vs "isto é uma Apólice") — é um classificador de FORMATO de arquivo para escolher
a chamada correta do Textract (PDF/JPEG/PNG/TIFF, `document-classifier.ts:14`). A Fase 1 leu o
nome do arquivo e presumiu uma conexão com `DocumentType.documentTypeId` (D-176) que a
implementação real não sustenta — não existe hoje NENHUM classificador de tipo de documento de
negócio na extração, sugerido por IA ou não. Proponho **não** inventar um nesta rodada (fora do
escopo do P0.4 conforme lido — P0.4 é sobre extração de dados de validade, não sobre
auto-categorização de tipo de documento) e apenas corrigir a lacuna de nomenclatura: renomear
`document-classifier.ts` para `document-format-classifier.ts` (rename mecânico, nível 1-2, não
precisa do protocolo) para que a próxima sessão não repita o mesmo engano de leitura.

### 4. Fluxo de dados de validade — de `ExpirationItem` para `DocumentVersion.validUntil` (e daí, automaticamente, `Requirement`)

- Novo caminho: `confirmField` (quando o campo é do tipo "validade") grava
  `DocumentVersion.validUntil` diretamente (nova operação, não existe hoje um setter pós-criação
  — `validUntil` hoje só é setado na criação da Version). Uma vez setado, QUALQUER `Requirement`
  já linkado a essa versão via `evidenceVersionId` precisa ter seu `evidenceValidUntil`/`status`
  recalculados na MESMA transação (reusando `deriveRequirementStatus`, puro, já testável) — nunca
  como uma segunda escrita fire-and-forget.
- `RequirementTemplate` (D-191) não recebe nada de extração diretamente — ele já é só um molde
  aplicado uma vez (`applyTemplate`, snapshot). Não há "valor extraído" que se aplique a um
  template; a Fase 1 provavelmente quis dizer "Requirement", que é o que este item #4 já cobre.

## Fora de escopo desta rodada (explícito, para a crítica do Codex focar no que importa)

- Desligar o módulo `document` antigo (D-190/D-191 style de migração progressiva — item de
  trabalho subsequente, quando confiança suficiente existir).
- Qualquer classificador de tipo de documento de negócio por IA.
- Mudar a UX/HTTP de `document-archive` além do necessário para receber o resultado de extração.
- Migrar dados já extraídos contra o módulo antigo (dev não tem usuário real, `AGENTS.md` §1 —
  não é um requisito de migração de dados, é um requisito de qual pipeline NOVO tráfego usa).
