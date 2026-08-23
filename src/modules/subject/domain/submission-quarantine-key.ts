/**
 * Parses tenantId/subjectId/assignmentId/submissionId/documentId/uploadSlotId out of a
 * quarantine object key built for a guest DocumentSubmission upload —
 * `tenant/<tenantId>/subject/<subjectId>/assignment/<assignmentId>/submission/<submissionId>/
 * document/<documentId>/slot/<uploadSlotId>/<uuid>`. Encodes every ID needed to reconstruct
 * `documentSubmissionKey()` directly in the key — same philosophy as M6's `quarantine-key.ts`
 * ("the S3/GuardDuty event carries only bucket/key/versionId, no other app context").
 *
 * Desvio deliberado e mais conservador em relação ao formato único `anchor/<ITEM|SUBMISSION>`
 * proposto em 04-domain-model-guest-upload.md: em vez de generalizar
 * `document/domain/quarantine-key.ts#parseQuarantineKey` (usado pelos 2 Lambda handlers já
 * verificados em produção real, M6), este é um parser SEPARADO com namespace de key que NUNCA
 * colide com o formato existente (`.../item/...` vs `.../subject/...` no mesmo segmento de
 * posição) — o parser antigo continua 100% intocado, e os handlers tentam-no primeiro (ver
 * upload-finalizer-handler.ts/malware-result-handler.ts). Justificativa: esta sessão não tem
 * como exercitar o pipeline real de GuardDuty/S3 (Camada 3), então unificar o parser da
 * produção já verificada é risco desproporcional ao benefício de não ter 2 regexes. Unificação
 * fica registrada como limpeza futura possível, não decidida agora.
 */
export interface ParsedSubmissionQuarantineKey {
  tenantId: string;
  subjectId: string;
  assignmentId: string;
  submissionId: string;
  documentId: string;
  uploadSlotId: string;
}

const KEY_PATTERN =
  /^tenant\/([^/]+)\/subject\/([^/]+)\/assignment\/([^/]+)\/submission\/([^/]+)\/document\/([^/]+)\/slot\/([^/]+)\//;

export function parseSubmissionQuarantineKey(key: string): ParsedSubmissionQuarantineKey | undefined {
  const match = KEY_PATTERN.exec(key);
  if (!match) return undefined;
  const [, tenantId, subjectId, assignmentId, submissionId, documentId, uploadSlotId] = match;
  if (!tenantId || !subjectId || !assignmentId || !submissionId || !documentId || !uploadSlotId) return undefined;
  return { tenantId, subjectId, assignmentId, submissionId, documentId, uploadSlotId };
}
