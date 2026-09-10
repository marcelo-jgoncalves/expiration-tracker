# Rodada 2 — Revisão Claude: Armazenamento real de arquivo no caminho guest (G02)

Nota Rodada 1 (Codex, blind): 5,8/10 NEEDS FIXES — 3 achados BLOQUEANTES, 3 MENORES, todos
verificados como reais por leitura direta do código antes desta revisão. Corrige cada um; não
repete o que não mudou (contexto/pesquisa/checklist/fora-de-escopo permanecem os de
`round1-claude-proposal.md`).

## Achados corrigidos

**#1 (BLOQUEANTE) — `DocumentVersion` nasce por `Put`, não por `Update`.** Correto — a versão é
criada em `entries` como `{ Put: buildVersionedCreate(..., version) }`
(`guest-document-access-service.ts:415-435`), o único `Update` da transação é do
`DocumentRequest`. Correção: `fileSetSealed: true, principalFileId, totalFiles: 1,
pendingFileScans: 1` nascem como campos do objeto `version` literal, no MESMO `Put` — nunca um
segundo `Update` no mesmo item (que a `TransactWriteItems` real rejeitaria).

**#2 (BLOQUEANTE) — `DocumentFile` precisa do ponteiro GSI8.** Correto — sem
`documentFileGsi8Keys()`/`deriveDocumentFileMaintenanceDue()`, o worker de reconciliação nunca
descobre um arquivo PENDING_UPLOAD nunca enviado, e ele fica pendente para sempre em vez de
`TIMEOUT`. Correção: o `Put` do `DocumentFile` guest inclui, EXATAMENTE como `reserveFiles()`
(`document-archive-service.ts:663-693`):
```
const due = deriveDocumentFileMaintenanceDue({ scanStatus: "PENDING_UPLOAD", createdAt: now })!;
...
...documentFileGsi8Keys({ dueAtIso: due.dueAtIso, tenantId, fileId }),
```

**#3 (BLOQUEANTE) — Gate STARTER/PROMOTER (D-193 item 8/9) já existe e é intencional, não um bug a
corrigir.** Verificado: `isDocumentArchivePromotionEnabled()`
(`src/modules/extraction/application/document-archive-activation.ts`) exige AMBAS
`EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED`/`DOCUMENT_ARCHIVE_PROMOTION_ENABLED` — hoje
deliberadamente `false` (`NEXT_SESSION_PROMPT.md` item 4: "ativação é decisão futura reversível").
Enquanto desligadas, **tanto o upload autenticado (A07/A12, já em produção) quanto o guest desta
proposta** ficam com o mesmo comportamento: o arquivo é fisicamente aceito no bucket de quarentena
(S3 PUT bem-sucedido), mas `upload-finalizer-handler.ts`/`malware-result-handler.ts` descartam o
evento físico ANTES de qualquer leitura de `DocumentFile` (`IGNORED_PROMOTION_DISABLED`) — o
arquivo nunca chega a `CLEAN`, nunca fica revisável em A12, e eventualmente expira via
reconciliação (`FILE_SCAN_TIMEOUT_SECONDS`) como `TIMEOUT`.

