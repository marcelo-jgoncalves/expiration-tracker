# Estado Final Consolidado — D-193: Reconciliação OCR/Extração ↔ Document Lifecycle (Design)

**Status: `APPROVED` via protocolo Claude↔Codex (`AGENTS.md` §4), 5 rodadas, nota cega cada
rodada: Rodada 1 Codex 5.6 / Claude 5.8 → Rodada 2 Codex 7.8 / Claude 7.6 → Rodada 3 Codex 8.7 /
Claude 8.5 → Rodada 4 Codex 8.8 / Claude 8.6 → Rodada 5 Codex 9.4 / Claude 9.2 (fechamento, ambos
≥9,0, sem arredondar).** Design-only — **nenhuma implementação foi feita nesta fase**. Evidência
completa: `docs/architecture/reviews/ocr-extraction-document-lifecycle-reconciliation-scoping/`
(round1-5, `-claude-`/`-codex-` proposta/crítica cada).

## Origem

Fase 2 do plano de divide-and-conquer do item de roadmap P0.4 (IA/OCR integrada ao Document
Lifecycle). Fase 1 (escopo) encontrou o pipeline de extração/OCR do M7 vivo e dual-wired ao lado
do novo Document Lifecycle, mas travado contra o módulo `document` antigo em vez de
`document-archive` (D-143+), e recomendou nível 5-6 de `change-risk-scale.md`.

## Pesquisa externa (E-014)

**SIM PARCIAL.** O mecanismo de revisão humana com confiança/sugestão/confirmação
(`ExtractedField`'s `PENDING_CONFIRMATION`/`CONFIRMED`/`REJECTED` + `candidateValue`/
`confirmedValue`) já é um padrão estabelecido fora deste projeto (AWS Textract + Augmented AI
Human Review Workflows, Hyperscience Platform human-in-the-loop, DocuSign Insight — fontes citadas
com data em `round1-claude-proposal.md`) e **não foi redesenhado** por esta decisão — permanece
exatamente como está. O que esta decisão de fato decidiu (identidade de agregados, chave S3,
transação OCC, convergência assíncrona) é interno a este projeto; nenhuma pesquisa externa
resolveria essas escolhas. Codex confirmou (Rodada 1) que a pesquisa citada é periférica à
decisão real e não a contestou como incorreta, só como mal-aplicada como régua de nota — a régua
real usada nas Rodadas 3-5 foi reponderada em propriedades de resultado (ver checklist final
abaixo), não na pesquisa human-in-the-loop em si.

## Achado central: pipeline autoritativo hoje em `dev` (verificado por leitura direta do código)

Três conceitos, mantidos separados (achado de correção da Rodada 2, aceito pelo Codex na Rodada
3): (1) **pipeline fisicamente completo** — só o módulo `document` antigo. Confirmado dos dois
lados da correlação simétrica de scan: `upload-finalizer-handler.ts` e `malware-result-handler.ts`
só reconhecem `parseQuarantineKey` (antigo) e `parseSubmissionQuarantineKey` (subject) — uma
chave `document-archive/tenant/...` (produzida por `document-archive-service.ts`'s
`buildQuarantineKey`) nunca é reconhecida por nenhum dos dois, e é descartada definitivamente sem
retry/DLQ (log de erro, sem `batchItemFailures`). `applyFileScanResult`/`confirmFileScanClean`
(`document-archive/application/apply-file-scan-result.ts`) existem no código mas não têm NENHUM
call site em `src/runtime/aws/handlers/**` — um arquivo enviado via `document-archive` fica preso
em `PENDING_UPLOAD`, nunca chega a `CLEAN`. (2) **API que recebe tráfego HTTP** — ambos os
handlers (`documents_handler`, `document_archive_handler`) estão deployados e roteáveis
(`infra/main.tf`); Terraform prova deploy, não volume real, hipótese retirada explicitamente na
Rodada 2. (3) **autoridade conceitual futura** — `document-archive`/`DocumentVersion`/`Requirement`,
nunca em disputa (D-143 já é a arquitetura aprovada).

## Correção ao enquadramento da Fase 1

`extraction/domain/document-classifier.ts` **não é** um classificador de tipo de documento de
negócio ligado a `DocumentType.documentTypeId` (D-176) — é um classificador de FORMATO físico de
arquivo (PDF/JPEG/PNG/TIFF, por magic bytes/extensão/content-type) para escolher a chamada certa
do Textract. Não existe hoje nenhum classificador de tipo de documento de negócio por IA neste
projeto. Fora de escopo desta decisão (renomear para `document-format-classifier.ts` é trabalho
mecânico nível 1-2, não decisão de protocolo).

