# DocumentFile — Rodada 1 (proposta Claude)

Contexto: decisão fundacional #1 do roadmap competitivo (D-161,
`docs/architecture/reviews/competitive-roadmap-reconciliation/estado-final-consolidado.md`).
D-143 (Domínio Documental, `APPROVED`) já decidiu a semântica de arquivo em Decision 6 (N por
Version, exatamente um `PRINCIPAL`, imutabilidade pós-`ACCEPTED`, dois contadores
`pendingFileScans`/`infectedFileScans` já implementados em `DocumentVersion` — ver
`document-version.ts` linhas 47-51/154-156, `hasCleanFileScans()` já usada como gate de
`acceptVersion`). O que falta é a entidade `DocumentFile` em si e o pipeline de storage/scan que
a alimenta — hoje `commitUpload()` só flipa `DocumentVersion.state` para `RECEIVED`, sem nenhum
S3/presign/scan real (`document-archive-service.ts` linhas 157-177, reconfirmado ao vivo nesta
sessão).

**Classificação de risco corrigida nesta rodada**: o `NEXT_SESSION_PROMPT.md`/handoff anterior
especulou nível 3-4 ("design já existe, falta só implementar"). Isso é verdade só para a
*semântica* de arquivo. É falso para o *mecanismo* — não existe hoje nenhum bucket S3, nenhuma
integração GuardDuty, nenhum worker de reconciliação, nenhuma policy IAM para o domínio
documental. Construir isso do zero é uma nova subsistema, não um data-write num campo já
modelado. **Reclassificado para nível 5** (nova entidade + storage + invariantes
transacionais), confirmando a própria estimativa de risco do roadmap (`estado-final-consolidado.md`
linha 73: "Storage (5, nova entidade de arquivo + invariantes transacionais)").

**Declaração E-014 (pesquisa externa)**: `SIM PARCIAL`. O padrão "S3 presigned upload +
GuardDuty Malware Protection scan + promoção quarantine→clean" já é a arquitetura de referência
publicada pela própria AWS e já foi pesquisado/aprovado neste projeto quando M6 foi desenhado
(`src/modules/document/` — `upload-slot.ts`, `quarantine-key.ts`/`clean-key.ts`,
`malware-scan-result.ts`, `s3-document-object-store.ts`, `s3-upload-url-signer.ts`, todos
`E2E PROVEN` em produção `dev`). Não há pesquisa externa nova a fazer para essa parte — ela já
existe, implementada e comprovada, dentro do próprio repositório. O que É genuinamente novo e
não coberto por nenhum precedente externo ou interno é: (a) múltiplos arquivos por unidade de
aprovação (M6 é 1 Document = 1 arquivo; D-143 quer N arquivos por Version) e (b) a invariante
"exatamente um PRINCIPAL" com enforcement real contra corrida concorrente.

## Proposta

**Reusar o pipeline M6 já aprovado, generalizado de "1 arquivo por Document" para "N arquivos
por DocumentVersion", nunca reinventado.** Concretamente:

1. **Entidade `DocumentFile`** (`src/modules/document-archive/domain/document-file.ts`), mesma
   partição do Document/Version (`documentVersionFileKeyPrefix()` já existe, não usado —
   `PK=TENANT#t#DOCUMENT#d`, `SK=VERSION#seq#FILE#fileId`, corrigindo o separador `|` espúrio do
   stub atual, que nunca foi exercitado e não corresponde ao formato PK/SK real de nenhuma outra
   entidade do módulo):
   ```ts
   interface DocumentFile extends EntityKey {
     entityType: "DocumentFile";
     tenantId: string; documentId: string; versionId: string; fileId: string;
     role: "PRINCIPAL" | "ATTACHMENT";
     scanStatus: "PENDING" | "CLEAN" | "INFECTED";
     quarantineObject: DocumentObjectReference;   // reused from document/domain, generic triple
     cleanObject?: DocumentObjectReference;         // only once promoted
     mediaType: string; contentLength: number; checksumSha256: string;
     malwareEvidence?: MalwareEvidence;             // reused type, generic over object ref
     createdAt: string; updatedAt: string; version: number;
   }
   ```