**Decisão explícita desta rodada: NÃO ativar essas flags como parte deste design.** A ativação é
uma decisão de produto já nomeada e deliberadamente adiada (item 4 do roadmap), acoplada ao
consumidor de OCR/extração (D-193's "CLEAN sem consumidor" window) — ativá-la unilateralmente aqui
reabriria uma decisão fora do escopo desta tarefa (armazenar bytes do guest), afetando também TODO
upload autenticado já em produção. Esta proposta **herda o mesmo gate já aprovado**, sem
contorná-lo — o guest tem exatamente a mesma paridade de comportamento que o caminho autenticado já
tem hoje, nem mais nem menos permissivo.

**Consequência honesta, registrada explicitamente (não estava em Rodada 1)**: com as flags no
estado atual, esta mudança sozinha AINDA NÃO fecha a propriedade "A14→G02→A13/A12" com um arquivo
de fato revisável — fecha a PARTE que está no orçamento desta decisão (bytes armazenados
corretamente, sob o mesmo mecanismo de segurança/scan já aprovado, nunca fabricando confiança antes
da hora). A ativação do STARTER/PROMOTER continua sendo pendência nomeada separada, cujo
responsável é quem decidir ativar OCR/extração — não esta rodada. A cópia final de G02 (D-264) já
não afirma "arquivo verificado/aceito", só "recebemos seu envio" — continua correta sem mudança,
porque nunca prometeu mais do que isto entrega.

**#4 (MENOR) — validação de formato de `checksumSha256` no serviço.** Corrigido: mesma regra de
`DocumentService.reserveUpload()` (`document-service.ts:85`), portada (não importada
cross-module, mesmo precedente de `storage-quota.ts`):
```
if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) throw new GuestAccessInvalidError();
```
(nunca `ValidationError` com a mensagem original — colapsa no erro genérico, disciplina
anti-enumeração do módulo).

**#5 (MENOR) — import do frontend errado.** Corrigido: `computeChecksumSha256`/
`uploadDocumentBytes` são exportados por `frontend/src/api/documents.ts` (linhas 34/57), não por
`hooks/useUploadDocument.ts` (que só os importa). G02 importa diretamente de `api/documents.ts`.

**#6 (MENOR) — validação de schema vaza detalhe do Ajv antes do colapso genérico.** Real e mais
sério com os campos novos (range numérico, enum de mediaType, regex de checksum produzem mensagens
mais discriminantes que os 3 campos string atuais). Corrigido, escopo mínimo: em
`handleSubmitEvidence` (`document-archive-guest-handlers.ts:190`), a chamada
`validateAgainstSchema(...)` passa a ser envolvida em try/catch que relança qualquer falha de
schema como `GuestAccessInvalidError` — SÓ nesta rota (as outras rotas guest têm campos
suficientemente pouco discriminantes para não precisar do mesmo tratamento nesta rodada; ver nota
de fora-de-escopo abaixo).

## Fora de escopo (inalterado + 1 item novo)

Tudo de `round1-claude-proposal.md` §"Fora de escopo", MAIS: hardening equivalente do try/catch de
schema nas OUTRAS rotas guest (`handleGetGuestRequest`/`handleListGuestDocumentTypes`) — mesma
classe de problema, mas pré-existente e não introduzida por esta mudança; nomeado aqui para uma
sessão futura, não corrigido agora para não expandir o diff além do gap fechado.

## Design revisado, seção 1 completa (substitui a Rodada 1)

```ts
const due = deriveDocumentFileMaintenanceDue({ scanStatus: "PENDING_UPLOAD", createdAt: now })!;
const file: DocumentFile = {
  ...documentFileKey(tenantId, documentId, seq, fileId),
  entityType: "DocumentFile",
  tenantId, documentId, versionId, seq: 1,
  fileId, role: "PRINCIPAL", scanStatus: "PENDING_UPLOAD",
  mediaType: input.mediaType, contentLength: input.contentLength, checksumSha256: input.checksumSha256,
  quarantineObject: { bucket: this.quarantineBucket, key: this.buildQuarantineKey(tenantId, documentId, 1, fileId), versionId: "" },
  createdAt: now, updatedAt: now, version: 1,
  ...documentFileGsi8Keys({ dueAtIso: due.dueAtIso, tenantId, fileId }),
};

const version: DocumentVersion = {
  ...documentVersionKey(tenantId, documentId, 1),
  entityType: "DocumentVersion", versionId, documentId, tenantId, seq: 1,
  state: "RECEIVED", origin: "GUEST_UPLOAD", receivedAt: now,
  fileSetSealed: true, principalFileId: fileId, totalFiles: 1, pendingFileScans: 1, infectedFileScans: 0,
  requestId: resolved.request.documentRequestId,
  createdAt: now, updatedAt: now, version: 1,
  ...reviewQueueGsi5Keys(tenantId, "RECEIVED", now, versionId),
};
```
(`buildQuarantineKey` privado de `document-archive-service.ts` precisa virar exportado/compartilhado —
proposta: mover para `document-file.ts` como função pura, reaproveitada pelos dois call sites, nunca
duplicada.)

Reserva de quota (mesma condição de `reserveFiles()`) entra como entrada adicional na MESMA
`entries[]` já existente da transação. Ordem de checagem no serviço, antes de montar a transação:
mediaType (allowlist) → contentLength (faixa) → checksumSha256 (regex) — qualquer falha lança
`GuestAccessInvalidError` direto, nunca chega a montar a transação.

## Pedido explícito ao Codex nesta rodada

Reavalie a nota considerando as 6 correções acima. Se algum achado bloqueante NÃO estiver
genuinamente fechado por esta revisão, diga exatamente qual e por quê — não aceite a alegação de
"corrigido" sem reconferir contra o código real novamente.