## Design final aprovado (resumo — histórico rodada-a-rodada tem o raciocínio completo)

### Sequenciamento (Opção C, não "Opção A" da Rodada 1)
Contrato/identidade desenhados agora; implementação da extração re-chaveada e da ingestão física
(upload-finalizer + malware-result + promoção) são fatias independentes; ativação por DOIS feature
flags em ORDEM obrigatória — starter novo primeiro (`EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED`),
promoter depois (`DOCUMENT_ARCHIVE_PROMOTION_ENABLED`) — nunca a ordem inversa, fecha por
construção a janela "CLEAN sem consumidor".

### Ingestão física
`upload-finalizer-handler.ts` e `malware-result-handler.ts` ganham um TERCEIRO branch cada
(`parseDocumentArchiveQuarantineKey`/mesmo prefixo), chamando `applyFileScanResult`/
`confirmFileScanClean` com um `TransactConditionCheckEntry` de tenant ACTIVE explícito adicionado
à assinatura dessas duas funções (nunca "herdado"). Promoção concorrente entre os dois branches é
aceita como segura por idempotência (chave de destino determinística, `CopyObject` redundante
inofensivo, `confirmFileScanClean`'s OCC já é o único portão real), não por exclusão mútua.

### Chave clean e identidade
`document-archive/clean/<tenantId>/<documentId>/<versionId>/<fileId>` (versionId imutável, não
`seq`). `ExtractionRun` re-chaveado por `{tenantId, documentId, versionId}` (nunca mais `itemId`
nem o campo ambíguo `documentVersion: number`), identidade determinística preservando a disciplina
existente de `startExtractionRun` (Put condicional + `StartExecution` sempre chamado com nome
determinístico, inclusive em retry). Só o arquivo `PRINCIPAL` de um `DocumentFile` dispara OCR
(decisão de produto explícita, provisória, revisável).

### Starter — nunca confia só na chave do evento S3
Sempre relê `DocumentFile` fresco: `scanStatus === CLEAN`, `cleanObject` bate exatamente,
`role === PRINCIPAL`, `DocumentVersion` em estado elegível (`RECEIVED`/`UNDER_REVIEW`/`ACCEPTED`).

### Transação de confirmação — cardinalidade fixa, Requirement nunca dentro dela
`confirmField`: 3 agregados / 4 ações (`DocumentVersion` Update, `ExtractionRun` ConditionCheck,
`ExtractedField` Update, `Outbox` Put — só quando há mudança real de `validUntil`).
`rejectField`: 2 agregados / 2 ações, nunca toca `DocumentVersion`. Um planner puro compartilhado,
`planDocumentVersionValidityEffect`, decide estados elegíveis/no-op/proveniência
(`confirmedBy`/`confirmedAt`, campos novos em `ExtractedField`) para os DOIS caminhos — confirmação
manual (`doConfirmField`) E auto-confirmação (`commitRunOutcome`, `run-extraction-validation.ts`)
— fechando a contradição real que a Rodada 1 tinha com o código existente.

### Convergência de `Requirement` — assíncrona, nunca fan-out síncrono
`DocumentVersion.validUntil` muda → outbox (`OutboxDestination = "SQS_REQUIREMENT_EVIDENCE_REFRESH_V1"`,
nova fila via `DispatchOutboxRelay`, mesmo padrão de `SQS_IMPORT_PARSE_V1`/D-192) → worker
`requirement-evidence-refresh-handler`, que NUNCA aplica o payload do evento — sempre relê
`DocumentVersion`+`Requirement` frescos via um novo índice reverso esparso `GSI_EVIDENCE`
(`TENANT#t#DOCVERSION#<versionId>` → `REQUIREMENT#<requirementId>`, escrito/removido dentro de
`linkEvidence`/`unlinkEvidence`), re-deriva um Requirement por vez com seu próprio loop OCC — evento
é só um "wake up", nunca um portador de valor, fechando o risco de ordem/perda. Isto explicitamente
anda sobre o bounded-staleness que `requirement.ts` já aceita para `DocumentVersion` mudando após o
link, só encurtando a janela.

### Rede de reparo autoritativa (fechamento final, Rodada 5)
Novo método `scanRequirementsWithEvidence` em `DocumentArchiveStore` — `Scan` cross-tenant
filtrado a `entityType=Requirement AND attribute_exists(evidenceVersionId)`, mesmo precedente já
aceito no módulo (`scanActiveSeries`, para o mesmo problema "nenhum método de enumeração de
tenant"). Um worker diário agendado (`requirement-evidence-daily-sweep`) pagina esse scan e apenas
REENFILEIRA cada candidato na MESMA fila do worker de refresh — nunca escreve `Requirement`
diretamente, colapsando o caminho de escrita a um único lugar. Independente de status cacheado
(cobre `SATISFIED`/`PENDING`/`NOT_SATISFIED` e qualquer transição futura), fecha o teto de
staleness em até 24h mesmo sob perda total do evento/outbox. IAM: `dynamodb:Scan` +
`sqs:SendMessage` (sweep); `sqs:Receive/Delete` + `dynamodb:GetItem`(DocumentVersion) +
`dynamodb:Query`(GSI_EVIDENCE) + `dynamodb:GetItem` + `dynamodb:TransactWriteItems` (refresh —
nunca `UpdateItem` standalone, corrigido na Rodada 5 para bater com o mecanismo real de
`buildVersionedUpdate`/`store.transactWrite()`).

## Checklist final de critérios (E-014, versão consolidada após reconciliação nas Rodadas 3-5)

1. (25%) Convergência de `Requirement`/`validUntil` bounded e demonstrável sob duplicação, perda,
   reordenação, relink — não "eventualmente, sem prazo".
2. (25%) Nenhuma extração inicia a partir de objeto S3 não autoritativo.
3. (20%) Cardinalidade de toda transação nomeada é fixa, independente de N.
4. (15%) Política multi-arquivo explícita e revisável, nunca omissão.
5. (10%) Caminho automático e humano produzem o mesmo efeito por construção (planner único).
6. (5%) Proveniência (`confirmedBy`/`confirmedAt`) sempre presente, nunca inferida.

## Escopo explicitamente fora desta decisão

Desligar o módulo `document` antigo; qualquer classificador de tipo de documento de negócio por
IA; mudar UX/HTTP de `document-archive` além do necessário; migrar dados já extraídos contra o
módulo antigo (sem usuário real em `dev`, não é requisito).

## Próxima fase (implementação) — escopo preciso

Trabalho de nível 3-4 (implementação de decisão já aprovada) salvo onde uma escolha real de
engenharia não prevista pelo design apareça (documentar em `NEXT_SESSION_PROMPT.md`/
`session-log.md`, `change-risk-scale.md` nível 4 no máximo — o protocolo §4 já rodou para as
decisões estruturais):

1. `document-archive/domain/document-archive-quarantine-key.ts` (novo parser) +
   `document-archive-clean-key.ts` (novo parser, versionId-based).
2. Terceiro branch em `upload-finalizer-handler.ts`/`malware-result-handler.ts` +
   `TransactConditionCheckEntry` de tenant ACTIVE adicionado a `applyFileScanResult`/
   `confirmFileScanClean`.
3. Re-chaveamento de `ExtractionRun`/`extraction-starter-handler.ts` para
   `{tenantId, documentId, versionId}`, com as 5 precondições de starter (item "Starter" acima).
4. `planDocumentVersionValidityEffect` (novo, `extraction/domain/`) + integração em
   `doConfirmField`/`commitRunOutcome`; campos `confirmedBy`/`confirmedAt` em `ExtractedField`;
   transação de `confirmField` (3-way/4-ação) e `rejectField` (2-way/2-ação) re-chaveadas.
5. `GSI_EVIDENCE` (novo índice esparso) + `linkEvidence`/`unlinkEvidence` passam a escrevê-lo.
6. Novo `OutboxDestination`, fila `requirement-evidence-refresh-queue` + DLQ, rota no
   `DispatchOutboxRelay`, handler `requirement-evidence-refresh-handler.ts`.
7. `scanRequirementsWithEvidence` em `DocumentArchiveStore` + worker agendado
   `requirement-evidence-daily-sweep` (EventBridge Scheduler, mesmo padrão de
   `document_file_reconciliation_handler`).
8. Dois feature flags (`EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED`,
   `DOCUMENT_ARCHIVE_PROMOTION_ENABLED`) + ordem de ativação obrigatória em runbook de deploy.
9. Rename mecânico `document-classifier.ts` → `document-format-classifier.ts` (nível 1-2, pode
   ser feito a qualquer momento, sem protocolo).

Cada item acima é testável isoladamente (unit + contract, mesmo padrão do resto do projeto);
nenhum exige uma segunda rodada de protocolo Claude↔Codex a menos que a implementação revele uma
divergência real do design aqui registrado.
