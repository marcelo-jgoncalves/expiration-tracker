# Rodada 1 — Proposta Claude: Armazenamento real de arquivo no caminho guest (G02)

## Contexto

Bloco 6 do plano de sequenciamento de frontend (D-264) implementou A14+G02 (Requests &
Recurrence + Guest Request). A rodada Codex de D-264 (7,6/10 NEEDS FIXES) apontou um achado
bloqueante real, deliberadamente não corrigido por ser decisão de nível 5-6/6: **`GuestDocumentAccessService.submitEvidence()` (`src/modules/document-archive/application/guest-document-access-service.ts`) aceita `fileName` no payload mas nunca persiste bytes de arquivo — só metadata.** A propriedade completa A14→G02→A13/A12 não fecha ponta a ponta: um documento enviado por um convidado nunca aparece de fato revisável (com arquivo real) em A13 (Review Queue)/A12 (Document Detail).

Esta proposta cobre SÓ este gap — não reabre nenhuma decisão de arquitetura já `APPROVED`
(sessão guest via cookie D-146, RBAC, modelo de dados de `DocumentRequest`/Document/DocumentVersion).

## Pesquisa externa considerada: SIM PARCIAL

Fontes (acesso 2026-09-10):
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) — validação allowlist de tipo/tamanho/nome, isolar do webroot, nunca confiar no nome de arquivo do cliente, escanear antes de confiar, preferir usuário identificável a upload verdadeiramente anônimo.
- [AWS Security Blog — Using Amazon GuardDuty Malware Protection to scan uploads to Amazon S3](https://aws.amazon.com/blogs/security/using-amazon-guardduty-malware-protection-to-scan-uploads-to-amazon-s3/) e [Mechanical Rock — Malware-Protected File Upload with S3 and GuardDuty](https://www.mechanicalrock.io/blog/malware-protected-file-upload-with-s3-and-guardduty) — padrão de referência: presigned PUT para bucket de staging/quarentena → GuardDuty Malware Protection for S3 → EventBridge → Lambda decide → cópia para bucket "limpo" só se `NO_THREATS_FOUND`. TTL curto de presign (~15 min) recomendado.

**Escopo da pesquisa**: informa o PADRÃO de upload anônimo com scan (presign curto + bucket de
quarentena + scan antes de promover + nunca confiar no nome/Content-Type do cliente) — a parte
externa da decisão. A forma EXATA de integrar com o modelo de dados deste projeto
(`DocumentFile`/`DocumentVersion`/chave DynamoDB/GSI8) é puramente interna, já resolvida por D-163
para o caminho autenticado — não há ambiguidade de mercado aí, só reaproveitamento.

**Achado central desta pesquisa, verificado contra o código real ANTES desta proposta**: o projeto
já implementa o padrão de referência acima, ponta a ponta, para 3 domínios (`document` M6,
`subject` M10, `document-archive` D-163/D-193) — UM bucket de quarentena compartilhado
(`module.document_buckets`), coberto por `module.document_malware_protection` (GuardDuty), um
handler genérico (`malware-result-handler.ts`) que roteia por prefixo de chave S3 via parsers
dedicados por módulo (`parseDocumentArchiveQuarantineKey`, etc.), e uma máquina de estados real
(`DocumentFile.scanStatus`: `PENDING_UPLOAD→SCANNING→CLEAN|REJECTED|UNSUPPORTED|TIMEOUT`,
`apply-file-scan-result.ts`/`advance-file-after-evidence.ts`). **Isso muda o escopo da decisão**:
não é "desenhar scanning de malware do zero", é "estender uma superfície de escrita já existente e
já validada para aceitar um segundo tipo de chamador (guest, não autenticado)". A pesquisa converge
com essa decisão pré-existente do projeto, não a contradiz.

**Ressalva OWASP levada a sério**: a fonte recomenda usuário identificável, não upload
verdadeiramente anônimo. Este projeto já tem esse substituto: o guest não é anônimo no sentido
"qualquer um" — é gated por um credential/session possession-based (token HMAC + cookie de sessão +
CSRF double-submit, D-146), rate-limited (30/min por seletor+IP), e vinculado a um
`DocumentRequest` vivo e específico de um tenant/subject/requirement. O mesmo padrão já é usado
em produção pelo `subject`-module guest-submission (M10) sem incidente registrado. Esta proposta
não introduz um endpoint público irrestrito — estende um endpoint já gated.

## Checklist de critérios pesados (derivado da pesquisa, sub-rubrica desta rodada)

1. **Nunca promover a "confiável" sem scan** — arquivo só sai do bucket de quarentena após
   `scanStatus=CLEAN` confirmado (reaproveita `apply-file-scan-result.ts` verbatim).
2. **Nunca auto-aceitar** — mesmo com `scanStatus=CLEAN`, o Document permanece `RECEIVED`,
   exigindo `acceptVersion()` humano autenticado (C2, já vigente) — scan limpo ≠ aceito.
3. **Allowlist de tipo/tamanho, nunca blocklist** — `mediaType` contra lista fechada,
   `contentLength` com teto explícito, aplicado no SERVIÇO (não só no schema HTTP).
4. **Nome de arquivo do cliente nunca vira caminho de armazenamento** — chave S3 gerada só a
   partir de identificadores internos (`documentId`/`seq`/`fileId`), nunca `fileName` (já a
   disciplina de `buildQuarantineKey()`, reaproveitada verbatim).
5. **Presign de vida curta** — reaproveita `PRESIGN_TTL_SECONDS=600s` já estabelecido (dentro da
   faixa recomendada pela fonte AWS, ~15min).
6. **Identificabilidade/accountability sem autenticação de usuário** — mantém a cadeia já
   existente (credential→session→CSRF→DocumentRequest de um tenant específico), nunca relaxa para
   um endpoint verdadeiramente aberto.
7. **Custo de armazenamento agora é real — quota deve ser aplicada** — até hoje a submissão guest
   era metadata-only (custo ~0); com bytes reais, a MESMA transação deve checar/reservar quota de
   armazenamento do tenant (reaproveitando o mecanismo de `reserveFiles()`, D-249), fechando um
   vetor de abuso que não existia antes desta mudança.
8. **Zero infraestrutura nova para o mecanismo de scan em si** — reaproveitar o bucket/GuardDuty/
   handler já existentes; qualquer proposta que crie um bucket/scanner paralelo é rejeitada por
   violar o próprio achado da pesquisa (o padrão de referência já está implementado).

## Design proposto

### 1. Domínio/aplicação (`guest-document-access-service.ts`)

`GuestDocumentAccessServiceDeps` ganha 2 deps novas: `signer: DocumentUploadSigner` (a MESMA
interface/porta que `document-archive-service.ts` já usa) e `quarantineBucket: string`.

`SubmitEvidenceInput` ganha 3 campos novos, obrigatórios: `mediaType: string`,
`contentLength: number`, `checksumSha256: string` (mesmo shape de `FileUploadSpec`, reaproveitado,
não redeclarado com nomes diferentes).

Validação nova, no SERVIÇO (não só no schema — trilha dupla, mesma disciplina do resto do módulo):
- `mediaType` contra uma allowlist portada para `document-archive` (mesmo valor de `document`
  module's `ALLOWED_MEDIA_TYPES` = `application/pdf`, `image/jpeg`, `image/png` — PORTADA, não
  importada cross-module, mesmo precedente que `storage-quota.ts` já documenta para
  `document-archive` não poder importar de `subject/**`/`document/**` via
  `.dependency-cruiser.cjs`).
- `contentLength` entre 1 e um teto nomeado (`MAX_GUEST_UPLOAD_BYTES`, proposta: reaproveitar o
  MESMO valor de `document` module, 10 MiB — nenhum motivo de produto identificado para um limite
  diferente no caminho guest).
- Falha de validação colapsa no MESMO `GuestAccessInvalidError` genérico (disciplina
  anti-enumeração já documentada no header do arquivo) — nunca vaza qual regra específica falhou.

`submitEvidence()`'s transação existente ganha 2 entradas novas, na MESMA `TransactWriteItems`:
- 1 `Put` de `DocumentFile` (`role: "PRINCIPAL"`, `scanStatus: "PENDING_UPLOAD"`, `quarantineObject`
  usando o MESMO `buildQuarantineKey()`/prefixo que `document-archive-service.ts` já usa — o
  parser `parseDocumentArchiveQuarantineKey` em `malware-result-handler.ts` já reconhece essa
  forma, **zero mudança nesse handler**).
- O `Update` já existente em `DocumentVersion` ganha os campos `fileSetSealed: true,
  principalFileId, totalFiles: 1, pendingFileScans: 1` (mesmos campos que `reserveFiles()` seta —
  `apply-file-scan-result.ts`/`advance-file-after-evidence.ts` nunca checam `DocumentVersion.state`,
  só `fileSetSealed`+`scanStatus`, então nascer já-selado em `RECEIVED` em vez de passar por um
  `DRAFT` intermediário é seguro).
- Reserva de quota de armazenamento: mesma condição transacional que `reserveFiles()` já usa
  (`usedBytes+reservedBytes+requested <= limitBytes` como `ConditionCheck`/`Update` na MESMA
  transação) — se excederia, a transação inteira é cancelada e o guest recebe o MESMO
  `GuestAccessInvalidError` genérico (nunca vaza "quota do tenant esgotada" a um estranho).

Depois que a transação commita: presigna um PUT contra o `quarantineObject` da nova `DocumentFile`
(mesmo `signer.presignUpload()`, mesmo `PRESIGN_TTL_SECONDS`). `SubmitEvidenceResult` ganha
`uploadUrl: string` e `requiredHeaders: Record<string,string>`.

**Replay idempotente com presign fresco**: a checagem de idempotência (`existingReplay`) já
existente continua retornando o snapshot original de `{documentId,versionId,seq}` — mas o presign
NUNCA é cacheado no snapshot (mesma disciplina de `reserveFiles()`: presign é sempre gerado
depois, nunca parte do resultado persistido). Em um replay, o serviço relê a `DocumentFile` real
pelo ponteiro do documento: se `scanStatus` ainda é `PENDING_UPLOAD`, presigna de novo contra a
MESMA `quarantineObject.key` (idempotente — múltiplos presigns da mesma chave nunca conflitam); se
já é terminal (`CLEAN`/`SCANNING`/etc.), `uploadUrl` vem `undefined` na resposta e o front-end trata
como "já recebido, nada a fazer".

### 2. HTTP (`document-archive-guest-handlers.ts` + schema)

`docarchive-guest-submit-evidence-request.v1.json` ganha `mediaType`/`contentLength`/
`checksumSha256` como `required`, mesmos formatos/constraints do schema já existente
`docarchive-reserve-files-request.v1.json` (reaproveitar os literais de validação, não redigitar).
Resposta HTTP ganha `uploadUrl`/`requiredHeaders` (opcionais, ausentes quando o replay não precisa
de novo upload).

### 3. Infra (`infra/main.tf`)

`module.document_archive_guest_handler` ganha `QUARANTINE_BUCKET_NAME` no `environment_variables` e
o MESMO `data.aws_iam_policy_document.document_archive_presign_quarantine_put.json` já definido
(reaproveitado, nunca uma segunda política equivalente) adicionado a `policy_documents_json` —
nenhum recurso novo, nenhuma mudança em `document_malware_protection`/EventBridge/GuardDuty.

### 4. Frontend (`GuestDocumentRequest.tsx`)

Reaproveita literalmente `computeChecksumSha256()`/`uploadDocumentBytes()` de
`frontend/src/hooks/useUploadDocument.ts` (mesmas funções, import direto, nunca redigitadas). Fluxo
do wizard no passo final: computa checksum → chama `submitEvidence` com os campos novos → SE
`uploadUrl` presente, faz o PUT real via `uploadDocumentBytes` → SÓ ENTÃO mostra a copy final
"Recebemos seu envio". Se o PUT falhar, mostra um estado de erro real e distinto (não a mesma copy
de sucesso) — o registro de metadata já existe (idempotente, replay seguro), então um retry do
guest chama `submitEvidence` de novo com a MESMA `idempotencyKey` e recebe um presign fresco para
tentar o PUT de novo. Um `DocumentFile` nunca enviado (guest desiste) expira sozinho via o worker de
reconciliação já existente (`FILE_SCAN_TIMEOUT_SECONDS`, `TIMEOUT` terminal) — nenhuma limpeza
manual nova necessária.

## Fora de escopo (nomeado, não esquecido)

- Sessão guest não vinculada ao token do path (achado #2 de D-264) — pré-existente, não piora
  materialmente com esta mudança (mesma semântica de "segunda aba sobrescreve sessão"), permanece
  como pendência nomeada separada.
- `createSeries` sem fence de unicidade de série ACTIVE (achado #3 de D-264) — não relacionado a
  este gap.
- Suporte a múltiplos arquivos/`ATTACHMENT` no caminho guest — G02 hoje só tem UI para 1 arquivo
  PRINCIPAL; não expandir escopo além do necessário para fechar o gap nomeado.
- Extração/OCR do arquivo do guest — fora de escopo desde sempre (roadmap).

## Nível de risco

5-6/6 (`change-risk-scale.md`): nova superfície efetiva de escrita anônima de bytes (mesmo gated),
mudança de custo real (quota) em um caminho antes gratuito, mas reaproveita 100% de um mecanismo de
segurança já `APPROVED`/em produção — não introduz nenhum componente de infraestrutura novo.
