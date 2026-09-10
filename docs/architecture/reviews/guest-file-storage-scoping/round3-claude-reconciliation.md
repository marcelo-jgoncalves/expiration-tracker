# Rodada 3 — Reconciliação final Claude: Armazenamento real de arquivo no caminho guest (G02)

Nota Rodada 2 (Codex, blind): 8,4/10 NEEDS FIXES — 6/6 achados originais RESOLVIDOS, 1 achado NOVO
bloqueante (presign fresco vs. deadline GSI8), 2 menores. Corrige os 3.

## Achado novo #1 (BLOQUEANTE) — presign de replay deve respeitar o deadline original, nunca reabrir uma janela nova

Correto: `FILE_SCAN_TIMEOUT_SECONDS`/`PRESIGN_TTL_SECONDS` são deliberadamente a MESMA janela
(comentário de `document-file.ts`: "the whole reserve->scan lifecycle is bounded by the same
window the presigned URL itself expires under") — presignar 600s frescos a cada replay quebra essa
invariante já documentada, permitindo um PUT válido depois que o reconciliador já decidiu
`TIMEOUT`.

**Correção**: em QUALQUER emissão de presign (primeira chamada ou replay), calcular
`remainingSeconds = secondsUntil(due.dueAtIso) - SAFETY_MARGIN_SECONDS` (margem pequena, ex. 5s,
evitando emitir uma URL que expira no instante em que o reconciliador roda). Três casos:

1. `file.scanStatus === "PENDING_UPLOAD"` e `remainingSeconds > 0` → presigna para
   `min(PRESIGN_TTL_SECONDS, remainingSeconds)` (nunca um teto novo além do deadline original).
   `SubmitEvidenceResult.uploadUrl`/`requiredHeaders` presentes.
2. `file.scanStatus === "PENDING_UPLOAD"` e `remainingSeconds <= 0` → NÃO presigna (o
   reconciliador pode ainda não ter rodado, mas a janela já é considerada encerrada por
   construção). `uploadUrl` ausente na resposta.
3. `file.scanStatus` já terminal (`SCANNING`/`CLEAN`/`REJECTED`/`UNSUPPORTED`/`TIMEOUT`) → NÃO
   presigna. `uploadUrl` ausente.

**Contrato de resposta simplificado (fecha também a confusão apontada sobre `TIMEOUT`)**:
`SubmitEvidenceResult` expõe só `uploadUrl?`/`requiredHeaders?` — nunca `scanStatus` (vazaria
estado interno a um chamador anônimo, quebra a disciplina anti-enumeração do módulo). Contrato
para o frontend: **presente = "envie os bytes agora, o registro ainda aceita"**; **ausente =
"nada mais a fazer por esta submissão específica"**, sem distinguir para o guest se foi por já ter
sido recebido, rejeitado ou expirado (a mesma colapsagem genérica que todo o resto do módulo já
aplica) — G02 mostra uma copy neutra ("Este envio já foi processado ou expirou — se ainda precisar
enviar evidência, inicie um novo envio") em vez de assumir sucesso.

## Achado novo #2 (MENOR) — constraints do schema devem ser explícitas, não "reaproveitadas" de um arquivo que não as tem

Correto — `docarchive-reserve-files-request.v1.json` não tem `enum`/`maximum`. O schema NOVO
(`docarchive-guest-submit-evidence-request.v1.json`, versão revisada) declara explicitamente:
```json
"mediaType": { "type": "string", "enum": ["application/pdf", "image/jpeg", "image/png"] },
"contentLength": { "type": "integer", "minimum": 1, "maximum": 10485760 },
"checksumSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
```
(mesmos VALORES do precedente de `document`/M6 — `ALLOWED_MEDIA_TYPES`/`MAX_UPLOAD_BYTES` —
portados como literais no schema E revalidados no serviço, disciplina de dupla trilha já usada em
outros módulos deste projeto.)

## Achado novo #3 (MENOR) — pseudocódigo autoconsistente

`seq = 1` declarado explicitamente (toda submissão guest cria uma versão nova na sequência 1, não
existe conceito de versão >1 no caminho guest). `buildQuarantineKey()` deixa de ser privado de
`document-archive-service.ts`: vira função pura exportada de `document-file.ts`
(`buildDocumentArchiveQuarantineKey(tenantId, documentId, seq, fileId)`), importada por AMBOS
`document-archive-service.ts` (`reserveFiles()`) e `guest-document-access-service.ts`
(`submitEvidence()`) — nunca duplicada, nunca método privado de uma classe que a outra não pode
chamar.

## Estado final da propriedade A14→G02→A13/A12 (framing explícito pedido pelo Codex)

Esta decisão fecha **armazenamento real de bytes no caminho guest**, sob o MESMO mecanismo de
segurança/scan já aprovado (D-163), com paridade total de comportamento em relação ao caminho
autenticado. Ela **não** fecha, e não tenta fechar, a ativação do gate STARTER/PROMOTER
(`EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED`/`DOCUMENT_ARCHIVE_PROMOTION_ENABLED`) — decisão de
produto separada, já nomeada (item 4 do roadmap), que afeta igualmente o caminho autenticado já em
produção. `D-265` (o D-number desta decisão) registrará os dois estados separadamente: "armazenamento
guest implementado" (fechado aqui) vs. "jornada revisável ponta a ponta" (ainda pendente da
ativação, não escopo desta decisão).

## Pedido final ao Codex

Reavalie com os 3 achados novos corrigidos acima (mais os 6 da Rodada 1, já RESOLVIDOS e
inalterados nesta rodada). Se ≥9,0, considere `APPROVED` e este design segue para implementação
(dentro do orçamento restante desta sessão) ou registro como `APPROVED`/ADR para uma sessão futura
implementar, conforme o tempo permitir.
