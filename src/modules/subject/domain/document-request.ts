/**
 * DocumentRequest — 04-domain-model-guest-upload.md (D-037). Mesma partição do
 * RequirementAssignment (coleção sob o subject, sem GSI novo). Destinatário como snapshot
 * inline (não bloqueia por `ExternalContact`, ainda não modelado — decisão explícita do
 * cluster 2).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { InitialInviteDeliveryOverride } from "./document-request-delivery-preference.js";

export type DocumentRequestStatus = "REQUESTED" | "OPENED" | "SUBMITTED" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "REVOKED";

export interface DocumentRequest extends EntityKey {
  entityType: "DocumentRequest";
  documentRequestId: string;
  tenantId: string;
  subjectId: string;
  assignmentId: string;
  recipientEmail: string;
  recipientDisplayName?: string;
  requestedByUserId: string;
  requestedAt: string;
  deadline?: string;
  status: DocumentRequestStatus;
  tokenSelectorHash: string;
  tokenVersion: number;
  tokenExpiresAt: string;
  revokedAt?: string;
  lastOpenedAt?: string;
  submissionCount: number;
  lastSubmissionId?: string;
  completedAt?: string;
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function documentRequestKey(tenantId: string, subjectId: string, assignmentId: string, documentRequestId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `REQASSIGN#${assignmentId}#DOCREQ#${documentRequestId}` };
}

export interface CreateDocumentRequestInput {
  recipientEmail: string;
  recipientDisplayName?: string;
  deadline?: string;
  /** M10 cluster 4 (D-049): override por chamada do modo de entrega do convite inicial -
   * `"DEFAULT"` (ou ausente) usa a preferência do tenant, ver `document-request-delivery-preference.ts`. */
  initialInviteDelivery?: InitialInviteDeliveryOverride;
}
