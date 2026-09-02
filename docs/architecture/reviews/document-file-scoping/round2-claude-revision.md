# DocumentFile — Rodada 2 (revisão Claude)

Nota da Rodada 1: 5,2/10. Todos os 5 achados reais do Codex são aceitos e corrigidos abaixo, sem
descartar nenhum. Correção factual assumida primeiro: os buckets S3 (`infra/modules/
document-buckets`), GuardDuty (`infra/modules/document-malware-protection`) e o worker de
reconciliação (`src/workers/upload-slot-reconciliation`) **já existem** — a Rodada 1 errou ao
dizer que não existia nada. Isso **reduz** o trabalho de infra desta decisão (reusar os buckets
físicos existentes, nenhum bucket/GuardDuty novo), não o contrário.

## 1. Modelo de evidência dupla (achado 1)

`DocumentFile.scanStatus` deixa de ser um campo solto e passa a espelhar exatamente a taxonomia
`DocumentStatus` de M6 (`document/domain/document.ts`), reaproveitada verbatim, não reinventada:

```ts
type DocumentFileScanStatus = "PENDING_UPLOAD" | "SCANNING" | "CLEAN" | "REJECTED" | "UNSUPPORTED" | "TIMEOUT";

interface DocumentFile extends EntityKey {
  entityType: "DocumentFile";
  tenantId: string; documentId: string; versionId: string; fileId: string;
  role: "PRINCIPAL" | "ATTACHMENT";
  scanStatus: DocumentFileScanStatus;
  quarantineObject: DocumentObjectReference;
  cleanObject?: DocumentObjectReference;
  mediaType: string; contentLength: number; checksumSha256: string;
  uploadEvidence?: UploadEvidence;      // reused type — HeadObject-validated, `valid: boolean`
  malwareEvidence?: MalwareEvidence;    // reused type — correlated by full DocumentObjectReference triple
  createdAt: string; updatedAt: string; version: number;
}
```

`advanceAfterEvidence()`-equivalente para `DocumentFile` é **o mesmo algoritmo puro de M6**
(`document-state-machine.ts`), não uma versão simplificada: promoção a `CLEAN` exige
`uploadEvidence.valid === true` **e** `malwareEvidence.status === "NO_THREATS_FOUND"`, ambas
correlacionadas pela tripla completa (`sameObjectVersion()`, já existente, reusada sem
modificação). `UNSUPPORTED`/`ACCESS_DENIED`/`FAILED` seguem exatamente o tratamento já aprovado
de M6 (`ACCESS_DENIED`/`FAILED` retryable no adapter, nunca coagidos a terminal; `UNSUPPORTED`
vai a estado terminal `UNSUPPORTED`, não `REJECTED`). Nenhuma peça nova aqui — é reuso literal.

Correção do `quarantineObject` com `versionId: ""` antes do upload real: aceito como o mesmo
atalho consciente de M6 (não uma dívida nova introduzida aqui) — o campo só é populado com o
`versionId` físico real quando `uploadEvidence` é observado via S3 event; até lá o registro vive
com o triple parcial, exatamente como `Document.quarantineObject` faz hoje em produção.

## 2. Corrida de PRINCIPAL (achado 2) — fechada com transação, não validação de input

Dois campos novos em `DocumentVersion` (D-143 Decision 6 nunca previu isto — extensão real
desta rodada, registrada como tal): `fileSetSealed: boolean` (default `false`) e
`principalFileId?: string`. `reserveUpload(documentId, seq, expectedVersion, files[])` vira uma
única `TransactWriteItems`:

- **Update** em `DocumentVersion`: `condition: state = "DRAFT" AND version = :expectedVersion AND
  (attribute_not_exists(fileSetSealed) OR fileSetSealed = :false)`, `set: fileSetSealed = true,
  principalFileId = :principalFileId, pendingFileScans = :n, totalFiles = :n` (mesmo builder
  `buildVersionedUpdate` de `occ.ts`, condição extra anexada, não um mecanismo novo).
- **N Put** de `DocumentFile`, cada um `attribute_not_exists(PK)` (mesma disciplina de
  `putIfAbsent`).

A corrida do Rodada 1 (duas chamadas concorrentes, cada uma com 1 PRINCIPAL, `fileId`s
diferentes nunca colidindo) é fechada porque **a condição que pode falhar não é mais nos
arquivos, é na própria Version**: a segunda chamada tenta `fileSetSealed = :false` quando a
primeira já setou `true` — `TransactionCanceledException`, mapeado para `ConflictError`, mesmo
padrão de toda escrita mutável do projeto. Exatamente 1 PRINCIPAL por lote continua validado no
domínio (rejeita 0 ou >1 antes de montar a transação) — mas agora a transação, não a validação
pura, é o que impede duas reservas concorrentes de ambas vencerem.

**Limite de tamanho de lote**: `files.length` capado em 20 (constante nomeada,
`MAX_FILES_PER_VERSION`) — N Put + 1 Update = 21 ações no pior caso, bem abaixo do limite de 100
ações do `TransactWriteItems`; 4 MB de payload não é uma preocupação real para itens deste
tamanho (metadados apenas, nunca o arquivo em si).

