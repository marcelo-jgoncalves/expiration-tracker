# DocumentFile — Estado Final Consolidado (D-162)

**Status: `APPROVED` (design) via protocolo Claude↔Codex, 4 rodadas (5,2 → 7,1 → 8,3 → 9,4),
Claude 9,3/Codex 9,4, sem arredondar. DESIGN-ONLY — implementação real fica para sessão(ões)
futura(s) dedicada(s), mesmo padrão de D-121/D-127/D-136/D-139/D-143.**

Origem: decisão fundacional #1 do roadmap competitivo (D-161,
`docs/architecture/reviews/competitive-roadmap-reconciliation/estado-final-consolidado.md`).
D-143 (Domínio Documental) já tinha aprovado a *semântica* de arquivo (Decision 6: N por
Version, exatamente um `PRINCIPAL`, imutabilidade pós-`ACCEPTED`, contadores
`pendingFileScans`/`infectedFileScans` já implementados) mas não o *mecanismo* de storage/scan —
`commitUpload()` hoje só flipa `DocumentVersion.state`, sem nenhum S3/presign/malware-scan real.

## Declaração E-014 (pesquisa externa)

`SIM PARCIAL`. O padrão "S3 presigned upload + GuardDuty Malware Protection + promoção
quarantine→clean" já é arquitetura de referência AWS, já pesquisado e implementado neste mesmo
repositório (M6, `src/modules/document/`, `E2E PROVEN` em `dev`) — reusado, não repesquisado.
Confirmado nesta rodada (Rodada 4) que um finding real do GuardDuty Malware Protection para S3
carrega `bucketName`/`objectKey`/`versionId` do objeto físico escaneado (AWS docs,
`monitor-with-eventbridge-s3-malware-protection.html`) — base da regra de correlação simétrica
abaixo. O que é genuinamente novo (sem precedente externo ou interno direto): N arquivos por
unidade de aprovação (M6 é 1:1) e a invariante "exatamente um PRINCIPAL".

## Decisão: generalizar o pipeline M6, nunca reinventar

1. **Entidade `DocumentFile`** — mesma partição de Document/Version/Event
   (`PK=TENANT#t#DOCUMENT#d`, `SK=VERSION#seq#FILE#fileId`, via `documentFileKey()` nova,
   espelhando `documentVersionEventKey()`). Campos: `role: PRINCIPAL|ATTACHMENT`, `scanStatus`
   reusando a taxonomia `DocumentStatus` de M6 (`PENDING_UPLOAD|SCANNING|CLEAN|REJECTED|
   UNSUPPORTED|TIMEOUT`), `quarantineObject`/`cleanObject`/`uploadEvidence`/`malwareEvidence`
   (tipos reusados de `document/domain/` sem modificação), `GSI5PK?`/`GSI5SK?` esparsos para
   reconciliação. `documentVersionFileKeyPrefix()`/`documentVersionEventKeyPrefix()` (stubs
   mortos, nunca tiveram chamador, formato `PK|SK` incorreto) são removidos nesta implementação.
2. **`reserveUpload()`**: uma `TransactWriteItems` — Update de `DocumentVersion` (condição
   `state=DRAFT AND version=:expectedVersion AND (fileSetSealed ausente OR false)`, seta
   `fileSetSealed=true`, `principalFileId`, `pendingFileScans=N`, `totalFiles=N`) + N Put de
   `DocumentFile` (`attribute_not_exists(PK)`). Exatamente 1 `PRINCIPAL` validado no domínio
   antes de montar a transação; a corrida entre duas reservas concorrentes é fechada pela
   condição da Version, não pela validação de input sozinha. Lote capado em
   `MAX_FILES_PER_VERSION=20`.
3. **Correlação de evidência simétrica**: o primeiro evento físico a chegar (S3 Object Created
   ou GuardDuty finding — ambos carregam a tripla `bucket+key+versionId` do objeto real)
   consolida `quarantineObject.versionId` a partir da própria tripla observada, condicionado em
   `scanStatus IN (PENDING_UPLOAD, SCANNING)`; o segundo evento a chegar verifica igualdade
   exata contra a tripla já consolidada. Nunca presume qual dos dois chega primeiro.
