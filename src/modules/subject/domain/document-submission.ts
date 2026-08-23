/**
 * DocumentSubmission — 04-domain-model-guest-upload.md (D-037). Agregado-irmão de `Document`
 * (M6): reaproveita os MESMOS tipos de evidência/status (`DocumentStatus`, `UploadEvidence`,
 * `MalwareEvidence`, `DocumentObjectReference` — vocabulário do ciclo de vida de
 * upload/malware-scan, agnóstico a quem iniciou o upload), mas é uma entidade NOVA e SEPARADA
 * de `Document` — nunca generaliza o agregado já em produção real (mesmo princípio já aplicado
 * em `06-domain-model-automated-chasing.md` para `NotificationIntent`/`ReminderOccurrence`).
 *
 * Ancorado no `RequirementAssignment`, nunca num `ExpirationItem` artificial (aviso explícito
 * do prompt estratégico) — evita a exigência de `Document.itemId` que M6 sempre teve.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { DocumentStatus, UploadEvidence } from "../../document/domain/document.js";
import type { MalwareEvidence } from "../../document/domain/malware-scan-result.js";
import type { DocumentObjectReference } from "../../document/domain/document-object-reference.js";

export type { DocumentStatus, UploadEvidence, MalwareEvidence, DocumentObjectReference };

export interface DocumentSubmission extends EntityKey {
  entityType: "DocumentSubmission";
  submissionId: string;
  tenantId: string;
  subjectId: string;
  assignmentId: string;
  documentRequestId: string;
  fileName: string;
  mediaType: string;
  contentLength: number;
  checksumSha256: string;
  status: DocumentStatus;
  quarantineObject: DocumentObjectReference;
  cleanObject?: DocumentObjectReference;
  uploadEvidence?: UploadEvidence;
  malwareEvidence?: MalwareEvidence;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export function documentSubmissionKey(tenantId: string, subjectId: string, assignmentId: string, submissionId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `REQASSIGN#${assignmentId}#SUBMISSION#${submissionId}` };
}