2. **Bucket/adapters reusados, não duplicados**: mesmos dois buckets S3 (`quarantine`/`clean`) e
   as mesmas portas (`UploadUrlSigner`, `DocumentObjectStore`) do módulo `document` — ambas já
   genéricas sobre bucket/key, sem acoplamento a `itemId`. Nova função de chave
   `documentArchiveQuarantineKey(tenantId, documentId, versionId, fileId, random)` (mesma forma
   de `parseQuarantineKey()`, namespace `document-archive/` para não colidir com `tenant/.../item/`
   do M6 na mesma árvore de bucket). Terraform: acrescentar o novo prefixo à policy do bucket
   existente (não criar bucket novo — mesma trust boundary, mesmo scan GuardDuty já cobre o
   bucket inteiro).
3. **`reserveUpload(documentId, seq, files: {role, mediaType, contentLength, checksumSha256}[])`**:
   novo método em `DocumentArchiveService`, só permitido em `DRAFT`. Cria N `DocumentFile` PENDING
   (put condicional, mesma disciplina OCC de `occ.ts`) + presigna N URLs. Exatamente 1 `role:
   PRINCIPAL` **enforced por construção do input** (validação de domínio pura antes de qualquer
   escrita — rejeita 0 ou >1 PRINCIPAL), não por corrida de escrita — não há concorrência possível
   porque um único chamador possui a versão em `DRAFT` nesta chamada.
4. **`commitUpload()` real**: hoje só flipa estado; passa a exigir `pendingFileScans > 0`
   (setado por `reserveUpload`) e permanece em `RECEIVED` só depois de os arquivos existirem —
   sem mudança na assinatura pública, o "commit" continua sendo a confirmação de que o upload em
   si terminou (paralelo exato ao `DocumentService.confirmUpload()` de M6).
5. **Promoção quarantine→clean por arquivo**: novo worker `document-file-malware-promotion`,
   cópia estrutural do fluxo M6 (`advance-after-evidence.ts` equivalente) — ao receber
   `NO_THREATS_FOUND`, copia objeto para bucket clean, decrementa `pendingFileScans` na
   `DocumentVersion` via `TransactWriteItems` (Update condicionado por versão, mesmo padrão de
   todo write mutável do projeto); ao receber `THREATS_FOUND`, seta `scanStatus: INFECTED` e
   incrementa `infectedFileScans` (nunca decrementa `pendingFileScans` duas vezes — idempotência
   via `attribute_exists`/valor observado, mesma disciplina de D-151..D-156).
6. **Reconciliação de scans travados**: reusa a mesma classe de worker de
   `UploadSlotReconciliationWorker` (M6), generalizada para `DocumentFile.scanStatus === PENDING`
   além de `UploadSlot.status === RESERVED`.
7. **Fora de escopo desta rodada (nomeado, não escondido)**: download real (Viewer A1 continua
   genuinamente aberto, D-143 Decision 9); parser sandbox de PDF (M6 tem, D-143 não pediu);
   purga física de `DocumentFile` (Prioridade LGPD nova, cai na mesma fila de D-127 quando
   chegar sua vez — `USER_DOCUMENT` já é uma classe existente em `privacy-lgpd.md`, `DocumentFile`
   provavelmente herda a mesma, não uma classe nova — a confirmar na implementação).

## Tamanho esperado

Comparável a uma wave (M6 module completo tinha ~15 arquivos entre domain/ports/persistence/
application/workers/infra). **Não cabe em implementação direta de sessão única com o rigor que
o projeto já exige (G-V3, terraform test, E2E) — proposta explícita: fechar esta rodada como
design `APPROVED`, mesma forma de D-127/D-130/D-131, implementação em sessão(ões) futura(s)
dedicada(s).**

## Pergunta explícita ao Codex

1. A generalização "1 arquivo→N arquivos, `itemId`→`versionId`" do pipeline M6 é sólida, ou hÁ
   uma diferença estrutural entre `Document`(M6)/`ExpirationItem` e `DocumentFile`/`DocumentVersion`
   que quebra alguma invariante do pipeline original (ex.: W3-06 purge assume 1:1 Document↔item;
   D-143 não)?
2. A validação "exatamente 1 PRINCIPAL só no input, sem lock" está certa, ou existe uma corrida
   real (ex.: duas chamadas concorrentes de `reserveUpload` na mesma Version) que o design
   ignorou?
3. Falta alguma invariante transacional entre `DocumentFile` e `DocumentVersion` que o design
   acima não cobre?
