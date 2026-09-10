# ADR-0013 — Armazenamento real de arquivo no caminho guest (G02)

**Status**: Aceito | **Data**: 2026-09-10 | **Type**: Type 1 (nível 5-6/6 — nova superfície efetiva
de escrita anônima de bytes + custo de armazenamento real em um caminho antes gratuito) |
**Requisitos**: fecha pendência bloqueante nomeada em D-264 (Bloco 6, A14+G02)

## Contexto

D-264 (Bloco 6 do plano de sequenciamento de frontend) implementou A14+G02, mas
`GuestDocumentAccessService.submitEvidence()` aceitava só metadata de arquivo (`fileName`), nunca
bytes reais — achado bloqueante da rodada Codex daquela sessão (7,6/10), deliberadamente não
corrigido por ser decisão de nível 5-6/6 fora do orçamento daquele bloco. A propriedade completa
A14→G02→A13/A12 (emissão → submissão guest → continuação do operador) não fechava ponta a ponta: um
documento enviado por convidado nunca chegava de fato revisável (com arquivo) em A13/A12.

## Options Considered

1. **Reaproveitar 100% o mecanismo `DocumentFile`/scan já `APPROVED` (D-163) e já em produção para
   3 domínios (`document` M6, `subject` M10, `document-archive` D-193), estendendo-o para aceitar
   um segundo tipo de chamador (guest, gated por credential/session/CSRF em vez de RBAC)**
   (escolhida). Zero infraestrutura nova (bucket de quarentena/GuardDuty/EventBridge/handler já
   compartilhados); só extensão de domínio/serviço/HTTP/infra IAM mínima.
2. Construir um pipeline de scan paralelo/dedicado ao caminho guest — rejeitada: violaria o
   próprio achado da pesquisa externa desta decisão (o padrão de referência AWS já está
   implementado neste projeto); duplicaria superfície de segurança sem motivo.
3. Não permitir upload real do guest, manter só metadata para sempre — rejeitada: não fecha a
   pendência nomeada em D-264, deixa a propriedade A14→G02→A13/A12 permanentemente quebrada.

## Pesquisa externa

SIM PARCIAL — OWASP File Upload Cheat Sheet (allowlist/scan-antes-de-confiar/nunca confiar no nome
do cliente/preferir identificabilidade a anonimato puro) e AWS Security Blog + Mechanical Rock
(padrão de referência presign+quarentena+GuardDuty+EventBridge, TTL curto de presign) — confirmam
que o mecanismo já implementado neste projeto SEGUE o padrão de mercado; a parte de integração com
o modelo de dados específico (DynamoDB/GSI8) é puramente interna. Detalhe completo:
`docs/architecture/reviews/guest-file-storage-scoping/round1-claude-proposal.md`.

## Evidence

`docs/architecture/reviews/guest-file-storage-scoping/` — 7 rodadas reais do protocolo Claude↔Codex
(nota cega a cada rodada): Rodada 1 5,8/10 (3 bloqueantes: `DocumentVersion` criado por `Put` não
`Update`, GSI8 ausente, gate STARTER/PROMOTER não endereçado + 3 menores) → Rodada 2 8,4/10 (6/6
originais resolvidos, 1 achado novo: race presign/deadline) → Rodada 3 8,8/10 (correção parcial) →
Rodada 4 7,8/10 (tentativa de ack introduziu 4 bugs de implementação novos) → Rodada 5 8,8/10 (4/5
corrigidos, 1 bug de loop OCC restante) → Rodada 6 8,9/10 (bug de loop corrigido, só faltava
exportar uma constante) → **Rodada 7 9,2/10 APPROVED**. Nenhuma rodada arredondada; cada achado
bloqueante verificado contra o código real antes de aceitar como corrigido.

## Decisão final de design

1. **Domínio**: `DocumentFile` ganha `deadlineExtended?: boolean` (campo esparso). Função
   `buildQuarantineKey()`/equivalente sai de método privado de `document-archive-service.ts` e
   vira função pura exportada de `document-file.ts`, reaproveitada por `reserveFiles()` (caminho
   autenticado) e `submitEvidence()` (caminho guest) — nunca duplicada. `MAX_OCC_RETRIES` (já
   existente em `apply-file-scan-result.ts`) passa a ser exportado.
2. **`GuestDocumentAccessServiceDeps`** ganha `signer`/`quarantineBucket`. `SubmitEvidenceInput`
   ganha `mediaType`/`contentLength`/`checksumSha256` (validados no serviço: allowlist portada de
   `document`/M6 — pdf/jpeg/png, 10 MiB —, regex hex64 para checksum, qualquer falha colapsa em
   `GuestAccessInvalidError` genérico). A transação existente de `submitEvidence()` ganha 1 `Put`
   de `DocumentFile` (PENDING_UPLOAD, GSI8 completo) e o `Put` de `DocumentVersion` ganha
   `fileSetSealed/principalFileId/totalFiles/pendingFileScans` diretamente no literal (nunca um
   `Update` separado no mesmo item) + reserva de quota de armazenamento (mesma condição de
   `reserveFiles()`). Depois do commit, presigna um PUT — em replay, presigna só pelo tempo
   restante até o deadline GSI8 original (nunca reabre uma janela de 600s nova); se o tempo
   restante já é ≤0 ou o `scanStatus` já é terminal, `uploadUrl` vem ausente.
