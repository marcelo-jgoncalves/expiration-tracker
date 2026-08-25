/**
 * Typed contracts - the domain-relevant subset of what the backend actually returns
 * (src/modules/expiration/domain/expiration-item.ts's ExpirationItem), never the full
 * persisted record. The real API response also carries internal storage fields (PK, SK,
 * GSI1PK, GSI1SK) that exist for DynamoDB's benefit, not the UI's - TypeScript's structural
 * typing means the extra fields are harmless to receive and simply never referenced here,
 * rather than requiring a backend response-shape change this foundation stage doesn't need.
 */

export type ExpirationItemStatus = "ACTIVE" | "ARCHIVED" | "RENEWED" | "DELETED";

export interface ExpirationItem {
  itemId: string;
  tenantId: string;
  name: string;
  category: string;
  description?: string;
  dueDate: string;
  issueDate?: string;
  periodicity?: string;
  issuer?: string;
  number?: string;
  assigneeUserId?: string;
  tags: string[];
  priority?: string;
  status: ExpirationItemStatus;
  renewedFromId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateItemInput {
  name: string;
  category: string;
  description?: string;
  dueDate: string;
  issueDate?: string;
  periodicity?: string;
  issuer?: string;
  number?: string;
  assigneeUserId?: string;
  tags?: string[];
  priority?: string;
}

export interface DashboardQuery {
  status: ExpirationItemStatus;
  ascending?: boolean;
  limit?: number;
}

/** POST /items/{itemId}/renew request body (src/modules/expiration/domain/expiration-item.ts
 * RenewItemInput). `cycle` defaults server-side to `newDueDate` when omitted - the Renew form
 * never sends it explicitly, there is no product reason yet to expose a distinct cycle label. */
export interface RenewItemInput {
  newDueDate: string;
  cycle?: string;
}

export interface ItemResponse {
  item: ExpirationItem;
}

/** renewItem's response also carries `copiedReminderPolicyIds` (reminder-delivery-
 * pipeline.md §8, Marcelo's decision 2026-08-25): the backend auto-copies the source item's
 * ReminderPolicy onto the new item and reports it explicitly, never inferred from absence,
 * so the UI can prompt the user to review it. */
export interface RenewItemResponse extends ItemResponse {
  copiedReminderPolicyIds: string[];
}

export interface DashboardResponse {
  items: ExpirationItem[];
}

/**
 * BLOCKER-C review queue (Variante B, revisão humana explícita — decisão do Marcelo,
 * 2026-08-25, reminder-delivery-pipeline.md's sibling decision brief). The domain-relevant
 * subset of src/modules/subject/domain/{tracked-subject,requirement-assignment,document-
 * submission}.ts, same convention as ExpirationItem above.
 */
export type TrackedSubjectStatus = "ACTIVE" | "ARCHIVED" | "DELETED";
export type TrackedSubjectType = "COMPANY" | "VENDOR" | "CLIENT" | "EMPLOYEE" | "ASSET" | "LOCATION" | "CUSTOM";

export interface TrackedSubject {
  subjectId: string;
  tenantId: string;
  type: TrackedSubjectType;
  displayName: string;
  notes?: string;
  tags: string[];
  status: TrackedSubjectStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type RequirementAssignmentStatus = "MISSING" | "REQUESTED" | "SUBMITTED" | "UNDER_REVIEW" | "REJECTED" | "SATISFIED";

export interface RequirementAssignment {
  assignmentId: string;
  subjectId: string;
  tenantId: string;
  requirementName: string;
  notes?: string;
  status: RequirementAssignmentStatus;
  linkedItemId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Same lifecycle vocabulary as Document (src/modules/document/domain/document.ts) - a
 * DocumentSubmission is Document's sibling aggregate for guest-uploaded evidence, never
 * merged into the same type (BLOCKER-A's own read routes keep them separate too). */
export type DocumentSubmissionStatus = "PENDING_UPLOAD" | "SCANNING" | "CLEAN" | "REJECTED" | "UNSUPPORTED" | "TIMEOUT" | "DELETED";

export interface DocumentSubmission {
  submissionId: string;
  subjectId: string;
  assignmentId: string;
  documentRequestId: string;
  fileName: string;
  status: DocumentSubmissionStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SubjectResponse {
  subject: TrackedSubject;
}

export interface SubjectsDashboardResponse {
  subjects: TrackedSubject[];
}

export interface RequirementAssignmentResponse {
  assignment: RequirementAssignment;
}

export interface RequirementAssignmentsResponse {
  assignments: RequirementAssignment[];
}

export interface DocumentSubmissionsResponse {
  submissions: DocumentSubmission[];
}
