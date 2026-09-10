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
  /** D-136/D-E: opaque cursor for the next page, `null` when there are no more pages. Never
   * interpreted client-side - only echoed back verbatim as the `cursor` query param. */
  nextCursor: string | null;
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
  /** A08 (Block 3, D-2xx) - create-only durable external identifier (CNPJ, CRM id, etc.) -
   * mirrors `src/modules/subject/domain/tracked-subject.ts`'s `externalId`. */
  externalId?: string;
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

/** A08 (Block 3, D-2xx) - mirrors `src/modules/subject/domain/tracked-subject.ts`'s
 * `CreateSubjectInput`/`UpdateSubjectInput` exactly. `externalId` is create-only (no rename
 * path on update - see that file's own doc comment on why). */
export interface CreateSubjectInput {
  type: TrackedSubjectType;
  displayName: string;
  notes?: string;
  tags?: string[];
  externalId?: string;
}

export interface UpdateSubjectInput {
  displayName?: string;
  notes?: string;
  tags?: string[];
}

export interface SubjectSearchPage {
  items: TrackedSubject[];
  cursor: string | null;
  scanLimitReached?: boolean;
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

// Wave B2B-10 (Tenant-aware Frontend) - members/invitations/settings.

/** A09/A11 (Block 3, D-2xx) - `document-archive` module's evidence-backed `Requirement`
 * (`src/modules/document-archive/domain/requirement.ts`). A DISTINCT concept from
 * `RequirementAssignment` above (the legacy `subject` module one, MISSING/SATISFIED only, A10)
 * - never rendered under the bare label "Requisito", always "Requisito documental" here, per
 * the A11 spec's naming-collision verification. */
export type RequirementStatus = "MISSING" | "PENDING" | "SATISFIED" | "NOT_SATISFIED" | "NOT_APPLICABLE";
export type RequirementApplicability = "APPLICABLE" | "NOT_APPLICABLE";

export interface Requirement {
  requirementId: string;
  subjectId: string;
  name: string;
  notes?: string;
  applicability: RequirementApplicability;
  assigneeUserId?: string;
  evidenceVersionId?: string;
  evidenceDocumentId?: string;
  evidenceSeq?: number;
  evidenceValidUntil?: string;
  status: RequirementStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateRequirementInput {
  subjectId: string;
  name: string;
  notes?: string;
  applicability: RequirementApplicability;
  assigneeUserId?: string;
}

export interface UpdateRequirementInput {
  name?: string;
  notes?: string;
  applicability?: RequirementApplicability;
  assigneeUserId?: string;
}

export interface RequirementSearchPage {
  items: Requirement[];
  cursor: string | null;
  scanLimitReached?: boolean;
}

/** Roadmap P0.6 fatia 2 - `null` (never `0%`) when `totalRequirements === 0`, per A09's spec
 * ("sempre mostrar numerador/denominador junto ao percentual"). */
export interface SubjectComplianceSummary {
  totalRequirements: number;
  satisfiedCount: number;
  expiringSoonCount: number;
  missingCount: number;
  compliancePercent: number | null;
}

// A20 (Block 4, D-2xx) - `document-archive` module's `DocumentType` catalog
// (`src/modules/document-archive/domain/document-type.ts`). Tenant-wide, shared by every
// upload flow (A12) and the guest catalog (G02) - every `ACTIVE` type is guest-visible by
// construction, no separate visibility flag exists on the backend (never invent one here).
export type DocumentTypeStatus = "ACTIVE" | "DEPRECATED";
export type DocumentTypeFieldValueType = "TEXT" | "NUMBER" | "DECIMAL" | "DATE" | "BOOLEAN" | "SINGLE_SELECT";
export type DocumentTypeFieldStatus = "ACTIVE" | "ARCHIVED";
export type DocumentTypeFieldOptionStatus = "ACTIVE" | "ARCHIVED";

export interface DocumentTypeFieldOption {
  optionId: string;
  label: string;
  status: DocumentTypeFieldOptionStatus;
}

export interface DocumentTypeMetadataFieldDefinition {
  fieldId: string;
  name: string;
  valueType: DocumentTypeFieldValueType;
  required: boolean;
  options?: DocumentTypeFieldOption[];
  status: DocumentTypeFieldStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentType {
  documentTypeId: string;
  displayName: string;
  status: DocumentTypeStatus;
  metadataFields?: DocumentTypeMetadataFieldDefinition[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateDocumentTypeInput {
  displayName: string;
}

export interface CreateDocumentTypeMetadataFieldInput {
  name: string;
  valueType: DocumentTypeFieldValueType;
  required: boolean;
  options?: string[];
}

export type DocumentTypeFieldOptionPatchOp =
  | { op: "ADD"; label: string }
  | { op: "RENAME"; optionId: string; label: string }
  | { op: "ARCHIVE"; optionId: string }
  | { op: "REACTIVATE"; optionId: string };

export interface UpdateDocumentTypeMetadataFieldInput {
  name?: string;
  required?: boolean;
  status?: DocumentTypeFieldStatus;
  optionsPatch?: DocumentTypeFieldOptionPatchOp[];
}

// A21 (Block 4, D-2xx) - `RequirementTemplate` catalog
// (`src/modules/document-archive/domain/requirement-template.ts`). Applying is SNAPSHOT
// semantics (never a live link) - a later template edit never reaches an already-applied
// Requirement.
export type RequirementTemplateStatus = "ACTIVE" | "ARCHIVED";

export interface RequirementTemplateItem {
  templateItemId: string;
  name: string;
  notes?: string;
  applicability: RequirementApplicability;
  position: number;
}

export interface RequirementTemplate {
  templateId: string;
  displayName: string;
  description?: string;
  status: RequirementTemplateStatus;
  items: RequirementTemplateItem[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateRequirementTemplateInput {
  displayName: string;
  description?: string;
  items: Array<{ name: string; notes?: string; applicability?: RequirementApplicability }>;
}

export interface UpdateRequirementTemplateInput {
  displayName?: string;
  description?: string;
  items?: Array<{ name: string; notes?: string; applicability?: RequirementApplicability }>;
}

export type TemplateApplicationSkipReason = "DUPLICATE_NAME";

export interface TemplateApplicationSkip {
  templateItemId: string;
  name: string;
  reason: TemplateApplicationSkipReason;
  existingRequirementId: string;
  sameTemplateItem: boolean;
}

export interface TemplateApplicationPreview {
  create: RequirementTemplateItem[];
  skip: TemplateApplicationSkip[];
  templateVersion: number;
}

export interface TemplateApplicationResult {
  created: Array<{ templateItemId: string; requirementId: string; name: string }>;
  skipped: TemplateApplicationSkip[];
  templateVersion: number;
}

export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface Member {
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  joinedAt: string;
  version: number;
}

export interface MembersResponse {
  members: Member[];
}

export interface Invitation {
  invitationId: string;
  emailNormalized: string;
  role: MembershipRole;
  status: InvitationStatus;
  expiresAt: string;
}

export interface InvitationsResponse {
  invitations: Invitation[];
}

export interface OrganizationSettingsResponse {
  organizationId: string;
  displayName: string;
  timezone: string;
  version: number;
}

/**
 * D-149 (admin-activity-log-scoping/estado-final-consolidado.md) - GET /activity. Mirrors
 * src/modules/activity/application/activity-service.ts's ActivityEntry/ActivityPage: one
 * merged, chronological feed across the 4 audit-event partitions (expiration/organization/
 * subject/tenant). Rendered as short prose, never raw JSON (decisão 8) - `changes` exists on
 * the type only because the backend sends it, it is never displayed directly.
 */
export type ActivityPartition = "expiration" | "organization" | "subject" | "tenant";

export interface ActivityActor {
  type: "USER" | "SYSTEM";
  userId?: string;
}

export interface ActivityEntry {
  auditEventId: string;
  partition: ActivityPartition;
  occurredAt: string;
  actor: ActivityActor;
  action: string;
  resourceType: string;
  resourceId?: string;
  changes: Record<string, unknown>;
}

export interface ActivityPageResponse {
  entries: ActivityEntry[];
  /** Opaque composite cursor, `null` when there are no more pages - same "never interpreted
   * client-side" convention as DashboardResponse.nextCursor above. */
  cursor: string | null;
  hasMore: boolean;
}

/**
 * Storage-quota-scoping (D-2xx) - mirrors `StorageQuotaUsage`
 * (`src/modules/document-archive/domain/storage-quota.ts`) exactly, `GET
 * /document-archive/storage-usage`'s `{ usage }` envelope. `docarchive:read` is READ_ONLY_ROLES
 * (every role), matching A03's "todos os papéis" access for the conditional storage card.
 */
export interface StorageQuotaUsage {
  limitBytes: number;
  usedBytes: number;
  reservedBytes: number;
  availableBytes: number;
  /** A FRACTION in `0..1` (e.g. `0.1` = 10%), never a `0..100` percentage - confirmed against the
   * backend's own computation, `usedPercent = committed / quota.limitBytes`
   * (`src/modules/document-archive/domain/storage-quota.ts`), and its test
   * (`test/unit/document-archive/storage-quota.test.ts`: `expect(usage.usedPercent).toBeCloseTo(0.1)`
   * for a 10%-committed fixture). Codex block-review finding (D-256): every frontend call site
   * multiplies this by 100 for display and feeds it directly to `<progress max={1}>` - a
   * `0..100` value here would silently render as e.g. "8750%" - see
   * `frontend/test/routes/{Overview,Settings}.test.tsx`'s `usedPercent: 0.875`/`0.5` fixtures
   * asserting the correctly-rendered "87%"/"50%" text for the pinned frontend-side contract. */
  usedPercent: number;
  warningLevel: "OK" | "WARNING" | "CRITICAL" | "OVER";
}

export interface StorageUsageResponse {
  usage: StorageQuotaUsage;
}

/**
 * A07 (Generic Document/OCR attachment, Block 2 D-2xx) - mirrors
 * `src/modules/document/domain/document.ts`'s `Document` exactly. Two-phase upload model
 * (audited fix, `A07-arquivos-vencimento.md`): `PENDING_UPLOAD` means the slot was reserved
 * and a presigned URL issued, NOT that bytes have been received - the actual transfer is a
 * separate direct-to-storage PUT the frontend performs itself, never collapsed into one
 * action/state with reservation.
 */
export type DocumentStatus = "PENDING_UPLOAD" | "SCANNING" | "CLEAN" | "REJECTED" | "UNSUPPORTED" | "TIMEOUT" | "DELETED";

export interface ItemDocument {
  documentId: string;
  itemId: string;
  fileName: string;
  mediaType: string;
  contentLength: number;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface DocumentsListResponse {
  documents: ItemDocument[];
}

export interface DocumentResponse {
  document: ItemDocument;
}

/** POST /items/{itemId}/documents request body (`ReserveUploadInput`). */
export interface ReserveUploadInput {
  fileName: string;
  mediaType: string;
  contentLength: number;
  checksumSha256: string;
}

/** POST /items/{itemId}/documents response (`ReserveUploadResult`) - phase 1 only. The
 * frontend must PUT the raw file bytes to `uploadUrl` with `requiredHeaders` itself (phase 2)
 * before the document can ever leave `PENDING_UPLOAD`; there is no separate "commit" call in
 * this module (unlike document-archive's `/versions/{seq}/commit`) - the storage-layer PUT
 * itself is what the malware-scan pipeline reacts to. */
export interface ReserveUploadResult {
  documentId: string;
  uploadSlotId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

/** A06 (Reminder Policy) - mirrors src/modules/reminder/domain/reminder-policy.ts's
 * ReminderTrigger/ReminderPolicy exactly (the backend contract, not a UI-shaped subset).
 * `offsetIso` is the restricted "[-]P<N>D" grammar (recurrence.ts's `parseDayOffset`) - days
 * relative to the item's dueDate, never a general ISO-8601 duration. */
export type NotificationChannelKind = "EMAIL" | "WHATSAPP";

export interface ReminderTrigger {
  triggerId: string;
  offsetIso: string;
  localTime: string;
  audience?: "ASSIGNEE_AND_WATCHERS" | "MANAGER";
}

export interface QuietHours {
  startLocalTime: string;
  endLocalTime: string;
}

export interface ReminderPolicy {
  policyId: string;
  tenantId: string;
  scope: "TEMPLATE" | "ITEM";
  itemId?: string;
  name: string;
  triggers: ReminderTrigger[];
  timeZone: string;
  quietHours?: QuietHours;
  channels: NotificationChannelKind[];
  optOutChannels?: NotificationChannelKind[];
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /items/{itemId}/reminder-policy response (D-258 discovery route) - `policy: null` is a
 * legitimate, common state ("no policy configured yet"), never an error. */
export interface ItemReminderPolicyResponse {
  policy: ReminderPolicy | null;
}

/** POST/PUT /reminders/policies(/{policyId}) request body (`PutPolicyInput`). */
export interface PutPolicyInput {
  scope: "TEMPLATE" | "ITEM";
  itemId?: string;
  rule: {
    name: string;
    triggers: ReminderTrigger[];
    timeZone: string;
    quietHours?: QuietHours;
    channels: NotificationChannelKind[];
    optOutChannels?: NotificationChannelKind[];
  };
  enabled?: boolean;
}

/**
 * A13 (Block 5, D-2xx) — `document-archive`'s review-queue subset of `DocumentVersion`/
 * `Document` (`src/modules/document-archive/domain/document-version.ts`/`document.ts`). Only
 * the fields this screen actually renders/decides on are declared here — same "domain-relevant
 * subset, not the full persisted record" convention `ExpirationItem`'s own doc comment states,
 * deliberately excluding the GSI5 sparse-index bookkeeping fields.
 */
export type ReviewQueueState = "RECEIVED" | "UNDER_REVIEW";

/** Closed taxonomy, `document-version.ts`'s `RejectionReason` — mirrors it exactly (backend
 * has no free-text field alongside "OTHER" today; the audited spec's "texto livre quando o
 * domínio permitir" is conditional precisely because the domain does not yet permit it here). */
export type RejectionReason = "EXPIRED" | "ILLEGIBLE" | "INCORRECT" | "WRONG_SUBJECT" | "OUTDATED_VERSION" | "INCOMPLETE" | "OTHER";

export type ReviewDocumentVersionState = ReviewQueueState | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "WITHDRAWN" | "DRAFT";
export type DocumentVersionOrigin = "MANUAL_UPLOAD" | "GUEST_UPLOAD" | "REQUEST_RESPONSE" | "IMPORT" | "AUTOMATED_CAPTURE";

export interface ReviewDocumentVersion {
  documentId: string;
  seq: number;
  versionId: string;
  state: ReviewDocumentVersionState;
  origin: DocumentVersionOrigin;
  validFrom?: string;
  validUntil?: string;
  receivedAt?: string;
  reviewerId?: string;
  decidedAt?: string;
  rejectionReason?: RejectionReason;
  pendingFileScans: number;
  infectedFileScans: number;
  requestId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** `document.ts`'s `Document` has no display `name` field (only `subjectId`/`documentTypeId`) —
 * the row/detail panel shows the identifiers it actually has, a graceful-degradation precedent
 * this codebase already uses elsewhere (`RequirementsCollection`'s row shows `r.subjectId`
 * directly, no name-resolution fetch), not a fabricated field. */
export interface ReviewDocumentSummary {
  documentId: string;
  subjectId: string;
  documentTypeId: string;
}

export interface ReviewQueueHit {
  version: ReviewDocumentVersion;
  document?: ReviewDocumentSummary;
}

export interface ReviewQueuePage {
  items: ReviewQueueHit[];
  cursor: string | null;
}

export interface PolicyResponse {
  policy: ReminderPolicy;
}