3. **Novo método `confirmUploadInFlight()`** — chamado pelo guest logo após o S3 confirmar 200 no
   PUT. Resolve o `fileId`/`documentId` SÓ a partir do registro de idempotência da submissão
   original (nunca aceita `fileId` cru do cliente). Loop OCC limitado (`MAX_OCC_RETRIES`,
   reaproveitado) que estende o deadline GSI8 uma única vez (`deadlineExtended`) enquanto
   `scanStatus` for `PENDING_UPLOAD` OU `SCANNING` — reduz a janela de corrida contra o worker de
   reconciliação ao round-trip de rede do browser, nunca aos ~600s inteiros. Nunca toca
   `scanStatus`/pipeline de scan — não interage com o gate STARTER/PROMOTER.
4. **Gate STARTER/PROMOTER (D-193 item 8/9) é herdado sem alteração** —
   `EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED`/`DOCUMENT_ARCHIVE_PROMOTION_ENABLED` continuam
   deliberadamente `false` (decisão de produto separada, item 4 do roadmap). Enquanto desligadas,
   arquivos guest (como os autenticados já hoje) não chegam a `CLEAN`/revisável — esta ADR fecha
   **armazenamento real de bytes com paridade total ao caminho autenticado**, não a ativação de
   OCR/extração, que segue como pendência nomeada separada e não bloqueante.
5. **HTTP**: schema `docarchive-guest-submit-evidence-request.v1.json` ganha `mediaType`
   (`enum`)/`contentLength` (`maximum: 10485760`)/`checksumSha256` (`pattern` hex64) como
   `required`; nova rota para `confirmUploadInFlight`. `validateAgainstSchema()` em
   `handleSubmitEvidence` envolvida em try/catch que colapsa qualquer falha em
   `GuestAccessInvalidError` (fecha vazamento de detalhe Ajv que os campos novos tornariam mais
   discriminante).
6. **Infra**: `module.document_archive_guest_handler` ganha `QUARANTINE_BUCKET_NAME` +
   `data.aws_iam_policy_document.document_archive_presign_quarantine_put.json` (política já
   existente, reaproveitada) — nenhum recurso novo de GuardDuty/EventBridge/bucket.
7. **Frontend**: G02 reaproveita `computeChecksumSha256()`/`uploadDocumentBytes()` de
   `frontend/src/api/documents.ts` (import direto). Fluxo: submit → PUT (se `uploadUrl` presente) →
   `confirmUploadInFlight` → só então copy de sucesso. Falha em qualquer etapa mostra copy neutra
   ("já processado ou expirou, inicie novo envio"), nunca afirma recebimento não confirmado.

## Correctness/Security Impact

- Nunca promove a "confiável" sem scan (herdado, D-163); nunca auto-aceita mesmo com scan limpo
  (C2, pré-existente); nome de arquivo do cliente nunca vira caminho de armazenamento; presign de
  vida curta e nunca além do deadline original; identificabilidade via credential/session/CSRF
  (nunca endpoint verdadeiramente anônimo); quota de armazenamento agora aplicada a um caminho
  antes gratuito, fechando um vetor de abuso que a mudança em si introduz.
- `confirmUploadInFlight` é de uso único por arquivo (`deadlineExtended`, OCC), autoriza só via
  registro de idempotência da própria sessão (nunca `fileId` cru), preserva CSRF/rate-limit da
  mesma disciplina de `submitEvidence()`.

## Fora de escopo (nomeado)

Ativação do gate STARTER/PROMOTER (decisão de produto separada, item 4 do roadmap); binding
sessão↔token do guest (achado pré-existente de D-264, achado #2); unicidade de série ACTIVE por
Requirement (achado #3 de D-264); suporte a múltiplos arquivos/`ATTACHMENT` no caminho guest;
hardening equivalente do try/catch de schema nas outras rotas guest (pré-existente, menos
discriminante).

## Implementação

Design `APPROVED`, ainda **NÃO implementado** nesta sessão — orçamento de turnos desta invocação
esgotado nas 7 rodadas do protocolo. Próxima sessão/fork implementa exatamente este design (seção
"Decisão final de design" acima é o plano de implementação completo), roda gate local, 1 rodada
Codex sobre a implementação real (pode divergir do design em detalhes mecânicos de código, mesma
disciplina do resto do projeto), commit/push/merge.

## References

`docs/architecture/reviews/guest-file-storage-scoping/` (7 rodadas completas); D-264
(`docs/architecture/decisions-log.md`); D-163 (`docs/architecture/reviews/document-file-scoping/`);
D-193 (`estado-final-consolidado.md`, gate STARTER/PROMOTER); D-249 (storage quota).