## 3. Invariantes transacionais (achado 3) — cada uma nomeada com o mecanismo real

- Criação de arquivos + contadores/principal da Version: item 2 acima, uma só transação.
- Transição terminal por arquivo + contadores da Version: **também uma transação** —
  `Update DocumentFile` (`condition: scanStatus = "SCANNING"`, idempotente contra evento
  duplicado/atrasado via correspondência exata da tripla observada) + `Update DocumentVersion`
  (`condition: version = :expectedVersion`, `set: pendingFileScans = pendingFileScans - :one`,
  e para o ramo `THREATS_FOUND` adicionalmente `infectedFileScans = infectedFileScans + :one`).
  Nunca dois `TransactWriteItems` separados para o mesmo evento — replay de evento duplicado é
  rejeitado pela condição do próprio item `DocumentFile` (já não está mais em `SCANNING`), não
  por um flag de idempotência adicional.
- Remoção de arquivo infectado: novo método `removeInfectedFile(documentId, seq, fileId,
  expectedVersion)` — transação com `Update DocumentFile` (`scanStatus: "SCANNING"` →
  terminal marcador de remoção, mantendo o registro para histórico, nunca deletado fisicamente,
  mesma disciplina de "REJECTED nunca removível" de D-143 Decision 7) + `Update DocumentVersion`
  (`infectedFileScans - 1`) + **Put `DocumentVersionEvent(type: "FILE_REMOVED_INFECTED")`** — o
  tipo de evento já existe na taxonomia (`document-version-event.ts` linha 17), nunca foi
  emitido por código nenhum até agora; esta é a primeira vez que ganha um writer real.
- Selagem: `fileSetSealed = true` por construção do item 2 já impede novas reservas na mesma
  Version (a condição do Update exige `fileSetSealed` ausente ou `false`) — não precisa de
  mecanismo adicional.

## 4. Gate de `commitUpload()` corrigido (achado 4)

`commitUpload()` (`DRAFT→RECEIVED`) passa a exigir `fileSetSealed === true` — prova que
`reserveUpload()` completou para esta Version, sem acoplar a contadores de scan que podem
legitimamente já estar zerados (upload+scan rápidos antes do commit) ou ainda não refletir
upload real algum. O gate de scans-completos continua exclusivamente em `acceptVersion()`
(`hasCleanFileScans()`, já implementado, inalterado) — `commitUpload` nunca decidiu isso e
continua não decidindo.

## 5. Reconciliação (achado 1, ponto final)

`UploadSlotReconciliationWorker` generaliza para tratar dois casos distintos de
`DocumentFile`, não um: `scanStatus = "PENDING_UPLOAD"` além do TTL de reserva (mesmo tratamento
de `UploadSlot.status === RESERVED` — nunca chegou a fazer upload, expira para estado terminal)
**e**, separadamente, `scanStatus = "SCANNING"` além do TTL de scan (upload observado, veredito
GuardDuty nunca chegou — expira para `TIMEOUT`, distinto de "nunca uploadado"). Dois filtros de
varredura no mesmo worker, não um worker novo.

## 6. Chaves reais (correção do stub morto)

`documentVersionFileKeyPrefix()` é removida (nunca teve chamador, formato `PK|SK` nunca
corresponde a nenhuma key function real do módulo). Nova função real, espelhando exatamente
`documentVersionEventKey()`:
```ts
function documentFileKey(tenantId: string, documentId: string, seq: number, fileId: string): { PK: string; SK: string } {
  return { PK: `TENANT#${tenantId}#DOCUMENT#${documentId}`, SK: `VERSION#${formatVersionSeq(seq)}#FILE#${fileId}` };
}
```
`documentVersionEventKeyPrefix()` (irmã igualmente morta, mesmo formato inconsistente) também é
removida na mesma limpeza — nenhuma das duas nunca teve um chamador real, confirmado por grep
antes desta rodada.

## Infra (correção factual)

Nenhum bucket S3 novo, nenhuma configuração GuardDuty nova — reusa `infra/modules/
document-buckets`/`infra/modules/document-malware-protection` tal como estão. O trabalho de
infra real desta decisão é: IAM policy escopada para a(s) Lambda(s) novas (mesmo padrão
least-privilege já documentado no bucket M6 — nenhum handler de negócio recebe acesso ao bucket
quarantine/clean), e roteamento do handler de evento S3/GuardDuty para reconhecer o namespace de
chave novo (`document-archive/...`) ao lado do namespace M6 existente (`tenant/.../item/...`) —
dois padrões coexistindo no mesmo bucket físico, nunca uma migração do M6.

## Escopo desta rodada

Ainda fechando só como design (`APPROVED`, nível 5 confirmado por ambos) — implementação em
sessão(ões) futura(s) dedicada(s), tamanho comparável a M6 completo. Nada abaixo mudou desde a
Rodada 1: download real (A1) genuinamente aberto; parser sandbox de PDF fora de escopo; purga
física de `DocumentFile` fica para quando a fila de D-127 chegar nela (classe de retenção a
confirmar na implementação, provavelmente `USER_DOCUMENT` reutilizada).