4. **Transição terminal** (`CLEAN`/`REJECTED`/`UNSUPPORTED`/`TIMEOUT`): uma transação — Update
   do `DocumentFile` (condição de correlação do item 3) + Update do `DocumentVersion` via
   `buildVersionedUpdate` padrão (`version=:expectedVersion`, sem mecanismo novo — os contadores
   são literais recalculados a partir da leitura já feita, a mesma OCC que todo write mutável do
   projeto já usa) + Put de `DocumentVersionEvent(type: "FILE_REJECTED_INFECTED", fileId,
   fromFileScanStatus, toFileScanStatus)` quando o veredito é infecção — tipo renomeado de
   `FILE_REMOVED_INFECTED` (nunca teve writer real) para refletir que é a própria transição
   terminal, não uma remoção humana separada.
5. **Recuperação de PRINCIPAL infectado**: sem reabertura do conjunto selado — `acceptVersion()`
   ganha um `ConditionCheck` transacional a mais (`scanStatus=CLEAN` no `DocumentFile` do
   `principalFileId`, TOCTOU-safe). Se o PRINCIPAL foi rejeitado, a única recuperação é
   `rejectVersion()` da Version inteira (via `commitUpload()` normal se ainda em `DRAFT`) e
   começar uma `DocumentVersion` nova — mesma disciplina já `APPROVED` de "nunca mutar Version
   de volta para DRAFT" (D-143 Decision 1/7), generalizada de arquivo único para conjunto.
6. **Reconciliação**: reusa `UploadSlotReconciliationWorker`, generalizado com uma segunda
   função de varredura sobre **GSI5** (nunca GSI6 — D-143 Decision 2 fecha GSI6 para este
   domínio, e emendar essa decisão estava fora de escopo) usando namespaces por prefixo
   (`DOCFILE-RECON#PENDING_UPLOAD`/`DOCFILE-RECON#SCANNING`), mesmo padrão de discriminação já
   usado por GSI1. Ponteiros esparsos, removidos na mesma transação terminal.
7. **Infra**: nenhum bucket S3 novo, nenhuma configuração GuardDuty nova — reusa
   `infra/modules/document-buckets`/`infra/modules/document-malware-protection` tal como estão
   (confirmado por leitura direta nesta rodada, corrigindo um erro factual da Rodada 1 que
   afirmou que nada disso existia). Trabalho de infra real: IAM escopado para a(s) Lambda(s)
   nova(s) + roteamento do handler para reconhecer o namespace de chave novo
   (`document-archive/...`) ao lado do namespace M6 existente.

## Achados reais do próprio protocolo (não escondidos)

- Rodada 1 errou dizendo que nenhum bucket/GuardDuty/worker existia — corrigido na Rodada 2 por
  leitura direta de `infra/modules/`.
- Rodada 1 propôs validar "exatamente 1 PRINCIPAL" só por validação de input — Rodada 2 achou a
  corrida real entre duas reservas concorrentes, fechada com a condição na própria `Version`.
- Rodada 2 introduziu `removeInfectedFile()` contraditório (exigia um estado que a própria
  infecção já teria consumido) — Rodada 3 removeu o método por completo, tratando `THREATS_
  FOUND` como a própria transição terminal.
- Rodada 3 propôs reusar GSI6 para reconciliação, contradizendo D-143 Decision 2 (GSI6 nunca
  tocado pelo domínio documental) — Rodada 4 reverteu para GSI5, já alocado ao módulo.
- Rodada 3 deixou ambíguo qual evento (S3 ou GuardDuty) consolida `quarantineObject.versionId`
  primeiro — Rodada 4 fechou com uma regra simétrica, verificada contra o formato real de um
  finding do GuardDuty Malware Protection (pesquisa externa nesta rodada).

## Fora de escopo (nomeado, não escondido)

Download real (Viewer A1 genuinamente aberto, D-143 Decision 9); parser sandbox de PDF; purga
física de `DocumentFile` (fila de D-127, classe de retenção `USER_DOCUMENT` já nomeada em D-143
Decision 7 como incluindo "File", a confirmar mecanismo na implementação).

## Próximo passo real

Implementação em sessão(ões) futura(s) dedicada(s) — tamanho comparável a M6 completo (~15
arquivos entre domain/ports/persistence/application/workers, mais Terraform de IAM/roteamento).
Depois de `DocumentFile`, a macro-ordem de D-161 segue para o item 8 (Document Types
configuráveis).
