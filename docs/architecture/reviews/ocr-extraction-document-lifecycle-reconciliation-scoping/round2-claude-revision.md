# Round 2 (Claude) — Revision

**Claude's own blind score for Round 1 (recorded now that Codex's Round 1 score exists): 5.8/10.**
I agree with the substance of the critique: the authoritative-pipeline finding conflated three
distinct claims, Option A was unjustified scope creep, and the "3+N Requirements" transaction was
not sound (open cardinality, phantom race, no reverse index, ignored the existing auto-confirm
path). Every point below is addressed on the merits, not to chase a number.

## 1. Achado central — reescrito, três conceitos separados

Corrigindo o excesso apontado: "autoritativo" tinha três sentidos diferentes na Rodada 1, e o
código só sustenta o primeiro.

- **Pipeline fisicamente completo hoje**: só o módulo `document` (antigo). Confirmado agora dos
  dois lados da correlação simétrica, não só do lado de malware result — **achado novo desta
  rodada**: `upload-finalizer-handler.ts` (o consumidor do evento de upload finalizado, o outro
  sinal físico que `apply-file-scan-result.ts`'s correlação exige) reconhece apenas
  `parseQuarantineKey` (antigo) e `parseSubmissionQuarantineKey` (subject) — o mesmo buraco do
  `malware-result-handler.ts`, no sinal oposto. Um arquivo enviado via `document-archive` fica
  preso em `PENDING_UPLOAD` (nunca chega a `SCANNING`), não só em `SCANNING` como a Rodada 1
  disse — pior do que eu tinha reportado.
- **API que recebe tráfego HTTP**: ambos os handlers estão deployados e roteáveis
  (`infra/main.tf`). Retiro a afirmação de "tráfego real" para `document_archive_handler` — não
  verificável a partir de Terraform/comentário histórico, só CloudWatch real (fora do escopo
  desta rodada de design). Mantenho, sem enfraquecer, que `documents_handler` tem o comentário
  histórico citando tráfego real — é evidência de uso passado do antigo, não prova de ausência de
  uso do novo.
- **Autoridade conceitual futura**: `document-archive`/`DocumentVersion`/`Requirement` — nunca
  esteve em disputa; D-143 já é a arquitetura aprovada, este documento não a reabre.

**Conclusão corrigida (adotada)**: o módulo antigo é hoje o único pipeline fisicamente completo
no código implantável, nos dois lados da correlação (upload finalizer E malware result).
`document-archive` é o modelo de domínio aprovado, com entrada HTTP/presign real, mas sem NENHUM
consumidor físico real para nenhum dos dois sinais que sua própria correlação de evidência exige.

## 2. Opção C adotada — sequenciamento, não escopo indivisível

Abandono a falsa dicotomia A/B da Rodada 1. Adoto a **Opção C do Codex** como a decisão desta
rodada:

1. Esta rodada decide a identidade/contrato de extração contra `DocumentVersion`/`DocumentFile`
   (seções 3-6 abaixo) e o contrato do evento clean + precondições de validação no starter.
2. A implementação da extração re-chaveada é construída e testada contra esse contrato, mas o
   trigger real (`clean_object_created` reconhecendo o novo prefixo) fica **desligado por feature
   flag** (mesmo mecanismo já usado por `extraction_pipeline_enabled` em `infra/main.tf:1965`,
   `1979`, `1986` — um segundo flag, não um mecanismo novo) até a fatia #2 existir.
2'. A fatia de ingestão física (upload-finalizer + malware-result + promoção, item 3 abaixo) é
   implementada e testada independentemente.
3. O flag do trigger novo só é ligado quando ambas as fatias estão prontas e verificadas em
   `dev`.

Isso não exige re-key duas vezes — a extração é desenhada uma vez contra o alvo certo.

## 3. Arquitetura do promoter — sem worker/fila novos, estendendo os dois handlers existentes

Rejeito a "nova fila SQS" da Rodada 1 (a crítica está certa: nebulosa, duplicava lógica). Em vez
disso, mesma forma que o módulo `subject` já usa para coexistir com o módulo `document` no MESMO
par de handlers (`malware-result-handler.ts` já ramifica em `parseQuarantineKey` vs
`parseSubmissionQuarantineKey` — dois branches, um handler, duas filas de origem já existentes
reaproveitadas):

- **`upload-finalizer-handler.ts`**: adicionar um terceiro branch, `parseDocumentArchiveQuarantineKey`
  (novo parser, mesmo estilo de `quarantine-key.ts`), chamando `applyFileScanResult` com
  `uploadEvidence` preenchido (em vez do `processMalwareResult`/`processSubmissionMalwareResult`
  do módulo antigo/subject) — reaproveita a MESMA fila `upload_finalizer_queue`/EventBridge rule
  já cabeada ao bucket de quarentena inteiro (`infra/main.tf:1027-1048`, não filtra por prefixo),
  só adiciona uma terceira ramificação de parsing no handler que já a consome.
- **`malware-result-handler.ts`**: mesmo padrão, terceiro branch chamando `applyFileScanResult`
  com `malwareEvidence` preenchido.
- **Quem copia quarentena→clean e chama `confirmFileScanClean`**: o MESMO handler cujo branch
  produziu `outcome: "READY_TO_PROMOTE"` faz o `CopyObject` (quarantine→clean, verificação de
  tamanho/checksum, mesma disciplina de `advance-after-evidence.ts`) e só então chama
  `confirmFileScanClean` — nunca os dois branches (upload-finalizer e malware-result) competindo
  para promover o mesmo arquivo, porque `applyFileScanResult` já é o único ponto de decisão
  (`decision.action === "PROMOTE"` só é alcançado depois que AMBAS as evidências consolidaram,
  não importa qual handler entregou a segunda — `apply-file-scan-result.ts`'s doc comment já
  garante isso, reaproveitado sem mudança).
- **Retry/DLQ/ownership**: idênticos aos que já existem para o branch antigo nos mesmos dois
  handlers — nenhum mecanismo novo, só um terceiro `if (parsed) { ... }` ao lado dos dois já
  existentes em cada handler.
- **Limpeza do objeto de quarentena**: fora de escopo desta rodada — o módulo antigo também não
  limpa o objeto de quarentena após promoção (`advance-after-evidence.ts` não faz
  `DeleteObject`), então esta rodada mantém paridade comportamental, não introduz uma lacuna
  nova.
- **Tenant lifecycle fence**: reaproveita o fence que `processMalwareResult`/`processSubmissionMalwareResult`
  já aplicam antes de escrever (checagem de tenant ACTIVE) — o novo branch chama a mesma
  checagem, nunca pula essa etapa.

## 4. Chave clean — versionId, não seq (correção do achado)

Corrigindo a Rodada 1: a nova convenção usa o `versionId` imutável de `DocumentVersion`, nunca o
`seq` mutável-por-natureza-de-índice: `document-archive/clean/<tenantId>/<documentId>/<versionId>/<fileId>`.
`versionId` já existe como identificador estável e imutável de uma `DocumentVersion`
(`document-version.ts`), evitando o problema apontado pelo Codex de reindexação sob retry/GSI. O
novo parser (`parseDocumentArchiveCleanKey`, ao lado do já existente `parseCleanKey` do módulo
antigo — os dois formatos coexistem, nenhum removido nesta rodada) devolve
`{tenantId, documentId, versionId, fileId}`.

## 5. Starter — o evento S3 nunca é confiado sozinho

Corrigindo o achado do Codex (evento clean pode chegar antes/fora de ordem do commit
`confirmFileScanClean`): `extraction-starter-handler.ts`, ao reconhecer o novo prefixo, SEMPRE
re-lê `DocumentFile` fresco (nunca confia só na chave do evento S3) e só prossegue se TODAS as
condições valem:

1. `file.scanStatus === "CLEAN"`;
2. `file.cleanObject` bate exatamente (bucket/key/versionId) com o objeto observado pelo evento
   S3 — mesma disciplina de correlação simétrica que `apply-file-scan-result.ts` já usa entre
   evidências;
3. `file.role === "PRINCIPAL"` (política decidida no item 6 abaixo — anexos nunca disparam OCR
   nesta fase);
4. a `DocumentVersion` correspondente está em um estado elegível: `RECEIVED` ou `UNDER_REVIEW`
   (nunca `WITHDRAWN`/`REJECTED`/`SUPERSEDED` — se a versão já saiu de consideração entre a
   promoção física e este evento, a extração é descartada como `IGNORED_STALE`, mesmo vocabulário
   que `applyFileScanResult` já usa). `ACCEPTED` também é elegível (evidência já aceita pode
   ainda precisar de extração de campos de validade que a revisão humana não preencheu).

Uma falha em qualquer condição é um `IGNORED_STALE`/log, nunca uma tentativa de iniciar extração
sobre um objeto órfão.

## 6. Multi-arquivo — só PRINCIPAL dispara OCR (decisão explícita, não default acidental)

`DocumentFile` permite um `PRINCIPAL` e anexos (`document-file.ts`). Decisão explícita desta
rodada: **só a promoção do arquivo `PRINCIPAL` gera um `ExtractionRun`.** Anexos promovidos nunca
disparam extração nesta fase — decisão de produto deliberadamente conservadora (anexos
tipicamente são material de apoio, não o documento cujo campo de validade importa), registrada
aqui como escopo explícito, revisável por um item de trabalho futuro caso o produto precise de
extração multi-arquivo. Isso elimina inteiramente a corrida "múltiplos arquivos disparando
execuções concorrentes para a mesma Version" apontada pelo Codex — não porque a corrida foi
resolvida por sincronização, mas porque só existe um candidato possível por Version.

## 7. Identidade de `ExtractionRun`/`ExtractedField` — redesenhada, sem ambiguidade

- `ExtractionRun` passa a ser identificado por `{tenantId, documentId, versionId}` — nunca mais
  `itemId` (não existe no novo modelo) nem o campo ambíguo `documentVersion: number` (que hoje
  mistura o conceito de "número de versão OCC do agregado Document" com "qual versão lógica do
  documento" — os dois precisam se separar). `PK = TENANT#t#DOC#d`, `SK = RUN#<versionId>#<runId>`
  — mesmo padrão de particionamento por Document que já existe, só troca o que qualifica a versão
  lógica.
- `ExtractedField` mantém sua chave atual (`extracted-field.ts:51-53`, `PK=TENANT#t#DOC#d`,
  `SK=FIELD#<fieldName>#<runId>`) sem mudança — já não dependia de `itemId`.
- Novos campos em `ExtractedField`: `confirmedBy: string` (o `RequestContext` do ator que
  confirmou/rejeitou — nunca "SYSTEM" para o caminho manual) e `confirmedAt: string`, setados
  junto com `state` na mesma escrita que já seta `state`/`confirmedValue`/`correctionReason` —
  fecha o achado do Codex de que o checklist da Rodada 1 prometia auditabilidade que a entidade
  não sustentava. Caminho de auto-confirmação (item 8) grava `confirmedBy: "SYSTEM_AUTOCONFIRM"`
  explicitamente, nunca omite o campo.

## 8. Auto-confirmação — unificada com o confirm manual via função pura compartilhada

Corrigindo o bloqueante 3.5 do Codex: `run-extraction-validation.ts`/`dynamodb-extracted-field-store.ts`'s
`commitRunOutcome` já escreve o agregado de negócio para campos auto-confirmados hoje — a
proposta da Rodada 1 (só `confirmField` grava valor de negócio) estava errada e contradizia o
código real.

Correção: extrair uma função pura `buildDocumentVersionValidityUpdate(fieldName, confirmedValue,
currentVersionState)` (nova, em `extraction/domain/`, testável sem I/O — mesmo padrão que
`item-field-mapping.ts`'s `buildItemAttributeUpdate` já estabelece) que os DOIS caminhos chamam:

- `doConfirmField` (HTTP, humano) — chama-a com `confirmedBy = ctx.identity`, dentro da mesma
  transação 3-way (item 9).
- `commitRunOutcome` (auto-confirm, `run-extraction-validation.ts`) — chama-a com
  `confirmedBy = "SYSTEM_AUTOCONFIRM"`, dentro da MESMA transação que já escreve `ExtractedField`
  auto-confirmado (nunca uma segunda transação separada).

Os dois caminhos produzem exatamente o mesmo efeito colateral sobre `DocumentVersion` — que campo
foi atualizado, com qual valor — através da mesma função, nunca duas implementações divergentes
(mesmo princípio que `confirm-reject-field.ts`'s doc comment já cita para o `ExpirationItem`
antigo: "os dois caminhos devem produzir efeito de item idêntico").

## 9. Transação de confirmação — 3-way fixo, Requirement NUNCA na mesma transação

Abandono por completo o "3+N Requirements" da Rodada 1 — o Codex está certo de que não fecha
(sem índice reverso, corrida fantasma, teto de 100 ações, cardinalidade aberta). A correção não é
consertar o fan-out síncrono, é removê-lo:

- **`confirmField`**: transação 3-way fixa — `DocumentVersion` (usa a função do item 8),
  `ExtractionRun` (proteção OCC, sem mudança de dado), `ExtractedField` (state→CONFIRMED,
  confirmedValue, confirmedBy, confirmedAt). Exatamente a mesma cardinalidade fixa que a Rodada 1
  já tinha para o 3-way original — só troca `Document`(antigo) por `DocumentVersion`.
- **`rejectField`**: 2-way — `ExtractionRun` (proteção) + `ExtractedField` (state→REJECTED) —
  NUNCA toca `DocumentVersion`, corrigindo a formulação "3 vias sempre" da Rodada 1 apontada como
  excessivamente ampla no achado 3.7. Reject é estritamente mais simples que hoje (era 3-way
  contra `Document` antigo; passa a não precisar nem tocar o agregado de documento, já que rejeitar
  um campo nunca muda `validUntil`).
- **`Requirement` nunca entra em nenhuma dessas transações.** Em vez disso: quando
  `buildDocumentVersionValidityUpdate` produz uma mudança real de `validUntil`, a MESMA transação
  emite um evento outbox (`src/shared/outbox/outbox.ts`, já obrigatório para eventos críticos no
  mesmo `TransactWriteItems` do agregado — `AGENTS.md` §7) `DocumentVersionValidityChanged
  {tenantId, documentId, versionId, validUntil}`.
- Um novo worker leve e idempotente, `requirement-evidence-refresh`, consome esse evento e
  re-deriva CADA `Requirement` vinculado, UM DE CADA VEZ, com seu próprio loop de retry OCC —
  exatamente a mesma disciplina que o worker diário `requirement-reindex` (D-179/D-185) já usa
  para o drift SATISFIED→NOT_SATISFIED por passagem de tempo (`requirement.ts`'s
  `deriveRequirementMaintenanceDue`). Este não é um mecanismo novo de consistência: é o MESMO
  worker de reconciliação assíncrona já aprovado neste projeto, disparado por evento em vez de só
  por agenda diária.
- **Isto não é uma fuga de responsabilidade — é o invariante que `requirement.ts` já declara e
  aceita explicitamente** (linha 68-70 do arquivo: *"a DocumentVersion whose state changes AFTER
  the link ... is caught the next time something re-links or re-derives this Requirement, not
  instantly — the same bounded-staleness window Decision 5 accepts"*). Um `confirmField` que muda
  `validUntil` é exatamente essa classe de evento — a Rodada 1 tentou fechar de forma síncrona uma
  janela que o próprio design de D-143 já aceita como asynchronamente convergente. Esta rodada só
  estreita a janela (evento-disparado, tipicamente segundos, contra "próxima reindexação diária
  ou próximo link/unlink manual").
- **Reverse lookup para o worker encontrar os Requirements de uma Version**: novo índice esparso
  `GSI_EVIDENCE` (nome de infraestrutura a decidir na implementação — não é GSI3/GSI6, não exige
  a exceção de isolamento de `AGENTS.md` §7), escrito/removido transacionalmente DENTRO de
  `linkEvidence`/`unlinkEvidence` (que já escrevem `Requirement` numa transação própria — só
  adicionam um par de atributos ao mesmo item, sem nova escrita separada):
  `GSI_EVIDENCE_PK = TENANT#t#DOCVERSION#<versionId>`, `GSI_EVIDENCE_SK = REQUIREMENT#<requirementId>`.
  Isso resolve 3.1 (índice reverso existe) sem resolver 3.2 (corrida entre a query do worker e um
  `linkEvidence` concorrente) por sincronização — resolve-a por ACEITAÇÃO EXPLÍCITA do mesmo
  bounded-staleness: se C se vincula depois que o worker já leu A/B, C simplesmente lê
  `DocumentVersion.validUntil` já atualizado no momento do seu PRÓPRIO `linkEvidence` (que sempre
  lê a versão corrente, nunca uma cópia cacheada) — C nunca fica desatualizado, é A/B que ficariam
  presos ao valor antigo por um ciclo a mais se o worker corresse ANTES do link de C, cenário
  idêntico ao que o reindex diário já tolera hoje. Nenhuma cardinalidade aberta em nenhuma
  transação — o worker processa Requirements um a um, sem teto de 100 ações porque nunca há uma
  transação com N itens dinâmicos.

## 10. Idempotência — simplificada pela remoção do fan-out síncrono

Com `Requirement` fora da transação, o request hash de `confirmField`/`rejectField` volta a ser
exatamente do mesmo formato de hoje (`confirm-reject-field.ts:102-116`), só trocando
`expectedDocumentVersion` por `expectedDocumentVersionVersion` (a versão OCC de `DocumentVersion`,
nome literal para não colidir com `versionId`) — nenhum campo dinâmico de Requirement entra no
hash, porque nenhuma operação em Requirement acontece dentro desta transação. A janela
commit-then-fail-before-`complete()` já existente (`idempotency.begin`/`transactWrite`/`complete`)
não muda de comportamento — mesmo padrão, mesmo risco residual já aceito pelo código atual, não
introduzido nem agravado por esta rodada.

## 11. Checklist E-014 — reponderado, aceitando a crítica do Codex quase verbatim

Adoto a reponderação do Codex, com pequenos ajustes de âncora explícita:

1. **(peso 25%) Identidade/idempotência corretas por `DocumentVersion`/`DocumentFile`.** Atende:
   `ExtractionRun` chaveado por `versionId` imutável, starter revalida `DocumentFile` fresco antes
   de iniciar, nenhuma ambiguidade `seq` vs `versionId`. Não atende: qualquer identidade que ainda
   dependa de `itemId` ou de um "número de versão" ambíguo.
2. **(peso 25%) `validUntil`/`Requirement` convergem sem fan-out transacional aberto.** Atende: a
   transação de confirmação tem cardinalidade FIXA (3-way ou 2-way), Requirement atualiza via
   worker assíncrono idempotente um-a-um, dentro do bounded-staleness já aceito por D-143. Não
   atende: qualquer transação cujo tamanho dependa do número de Requirements vinculados.
3. **(peso 20%) Trigger seguro contra a corrida S3-copy-antes-de-confirm.** Atende: o starter
   sempre re-lê `DocumentFile` e verifica scanStatus/cleanObject/role/estado da Version antes de
   iniciar um run. Não atende: qualquer caminho que inicie extração só a partir da chave do
   evento S3.
4. **(peso 15%) Semântica multi-arquivo explícita, não acidental.** Atende: só PRINCIPAL dispara
   OCR, decisão registrada como escopo (não uma omissão). Não atende: qualquer ambiguidade sobre
   o que acontece quando múltiplos arquivos de uma Version são promovidos.
5. **(peso 10%) Preserva corretamente auto-confirmação E revisão humana com o MESMO efeito
   colateral.** Atende: `buildDocumentVersionValidityUpdate` compartilhada pelos dois caminhos.
   Não atende: qualquer divergência de efeito entre o path automático e o manual.
6. **(peso 5%) Proveniência auditável de verdade.** Atende: `confirmedBy`/`confirmedAt`
   realmente existem em `ExtractedField` e são sempre preenchidos (inclusive
   `SYSTEM_AUTOCONFIRM`). Não atende: alegar auditabilidade sem o campo persistido.

## Pontos ainda em aberto para a crítica do Codex nesta rodada

- O nome/posicionamento exato do `GSI_EVIDENCE` (qual GSI físico do zero vs slot reaproveitado) —
  deliberadamente deixado como detalhe de implementação, não decisão de protocolo, mas abro para
  o Codex contestar se isso é council-worthy nesta rodada.
- Se `PRINCIPAL`-only é a política de produto correta de longo prazo, ou apenas a mais simples
  para não bloquear esta reconciliação — registrado como decisão explícita e revisável, não uma
  afirmação de que é definitivamente certa para sempre.
