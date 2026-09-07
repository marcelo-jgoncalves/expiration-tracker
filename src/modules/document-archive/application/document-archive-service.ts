/**
 * DocumentArchiveService — D-143 Nucleus 1: orchestrates the Document/DocumentVersion state
 * machine (`domain/document-version.ts`) against real transactional writes
 * (`ports/document-archive-store.ts`). `acceptVersion`'s transaction here only builds the
 * Document/DocumentVersion/DocumentVersionEvent/idempotency actions (up to 6 of the up-to-10
 * the full design describes); DocumentRequest fencing (items 7-10) is added when that module
 * exists. Out of scope for this increment: DocumentRequest origin, guest access, recurrence,
 * DocumentFile persistence/malware scanning.
 *
 * D-143 Nucleus 2, entity 1 (Decision 5/D9, D-145): also hosts Requirement CRUD +
 * linkEvidence/unlinkEvidence (`createRequirement`.. below) — kept in this same service rather
 * than a new class because Requirement's only cross-entity dependency is DocumentVersion, which
 * this service already reads via `findVersionById`; a second service class would only add an
 * extra composition-root wire for no real separation of concerns at this module's current size.
 */
import {
  buildConditionalDelete,
  buildExistenceConditionCheck,
  buildVersionedCreate,
  buildVersionedDelete,
  buildVersionConditionCheck,
  buildVersionedUpdate,
  getCancellationReasonCodes,
  isTransactionCanceled,
  type EntityKey,
  type TransactWriteEntry,
} from "../../../shared/dynamodb/occ.js";
import {
  AuthorizationError,
  ConflictError,
  DocumentTypeNameConflictError,
  DocumentTypeNotActiveError,
  IneligibleAssigneeError,
  NotFoundError,
  RequirementNameConflictError,
  SubjectPreconditionFailedError,
  TemplatePreconditionFailedError,
  ValidationError,
} from "../../../shared/errors/app-error.js";
import type { MemberEligibilityChecker } from "../../expiration/ports/member-eligibility.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { normalizeDisplayName } from "../../../shared/text/normalize-display-name.js";
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { DocumentArchiveStore } from "../ports/document-archive-store.js";
import type { DocumentArchiveIdGenerator } from "./id-generator.js";
import {
  type CreateDocumentInput,
  type Document,
  type DocumentMetadataValue,
  type DocumentMetadataValueInput,
  describeMetadataValueFormatError,
  documentGsi1Keys,
  documentGsi2Keys,
  documentKey,
} from "../domain/document.js";
import {
  assertTemplateItemNamesUnique,
  assertTemplateItemSizes,
  MAX_NAME_BYTES,
  MAX_NOTES_BYTES,
  MAX_TEMPLATE_ITEMS,
  planTemplateApplication,
  requirementNamePointerKey,
  requirementTemplateGsi1Keys,
  requirementTemplateKey,
  requirementTemplateNamePointerKey,
  SUBJECT_STATUS_ACCEPTING_REQUIREMENTS,
  trackedSubjectKeyForFence,
  type CreateRequirementTemplateInput,
  type RequirementNamePointer,
  type RequirementTemplate,
  type RequirementTemplateItem,
  type RequirementTemplateNamePointer,
  type TemplateApplicationPlan,
  type UpdateRequirementTemplateInput,
} from "../domain/requirement-template.js";
import {
  documentTypeGsi1Keys,
  documentTypeKey,
  documentTypeNamePointerKey,
  MAX_ACTIVE_METADATA_FIELDS,
  MAX_ACTIVE_OPTIONS_PER_FIELD,
  MAX_METADATA_FIELD_NAME_CHARS,
  MAX_METADATA_FIELD_OPTION_LABEL_CHARS,
  MAX_TOTAL_METADATA_FIELD_DEFINITIONS,
  MAX_TOTAL_OPTIONS_PER_FIELD,
  type CreateDocumentTypeInput,
  type CreateDocumentTypeMetadataFieldInput,
  type DocumentType,
  type DocumentTypeFieldOption,
  type DocumentTypeFieldOptionPatchOp,
  type DocumentTypeMetadataFieldDefinition,
  type DocumentTypeNamePointer,
  type UpdateDocumentTypeMetadataFieldInput,
} from "../domain/document-type.js";
import {
  assertExactlyOnePrincipal,
  documentFileGsi8Keys,
  documentFileKey,
  deriveDocumentFileMaintenanceDue,
  FILE_SCAN_TIMEOUT_SECONDS,
  MAX_FILES_PER_VERSION,
  type DocumentFile,
  type FileUploadSpec,
} from "../domain/document-file.js";
import type { UploadUrlSigner } from "../../document/ports/upload-url-signer.js";
import {
  assertValidDocumentVersionTransition,
  documentVersionKey,
  hasCleanFileScans,
  InvalidDocumentVersionTransitionError,
  reviewQueueGsi5Keys,
  type DocumentVersion,
  type DocumentVersionOrigin,
  type DocumentVersionState,
  type RejectionReason,
} from "../domain/document-version.js";
import { documentVersionEventKey, idempotencyRecordKey, type DocumentVersionEvent, type IdempotencyRecord } from "../domain/document-version-event.js";
import {
  applyFileScanResult,
  confirmFileScanClean,
  type ApplyFileScanResultInput,
  type ApplyFileScanResultOutcome,
  type ConfirmFileScanCleanInput,
  type ConfirmFileScanCleanOutcome,
} from "./apply-file-scan-result.js";
import {
  deriveRequirementMaintenanceDue,
  deriveRequirementStatus,
  deriveRequirementValidityState,
  requirementGsi1Keys,
  requirementGsi8Keys,
  requirementGsi9Keys,
  requirementGsi9PartitionKey,
  requirementKey,
  REQUIREMENT_SK_PREFIX,
  type CreateRequirementInput,
  type Requirement,
  type RequirementApplicability,
  type RequirementStatus,
  type UpdateRequirementInput,
} from "../domain/requirement.js";
import type { UnifiedValidityState } from "../../../shared/domain/validity-state.js";
import { runPagedSearch, SEARCH_PAGE_SIZE } from "../../../shared/domain/paged-search.js";
import { appendToTransaction } from "../../../shared/outbox/outbox.js";
import type { DomainEvent } from "../../../shared/contracts/events.js";
import { computeDossierScopeHash, dossierExportRunKey, type DossierExportRun } from "../domain/dossier-export-run.js";
import { documentRequestKey, type DocumentRequest } from "../domain/document-request.js";
import { requestAccessCredentialKey } from "../domain/request-access-credential.js";
import { buildDocumentRequestCreatedOutboxEntry } from "./document-request-recurrence-service.js";

/** Metadata paired with each transaction entry so a cancellation is classified structurally
 * (P0.1/§8) rather than by a fixed `CancellationReasons` index. */
export type TransactEntryLabel =
  | { kind: "REQUIREMENT"; templateItemId?: string }
  | { kind: "POINTER"; name: string; templateItemId?: string }
  | { kind: "TEMPLATE_FENCE" }
  | { kind: "SUBJECT_FENCE" }
  | { kind: "DOCUMENT_TYPE_FENCE" }
  | { kind: "DOCUMENT" };

export interface DocumentArchiveServiceDeps {
  store: DocumentArchiveStore;
  tableName: string;
  ids: DocumentArchiveIdGenerator;
  /** D-163 §7: same quarantine bucket M6 already provisions (`infra/modules/document-buckets`)
   * — no new bucket for this module, only a new key namespace within it (see
   * `buildQuarantineKey` below). */
  quarantineBucket: string;
  /** Item 3 (2026-09-02): the SAME `UploadUrlSigner` port M6's `DocumentService` already
   * depends on (`src/modules/document/ports/upload-url-signer.ts`) — no new signer
   * abstraction, only a new call site against the existing one. */
  signer: UploadUrlSigner;
  /** D-194 Fatia 2: the SAME `MemberEligibilityChecker` port `expiration-service.ts` already
   * uses (`expiration/ports/member-eligibility.ts`) — validates `Requirement.assigneeUserId` on
   * `createRequirement`/`updateRequirement`, never a second eligibility abstraction. */
  members: MemberEligibilityChecker;
  now?: () => string;
}

export interface AcceptVersionResult {
  document: Document;
  acceptedVersionId: string;
}

/** Input to `buildCreateDocumentEntries()` — every field the pure planner needs, with
 * `subjectId`/`documentTypeId` already RESOLVED to real ids (D-192 §4: reference resolution
 * — externalId/displayName lookups via `SubjectExternalIdPointer`/`documentTypeNamePointerKey`
 * — is the import module's job, done in a batched `BatchGetItem` phase before this planner ever
 * runs; `document-archive` cannot reach `subject/**` per `.dependency-cruiser.cjs`, so this
 * function is deliberately never the place that does an externalId lookup itself). */
export interface BuildCreateDocumentEntriesInput {
  tableName: string;
  tenantId: string;
  documentId: string;
  subjectId: string;
  documentTypeId: string;
  hasValidity: boolean;
  now: string;
}

export interface BuildCreateDocumentEntriesResult {
  document: Document;
  entries: TransactWriteEntry[];
  labels: TransactEntryLabel[];
}

/**
 * D-192 §5/§6: pure planner (no I/O) that builds the `Document` row plus its transactional
 * entries — the SAME `{entries, labels}` shape `createRequirement()`/`applyTemplate()` already
 * use for structural cancellation classification. Reused by `createDocument()` below (zero
 * change to its external contract) and, later, by the bulk-import commit worker (not wired yet —
 * this slice only adds the function).
 *
 * Entry order fixed at [DocumentType fence, Subject fence, Document Put] — mirrors
 * `createRequirement()`'s "broadest precondition first" discipline in `throwClassifiedCancellation`.
 * The Subject fence (D-192 §5, gap `DA-SUBJECT-FENCE-01`) is NEW here: `createDocument()` never
 * checked the owning Subject's existence/status before this slice, unlike `createRequirement()`
 * (D-191) which already had it.
 */
export function buildCreateDocumentEntries(input: BuildCreateDocumentEntriesInput): BuildCreateDocumentEntriesResult {
  const { tableName, tenantId, documentId, subjectId, documentTypeId, hasValidity, now } = input;
  const document: Document = {
    ...documentKey(tenantId, documentId),
    entityType: "Document",
    documentId,
    tenantId,
    subjectId,
    documentTypeId,
    status: "ACTIVE",
    hasValidity,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...documentGsi1Keys(tenantId, "ACTIVE", now, documentId),
    // GSI2 (AP3, Documents-by-Subject) written as a second attribute set on the same item —
    // both index memberships live on one physical row, no mirror item needed for this pattern.
    ...documentGsi2Keys(tenantId, subjectId, documentTypeId, documentId),
  };

  const labels: TransactEntryLabel[] = [{ kind: "DOCUMENT_TYPE_FENCE" }, { kind: "SUBJECT_FENCE" }, { kind: "DOCUMENT" }];
  const entries: TransactWriteEntry[] = [
    buildExistenceConditionCheck({
      tableName,
      key: documentTypeKey(tenantId, documentTypeId),
      extra: { status: "ACTIVE" },
    }),
    // `attribute_exists(PK) AND status = ACTIVE` — enumerated, never `<> DELETED` (same reasoning
    // as `buildSubjectFence()` below; `TrackedSubjectStatus` is `ACTIVE | ARCHIVED | DELETED`).
    buildSubjectFence(tableName, tenantId, subjectId),
    { Put: buildVersionedCreate(tableName, document as unknown as Record<string, unknown> & EntityKey) },
  ];
  return { document, entries, labels };
}

/** Shared by `createRequirement`/`updateRequirement`/`applyTemplate` and, since D-192 §6,
 * `buildCreateRequirementEntries()` — the pointer row that makes the per-Subject name
 * uniqueness rule transactional rather than a read-then-write. Module-level (not a class method)
 * so the pure planner below can build the identical row with no `DocumentArchiveService`
 * instance in scope. */
function buildRequirementNamePointer(tenantId: string, subjectId: string, name: string, requirementId: string, now: string): RequirementNamePointer {
  const normalizedName = normalizeDisplayName(name);
  return {
    ...requirementNamePointerKey(tenantId, subjectId, normalizedName),
    entityType: "RequirementNamePointer",
    tenantId,
    subjectId,
    normalizedName,
    requirementId,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

/** `attribute_exists(PK) AND status = ACTIVE` — the status is ENUMERATED, never `<> DELETED`,
 * which would let an ARCHIVED Subject through (`TrackedSubjectStatus` is
 * `ACTIVE | ARCHIVED | DELETED`). Module-level for the same reason as `buildRequirementNamePointer`
 * above — shared by `createDocument`/`createRequirement`/`applyTemplate` and the pure planners. */
function buildSubjectFence(tableName: string, tenantId: string, subjectId: string) {
  return buildExistenceConditionCheck({
    tableName,
    key: trackedSubjectKeyForFence(tenantId, subjectId),
    extra: { status: SUBJECT_STATUS_ACCEPTING_REQUIREMENTS },
  });
}

/** Shared by all 4 Requirement mutation sites (D-179/D-185) plus `buildCreateRequirementEntries()`
 * — computes the GSI8 pointer fields to `set` (SATISFIED + `evidenceValidUntil`) or the sentinel
 * meaning "remove instead" (every other case), keeping `deriveRequirementMaintenanceDue` the
 * single source of truth for eligibility rather than re-deriving it at each call site. Module-level
 * for the same "pure planner needs no class instance" reason as the two helpers above. */
function buildRequirementGsi8Fields(status: RequirementStatus, evidenceValidUntil: string | undefined, tenantId: string, requirementId: string): { GSI8PK: string; GSI8SK: string } | Record<string, never> {
  const due = deriveRequirementMaintenanceDue(status, evidenceValidUntil);
  return due ? requirementGsi8Keys({ dueAtIso: due.dueAtIso, tenantId, requirementId }) : {};
}

/** Input to `buildCreateRequirementEntries()` — the sibling planner to
 * `buildCreateDocumentEntries()` above (D-192 §6 slice 3). No externalId/subjectId resolution
 * happens here either — same division of labor: the import module resolves references in a
 * batched phase before ever calling this pure function. */
export interface BuildCreateRequirementEntriesInput {
  tableName: string;
  tenantId: string;
  requirementId: string;
  subjectId: string;
  name: string;
  notes?: string;
  applicability: RequirementApplicability;
  /** D-194 Fatia 2 - callers MUST validate eligibility (`MemberEligibilityChecker`) BEFORE
   * calling this pure planner; it never validates on its own (no I/O). */
  assigneeUserId?: string;
  now: string;
}

export interface BuildCreateRequirementEntriesResult {
  requirement: Requirement;
  entries: TransactWriteEntry[];
  labels: TransactEntryLabel[];
}

/**
 * D-192 §6 slice 3: pure planner (no I/O), sibling to `buildCreateDocumentEntries()` above —
 * builds the `Requirement` row, its `RequirementNamePointer`, and the Subject fence, in the
 * exact `{requirement, entries, labels}` shape `createRequirement()` already builds inline.
 * Reused by `createRequirement()` below (zero change to its external contract) and, later, by
 * the bulk-import commit worker (not wired yet — this slice only adds the function).
 *
 * Entry order fixed at [Requirement Put, RequirementNamePointer Put, Subject fence] — matches
 * `createRequirement()`'s existing entry order (unlike Document's fence-first order) so this
 * refactor changes no observable transaction shape.
 */
export function buildCreateRequirementEntries(input: BuildCreateRequirementEntriesInput): BuildCreateRequirementEntriesResult {
  const { tableName, tenantId, requirementId, subjectId, name, notes, applicability, assigneeUserId, now } = input;
  const status = deriveRequirementStatus(applicability, undefined, new Date(now));
  const requirement: Requirement = {
    ...requirementKey(tenantId, subjectId, requirementId),
    entityType: "Requirement",
    requirementId,
    tenantId,
    subjectId,
    name,
    // `notes` omitted entirely (never written as an explicit `undefined` attribute value) when
    // the caller didn't supply one — same D3-style "no fabricated value" discipline as
    // Document.hasValidity's optional siblings.
    ...(notes !== undefined ? { notes } : {}),
    // D-194 Fatia 2 - same omit-when-absent discipline as `notes` above.
    ...(assigneeUserId !== undefined ? { assigneeUserId } : {}),
    applicability,
    status,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...requirementGsi1Keys(tenantId, status, now, requirementId),
    // Never due at creation (status is always MISSING/NOT_APPLICABLE here, `deriveRequirementStatus`
    // with no evidence linked) — included anyway for the same uniform-write-site discipline the
    // other 3 mutation sites need, since a future caller shape could change that invariant.
    ...buildRequirementGsi8Fields(status, undefined, tenantId, requirementId),
  };

  const labels: TransactEntryLabel[] = [{ kind: "REQUIREMENT" }, { kind: "POINTER", name }, { kind: "SUBJECT_FENCE" }];
  const entries: TransactWriteEntry[] = [
    { Put: buildVersionedCreate(tableName, requirement as unknown as Record<string, unknown> & EntityKey) },
    { Put: buildVersionedCreate(tableName, buildRequirementNamePointer(tenantId, subjectId, name, requirementId, now) as unknown as Record<string, unknown> & EntityKey) },
    buildSubjectFence(tableName, tenantId, subjectId),
  ];
  return { requirement, entries, labels };
}

/** A persisted `DocumentFile` row plus the presigned PUT the caller uploads its bytes to —
 * mirrors `ReserveUploadResult`'s shape in M6's `document-service.ts` (`uploadUrl`/
 * `requiredHeaders`), one per file in the batch instead of a single document. */
export interface ReservedFile {
  file: DocumentFile;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
}

// 10 minutes — same TTL M6's document-service.ts uses. Reuses domain's FILE_SCAN_TIMEOUT_SECONDS
// rather than a second constant (D-179 slice 3): the presign window and the scan-timeout deadline
// are deliberately the same window, so reserveFiles()'s GSI8 pointer and the presign expiry never
// drift apart.
const PRESIGN_TTL_SECONDS = FILE_SCAN_TIMEOUT_SECONDS;

/** D-194 Fatia 3 — see `searchRequirements`'s doc comment. `tag` is deliberately absent
 * (Requirement has no `tags` field, out of scope per the design). */
export interface RequirementSearchQuery {
  status: RequirementStatus;
  namePrefix?: string;
  assigneeUserId?: string;
  validityState?: UnifiedValidityState;
  exclusiveStartKey?: Record<string, unknown>;
}

export interface RequirementSearchHit {
  kind: "REQUIREMENT";
  requirement: Requirement;
  subjectDisplayName?: string;
}

export interface RequirementSearchPage {
  items: RequirementSearchHit[];
  lastEvaluatedKey?: Record<string, unknown>;
  scanLimitReached: boolean;
}

/** Roadmap P0.6, fatia 2 — see `getSubjectCompliance`'s doc comment for the exact formula. */
export interface SubjectComplianceSummary {
  totalRequirements: number;
  satisfiedCount: number;
  expiringSoonCount: number;
  missingCount: number;
  compliancePercent: number | null;
}

/** D-205 fatia 1 — one row per Requirement in a dossier preview response. Metadata-first
 * (decision 1): no evidence bytes, no version history yet (fatia 2's actual generation reads
 * that fresh). */
export interface DossierExportPreviewRow {
  requirementId: string;
  name: string;
  status: RequirementStatus;
  evidenceValidUntil?: string;
  assigneeUserId?: string;
}

/** D-205 fatia 2 — one row per Requirement fed to the PDF/XLSX builders. Same shape as
 * `DossierExportPreviewRow` plus `updatedAt` (decision 1's "histórico" field, name notwithstanding
 * - full version-event-log history is explicitly out of scope, decision 11's named limitation;
 * `updatedAt` is the closest proportional signal this codebase already tracks per Requirement). */
export interface DossierExportRow {
  requirementId: string;
  name: string;
  status: RequirementStatus;
  evidenceValidUntil?: string;
  assigneeUserId?: string;
  updatedAt: string;
}

/** D-226 Achado 2 — `createDocumentRequest`'s input. `idempotencyKey` is the caller's OWN key
 * (never the credential/session material this eventually issues) — same "idempotency key
 * identifies one logical operation" discipline `GuestDocumentAccessService.submitEvidence`
 * already documents for its own idempotency key. */
export interface CreateDocumentRequestInput {
  subjectId: string;
  requirementId: string;
  /** Absent means no deadline — the future guest-issuance consumer then applies
   * `DEFAULT_CREDENTIAL_TTL_DAYS` (D-226 decision central item 4), never a fabricated value here. */
  deadline?: string;
  idempotencyKey: string;
}

export class DocumentArchiveService {
  private readonly store: DocumentArchiveStore;
  private readonly tableName: string;
  private readonly ids: DocumentArchiveIdGenerator;
  private readonly quarantineBucket: string;
  private readonly signer: UploadUrlSigner;
  private readonly members: MemberEligibilityChecker;
  private readonly now: () => string;

  constructor(deps: DocumentArchiveServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.quarantineBucket = deps.quarantineBucket;
    this.signer = deps.signer;
    this.members = deps.members;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** D-194 Fatia 2 - same "empty string clears, undefined means not provided (never reaches
   * here), any other value must be a real eligible member" convention as
   * `ExpirationService.validateAssignee`. */
  private async validateAssignee(tenantId: string, assigneeUserId: string | undefined): Promise<void> {
    if (!assigneeUserId) return;
    if (!(await this.members.isEligibleMember(tenantId, assigneeUserId))) {
      throw new IneligibleAssigneeError("assigneeUserId is not an eligible member of this organization.", { assigneeUserId });
    }
  }

  /**
   * applyFileScanResult / confirmFileScanClean — D-163 §1/§5. Event-driven (S3 Object Created /
   * GuardDuty finding), never a user action - deliberately take no `RequestContext` and call no
   * `authorize()`, same posture as M6's `advanceAfterEvidence()` (only a human-initiated command
   * needs RBAC; a physical storage/scan event is trusted infrastructure input, verified by the
   * transactional evidence-correlation fence itself, not by a role check). Thin wiring only -
   * all real logic lives in `apply-file-scan-result.ts`, independently unit-testable without
   * this class. The actual S3 copy-to-clean between these two calls (`READY_TO_PROMOTE`'s
   * `sourceObject` -> `confirmFileScanClean`'s `cleanObject`) is owned by the future S3/
   * GuardDuty event worker, not this service (no `DocumentObjectStore` wired here yet).
   */
  async applyFileScanResult(input: ApplyFileScanResultInput): Promise<ApplyFileScanResultOutcome> {
    return applyFileScanResult({ store: this.store, tableName: this.tableName, ids: this.ids, now: this.now }, input);
  }

  async confirmFileScanClean(input: ConfirmFileScanCleanInput): Promise<ConfirmFileScanCleanOutcome> {
    return confirmFileScanClean({ store: this.store, tableName: this.tableName, ids: this.ids, now: this.now }, input);
  }

  /**
   * createDocument — D-173 §4: migrated off the loose `putIfAbsent` onto
   * `executeTenantBusinessMutation` to close a TOCTOU window where the referenced DocumentType
   * could flip to DEPRECATED between a read-before-write check and the actual `Put` — the
   * `ConditionCheck` runs inside the SAME `TransactWriteItems`, never a separate read.
   * `input.documentTypeId` (D-173 §5, item 4 of the design doc's "Próximo passo real") carries
   * the DocumentType's stable id — the field/GSI2SK format rename is atomic with no hybrid
   * state, since this project has no production data to migrate (D-093).
   */
  async createDocument(ctx: RequestContext, input: CreateDocumentInput): Promise<Document> {
    authorize({ context: ctx, action: "docarchive:create", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const documentId = this.ids.newDocumentId();
    const now = this.now();
    const { document, entries, labels } = buildCreateDocumentEntries({
      tableName: this.tableName,
      tenantId,
      documentId,
      subjectId: input.subjectId,
      documentTypeId: input.documentTypeId,
      hasValidity: input.hasValidity,
      now,
    });
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      this.throwClassifiedCancellation(err, labels, { documentId, subjectId: input.subjectId, documentTypeId: input.documentTypeId });
    }
    return document;
  }

  async getDocument(ctx: RequestContext, documentId: string): Promise<Document> {
    authorize({ context: ctx, action: "docarchive:read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.getDocumentUnchecked(ctx.tenant.tenantId, documentId);
  }

  private async getDocumentUnchecked(tenantId: string, documentId: string): Promise<Document> {
    const document = await this.store.get<Document>(documentKey(tenantId, documentId));
    if (!document) throw new NotFoundError("Document not found.", { documentId });
    return document;
  }

  async listVersions(ctx: RequestContext, documentId: string): Promise<DocumentVersion[]> {
    authorize({ context: ctx, action: "docarchive:read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.listVersionsUnchecked(ctx.tenant.tenantId, documentId);
  }

  private async listVersionsUnchecked(tenantId: string, documentId: string): Promise<DocumentVersion[]> {
    const items = await this.store.queryByPk<DocumentVersion>(`TENANT#${tenantId}#DOCUMENT#${documentId}`, "VERSION#");
    // DocumentVersionEvent rows share the "VERSION#" SK prefix (VERSION#<seq>#EVENT#...) —
    // filter to rows whose SK is exactly "VERSION#<seq>" (no further "#" segment).
    return items.filter((item) => /^VERSION#\d{6}$/.test(item.SK));
  }

  /** DRAFT creation (`reserveUpload`) — seq is 1 + the highest existing seq for this Document. */
  async reserveUpload(ctx: RequestContext, documentId: string, origin: DocumentVersionOrigin): Promise<DocumentVersion> {
    authorize({ context: ctx, action: "docarchive:upload", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    await this.getDocumentUnchecked(tenantId, documentId); // 404s if the Document doesn't exist
    const existingVersions = await this.listVersionsUnchecked(tenantId, documentId);
    const seq = existingVersions.reduce((max, v) => Math.max(max, v.seq), 0) + 1;
    const now = this.now();
    const version: DocumentVersion = {
      ...documentVersionKey(tenantId, documentId, seq),
      entityType: "DocumentVersion",
      versionId: this.ids.newVersionId(),
      documentId,
      tenantId,
      seq,
      state: "DRAFT",
      origin,
      pendingFileScans: 0,
      infectedFileScans: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const created = await this.store.putIfAbsent(version);
    if (!created) throw new ConflictError("DocumentVersion already exists at this sequence.", { documentId, seq });
    return version;
  }

  /**
   * reserveFiles — D-163 §2. Persists the `DocumentFile` set for a `DRAFT` Version in a
   * single `TransactWriteItems`: the Update on `DocumentVersion` (`fileSetSealed`/
   * `principalFileId`/`totalFiles`/`pendingFileScans`) is what actually closes the race
   * between two concurrent calls each supplying a single PRINCIPAL with distinct `fileId`s
   * (input validation alone — `assertExactlyOnePrincipal` — cannot close that race, only the
   * transaction's own condition on `fileSetSealed` can, since it's the one write both callers
   * necessarily contend on). Only permitted while the Version is `DRAFT` and not yet sealed.
   *
   * Item 3 (2026-09-02): presigns each file's upload URL against its own `quarantineObject`
   * key AFTER the transaction commits — mirrors M6's `document-service.ts` ordering (DynamoDB
   * admission point gates a new presigned URL, never the other way around). A presign failure
   * here therefore never leaves an orphaned `DocumentFile` row with no way to ever be uploaded
   * to: the row already exists and is retried by the reconciliation worker's TIMEOUT path if
   * the caller can't retry the presign directly.
   */
  async reserveFiles(ctx: RequestContext, documentId: string, seq: number, expectedVersion: number, files: readonly FileUploadSpec[]): Promise<ReservedFile[]> {
    authorize({ context: ctx, action: "docarchive:upload", resource: { tenantId: ctx.tenant.tenantId } });
    assertExactlyOnePrincipal(files);
    if (files.length > MAX_FILES_PER_VERSION) {
      throw new ValidationError(`At most ${MAX_FILES_PER_VERSION} files per DocumentVersion.`, { documentId, seq, count: files.length });
    }
    const tenantId = ctx.tenant.tenantId;
    const key = documentVersionKey(tenantId, documentId, seq);
    const current = await this.store.get<DocumentVersion>(key);
    if (!current) throw new NotFoundError("DocumentVersion not found.", { documentId, seq });
    if (current.state !== "DRAFT") throw new ConflictError("Files can only be reserved while the DocumentVersion is DRAFT.", { documentId, seq, state: current.state });
    if (current.fileSetSealed) throw new ConflictError("This DocumentVersion's file set is already sealed.", { documentId, seq });

    const now = this.now();
    const principalSpec = files.find((f) => f.role === "PRINCIPAL");
    if (!principalSpec) throw new ValidationError("Exactly one PRINCIPAL is required.", { documentId, seq });
    const documentFiles: DocumentFile[] = files.map((spec) => {
      const fileId = this.ids.newFileId();
      // D-179 slice 3: the scan-timeout deadline is fully known right here (createdAt=now, the
      // file starts PENDING_UPLOAD), so the GSI8 MaintenanceDueIndex pointer is stamped in this
      // same Put — same "write the pointer at the real transition, and creation IS that
      // transition when the due date needs no later event" reasoning invitationGsi8Keys() uses
      // for a PENDING Invitation.
      const due = deriveDocumentFileMaintenanceDue({ scanStatus: "PENDING_UPLOAD", createdAt: now })!;
      return {
        ...documentFileKey(tenantId, documentId, seq, fileId),
        entityType: "DocumentFile",
        tenantId,
        documentId,
        versionId: current.versionId,
        seq,
        fileId,
        role: spec.role,
        scanStatus: "PENDING_UPLOAD",
        mediaType: spec.mediaType,
        contentLength: spec.contentLength,
        checksumSha256: spec.checksumSha256,
        // D-163 §1: versionId consolidated later, atomically, by whichever physical event
        // (S3 Object Created / GuardDuty finding) observes the real object first — never
        // fabricated here (same placeholder discipline M6's Document.quarantineObject uses).
        quarantineObject: { bucket: this.quarantineBucket, key: this.buildQuarantineKey(tenantId, documentId, seq, fileId), versionId: "" },
        createdAt: now,
        updatedAt: now,
        version: 1,
        ...documentFileGsi8Keys({ dueAtIso: due.dueAtIso, tenantId, fileId }),
      };
    });
    const principalFileId = documentFiles.find((f) => f.role === "PRINCIPAL")!.fileId;

    const entries = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key,
          tenantId,
          expectedVersion,
          set: { fileSetSealed: true, principalFileId, totalFiles: documentFiles.length, pendingFileScans: documentFiles.length },
          now,
          extraConditions: [
            { expression: "#st = :draft", names: { "#st": "state" }, values: { ":draft": "DRAFT" } },
            { expression: "attribute_not_exists(#sealed) OR #sealed = :false", names: { "#sealed": "fileSetSealed" }, values: { ":false": false } },
          ],
        }),
      },
      ...documentFiles.map((file) => ({ Put: buildVersionedCreate(this.tableName, file as unknown as Record<string, unknown> & EntityKey) })),
    ];
    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("DocumentVersion's file set was concurrently reserved or the Version is no longer DRAFT.", { documentId, seq });
      throw err;
    }

    return Promise.all(
      documentFiles.map(async (file) => {
        const presigned = await this.signer.presignUpload({
          bucket: file.quarantineObject.bucket,
          key: file.quarantineObject.key,
          mediaType: file.mediaType,
          contentLength: file.contentLength,
          checksumSha256: file.checksumSha256,
          metadata: { documentId, versionId: current.versionId, fileId: file.fileId, tenantId },
          expiresInSeconds: PRESIGN_TTL_SECONDS,
        });
        return { file, uploadUrl: presigned.uploadUrl, requiredHeaders: presigned.requiredHeaders };
      }),
    );
  }

  /** D-163 §7: mirrors M6's quarantine key convention (`document-service.ts`'s
   * `tenant/<t>/item/<i>/document/<d>/slot/<s>/<random>`), namespaced under `document-archive/`
   * so the two key formats coexist in the same physical bucket without ever colliding — the S3
   * event handler routes on this prefix to pick the right parser (D-163 §7, deferred). Never
   * encodes the original file name (PII) — only internal identifiers. */
  private buildQuarantineKey(tenantId: string, documentId: string, seq: number, fileId: string): string {
    return `document-archive/tenant/${tenantId}/document/${documentId}/version/${seq}/file/${fileId}`;
  }

  /** DRAFT -> RECEIVED. File presence/malware-scan-clean validation is the caller's
   * responsibility in this increment (DocumentFile persistence is a follow-up slice) — this
   * method only enforces the state-machine transition itself.
   *
   * D-163 §4 gate, activated now that `reserveFiles()` has a real HTTP route (D-167): a Version
   * cannot commit until its file set is sealed (`reserveFiles()` ran and produced a determined,
   * immutable set of files), closing the race where a caller commits while files are still being
   * added/never reserved at all. The precondition is enforced twice — an in-memory pre-check for
   * a clear `ConflictError` message, and a transactional `ConditionCheck` (TOCTOU-safe, same
   * pattern as the PRINCIPAL fence in `acceptVersion()`, D-163 §5) so a concurrent `reserveFiles()`
   * that seals the set between the read and the write can never be missed. */
  async commitUpload(ctx: RequestContext, documentId: string, seq: number, expectedVersion: number): Promise<DocumentVersion> {
    authorize({ context: ctx, action: "docarchive:upload", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const key = documentVersionKey(tenantId, documentId, seq);
    const current = await this.store.get<DocumentVersion>(key);
    if (!current) throw new NotFoundError("DocumentVersion not found.", { documentId, seq });
    this.assertTransitionOrConflict(current.state, "RECEIVED", documentId, seq);
    if (!current.fileSetSealed) throw new ConflictError("This DocumentVersion's file set is not sealed yet — call reserveFiles() first.", { documentId, seq });
    const now = this.now();
    const gsi5 = reviewQueueGsi5Keys(tenantId, "RECEIVED", now, current.versionId);
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key,
      tenantId,
      expectedVersion,
      set: { state: "RECEIVED", receivedAt: now, ...gsi5 },
      now,
      extraConditions: [{ expression: "#sealed = :true", names: { "#sealed": "fileSetSealed" }, values: { ":true": true } }],
    });
    try {
      await this.store.transactWrite([{ Update: update }]);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("DocumentVersion was concurrently modified.", { documentId, seq });
      throw err;
    }
    return { ...current, state: "RECEIVED", receivedAt: now, version: expectedVersion + 1, updatedAt: now };
  }

  /** RECEIVED -> UNDER_REVIEW. Serializes concurrent reviewers: a second claim attempt fails
   * the OCC condition and receives ConflictError, never silently overwrites the first
   * reviewer's claim (D-143 Decision 1). */
  async claimReview(ctx: RequestContext, documentId: string, seq: number, expectedVersion: number): Promise<DocumentVersion> {
    authorize({ context: ctx, action: "docarchive:review", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const reviewerId = ctx.principal.userId;
    const key = documentVersionKey(tenantId, documentId, seq);
    const current = await this.store.get<DocumentVersion>(key);
    if (!current) throw new NotFoundError("DocumentVersion not found.", { documentId, seq });
    this.assertTransitionOrConflict(current.state, "UNDER_REVIEW", documentId, seq);
    const now = this.now();
    const gsi5 = reviewQueueGsi5Keys(tenantId, "UNDER_REVIEW", now, current.versionId);
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key,
      tenantId,
      expectedVersion,
      set: { state: "UNDER_REVIEW", reviewerId, ...gsi5 },
      now,
    });
    try {
      await this.store.transactWrite([{ Update: update }]);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("DocumentVersion is no longer RECEIVED (already claimed or decided).", { documentId, seq });
      throw err;
    }
    return { ...current, state: "UNDER_REVIEW", reviewerId, version: expectedVersion + 1, updatedAt: now };
  }

  /**
   * acceptVersion — D-143 Decision 2's transaction, Nucleus-1 scope (actions 1-2-3-4-5-6 of
   * the up-to-10 full design; Requirement/DocumentRequest fencing is added when those modules
   * exist). Idempotent: replaying the same `clientRequestToken` with the same effective
   * command returns the persisted `resultSnapshot` rather than re-executing (D-143
   * Decision 2/Bloqueador 4-5) — this increment enforces the idempotency record's uniqueness
   * but does not yet re-derive/compare a `payloadHash` (no varying payload shape to hash yet
   * at Nucleus-1 scope beyond the identifiers already in the transaction's own conditions).
   */
  async acceptVersion(ctx: RequestContext, documentId: string, seq: number, expectedVersion: number, clientRequestToken: string): Promise<AcceptVersionResult> {
    authorize({ context: ctx, action: "docarchive:review", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const actor = ctx.principal.userId;

    // Idempotency check FIRST, before any state-transition validation: a legitimate replay of
    // an already-applied `acceptVersion` must return the original result even though the real
    // current state has since moved on (e.g. ACCEPTED -> SUPERSEDED by a later renewal) — D-143
    // Decision 2/Bloqueador 4-5. Checking transition validity first would misclassify a genuine
    // replay as an illegal transition.
    const existingReplay = await this.store.get<IdempotencyRecord<AcceptVersionResult>>(idempotencyRecordKey(tenantId, documentId, seq, clientRequestToken));
    if (existingReplay) return existingReplay.resultSnapshot;

    const document = await this.getDocumentUnchecked(tenantId, documentId);
    const key = documentVersionKey(tenantId, documentId, seq);
    const current = await this.store.get<DocumentVersion>(key);
    if (!current) throw new NotFoundError("DocumentVersion not found.", { documentId, seq });
    this.assertReviewerOrAdmin(ctx, current);
    try {
      assertValidDocumentVersionTransition(current.state, "ACCEPTED");
    } catch (err) {
      if (err instanceof InvalidDocumentVersionTransitionError) throw new ConflictError("DocumentVersion is no longer eligible for acceptance.", { documentId, seq, actualState: current.state });
      throw err;
    }
    if (!hasCleanFileScans(current)) {
      throw new ValidationError("DocumentVersion cannot be accepted while file scans are pending or infected.", {
        documentId,
        seq,
        pendingFileScans: current.pendingFileScans,
        infectedFileScans: current.infectedFileScans,
      });
    }

    const now = this.now();
    const newVersionId = current.versionId;
    const entries = [];

    // 1. Update Document.currentVersionId
    entries.push({
      Update: buildVersionedUpdate({
        tableName: this.tableName,
        key: documentKey(tenantId, documentId),
        tenantId,
        expectedVersion: document.version,
        set: { currentVersionId: newVersionId },
        now,
      }),
    });

    let previousVersion: DocumentVersion | undefined;
    if (document.currentVersionId && document.currentVersionId !== newVersionId) {
      previousVersion = await this.findVersionById(tenantId, documentId, document.currentVersionId);
      if (previousVersion) {
        // 2. Update previous current Version -> SUPERSEDED
        entries.push({
          Update: buildVersionedUpdate({
            tableName: this.tableName,
            key: documentVersionKey(tenantId, documentId, previousVersion.seq),
            tenantId,
            expectedVersion: previousVersion.version,
            set: { state: "SUPERSEDED" },
            remove: ["GSI5PK", "GSI5SK"],
            now,
            extraConditions: [{ expression: "#docId = :docId AND #st = :acceptedState", names: { "#docId": "documentId", "#st": "state" }, values: { ":docId": documentId, ":acceptedState": "ACCEPTED" } }],
          }),
        });
        // 3. Put DocumentVersionEvent(SUPERSEDED) for the previous version
        entries.push({
          Put: buildVersionedCreate(
            this.tableName,
            this.buildEvent(tenantId, documentId, previousVersion.seq, previousVersion.versionId, "SUPERSEDED", "ACCEPTED", "SUPERSEDED", actor, now),
          ),
        });
      }
    }

    // 4. Update the new Version -> ACCEPTED
    entries.push({
      Update: buildVersionedUpdate({
        tableName: this.tableName,
        key,
        tenantId,
        expectedVersion,
        set: { state: "ACCEPTED", decidedAt: now, reviewerId: actor },
        remove: ["GSI5PK", "GSI5SK"],
        now,
        extraConditions: [
          { expression: "#docId = :docId", names: { "#docId": "documentId" }, values: { ":docId": documentId } },
          { expression: "#st = :received OR #st = :underReview", names: { "#st": "state" }, values: { ":received": "RECEIVED", ":underReview": "UNDER_REVIEW" } },
          { expression: "#pending = :zero", names: { "#pending": "pendingFileScans" }, values: { ":zero": 0 } },
          { expression: "#infected = :zero2", names: { "#infected": "infectedFileScans" }, values: { ":zero2": 0 } },
        ],
      }),
    });

    // D-163 §5: transactional (not merely in-memory) fence that the PRINCIPAL file is CLEAN —
    // if it was rejected as infected between this read and the transaction, the whole
    // TransactWriteItems cancels (TOCTOU-safe), same as any other ConditionCheck here. Only
    // added when the Version actually has a PRINCIPAL (D-163's `reserveFiles()` is additive —
    // a Version accepted before this slice existed never sets `principalFileId`).
    if (current.principalFileId) {
      entries.push(
        buildExistenceConditionCheck({
          tableName: this.tableName,
          key: documentFileKey(tenantId, documentId, seq, current.principalFileId),
          extra: { scanStatus: "CLEAN" },
        }),
      );
    }

    // 5. Put idempotency record
    const idempotencyRecord: IdempotencyRecord<AcceptVersionResult> & EntityKey = {
      ...idempotencyRecordKey(tenantId, documentId, seq, clientRequestToken),
      entityType: "IdempotencyRecord",
      tenantId,
      payloadHash: `acceptVersion:${documentId}:${seq}:${expectedVersion}`,
      resultSnapshot: { document: { ...document, currentVersionId: newVersionId, version: document.version + 1 }, acceptedVersionId: newVersionId },
      createdAt: now,
    };
    entries.push({ Put: buildVersionedCreate(this.tableName, idempotencyRecord as unknown as Record<string, unknown> & EntityKey) });

    // 6. Put DocumentVersionEvent(ACCEPTED) for the new version
    entries.push({
      Put: buildVersionedCreate(this.tableName, this.buildEvent(tenantId, documentId, seq, newVersionId, "ACCEPTED", current.state, "ACCEPTED", actor, now)),
    });

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const replay = await this.store.get<IdempotencyRecord<AcceptVersionResult>>(idempotencyRecordKey(tenantId, documentId, seq, clientRequestToken));
        if (replay) return replay.resultSnapshot;
        throw new ConflictError("acceptVersion transaction was rejected (concurrent modification or invalid state).", { documentId, seq });
      }
      throw err;
    }

    return idempotencyRecord.resultSnapshot;
  }

  /** RECEIVED | UNDER_REVIEW -> REJECTED. Terminal and never removable (D-143 Decision 7 — the
   * exact contradiction with J9 a Rodada 1 proposal introduced and this design corrects).
   *
   * D-226 Achado 3 (`guest-credential-issuance-scoping/estado-final-consolidado.md`, closes
   * D-222 gap 3): when this version is the one a `DocumentRequest` is currently waiting on
   * (`version.requestId` present, `request.lastSubmissionId === version.versionId`,
   * `request.status === "SUBMITTED"` — fencing against reopening a request whose submission was
   * already superseded by a LATER one, e.g. a stale rejection racing a resubmission), the SAME
   * transaction ALSO: reopens the `DocumentRequest` (`status: "REQUESTED"`, `issuanceGeneration`
   * incremented, `lastRejection` recorded), revokes the old `RequestAccessCredential` if one was
   * ever issued (idempotent `SET revokedAt = if_not_exists(revokedAt, :now)` — never compares
   * timestamps), and appends a reissuance outbox entry via the SAME
   * `buildDocumentRequestCreatedOutboxEntry` every other `DocumentRequest`-touching call site
   * uses. A version with no live `DocumentRequest` to reopen (guest flow not used, or the
   * request already moved past this submission) rejects exactly as before — purely additive. */
  async rejectVersion(ctx: RequestContext, documentId: string, seq: number, expectedVersion: number, reason: RejectionReason): Promise<DocumentVersion> {
    authorize({ context: ctx, action: "docarchive:review", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const actor = ctx.principal.userId;
    const key = documentVersionKey(tenantId, documentId, seq);
    const current = await this.store.get<DocumentVersion>(key);
    if (!current) throw new NotFoundError("DocumentVersion not found.", { documentId, seq });
    this.assertReviewerOrAdmin(ctx, current);
    this.assertTransitionOrConflict(current.state, "REJECTED", documentId, seq);
    const now = this.now();
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key,
      tenantId,
      expectedVersion,
      set: { state: "REJECTED", decidedAt: now, reviewerId: actor, rejectionReason: reason },
      remove: ["GSI5PK", "GSI5SK"],
      now,
    });
    const event = this.buildEvent(tenantId, documentId, seq, current.versionId, "REJECTED", current.state, "REJECTED", actor, now);
    const entries: TransactWriteEntry[] = [{ Update: update }, { Put: buildVersionedCreate(this.tableName, event) }];

    // D-226 Achado 3: only reachable when this version actually originated from a guest-access
    // DocumentRequest (`requestId` is only ever set by GuestDocumentAccessService.submitEvidence).
    let reopenedRequest: DocumentRequest | undefined;
    if (current.requestId) {
      const document = await this.store.get<Document>(documentKey(tenantId, documentId));
      if (document) {
        const request = await this.store.get<DocumentRequest>(documentRequestKey(tenantId, document.subjectId, current.requestId));
        // Fencing per the design: only a request still genuinely waiting on THIS submission
        // reopens — a request that already moved on (resubmitted, cancelled, expired) must
        // never be reset backwards by a late rejection of a superseded version.
        if (request && request.lastSubmissionId === current.versionId && request.status === "SUBMITTED") {
          const nextRequest: DocumentRequest = {
            ...request,
            status: "REQUESTED",
            issuanceGeneration: request.issuanceGeneration + 1,
            lastRejection: { versionId: current.versionId, reason, occurredAt: now },
            updatedAt: now,
            version: request.version + 1,
          };
          entries.push({
            Update: buildVersionedUpdate({
              tableName: this.tableName,
              key: documentRequestKey(tenantId, request.subjectId, request.documentRequestId),
              tenantId,
              expectedVersion: request.version,
              set: { status: "REQUESTED", issuanceGeneration: request.issuanceGeneration + 1, lastRejection: nextRequest.lastRejection },
              now,
            }),
          });
          // Revoke the credential the guest actually submitted with, if the issuance consumer
          // ever ran for it (activeCredentialSelectorHash is written ONLY by that consumer, D-226
          // decision central item 2/3 — absent means no credential was ever minted, nothing to
          // revoke). Idempotent: a second rejection racing the first never overwrites an
          // already-set revokedAt with a later timestamp.
          if (request.activeCredentialSelectorHash) {
            entries.push({
              Update: {
                TableName: this.tableName,
                Key: requestAccessCredentialKey(request.activeCredentialSelectorHash),
                UpdateExpression: "SET revokedAt = if_not_exists(revokedAt, :now)",
                ConditionExpression: "documentRequestId = :did AND selectorHash = :sel",
                ExpressionAttributeValues: { ":now": now, ":did": request.documentRequestId, ":sel": request.activeCredentialSelectorHash },
              },
            });
          }
          buildDocumentRequestCreatedOutboxEntry(entries, this.tableName, nextRequest, current.versionId);
          reopenedRequest = nextRequest;
        }
      }
    }

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("DocumentVersion was concurrently modified.", { documentId, seq, reopenedDocumentRequest: reopenedRequest?.documentRequestId });
      throw err;
    }
    return { ...current, state: "REJECTED", decidedAt: now, reviewerId: actor, rejectionReason: reason, version: expectedVersion + 1, updatedAt: now };
  }

  /**
   * createRequirement — D-143 Decision 5 (D-145). `applicability` is a persisted fact supplied
   * by the caller, never derived; `status` is computed immediately from it (with no evidence
   * linked yet, `applicability=APPLICABLE` always starts at MISSING, `NOT_APPLICABLE` always
   * starts at NOT_APPLICABLE — `deriveRequirementStatus` is authoritative even at creation time
   * rather than hardcoding the obvious no-evidence case separately).
   */
  async createRequirement(ctx: RequestContext, input: CreateRequirementInput): Promise<Requirement> {
    authorize({ context: ctx, action: "docarchive:requirement-create", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    // D-194 Fatia 2 - validated BEFORE any transactional write is attempted, same "reject early,
    // never burn a write attempt on a request that will never succeed" posture as
    // `ExpirationService.createItem`.
    await this.validateAssignee(tenantId, input.assigneeUserId);
    const requirementId = this.ids.newRequirementId();
    const now = this.now();
    // P0.1/§3: `putIfAbsent` replaced by a real transaction, planned by `buildCreateRequirementEntries()`
    // (D-192 §6 slice 3). Two properties this buys, neither of which a single conditional Put can
    // give: the per-Subject name uniqueness rule is enforced by the pointer's own
    // `attribute_not_exists` (not by a read-then-write), and the Subject's existence/status is
    // fenced INSIDE the same transaction — a pre-existing gap found by this decision's Round 2
    // (`createRequirement` never checked the Subject at all and would happily create a
    // Requirement under a non-existent or ARCHIVED Subject).
    const { requirement, entries, labels } = buildCreateRequirementEntries({
      tableName: this.tableName,
      tenantId,
      requirementId,
      subjectId: input.subjectId,
      name: input.name,
      notes: input.notes,
      applicability: input.applicability,
      assigneeUserId: input.assigneeUserId,
      now,
    });
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      this.throwClassifiedCancellation(err, labels, { subjectId: input.subjectId, requirementId });
    }
    return requirement;
  }

  /**
   * createDocumentRequest — D-226 Achado 2 (`guest-credential-issuance-scoping/
   * estado-final-consolidado.md`, closes D-222 gap 2): creates a `DocumentRequest` OUTSIDE any
   * `DocumentRequestSeries` cycle — every field the series-materialized shape (`document-request-
   * recurrence-service.ts`'s `buildMaterializeAttemptEntries`) leaves optional (`seriesId`/
   * `occurrenceId`/`attemptIndex`/`parentRequestId`) simply stays absent here, per that entity's
   * own "no fabricated value" discipline. Idempotent via a caller-supplied key + `payloadHash`
   * (a REPLAY with a DIFFERENT payload is a caller bug, not a safe retry — `ConflictError`,
   * never silently returning the wrong snapshot). Writes `buildDocumentRequestCreatedOutboxEntry`
   * in the SAME transaction (the ONE builder every DocumentRequest-creating call site must go
   * through, per that function's own doc comment) — the guest Lambda's issuance consumer picks
   * this DocumentRequest up exactly like a series-materialized one.
   */
  async createDocumentRequest(ctx: RequestContext, input: CreateDocumentRequestInput): Promise<DocumentRequest> {
    authorize({ context: ctx, action: "docarchive:request-create", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const now = this.now();
    const payloadHash = `createDocumentRequest:${input.subjectId}:${input.requirementId}:${input.deadline ?? ""}`;
    const idempotencyKey = { PK: `TENANT#${tenantId}#SUBJECT#${input.subjectId}`, SK: `DOCREQUESTCREATE#${input.idempotencyKey}` };

    const existing = await this.store.get<{ payloadHash: string; resultSnapshot: DocumentRequest } & EntityKey>(idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new ConflictError("Idempotency key reused with a different DocumentRequest payload.", { idempotencyKey: input.idempotencyKey });
      return existing.resultSnapshot;
    }

    const documentRequestId = this.ids.newDocumentRequestId();
    const request: DocumentRequest = {
      ...documentRequestKey(tenantId, input.subjectId, documentRequestId),
      entityType: "DocumentRequest",
      documentRequestId,
      tenantId,
      subjectId: input.subjectId,
      requirementId: input.requirementId,
      status: "REQUESTED",
      ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
      submissionCount: 0,
      issuanceGeneration: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const idempotencyRecord = { ...idempotencyKey, entityType: "IdempotencyRecord" as const, tenantId, payloadHash, resultSnapshot: request, createdAt: now };

    const entries: TransactWriteEntry[] = [
      // Requirement must exist under this Subject/tenant — same posture as the series flow,
      // which targets a Requirement copied from `series.requirementId` at series-creation time
      // (never re-validated per attempt); this avulso path has no series to have validated it
      // earlier, so it is checked here, once, at creation.
      buildExistenceConditionCheck({ tableName: this.tableName, key: requirementKey(tenantId, input.subjectId, input.requirementId), extra: { tenantId } }),
      { Put: buildVersionedCreate(this.tableName, idempotencyRecord as unknown as Record<string, unknown> & EntityKey) },
      { Put: buildVersionedCreate(this.tableName, request as unknown as Record<string, unknown> & EntityKey) },
    ];
    buildDocumentRequestCreatedOutboxEntry(entries, this.tableName, request, input.idempotencyKey);

    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const codes = getCancellationReasonCodes(err);
        if (codes?.[0] === "ConditionalCheckFailed") throw new NotFoundError("Requirement not found.", { requirementId: input.requirementId });
        if (codes?.[1] === "ConditionalCheckFailed") {
          // Concurrent replay of the SAME idempotency key won the race — re-read and return its
          // snapshot rather than treating this as a genuine failure.
          const replay = await this.store.get<{ payloadHash: string; resultSnapshot: DocumentRequest } & EntityKey>(idempotencyKey);
          if (replay) return replay.resultSnapshot;
        }
        throw new ConflictError("createDocumentRequest transaction was rejected (concurrent modification or invalid state).", { subjectId: input.subjectId });
      }
      throw err;
    }
    return request;
  }

  /** Shared by `createRequirement` and `applyTemplate` — the pointer row that makes the
   * per-Subject name uniqueness rule transactional rather than a read-then-write. */
  private buildRequirementNamePointer(tenantId: string, subjectId: string, name: string, requirementId: string, now: string): RequirementNamePointer {
    const normalizedName = normalizeDisplayName(name);
    return {
      ...requirementNamePointerKey(tenantId, subjectId, normalizedName),
      entityType: "RequirementNamePointer",
      tenantId,
      subjectId,
      normalizedName,
      requirementId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
  }

  /** `attribute_exists(PK) AND status = ACTIVE` — the status is ENUMERATED, never `<> DELETED`,
   * which would let an ARCHIVED Subject through (`TrackedSubjectStatus` is
   * `ACTIVE | ARCHIVED | DELETED`). */
  private buildSubjectFence(tenantId: string, subjectId: string) {
    return buildExistenceConditionCheck({
      tableName: this.tableName,
      key: trackedSubjectKeyForFence(tenantId, subjectId),
      extra: { status: SUBJECT_STATUS_ACCEPTING_REQUIREMENTS },
    });
  }

  /**
   * Structural classification of a `TransactionCanceledException` — never a literal index
   * (`codes?.[1]`), which breaks the moment an entry is inserted, and never a re-read that picks
   * WHICH error to throw (that would assert a cause DynamoDB did not reveal; Codex Rounds 3/4).
   *
   * Coupling with the shared lane, declared rather than assumed: `executeTenantBusinessMutation`
   * always appends its tenant fence LAST and converts that fence's failure into
   * `TenantNotActiveError` before the caller ever sees the cancellation, so `labels` covers the
   * whole space this classifier can still be asked about. Any `ConditionalCheckFailed` at an
   * index beyond `labels` falls back to a generic conflict rather than a wrong label.
   *
   * Precedence runs from the broadest precondition to the narrowest: if the template is no
   * longer applicable, reporting "name X collided" would be misleading; likewise for the Subject.
   */
  private throwClassifiedCancellation(err: unknown, labels: TransactEntryLabel[], details: Record<string, unknown>): never {
    if (!isTransactionCanceled(err)) throw err;
    const codes = getCancellationReasonCodes(err);
    const failed = (codes ?? []).flatMap((code, index) => (code === "ConditionalCheckFailed" && index < labels.length ? [labels[index] as TransactEntryLabel] : []));

    if (failed.some((label) => label.kind === "TEMPLATE_FENCE")) {
      throw new TemplatePreconditionFailedError(undefined, details);
    }
    if (failed.some((label) => label.kind === "DOCUMENT_TYPE_FENCE")) {
      throw new DocumentTypeNotActiveError(undefined, details);
    }
    if (failed.some((label) => label.kind === "SUBJECT_FENCE")) {
      throw new SubjectPreconditionFailedError(undefined, details);
    }
    const collisions = failed.filter((label) => label.kind === "POINTER");
    if (collisions.length > 0) {
      // Every colliding name, not just the first — a single apply can lose more than one race.
      throw new RequirementNameConflictError(undefined, { ...details, conflictingNames: collisions.map((label) => label.name) });
    }
    if (failed.some((label) => label.kind === "REQUIREMENT")) {
      throw new ConflictError("Requirement was concurrently modified.", details);
    }
    if (failed.some((label) => label.kind === "DOCUMENT")) {
      throw new ConflictError("Document already exists.", details);
    }
    throw new ConflictError("The transaction was rejected by a condition check.", details);
  }

  /** Shared by all 4 Requirement mutation sites (D-179/D-185) — computes the GSI8 pointer fields
   * to `set` (SATISFIED + `evidenceValidUntil`) or the sentinel meaning "remove instead" (every
   * other case), keeping `deriveRequirementMaintenanceDue` the single source of truth for
   * eligibility rather than re-deriving it at each call site. */
  private requirementGsi8Fields(status: RequirementStatus, evidenceValidUntil: string | undefined, tenantId: string, requirementId: string): { GSI8PK: string; GSI8SK: string } | Record<string, never> {
    const due = deriveRequirementMaintenanceDue(status, evidenceValidUntil);
    return due ? requirementGsi8Keys({ dueAtIso: due.dueAtIso, tenantId, requirementId }) : {};
  }

  async getRequirement(ctx: RequestContext, subjectId: string, requirementId: string): Promise<Requirement> {
    authorize({ context: ctx, action: "docarchive:requirement-read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.getRequirementUnchecked(ctx.tenant.tenantId, subjectId, requirementId);
  }

  private async getRequirementUnchecked(tenantId: string, subjectId: string, requirementId: string): Promise<Requirement> {
    const requirement = await this.store.get<Requirement>(requirementKey(tenantId, subjectId, requirementId));
    if (!requirement) throw new NotFoundError("Requirement not found.", { requirementId });
    return requirement;
  }

  async listRequirements(ctx: RequestContext, subjectId: string): Promise<Requirement[]> {
    authorize({ context: ctx, action: "docarchive:requirement-read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.store.queryByPk<Requirement>(`TENANT#${ctx.tenant.tenantId}#SUBJECT#${subjectId}`, REQUIREMENT_SK_PREFIX);
  }

  /**
   * Roadmap P0.6 (dashboard operacional/compliance básico), fatia 2 — reuses the exact same
   * `queryByPk` over the Subject's own partition `listRequirements` already does (no new read
   * path). `totalRequirements`/`satisfiedCount`/`missingCount` deliberately EXCLUDE
   * `NOT_APPLICABLE` (a requirement marked not-applicable should never penalize OR inflate the
   * percentage — there is no obligation to measure). `expiringSoonCount` reuses
   * `deriveRequirementValidityState` (never reimplements the 7-day threshold) filtered to
   * `VENCENDO`. `compliancePercent` is `null` (never `0`/`100`) when `totalRequirements === 0` —
   * an empty/all-not-applicable Subject has no basis for a percentage, and forcing one would
   * misrepresent either full or zero compliance.
   */
  async getSubjectCompliance(ctx: RequestContext, subjectId: string): Promise<SubjectComplianceSummary> {
    authorize({ context: ctx, action: "docarchive:requirement-read", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const requirements = await this.store.queryByPk<Requirement>(`TENANT#${tenantId}#SUBJECT#${subjectId}`, REQUIREMENT_SK_PREFIX);
    const now = new Date(this.now());
    const applicable = requirements.filter((r) => r.status !== "NOT_APPLICABLE");
    const totalRequirements = applicable.length;
    const satisfiedCount = applicable.filter((r) => r.status === "SATISFIED").length;
    const missingCount = applicable.filter((r) => r.status === "MISSING").length;
    const expiringSoonCount = applicable.filter((r) => deriveRequirementValidityState(r, now) === "VENCENDO").length;
    const compliancePercent = totalRequirements === 0 ? null : Math.round((100 * satisfiedCount) / totalRequirements);
    return { totalRequirements, satisfiedCount, expiringSoonCount, missingCount, compliancePercent };
  }

  /**
   * D-205 fatia 1 (Roadmap P1 item 16, dossier export) — `POST .../subjects/{subjectId}/dossier`.
   * Creates a `DossierExportRun` in `PREVIEW_READY`, freezing the Subject's CURRENT
   * `requirementIds` (decision 4 — the generation, once built in fatia 2, iterates exactly this
   * set, never re-derives it) and returns the same rows the caller would see confirming right
   * now. `scopeHash` is what `confirmDossierExport` re-validates against the caller's echoed
   * value before dispatching generation.
   */
  async previewDossierExport(ctx: RequestContext, subjectId: string): Promise<{ run: DossierExportRun; rows: DossierExportPreviewRow[] }> {
    authorize({ context: ctx, action: "docarchive:dossier-export", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const subject = await this.store.get(trackedSubjectKeyForFence(tenantId, subjectId));
    if (!subject) throw new NotFoundError("Subject not found.", { subjectId });

    const requirements = await this.store.queryByPk<Requirement>(`TENANT#${tenantId}#SUBJECT#${subjectId}`, REQUIREMENT_SK_PREFIX);
    const requirementIds = requirements.map((r) => r.requirementId);
    const now = this.now();
    const runId = this.ids.newDossierExportRunId();
    const run: DossierExportRun = {
      ...dossierExportRunKey(tenantId, subjectId, runId),
      entityType: "DossierExportRun",
      runId,
      subjectId,
      tenantId,
      status: "PREVIEW_READY",
      requirementIds,
      scopeHash: computeDossierScopeHash(subjectId, requirementIds),
      createdBy: ctx.principal.userId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.transactWrite([{ Put: buildVersionedCreate(this.tableName, run as unknown as Record<string, unknown> & EntityKey) }]);

    const rows: DossierExportPreviewRow[] = requirements.map((r) => ({
      requirementId: r.requirementId,
      name: r.name,
      status: r.status,
      ...(r.evidenceValidUntil !== undefined ? { evidenceValidUntil: r.evidenceValidUntil } : {}),
      ...(r.assigneeUserId !== undefined ? { assigneeUserId: r.assigneeUserId } : {}),
    }));
    return { run, rows };
  }

  /**
   * D-205 fatia 1 — `POST .../dossier/{runId}/confirm`. Idempotent (decision 3): a matching
   * `scopeHash` on an ALREADY confirmed run is a no-op success (never a second dispatch, never a
   * second `SQS_DOSSIER_EXPORT_V1` event once fatia 2's worker exists to consume it) — only a
   * `PREVIEW_READY` run with a matching hash actually transitions + dispatches. A mismatched hash
   * is ALWAYS a 409 regardless of current status (decision 3's own "força novo preview"), never
   * silently accepted just because the run already moved on.
   */
  async confirmDossierExport(ctx: RequestContext, subjectId: string, runId: string, scopeHash: string): Promise<DossierExportRun> {
    authorize({ context: ctx, action: "docarchive:dossier-export", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const run = await this.store.get<DossierExportRun>(dossierExportRunKey(tenantId, subjectId, runId));
    if (!run) throw new NotFoundError("DossierExportRun not found.", { subjectId, runId });
    if (run.scopeHash !== scopeHash) {
      throw new ConflictError("Dossier scope has changed since preview - request a new preview.", { subjectId, runId });
    }
    if (run.status !== "PREVIEW_READY") {
      return run; // idempotent replay - same scopeHash, already confirmed (or beyond).
    }

    const now = this.now();
    const event: DomainEvent = {
      specVersion: "1.0",
      eventId: this.ids.newEventId(),
      eventType: "DossierExportConfirmed",
      source: "expiration-tracker.document-archive",
      occurredAt: now,
      correlationId: ctx.correlationId,
      tenantId,
      actor: { type: "USER", userId: ctx.principal.userId },
      aggregate: { type: "DossierExportRun", id: runId, version: run.version + 1 },
      data: { runId, subjectId, tenantId },
    };
    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: this.tableName,
          key: dossierExportRunKey(tenantId, subjectId, runId),
          tenantId,
          expectedVersion: run.version,
          now,
          set: { status: "CONFIRMED", confirmedAt: now },
        }),
      },
    ];
    appendToTransaction(entries, this.tableName, event, "SQS_DOSSIER_EXPORT_V1");

    try {
      await this.store.transactWrite(entries);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("DossierExportRun was concurrently modified.", { subjectId, runId });
      throw err;
    }
    return { ...run, status: "CONFIRMED", confirmedAt: now, version: run.version + 1, updatedAt: now };
  }

  /**
   * D-205 fatia 2 — system-facing data retrieval for the dossier generation worker. No
   * `RequestContext`/`authorize()` here on purpose, same posture `findRequirementsByEvidenceVersion`/
   * `ReportsService.generateReportCsv` already establish for an async worker that never acts on
   * behalf of an authenticated end-user request (the worker's OWN caller already enforced
   * `docarchive:dossier-export` at confirm time). Re-reads the Subject displayName and EVERY
   * Requirement in the frozen `requirementIds` set fresh (decision 4 - field VALUES are never
   * stale, only the SET is frozen). A Requirement deleted since preview is silently omitted
   * (never fabricated) - the generated document reflects what still exists NOW, not a snapshot
   * of what existed at preview time.
   */
  async getDossierExportData(tenantId: string, subjectId: string, requirementIds: readonly string[]): Promise<{ subjectDisplayName?: string; rows: DossierExportRow[] }> {
    const [subject, requirements] = await Promise.all([
      this.store.get<EntityKey & { displayName?: string }>(trackedSubjectKeyForFence(tenantId, subjectId)),
      Promise.all(requirementIds.map((requirementId) => this.store.get<Requirement>(requirementKey(tenantId, subjectId, requirementId)))),
    ]);
    const rows: DossierExportRow[] = requirements
      .filter((r): r is Requirement => r !== undefined)
      .map((r) => ({ requirementId: r.requirementId, name: r.name, status: r.status, evidenceValidUntil: r.evidenceValidUntil, assigneeUserId: r.assigneeUserId, updatedAt: r.updatedAt }));
    return { subjectDisplayName: subject?.displayName, rows };
  }

  /**
   * D-205 fatia 3 — `GET .../dossier/{runId}/download` reads the run through this (ADMIN_ROLES,
   * decision 10 - no assignee/recipient fallback tier, unlike D-204's report download route:
   * a full-Subject dossier is disclosure-sensitive enough that D-205's own Rodada 1 removed the
   * assignee tier entirely). The route itself checks `status === "READY"` after this returns -
   * kept there, not here, so a future caller wanting the run regardless of status (there is none
   * yet) is not forced through a status gate this method doesn't own.
   */
  async getDossierExportRun(ctx: RequestContext, subjectId: string, runId: string): Promise<DossierExportRun> {
    authorize({ context: ctx, action: "docarchive:dossier-export", resource: { tenantId: ctx.tenant.tenantId } });
    const run = await this.store.get<DossierExportRun>(dossierExportRunKey(ctx.tenant.tenantId, subjectId, runId));
    if (!run) throw new NotFoundError("DossierExportRun not found.", { subjectId, runId });
    return run;
  }

  /**
   * D-194 Fatia 3 — single `Query` on GSI1's REQSTATUS namespace (already tenant-facing, no new
   * index), filtered in memory: `name` substring (Requirement has no type-scoped physical name
   * ordering the way TrackedSubject's GSI7SK does, so this is always substring, never prefix —
   * "ou substring-sem" per the design), `assigneeUserId` exact match, `UnifiedValidityState` via
   * `deriveRequirementValidityState` (never reimplemented here). `tag` is deliberately NOT a
   * parameter — Requirement has no `tags` field, out of scope per the design's own "Escopo
   * explicitamente fora desta decisão" (tags em Requirement). `subjectDisplayName` enrichment: one
   * `BatchGetItem` (this module's own `store.batchGet`, already 100-key chunked internally,
   * `import/resolve-subject-references.ts` precedent) over the DISTINCT `subjectId`s of the
   * matched page — at most 125 evaluated items per call (`SEARCH_MAX_PAGES` * `SEARCH_PAGE_SIZE`),
   * so at most 125 distinct subjectIds, well within 2 chunks of 100. `trackedSubjectKeyForFence`
   * (not a new port) composes the TrackedSubject key without importing `subject/**` directly —
   * same module-boundary precedent this file already uses for `SUBJECT_STATUS_ACCEPTING_REQUIREMENTS`
   * fencing.
   */
  async searchRequirements(ctx: RequestContext, query: RequirementSearchQuery): Promise<RequirementSearchPage> {
    authorize({ context: ctx, action: "docarchive:requirement-read", resource: { tenantId: ctx.tenant.tenantId } });
    if (!query.status) throw new ValidationError("status is required for searchRequirements.");
    const tenantId = ctx.tenant.tenantId;
    const now = new Date(this.now());
    const namePrefix = query.namePrefix;

    const result = await runPagedSearch<Requirement>({
      exclusiveStartKey: query.exclusiveStartKey,
      fetchPage: (exclusiveStartKey) =>
        this.store.queryIndexPage<Requirement>({
          indexName: "GSI1",
          partitionKeyValue: `TENANT#${tenantId}#REQSTATUS#${query.status}`,
          limit: SEARCH_PAGE_SIZE,
          exclusiveStartKey,
        }),
      matches: (requirement) => {
        if (namePrefix !== undefined && !requirement.name.toLowerCase().includes(namePrefix.toLowerCase())) return false;
        if (query.assigneeUserId !== undefined && requirement.assigneeUserId !== query.assigneeUserId) return false;
        if (query.validityState !== undefined && deriveRequirementValidityState(requirement, now) !== query.validityState) return false;
        return true;
      },
    });

    const subjectIds = [...new Set(result.items.map((r) => r.subjectId))];
    const subjectRows =
      subjectIds.length > 0
        ? await this.store.batchGet<EntityKey & { displayName?: string }>(subjectIds.map((subjectId) => trackedSubjectKeyForFence(tenantId, subjectId)))
        : [];
    const displayNameBySubjectId = new Map<string, string>();
    subjectRows.forEach((row, i) => {
      // batchGet's return order is not guaranteed to match `subjectIds` - but each key IS the
      // TrackedSubject's own PK/SK, so recovering subjectId from the returned row's own PK is
      // correct regardless of order (never assumed positional).
      const pk = (row as unknown as EntityKey).PK;
      const subjectId = subjectIds.find((id) => trackedSubjectKeyForFence(tenantId, id).PK === pk) ?? subjectIds[i];
      if (subjectId !== undefined && row.displayName !== undefined) displayNameBySubjectId.set(subjectId, row.displayName);
    });

    return {
      items: result.items.map((requirement) => ({
        kind: "REQUIREMENT" as const,
        requirement,
        subjectDisplayName: displayNameBySubjectId.get(requirement.subjectId),
      })),
      lastEvaluatedKey: result.lastEvaluatedKey,
      scanLimitReached: result.scanLimitReached,
    };
  }

  /** Never touches `evidenceVersionId`/`status` directly — an `applicability` change here still
   * re-derives `status` (e.g. flipping to NOT_APPLICABLE must immediately reflect in GSI1's
   * REQSTATUS namespace, not wait for the next unrelated mutation or the daily reindex). */
  async updateRequirement(ctx: RequestContext, subjectId: string, requirementId: string, expectedVersion: number, input: UpdateRequirementInput): Promise<Requirement> {
    authorize({ context: ctx, action: "docarchive:requirement-update", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    // D-194 Fatia 2 - only validated when actually CHANGING (same "unrelated-field update never
    // re-validates" posture as `ExpirationService.updateItem`).
    if (input.assigneeUserId !== undefined) {
      await this.validateAssignee(tenantId, input.assigneeUserId);
    }
    const current = await this.getRequirementUnchecked(tenantId, subjectId, requirementId);
    const nextApplicability = input.applicability ?? current.applicability;
    const now = this.now();
    let status = current.status;
    if (nextApplicability !== current.applicability) {
      const evidence = this.cachedEvidenceForDerivation(current);
      status = deriveRequirementStatus(nextApplicability, evidence, new Date(now));
    }
    // Applicability is the only field here that can change `status` (name/notes never do), and
    // `evidenceValidUntil` itself never changes in this call — only whether the GSI8 pointer
    // built from it should exist follows `status`.
    const gsi8Fields = this.requirementGsi8Fields(status, current.evidenceValidUntil, tenantId, requirementId);
    const set: Record<string, unknown> = { applicability: nextApplicability, status, ...requirementGsi1Keys(tenantId, status, now, requirementId), ...gsi8Fields };
    if (input.name !== undefined) set["name"] = input.name;
    if (input.notes !== undefined) set["notes"] = input.notes;
    // D-194 Fatia 2 - an empty string REMOVES the attribute (clears the assignee), any other
    // value is written as-is (already validated above); `undefined` means "not provided" and
    // touches neither `set` nor `remove`.
    const removeFields: string[] = Object.keys(gsi8Fields).length === 0 ? ["GSI8PK", "GSI8SK"] : [];
    if (input.assigneeUserId !== undefined) {
      if (input.assigneeUserId === "") {
        removeFields.push("assigneeUserId");
      } else {
        set["assigneeUserId"] = input.assigneeUserId;
      }
    }
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: requirementKey(tenantId, subjectId, requirementId),
      tenantId,
      expectedVersion,
      set,
      remove: removeFields.length > 0 ? removeFields : undefined,
    });

    // P0.1/§3: a name change has to move the dedupe pointer too, in the SAME transaction. Two
    // branches for the same reason `renameDocumentType()` has two (D-173 §3): DynamoDB rejects a
    // Delete and a Put against the SAME item inside one TransactWriteItems, so "normalized name
    // unchanged" and "normalized name changed" cannot share one transaction shape. The old
    // normalized name is ALWAYS derived from the persisted `current.name`, never from caller
    // input — the persisted value is the only source of truth for which pointer key exists.
    const oldNormalizedName = normalizeDisplayName(current.name);
    const newNormalizedName = input.name !== undefined ? normalizeDisplayName(input.name) : oldNormalizedName;
    const entries: TransactWriteEntry[] = [{ Update: update }];
    const labels: TransactEntryLabel[] = [{ kind: "REQUIREMENT" }];
    if (newNormalizedName !== oldNormalizedName) {
      entries.push({
        Delete: buildConditionalDelete({
          tableName: this.tableName,
          key: requirementNamePointerKey(tenantId, subjectId, oldNormalizedName),
          conditionExpression: "attribute_exists(PK) AND #reqId = :self",
          names: { "#reqId": "requirementId" },
          values: { ":self": requirementId },
        }),
      });
      labels.push({ kind: "POINTER", name: current.name });
      entries.push({
        Put: buildVersionedCreate(
          this.tableName,
          this.buildRequirementNamePointer(tenantId, subjectId, input.name as string, requirementId, now) as unknown as Record<string, unknown> & EntityKey,
        ),
      });
      labels.push({ kind: "POINTER", name: input.name as string });
    }

    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      this.throwClassifiedCancellation(err, labels, { subjectId, requirementId });
    }
    // `removeFields` (e.g. a cleared `assigneeUserId`) must be dropped from the in-memory return
    // too - `set` alone can't overwrite a field that was REMOVEd rather than SET, so `current`'s
    // stale value would otherwise leak into the caller-visible result despite being genuinely
    // absent in DynamoDB after this write.
    const returned = { ...current, ...set, version: expectedVersion + 1, updatedAt: now } as unknown as Record<string, unknown>;
    for (const field of removeFields) delete returned[field];
    return returned as unknown as Requirement;
  }

  /**
   * linkEvidence — sets the (singular) `evidenceVersionId` and re-derives `status`
   * transactionally alongside the GSI1 REQSTATUS update, so a reader querying by status never
   * observes a Requirement whose `status` attribute is stale relative to its own
   * `evidenceVersionId` (D-143 Decision 5).
   *
   * Takes `documentId` explicitly (see `evidenceDocumentId`'s doc comment on the domain entity
   * for why this is stored rather than resolved via GSI5 at read time — that attribute pair is
   * already claimed by the sparse review-queue index and is removed exactly when a version
   * becomes ACCEPTED).
   */
  async linkEvidence(ctx: RequestContext, subjectId: string, requirementId: string, expectedVersion: number, documentId: string, versionId: string): Promise<Requirement> {
    authorize({ context: ctx, action: "docarchive:requirement-update", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getRequirementUnchecked(tenantId, subjectId, requirementId);
    const evidenceVersion = await this.findVersionById(tenantId, documentId, versionId);
    if (!evidenceVersion) throw new NotFoundError("DocumentVersion not found.", { documentId, versionId });
    const now = this.now();
    const status = deriveRequirementStatus(current.applicability, evidenceVersion, new Date(now));
    const set: Record<string, unknown> = {
      evidenceVersionId: versionId,
      evidenceDocumentId: documentId,
      evidenceSeq: evidenceVersion.seq,
      evidenceState: evidenceVersion.state,
      status,
      ...requirementGsi1Keys(tenantId, status, now, requirementId),
      ...requirementGsi9Keys({ tenantId, evidenceVersionId: versionId, requirementId }),
    };
    // `undefined` is not a valid DynamoDB attribute value (occ.ts's SET-clause builder would
    // otherwise emit an ExpressionAttributeValue literally equal to `undefined`) — only include
    // evidenceValidUntil when the evidence version actually carries one (D3: a document without
    // an expiration date is a legitimate first-class case).
    if (evidenceVersion.validUntil !== undefined) set["evidenceValidUntil"] = evidenceVersion.validUntil;
    const gsi8Fields = this.requirementGsi8Fields(status, evidenceVersion.validUntil, tenantId, requirementId);
    Object.assign(set, gsi8Fields);
    const remove = [
      ...(evidenceVersion.validUntil === undefined ? ["evidenceValidUntil"] : []),
      ...(Object.keys(gsi8Fields).length === 0 ? ["GSI8PK", "GSI8SK"] : []),
    ];
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: requirementKey(tenantId, subjectId, requirementId),
      tenantId,
      expectedVersion,
      set,
      remove: remove.length > 0 ? remove : undefined,
    });
    try {
      await this.store.transactWrite([{ Update: update }]);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("Requirement was concurrently modified.", { requirementId });
      throw err;
    }
    const next = { ...current, ...set, version: expectedVersion + 1, updatedAt: now } as Requirement;
    if (evidenceVersion.validUntil === undefined) delete next.evidenceValidUntil;
    return next;
  }

  /** Unlinks evidence unconditionally back to MISSING/NOT_APPLICABLE (never PENDING/
   * NOT_SATISFIED — `deriveRequirementStatus` with `evidenceVersion=undefined` only ever
   * returns one of those two, by construction). */
  async unlinkEvidence(ctx: RequestContext, subjectId: string, requirementId: string, expectedVersion: number): Promise<Requirement> {
    authorize({ context: ctx, action: "docarchive:requirement-update", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getRequirementUnchecked(tenantId, subjectId, requirementId);
    const now = this.now();
    const status = deriveRequirementStatus(current.applicability, undefined, new Date(now));
    const set = { status, ...requirementGsi1Keys(tenantId, status, now, requirementId) };
    // Never SATISFIED here (deriveRequirementStatus with no evidence only ever returns
    // MISSING/NOT_APPLICABLE) — the GSI8 pointer is always cleared unconditionally, no
    // requirementGsi8Fields() branch needed. GSI9 (GSI_EVIDENCE) is always cleared
    // unconditionally too — the whole point of "sparse" is that a Requirement with no evidence
    // link never appears in it at all.
    const removedFields = ["evidenceVersionId", "evidenceDocumentId", "evidenceSeq", "evidenceState", "evidenceValidUntil", "GSI8PK", "GSI8SK", "GSI9PK", "GSI9SK"] as const;
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: requirementKey(tenantId, subjectId, requirementId),
      tenantId,
      expectedVersion,
      set,
      remove: [...removedFields],
    });
    try {
      await this.store.transactWrite([{ Update: update }]);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("Requirement was concurrently modified.", { requirementId });
      throw err;
    }
    const next = { ...current, ...set, version: expectedVersion + 1, updatedAt: now } as Requirement;
    for (const field of removedFields) delete next[field];
    return next;
  }

  /**
   * GSI_EVIDENCE reverse lookup (D-193 slice 5) — given a `DocumentVersion` identity, returns
   * every `Requirement` currently linking it as evidence, paging the full GSI9 partition (never
   * a single-page peek: the design's convergence worker (D-193 slice 6, not built yet) must
   * re-derive EVERY Requirement referencing a re-confirmed/rejected DocumentVersion, not just the
   * first one a page happens to return). No `RequestContext`/`authorize()` here on purpose — this
   * is a SYSTEM query for the async worker (D-193's whole point: the worker re-reads
   * `DocumentVersion`+`Requirement` fresh itself, it is never acting on behalf of an
   * authenticated end-user request), same posture `scanActiveSeries` already holds for the
   * recurrence materializer worker. Callers still owe re-fetching each `Requirement` fresh
   * before acting — this index is discovery-only, never a source of eligibility (same posture
   * every GSI8 consumer already holds, D-179/D-180).
   */
  async findRequirementsByEvidenceVersion(tenantId: string, evidenceVersionId: string): Promise<Requirement[]> {
    const items: Requirement[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.store.queryIndexPage<Requirement>({
        indexName: "GSI9",
        partitionKeyValue: requirementGsi9PartitionKey(tenantId, evidenceVersionId),
        exclusiveStartKey,
      });
      items.push(...page.items);
      exclusiveStartKey = page.lastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  async deleteRequirement(ctx: RequestContext, subjectId: string, requirementId: string, expectedVersion: number): Promise<void> {
    authorize({ context: ctx, action: "docarchive:requirement-delete", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getRequirementUnchecked(tenantId, subjectId, requirementId); // 404s if absent
    const key = requirementKey(tenantId, subjectId, requirementId);
    const del = buildVersionedDelete({ tableName: this.tableName, key, tenantId, expectedVersion });
    // The pointer is released together with the Requirement it names — this is why "a deleted
    // name is freed" is true by construction, and why an archived-forever name reservation (a
    // risk the Codex raised in Round 2) cannot happen: `Requirement` has no archived state, its
    // delete is physical.
    const pointerDelete = buildConditionalDelete({
      tableName: this.tableName,
      key: requirementNamePointerKey(tenantId, subjectId, normalizeDisplayName(current.name)),
      conditionExpression: "attribute_exists(PK) AND #reqId = :self",
      names: { "#reqId": "requirementId" },
      values: { ":self": requirementId },
    });
    const labels: TransactEntryLabel[] = [{ kind: "REQUIREMENT" }, { kind: "POINTER", name: current.name }];
    try {
      await executeTenantBusinessMutation({
        store: this.store,
        tableName: this.tableName,
        tenantId,
        entries: [{ Delete: del }, { Delete: pointerDelete }],
      });
    } catch (err) {
      this.throwClassifiedCancellation(err, labels, { subjectId, requirementId });
    }
  }

  /**
   * createDocumentType — D-173 §3. `[0] Put(DocumentType, attribute_not_exists), [1]
   * Put(pointer, attribute_not_exists), [2] fence]`. Position 1 (the pointer) is what actually
   * closes the race between two concurrent creators supplying the same normalized name —
   * position 0 essentially never conflicts in practice (fresh ULID) but is still mapped
   * defensively, same discipline as every other `putIfAbsent`-shaped create in this module.
   */
  async createDocumentType(ctx: RequestContext, input: CreateDocumentTypeInput): Promise<DocumentType> {
    authorize({ context: ctx, action: "docarchive:documenttype-create", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const documentTypeId = this.ids.newDocumentTypeId();
    const normalizedName = normalizeDisplayName(input.displayName);
    const now = this.now();

    const documentType: DocumentType = {
      ...documentTypeKey(tenantId, documentTypeId),
      entityType: "DocumentType",
      documentTypeId,
      tenantId,
      displayName: input.displayName,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...documentTypeGsi1Keys(tenantId, "ACTIVE", normalizedName, documentTypeId),
    };
    const pointer: DocumentTypeNamePointer = {
      ...documentTypeNamePointerKey(tenantId, normalizedName),
      entityType: "DocumentTypeNamePointer",
      tenantId,
      normalizedName,
      documentTypeId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const entries = [
      { Put: buildVersionedCreate(this.tableName, documentType as unknown as Record<string, unknown> & EntityKey) },
      { Put: buildVersionedCreate(this.tableName, pointer as unknown as Record<string, unknown> & EntityKey) },
    ];
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const codes = getCancellationReasonCodes(err);
        if (codes?.[1] === "ConditionalCheckFailed") throw new DocumentTypeNameConflictError("A DocumentType with this name already exists.", { displayName: input.displayName });
        throw new ConflictError("DocumentType already exists.", { documentTypeId });
      }
      throw err;
    }
    return documentType;
  }

  async getDocumentType(ctx: RequestContext, documentTypeId: string): Promise<DocumentType> {
    authorize({ context: ctx, action: "docarchive:documenttype-read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.getDocumentTypeUnchecked(ctx.tenant.tenantId, documentTypeId);
  }

  private async getDocumentTypeUnchecked(tenantId: string, documentTypeId: string): Promise<DocumentType> {
    const documentType = await this.store.get<DocumentType>(documentTypeKey(tenantId, documentTypeId));
    if (!documentType) throw new NotFoundError("DocumentType not found.", { documentTypeId });
    return documentType;
  }

  /**
   * listDocumentTypes — D-173/item 5. GSI1's DOCTYPESTATUS namespace (`documentTypeGsi1Keys`)
   * already orders entries by normalized name, so this is a single `queryIndexPage` call, same
   * one-physical-page-per-call discipline as every other GSI read in this module — the caller
   * drives pagination via `exclusiveStartKey`/the returned `lastEvaluatedKey`, no internal
   * accumulate-across-pages loop (the D-142 cursor-skip lesson `queryByPk`'s doc comment cites).
   */
  async listDocumentTypes(ctx: RequestContext, status: DocumentType["status"], exclusiveStartKey?: Record<string, unknown>): Promise<{ items: DocumentType[]; lastEvaluatedKey?: Record<string, unknown> }> {
    authorize({ context: ctx, action: "docarchive:documenttype-read", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    return this.store.queryIndexPage<DocumentType>({ indexName: "GSI1", partitionKeyValue: `TENANT#${tenantId}#DOCTYPESTATUS#${status}`, exclusiveStartKey });
  }

  /**
   * renameDocumentType — D-173 §3, two branches (DynamoDB rejects a Delete+Put on the SAME
   * item within one TransactWriteItems, which is why "normalized name unchanged" and
   * "normalized name changed" cannot share one transaction shape). `oldNormalizedName` is
   * ALWAYS derived from this read of the current `DocumentType` (never trusted from caller
   * input) — the whole point of the dedupe pointer is that the persisted `displayName` is the
   * only source of truth for what the old pointer key actually was.
   *
   * Same-name branch: `[0] Update(DocumentType, expectedVersion), [1] fence]`.
   * Changed-name branch: `[0] Update(DocumentType, expectedVersion), [1] Delete(old pointer,
   * documentTypeId=:self), [2] Put(new pointer, attribute_not_exists), [3] fence]`.
   * `CancellationReasons`: 0 = OCC conflict, 1 = the old pointer no longer points to this type
   * (stale read), 2 = the target name is already in use by a different DocumentType.
   */
  async renameDocumentType(ctx: RequestContext, documentTypeId: string, expectedVersion: number, newDisplayName: string): Promise<DocumentType> {
    authorize({ context: ctx, action: "docarchive:documenttype-rename", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getDocumentTypeUnchecked(tenantId, documentTypeId);
    const oldNormalizedName = normalizeDisplayName(current.displayName);
    const newNormalizedName = normalizeDisplayName(newDisplayName);
    const now = this.now();

    if (oldNormalizedName === newNormalizedName) {
      const update = buildVersionedUpdate({
        tableName: this.tableName,
        key: documentTypeKey(tenantId, documentTypeId),
        tenantId,
        expectedVersion,
        set: { displayName: newDisplayName },
        now,
      });
      try {
        await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries: [{ Update: update }] });
      } catch (err) {
        if (isTransactionCanceled(err)) throw new ConflictError("DocumentType was concurrently modified.", { documentTypeId });
        throw err;
      }
      return { ...current, displayName: newDisplayName, version: expectedVersion + 1, updatedAt: now };
    }

    const newGsi1 = documentTypeGsi1Keys(tenantId, current.status, newNormalizedName, documentTypeId);
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: documentTypeKey(tenantId, documentTypeId),
      tenantId,
      expectedVersion,
      set: { displayName: newDisplayName, ...newGsi1 },
      now,
    });
    const deleteOldPointer = buildConditionalDelete({
      tableName: this.tableName,
      key: documentTypeNamePointerKey(tenantId, oldNormalizedName),
      conditionExpression: "attribute_exists(PK) AND #docTypeId = :self",
      names: { "#docTypeId": "documentTypeId" },
      values: { ":self": documentTypeId },
    });
    const newPointer: DocumentTypeNamePointer = {
      ...documentTypeNamePointerKey(tenantId, newNormalizedName),
      entityType: "DocumentTypeNamePointer",
      tenantId,
      normalizedName: newNormalizedName,
      documentTypeId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const putNewPointer = buildVersionedCreate(this.tableName, newPointer as unknown as Record<string, unknown> & EntityKey);

    const entries = [{ Update: update }, { Delete: deleteOldPointer }, { Put: putNewPointer }];
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const codes = getCancellationReasonCodes(err);
        if (codes?.[0] === "ConditionalCheckFailed") throw new ConflictError("DocumentType was concurrently modified.", { documentTypeId });
        if (codes?.[1] === "ConditionalCheckFailed") throw new ConflictError("DocumentType's old name pointer was concurrently modified.", { documentTypeId });
        if (codes?.[2] === "ConditionalCheckFailed") throw new DocumentTypeNameConflictError("A DocumentType with this name already exists.", { displayName: newDisplayName });
        throw new ConflictError("renameDocumentType transaction was rejected.", { documentTypeId });
      }
      throw err;
    }
    return { ...current, displayName: newDisplayName, ...newGsi1, version: expectedVersion + 1, updatedAt: now };
  }

  /** deprecateDocumentType/reactivateDocumentType — D-173 §3: `[0] Update(DocumentType,
   * expectedVersion, status flip), [1] fence]`. Each direction's `extraConditions` fences the
   * FROM status transactionally (not just via `expectedVersion`) so a concurrent double-flip
   * can never silently no-op past the wrong state. */
  async deprecateDocumentType(ctx: RequestContext, documentTypeId: string, expectedVersion: number): Promise<DocumentType> {
    return this.flipDocumentTypeStatus(ctx, "docarchive:documenttype-deprecate", documentTypeId, expectedVersion, "ACTIVE", "DEPRECATED");
  }

  async reactivateDocumentType(ctx: RequestContext, documentTypeId: string, expectedVersion: number): Promise<DocumentType> {
    return this.flipDocumentTypeStatus(ctx, "docarchive:documenttype-reactivate", documentTypeId, expectedVersion, "DEPRECATED", "ACTIVE");
  }

  private async flipDocumentTypeStatus(
    ctx: RequestContext,
    action: "docarchive:documenttype-deprecate" | "docarchive:documenttype-reactivate",
    documentTypeId: string,
    expectedVersion: number,
    fromStatus: DocumentType["status"],
    toStatus: DocumentType["status"],
  ): Promise<DocumentType> {
    authorize({ context: ctx, action, resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getDocumentTypeUnchecked(tenantId, documentTypeId);
    const now = this.now();
    const normalizedName = normalizeDisplayName(current.displayName);
    const gsi1 = documentTypeGsi1Keys(tenantId, toStatus, normalizedName, documentTypeId);
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: documentTypeKey(tenantId, documentTypeId),
      tenantId,
      expectedVersion,
      set: { status: toStatus, ...gsi1 },
      now,
      extraConditions: [{ expression: "#st = :from", names: { "#st": "status" }, values: { ":from": fromStatus } }],
    });
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries: [{ Update: update }] });
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError(`DocumentType is not ${fromStatus} (already ${toStatus}, or concurrently modified).`, { documentTypeId });
      throw err;
    }
    return { ...current, status: toStatus, ...gsi1, version: expectedVersion + 1, updatedAt: now };
  }

  // ---------------------------------------------------------------------------------------
  // DocumentType metadata fields (D-218, Roadmap P1 "metadata configurável por Document
  // Type") — design APPROVED in
  // `docs/architecture/reviews/document-type-metadata-scoping/estado-final-consolidado.md`.
  // Fatia 1: domain + catalog CRUD only (Decisions 1/3/4/6 partial) — no HTTP routes yet, no
  // `Document.metadataValues` value-write path yet (fatia 2/3).
  // ---------------------------------------------------------------------------------------

  /** Decision 1/3 — whole-array replace of `DocumentType.metadataFields`, same idiom as
   * `updateRequirementTemplate`'s `items` replace. `valueType` is fixed forever at creation
   * (Decision 3) — there is no operation anywhere in this class that accepts a `valueType`
   * change for an existing `fieldId`. */
  async createDocumentTypeMetadataField(
    ctx: RequestContext,
    documentTypeId: string,
    expectedVersion: number,
    input: CreateDocumentTypeMetadataFieldInput,
  ): Promise<DocumentType> {
    authorize({ context: ctx, action: "docarchive:documenttype-metadata-manage", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getDocumentTypeUnchecked(tenantId, documentTypeId);
    const now = this.now();

    this.assertMetadataFieldNameSize(input.name);
    if (input.valueType !== "SINGLE_SELECT" && input.options !== undefined && input.options.length > 0) {
      throw new ValidationError("Only a SINGLE_SELECT field may declare options.", { valueType: input.valueType });
    }

    const existingFields = current.metadataFields ?? [];
    const existingActive = existingFields.filter((f) => f.status === "ACTIVE").length;
    if (existingActive + 1 > MAX_ACTIVE_METADATA_FIELDS) {
      throw new ValidationError(`A DocumentType may hold at most ${MAX_ACTIVE_METADATA_FIELDS} ACTIVE metadata fields.`, { activeCount: existingActive });
    }
    if (existingFields.length + 1 > MAX_TOTAL_METADATA_FIELD_DEFINITIONS) {
      throw new ValidationError(`A DocumentType may hold at most ${MAX_TOTAL_METADATA_FIELD_DEFINITIONS} metadata field definitions in total (active + archived).`, { totalCount: existingFields.length });
    }

    const options = (input.options ?? []).map((label): DocumentTypeFieldOption => {
      this.assertMetadataFieldOptionLabelSize(label);
      return { optionId: this.ids.newDocumentTypeFieldOptionId(), label, status: "ACTIVE" };
    });
    if (options.length > MAX_ACTIVE_OPTIONS_PER_FIELD) {
      throw new ValidationError(`A field may hold at most ${MAX_ACTIVE_OPTIONS_PER_FIELD} ACTIVE options.`, { count: options.length });
    }

    const newField: DocumentTypeMetadataFieldDefinition = {
      fieldId: this.ids.newDocumentTypeFieldId(),
      name: input.name,
      valueType: input.valueType,
      required: input.required,
      ...(input.valueType === "SINGLE_SELECT" ? { options } : {}),
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    const nextFields = [...existingFields, newField];

    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: documentTypeKey(tenantId, documentTypeId),
      tenantId,
      expectedVersion,
      set: { metadataFields: nextFields },
      now,
    });
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries: [{ Update: update }] });
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("DocumentType was concurrently modified.", { documentTypeId });
      throw err;
    }
    return { ...current, metadataFields: nextFields, version: expectedVersion + 1, updatedAt: now };
  }

  /** Decision 7 — one PATCH covers the field itself (name/required/status) AND its options
   * (`optionsPatch`), one OCC-fenced write, because `options` is an array nested inside the
   * same `DocumentTypeMetadataFieldDefinition` inside the same `DocumentType` item — never a
   * second concurrency mechanism for options specifically. */
  async updateDocumentTypeMetadataField(
    ctx: RequestContext,
    documentTypeId: string,
    fieldId: string,
    expectedVersion: number,
    input: UpdateDocumentTypeMetadataFieldInput,
  ): Promise<DocumentType> {
    authorize({ context: ctx, action: "docarchive:documenttype-metadata-manage", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getDocumentTypeUnchecked(tenantId, documentTypeId);
    const now = this.now();

    const existingFields = current.metadataFields ?? [];
    const fieldIndex = existingFields.findIndex((f) => f.fieldId === fieldId);
    if (fieldIndex === -1) throw new NotFoundError("DocumentType metadata field not found.", { documentTypeId, fieldId });
    const field = existingFields[fieldIndex]!;

    if (input.name !== undefined) this.assertMetadataFieldNameSize(input.name);
    if (input.optionsPatch !== undefined && input.optionsPatch.length > 0 && field.valueType !== "SINGLE_SELECT") {
      throw new ValidationError("Only a SINGLE_SELECT field may have its options patched.", { fieldId, valueType: field.valueType });
    }

    const nextOptions = input.optionsPatch !== undefined ? this.applyDocumentTypeFieldOptionsPatch(field.options ?? [], input.optionsPatch) : field.options;
    const nextField: DocumentTypeMetadataFieldDefinition = {
      ...field,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(nextOptions !== undefined ? { options: nextOptions } : {}),
      updatedAt: now,
    };
    const nextFields = existingFields.map((f, i) => (i === fieldIndex ? nextField : f));

    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: documentTypeKey(tenantId, documentTypeId),
      tenantId,
      expectedVersion,
      set: { metadataFields: nextFields },
      now,
    });
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries: [{ Update: update }] });
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("DocumentType was concurrently modified.", { documentTypeId });
      throw err;
    }
    return { ...current, metadataFields: nextFields, version: expectedVersion + 1, updatedAt: now };
  }

  /** Decision 4/8 — applies each option patch op in order against a working copy, so a batch
   * mixing e.g. ARCHIVE+ADD in the same call sees a consistent running ACTIVE count. Options
   * are never removed from the array — ARCHIVE only flips `status`, same tombstone discipline
   * as the field itself. */
  private applyDocumentTypeFieldOptionsPatch(existingOptions: readonly DocumentTypeFieldOption[], patch: readonly DocumentTypeFieldOptionPatchOp[]): DocumentTypeFieldOption[] {
    const working = [...existingOptions];
    for (const op of patch) {
      if (op.op === "ADD") {
        this.assertMetadataFieldOptionLabelSize(op.label);
        const activeCount = working.filter((o) => o.status === "ACTIVE").length;
        if (activeCount + 1 > MAX_ACTIVE_OPTIONS_PER_FIELD) throw new ValidationError(`A field may hold at most ${MAX_ACTIVE_OPTIONS_PER_FIELD} ACTIVE options.`, { activeCount });
        if (working.length + 1 > MAX_TOTAL_OPTIONS_PER_FIELD) throw new ValidationError(`A field may hold at most ${MAX_TOTAL_OPTIONS_PER_FIELD} options in total (active + archived).`, { totalCount: working.length });
        working.push({ optionId: this.ids.newDocumentTypeFieldOptionId(), label: op.label, status: "ACTIVE" });
        continue;
      }
      const index = working.findIndex((o) => o.optionId === op.optionId);
      if (index === -1) throw new NotFoundError("DocumentType metadata field option not found.", { optionId: op.optionId });
      const option = working[index]!;
      if (op.op === "RENAME") {
        this.assertMetadataFieldOptionLabelSize(op.label);
        working[index] = { ...option, label: op.label };
      } else if (op.op === "ARCHIVE") {
        working[index] = { ...option, status: "ARCHIVED" };
      } else {
        const activeCount = working.filter((o) => o.status === "ACTIVE").length;
        if (activeCount + 1 > MAX_ACTIVE_OPTIONS_PER_FIELD) throw new ValidationError(`A field may hold at most ${MAX_ACTIVE_OPTIONS_PER_FIELD} ACTIVE options.`, { activeCount });
        working[index] = { ...option, status: "ACTIVE" };
      }
    }
    return working;
  }

  /** D-218 Decision 1 uses character length (not `Buffer.byteLength` UTF-8 bytes like
   * `MAX_NAME_BYTES` elsewhere in this file) — the approved design explicitly specifies "≤ 200
   * caracteres", not bytes. */
  private assertMetadataFieldNameSize(name: string): void {
    if (name.trim().length === 0) throw new ValidationError("DocumentType metadata field name must not be empty.");
    if (name.length > MAX_METADATA_FIELD_NAME_CHARS) throw new ValidationError(`DocumentType metadata field name exceeds ${MAX_METADATA_FIELD_NAME_CHARS} characters.`);
  }

  private assertMetadataFieldOptionLabelSize(label: string): void {
    if (label.trim().length === 0) throw new ValidationError("DocumentType metadata field option label must not be empty.");
    if (label.length > MAX_METADATA_FIELD_OPTION_LABEL_CHARS) throw new ValidationError(`DocumentType metadata field option label exceeds ${MAX_METADATA_FIELD_OPTION_LABEL_CHARS} characters.`);
  }

  /**
   * D-218 fatia 2 (Decisions 2/5/7) — `Document.metadataValues` is the only value-write path;
   * `createDocument()` never touches it (Decision 5 — every Document starts sparse). One entry
   * per `fieldId` in `values`: `null` CLEARS that field (removes the key entirely — blocked with
   * a `ValidationError` when the field is currently ACTIVE and `required`, per Decision 5's exact
   * semantics); a non-null entry VALIDATES against the field's current ACTIVE definition (unknown
   * fieldId, archived field, `valueType` mismatch, malformed value, or an unknown/archived
   * `SINGLE_SELECT` option all reject with `ValidationError` before any write is attempted) and
   * then WRITES a fully self-describing `DocumentMetadataValue` (never partial).
   *
   * Concurrency (Decision 7 — closes the real TOCTOU the design names: a caller reads an ACTIVE
   * field, a second request archives it, the first caller's write must still fail rather than
   * silently attach a value under a now-archived field): the `DocumentType` is re-read fresh
   * inside THIS call (never trusted from an earlier read the caller might be holding), and its
   * `version` is pinned via `buildVersionConditionCheck` in the SAME `TransactWriteItems` as the
   * `Document` update — the caller only ever needs to know/pass `expectedDocumentVersion` (plain
   * OCC on the Document itself), never the DocumentType's version.
   */
  async updateDocumentMetadataValues(
    ctx: RequestContext,
    documentId: string,
    expectedDocumentVersion: number,
    values: Readonly<Record<string, DocumentMetadataValueInput>>,
  ): Promise<Document> {
    authorize({ context: ctx, action: "docarchive:document-metadata-update", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getDocumentUnchecked(tenantId, documentId);
    const documentType = await this.getDocumentTypeUnchecked(tenantId, current.documentTypeId);
    const now = this.now();
    const updatedBy = ctx.principal.userId;
    const fields = documentType.metadataFields ?? [];

    const nextValues: Record<string, DocumentMetadataValue> = { ...(current.metadataValues ?? {}) };
    for (const [fieldId, input] of Object.entries(values)) {
      const field = fields.find((f) => f.fieldId === fieldId);

      if (input === null) {
        if (field?.status === "ACTIVE" && field.required) {
          throw new ValidationError(`Field "${field.name}" is required and cannot be cleared.`, { fieldId });
        }
        delete nextValues[fieldId];
        continue;
      }

      if (!field) throw new ValidationError("Unknown DocumentType metadata field.", { fieldId });
      if (field.status !== "ACTIVE") throw new ValidationError(`Field "${field.name}" is archived and cannot receive a new value.`, { fieldId });
      if (field.valueType !== input.valueType) {
        throw new ValidationError(`Field "${field.name}" expects valueType ${field.valueType}, got ${input.valueType}.`, { fieldId, expected: field.valueType, actual: input.valueType });
      }
      const formatError = describeMetadataValueFormatError(input);
      if (formatError) throw new ValidationError(formatError, { fieldId });

      if (input.valueType === "SINGLE_SELECT") {
        const option = (field.options ?? []).find((o) => o.optionId === input.optionId);
        if (!option || option.status !== "ACTIVE") throw new ValidationError("Unknown or archived option.", { fieldId, optionId: input.optionId });
        nextValues[fieldId] = { valueType: "SINGLE_SELECT", optionId: option.optionId, labelSnapshot: option.label, documentTypeVersionAtWrite: documentType.version, updatedAt: now, updatedBy };
      } else {
        nextValues[fieldId] = { ...input, documentTypeVersionAtWrite: documentType.version, updatedAt: now, updatedBy };
      }
    }

    const hasValues = Object.keys(nextValues).length > 0;
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: documentKey(tenantId, documentId),
      tenantId,
      expectedVersion: expectedDocumentVersion,
      set: hasValues ? { metadataValues: nextValues } : {},
      remove: hasValues ? undefined : ["metadataValues"],
      now,
    });
    const documentTypeFence = buildVersionConditionCheck({ tableName: this.tableName, key: documentTypeKey(tenantId, current.documentTypeId), expectedVersion: documentType.version });

    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries: [{ Update: update }, documentTypeFence] });
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const codes = getCancellationReasonCodes(err);
        if (codes?.[1] === "ConditionalCheckFailed") {
          throw new ConflictError("DocumentType was concurrently modified — re-read the current field definitions and retry.", { documentTypeId: current.documentTypeId });
        }
        throw new ConflictError("Document was concurrently modified.", { documentId });
      }
      throw err;
    }
    return { ...current, ...(hasValues ? { metadataValues: nextValues } : { metadataValues: undefined }), version: expectedDocumentVersion + 1, updatedAt: now };
  }

  // ---------------------------------------------------------------------------------------
  // RequirementTemplate (P0.1) — design APPROVED in
  // `docs/architecture/reviews/requirement-template-scoping/estado-final-consolidado.md`.
  // ---------------------------------------------------------------------------------------

  /** Same shape as `createDocumentType` (D-173 §3): `[0] Put(template, attribute_not_exists),
   * [1] Put(name pointer, attribute_not_exists), [2] fence]`. Position 1 is what actually closes
   * the race between two concurrent creators supplying the same normalized name. */
  async createRequirementTemplate(ctx: RequestContext, input: CreateRequirementTemplateInput): Promise<RequirementTemplate> {
    authorize({ context: ctx, action: "docarchive:requirementtemplate-create", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const now = this.now();
    const templateId = this.ids.newRequirementTemplateId();
    const items = this.buildTemplateItems(input.items);
    this.assertTemplateEnvelopeSizes(input.displayName, input.description);

    const normalizedName = normalizeDisplayName(input.displayName);
    const template: RequirementTemplate = {
      ...requirementTemplateKey(tenantId, templateId),
      entityType: "RequirementTemplate",
      templateId,
      tenantId,
      displayName: input.displayName,
      ...(input.description !== undefined ? { description: input.description } : {}),
      status: "ACTIVE",
      items,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...requirementTemplateGsi1Keys(tenantId, "ACTIVE", normalizedName, templateId),
    };
    await this.commitTemplateCreate(tenantId, template, normalizedName, now, input.displayName);
    return template;
  }

  async getRequirementTemplate(ctx: RequestContext, templateId: string): Promise<RequirementTemplate> {
    authorize({ context: ctx, action: "docarchive:requirementtemplate-read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.getRequirementTemplateUnchecked(ctx.tenant.tenantId, templateId);
  }

  /** One physical GSI page per call, same discipline as `listDocumentTypes` — the caller drives
   * pagination (the D-142 cursor-skip lesson). GSI1SK already orders by normalized name, so a
   * catalog listing comes out alphabetical for free. */
  async listRequirementTemplates(
    ctx: RequestContext,
    status: RequirementTemplate["status"],
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<{ items: RequirementTemplate[]; lastEvaluatedKey?: Record<string, unknown> }> {
    authorize({ context: ctx, action: "docarchive:requirementtemplate-read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.store.queryIndexPage<RequirementTemplate>({
      indexName: "GSI1",
      partitionKeyValue: `TENANT#${ctx.tenant.tenantId}#REQTEMPLATESTATUS#${status}`,
      exclusiveStartKey,
    });
  }

  /** Renames and/or replaces the whole `items` list under OCC. An ARCHIVED template is not
   * editable (409, fenced by `extraConditions` on the FROM status, not just by `expectedVersion`)
   * — unarchive first. Rename has the same two pointer branches as `renameDocumentType`. */
  async updateRequirementTemplate(
    ctx: RequestContext,
    templateId: string,
    expectedVersion: number,
    input: UpdateRequirementTemplateInput,
  ): Promise<RequirementTemplate> {
    authorize({ context: ctx, action: "docarchive:requirementtemplate-update", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getRequirementTemplateUnchecked(tenantId, templateId);
    const now = this.now();
    this.assertTemplateEnvelopeSizes(input.displayName ?? current.displayName, input.description ?? current.description);

    const nextItems = input.items !== undefined ? this.buildTemplateItems(input.items) : current.items;
    const nextDisplayName = input.displayName ?? current.displayName;
    const oldNormalizedName = normalizeDisplayName(current.displayName);
    const newNormalizedName = normalizeDisplayName(nextDisplayName);
    const set: Record<string, unknown> = {
      displayName: nextDisplayName,
      items: nextItems,
      ...requirementTemplateGsi1Keys(tenantId, current.status, newNormalizedName, templateId),
    };
    if (input.description !== undefined) set["description"] = input.description;

    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: requirementTemplateKey(tenantId, templateId),
      tenantId,
      expectedVersion,
      set,
      now,
      extraConditions: [{ expression: "#st = :active", names: { "#st": "status" }, values: { ":active": "ACTIVE" } }],
    });
    const entries: TransactWriteEntry[] = [{ Update: update }];
    if (newNormalizedName !== oldNormalizedName) {
      entries.push({
        Delete: buildConditionalDelete({
          tableName: this.tableName,
          key: requirementTemplateNamePointerKey(tenantId, oldNormalizedName),
          conditionExpression: "attribute_exists(PK) AND #tplId = :self",
          names: { "#tplId": "templateId" },
          values: { ":self": templateId },
        }),
      });
      entries.push({ Put: buildVersionedCreate(this.tableName, this.buildTemplateNamePointer(tenantId, newNormalizedName, templateId, now) as unknown as Record<string, unknown> & EntityKey) });
    }

    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const codes = getCancellationReasonCodes(err);
        if (codes && codes.length > 2 && codes[2] === "ConditionalCheckFailed") {
          throw new ConflictError("A RequirementTemplate with this name already exists.", { displayName: nextDisplayName });
        }
        throw new ConflictError("RequirementTemplate is not ACTIVE, or was concurrently modified.", { templateId });
      }
      throw err;
    }
    return { ...current, ...(set as Partial<RequirementTemplate>), version: expectedVersion + 1, updatedAt: now } as RequirementTemplate;
  }

  /**
   * Duplicating mints a new `templateId` AND brand-new `templateItemId`s — a copy is an
   * INDEPENDENT template, never an alias of the original (the same snapshot posture the apply
   * itself takes, applied one level up). Duplicating an ARCHIVED template is allowed on purpose:
   * it is how a retired template is revived without unarchiving the original.
   */
  async duplicateRequirementTemplate(ctx: RequestContext, templateId: string, newDisplayName: string): Promise<RequirementTemplate> {
    authorize({ context: ctx, action: "docarchive:requirementtemplate-duplicate", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const source = await this.getRequirementTemplateUnchecked(tenantId, templateId);
    this.assertTemplateEnvelopeSizes(newDisplayName, source.description);
    const now = this.now();
    const newTemplateId = this.ids.newRequirementTemplateId();
    const normalizedName = normalizeDisplayName(newDisplayName);
    const items = this.buildTemplateItems(source.items);

    const copy: RequirementTemplate = {
      ...requirementTemplateKey(tenantId, newTemplateId),
      entityType: "RequirementTemplate",
      templateId: newTemplateId,
      tenantId,
      displayName: newDisplayName,
      ...(source.description !== undefined ? { description: source.description } : {}),
      status: "ACTIVE",
      items,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...requirementTemplateGsi1Keys(tenantId, "ACTIVE", normalizedName, newTemplateId),
    };
    await this.commitTemplateCreate(tenantId, copy, normalizedName, now, newDisplayName);
    return copy;
  }

  async archiveRequirementTemplate(ctx: RequestContext, templateId: string, expectedVersion: number): Promise<RequirementTemplate> {
    return this.flipTemplateStatus(ctx, "docarchive:requirementtemplate-archive", templateId, expectedVersion, "ACTIVE", "ARCHIVED");
  }

  async unarchiveRequirementTemplate(ctx: RequestContext, templateId: string, expectedVersion: number): Promise<RequirementTemplate> {
    return this.flipTemplateStatus(ctx, "docarchive:requirementtemplate-unarchive", templateId, expectedVersion, "ARCHIVED", "ACTIVE");
  }

  /**
   * Pure read. Returns the plan plus the `templateVersion` it was computed against, so the caller
   * can hand that back to `applyTemplate` as `expectedTemplateVersion` and have the apply reject
   * a plan the template moved out from under.
   *
   * Declared contract: preview and apply CANNOT diverge algorithmically (one implementation of
   * `planTemplateApplication`, two call sites) but CAN diverge temporally — anything may create,
   * rename or delete a Requirement between the two reads.
   */
  async previewTemplateApplication(
    ctx: RequestContext,
    templateId: string,
    subjectId: string,
  ): Promise<TemplateApplicationPlan & { templateVersion: number }> {
    authorize({ context: ctx, action: "docarchive:requirementtemplate-read", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const template = await this.getRequirementTemplateUnchecked(tenantId, templateId);
    const existing = await this.readExistingForPlan(tenantId, subjectId);
    return { ...planTemplateApplication(template.items, existing), templateVersion: template.version };
  }

  /**
   * Materializes the template's eligible items as real `Requirement` rows, by COPY (snapshot) —
   * never a live link. Transaction shape (§4 of the design):
   *
   * ```text
   * N × Put(Requirement, attribute_not_exists) + N × Put(name pointer, attribute_not_exists)
   *   + ConditionCheck(template: status = ACTIVE AND version = <expected>)
   *   + ConditionCheck(Subject:  attribute_exists(PK) AND status = ACTIVE)
   *   + tenant fence (appended by executeTenantBusinessMutation)
   * = 2N + 3, bounded by MAX_TEMPLATE_ITEMS against the hard 100-action limit
   * ```
   *
   * All-or-nothing by construction: a late pointer collision aborts the WHOLE apply, so a
   * partially-applied template is never observable. Re-applying is idempotent and is SUCCESS
   * (200 with `created: []`), not a conflict — that is the real "the customer added one item to
   * the template, apply just that one" use case.
   *
   * Known, declared window: the plan's read is eventually consistent (`queryByPk` does not use
   * `ConsistentRead`), so a Requirement created moments earlier may be missed by the plan and
   * collide at commit, cancelling the whole apply instead of being skipped. Re-applying is safe,
   * and once the read converges the item is skipped.
   */
  async applyTemplate(
    ctx: RequestContext,
    templateId: string,
    subjectId: string,
    expectedTemplateVersion?: number,
  ): Promise<{ created: Array<{ templateItemId: string; requirementId: string; name: string }>; skipped: TemplateApplicationPlan["skip"]; templateVersion: number }> {
    authorize({ context: ctx, action: "docarchive:requirementtemplate-apply", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const template = await this.getRequirementTemplateUnchecked(tenantId, templateId);
    const fencedVersion = expectedTemplateVersion ?? template.version;
    const existing = await this.readExistingForPlan(tenantId, subjectId);
    const plan = planTemplateApplication(template.items, existing);

    if (plan.create.length === 0) {
      // Nothing to write. Deliberately NOT a transaction with only fences: the lane rejects a
      // zero-mutation call, and there is no state to protect when nothing is being written.
      return { created: [], skipped: plan.skip, templateVersion: fencedVersion };
    }

    const now = this.now();
    const entries: TransactWriteEntry[] = [];
    const labels: TransactEntryLabel[] = [];
    const created: Array<{ templateItemId: string; requirementId: string; name: string }> = [];

    for (const item of plan.create) {
      const requirementId = this.ids.newRequirementId();
      const status = deriveRequirementStatus(item.applicability, undefined, new Date(now));
      const requirement: Requirement = {
        ...requirementKey(tenantId, subjectId, requirementId),
        entityType: "Requirement",
        requirementId,
        tenantId,
        subjectId,
        name: item.name,
        ...(item.notes !== undefined ? { notes: item.notes } : {}),
        applicability: item.applicability,
        status,
        createdAt: now,
        updatedAt: now,
        version: 1,
        ...requirementGsi1Keys(tenantId, status, now, requirementId),
        ...this.requirementGsi8Fields(status, undefined, tenantId, requirementId),
        // Provenance ONLY — no read path, derivation or worker ever consults these three.
        sourceTemplateId: templateId,
        sourceTemplateItemId: item.templateItemId,
        sourceTemplateAppliedVersion: fencedVersion,
      };
      entries.push({ Put: buildVersionedCreate(this.tableName, requirement as unknown as Record<string, unknown> & EntityKey) });
      labels.push({ kind: "REQUIREMENT", templateItemId: item.templateItemId });
      entries.push({
        Put: buildVersionedCreate(this.tableName, this.buildRequirementNamePointer(tenantId, subjectId, item.name, requirementId, now) as unknown as Record<string, unknown> & EntityKey),
      });
      labels.push({ kind: "POINTER", name: item.name, templateItemId: item.templateItemId });
      created.push({ templateItemId: item.templateItemId, requirementId, name: item.name });
    }

    // `buildVersionConditionCheck` pins version AND status in one action — closing the TOCTOU
    // the Codex found in Round 2 (checking only ACTIVE would let an apply materialize items from
    // a template version that had already been edited away) at zero extra action cost.
    entries.push(buildVersionConditionCheck({
      tableName: this.tableName,
      key: requirementTemplateKey(tenantId, templateId),
      expectedVersion: fencedVersion,
      extra: { status: "ACTIVE" },
    }));
    labels.push({ kind: "TEMPLATE_FENCE" });
    entries.push(this.buildSubjectFence(tenantId, subjectId));
    labels.push({ kind: "SUBJECT_FENCE" });

    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      this.throwClassifiedCancellation(err, labels, { templateId, subjectId, expectedTemplateVersion: fencedVersion });
    }
    return { created, skipped: plan.skip, templateVersion: fencedVersion };
  }

  private async getRequirementTemplateUnchecked(tenantId: string, templateId: string): Promise<RequirementTemplate> {
    const template = await this.store.get<RequirementTemplate>(requirementTemplateKey(tenantId, templateId));
    if (!template) throw new NotFoundError("RequirementTemplate not found.", { templateId });
    return template;
  }

  /** `queryByPk` exhausts `LastEvaluatedKey` internally (verified in
   * `dynamodb-document-archive-store.ts`), so the plan always sees EVERY Requirement of the
   * Subject — an incomplete plan would silently under-report skips. */
  private async readExistingForPlan(tenantId: string, subjectId: string) {
    const rows = await this.store.queryByPk<Requirement>(`TENANT#${tenantId}#SUBJECT#${subjectId}`, REQUIREMENT_SK_PREFIX);
    return rows.map((row) => ({ requirementId: row.requirementId, name: row.name, sourceTemplateItemId: row.sourceTemplateItemId }));
  }

  private buildTemplateItems(input: ReadonlyArray<{ name: string; notes?: string; applicability?: RequirementApplicability }>): RequirementTemplateItem[] {
    if (input.length > MAX_TEMPLATE_ITEMS) {
      throw new ValidationError(`A RequirementTemplate may hold at most ${MAX_TEMPLATE_ITEMS} items.`, { count: input.length });
    }
    assertTemplateItemSizes(input);
    assertTemplateItemNamesUnique(input);
    return input.map((item, index) => ({
      templateItemId: this.ids.newRequirementTemplateItemId(),
      name: item.name,
      ...(item.notes !== undefined ? { notes: item.notes } : {}),
      applicability: item.applicability ?? "APPLICABLE",
      position: index,
    }));
  }

  private assertTemplateEnvelopeSizes(displayName: string, description: string | undefined): void {
    if (Buffer.byteLength(displayName, "utf8") > MAX_NAME_BYTES) {
      throw new ValidationError(`RequirementTemplate displayName exceeds ${MAX_NAME_BYTES} UTF-8 bytes.`);
    }
    if (description !== undefined && Buffer.byteLength(description, "utf8") > MAX_NOTES_BYTES) {
      throw new ValidationError(`RequirementTemplate description exceeds ${MAX_NOTES_BYTES} UTF-8 bytes.`);
    }
  }

  private buildTemplateNamePointer(tenantId: string, normalizedName: string, templateId: string, now: string): RequirementTemplateNamePointer {
    return {
      ...requirementTemplateNamePointerKey(tenantId, normalizedName),
      entityType: "RequirementTemplateNamePointer",
      tenantId,
      normalizedName,
      templateId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
  }

  private async commitTemplateCreate(tenantId: string, template: RequirementTemplate, normalizedName: string, now: string, displayName: string): Promise<void> {
    const entries = [
      { Put: buildVersionedCreate(this.tableName, template as unknown as Record<string, unknown> & EntityKey) },
      { Put: buildVersionedCreate(this.tableName, this.buildTemplateNamePointer(tenantId, normalizedName, template.templateId, now) as unknown as Record<string, unknown> & EntityKey) },
    ];
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const codes = getCancellationReasonCodes(err);
        if (codes?.[1] === "ConditionalCheckFailed") {
          throw new ConflictError("A RequirementTemplate with this name already exists.", { displayName });
        }
        throw new ConflictError("RequirementTemplate already exists.", { templateId: template.templateId });
      }
      throw err;
    }
  }

  private async flipTemplateStatus(
    ctx: RequestContext,
    action: "docarchive:requirementtemplate-archive" | "docarchive:requirementtemplate-unarchive",
    templateId: string,
    expectedVersion: number,
    fromStatus: RequirementTemplate["status"],
    toStatus: RequirementTemplate["status"],
  ): Promise<RequirementTemplate> {
    authorize({ context: ctx, action, resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getRequirementTemplateUnchecked(tenantId, templateId);
    const now = this.now();
    const gsi1 = requirementTemplateGsi1Keys(tenantId, toStatus, normalizeDisplayName(current.displayName), templateId);
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: requirementTemplateKey(tenantId, templateId),
      tenantId,
      expectedVersion,
      set: { status: toStatus, ...gsi1 },
      now,
      // Fences the FROM status transactionally, not just via expectedVersion, so a concurrent
      // double-flip can never silently no-op past the wrong state (same as flipDocumentTypeStatus).
      extraConditions: [{ expression: "#st = :from", names: { "#st": "status" }, values: { ":from": fromStatus } }],
    });
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries: [{ Update: update }] });
    } catch (err) {
      if (isTransactionCanceled(err)) {
        throw new ConflictError(`RequirementTemplate is not ${fromStatus} (already ${toStatus}, or concurrently modified).`, { templateId });
      }
      throw err;
    }
    return { ...current, status: toStatus, ...gsi1, version: expectedVersion + 1, updatedAt: now };
  }

  /** Projects a Requirement's own denormalized `evidenceState`/`evidenceValidUntil` (written by
   * `linkEvidence`, see the domain entity's doc comment) into the shape `deriveRequirementStatus`
   * needs — pure, no I/O. Used by `updateRequirement` when an `applicability` change requires
   * re-deriving `status` without also re-linking evidence; correctly returns `undefined` when no
   * evidence is linked (`evidenceState` absent), matching `deriveRequirementStatus`'s MISSING
   * branch. */
  private cachedEvidenceForDerivation(current: Requirement): { state: DocumentVersionState; validUntil?: string } | undefined {
    if (!current.evidenceState) return undefined;
    return { state: current.evidenceState, validUntil: current.evidenceValidUntil };
  }

  /** Translates the domain layer's `InvalidDocumentVersionTransitionError` into the
   * application's normalized `ConflictError` at this module's boundary — from a caller's
   * perspective, "the version's state changed since you read it" IS a conflict, whether the
   * real race is caught here (state already moved) or later by the transaction's own OCC
   * condition. The domain layer stays free of any HTTP/AppError concern. */
  private assertTransitionOrConflict(from: DocumentVersionState, to: DocumentVersionState, documentId: string, seq: number): void {
    try {
      assertValidDocumentVersionTransition(from, to);
    } catch (err) {
      if (err instanceof InvalidDocumentVersionTransitionError) {
        throw new ConflictError(`DocumentVersion is not in a state that allows this operation (currently "${from}").`, { documentId, seq, from, to });
      }
      throw err;
    }
  }

  private async findVersionById(tenantId: string, documentId: string, versionId: string): Promise<DocumentVersion | undefined> {
    const versions = await this.listVersionsUnchecked(tenantId, documentId);
    return versions.find((v) => v.versionId === versionId);
  }

  /** D-143 Decision 1/Bloqueador 6: a dedicated, named check distinct from `authorize()` —
   * `AuthorizedResource`'s owner/assignee bypass only activates when BOTH fields are supplied
   * together, which does not fit this shape (only `reviewerId` exists, and only sometimes).
   * OWNER/ADMIN always bypass (content-admin parity already established by B2B-7/D-097); a
   * MEMBER may decide only a version they claimed themselves, or one nobody has claimed yet. */
  private assertReviewerOrAdmin(ctx: RequestContext, current: DocumentVersion): void {
    const roles = ctx.tenant.roles;
    if (roles.includes("OWNER") || roles.includes("ADMIN")) return;
    if (current.reviewerId && current.reviewerId !== ctx.principal.userId) {
      throw new AuthorizationError("Only the reviewer who claimed this DocumentVersion (or an Admin/Owner) may decide it.", {
        documentId: current.documentId,
        seq: current.seq,
      });
    }
  }

  private buildEvent(
    tenantId: string,
    documentId: string,
    seq: number,
    versionId: string,
    type: DocumentVersionEvent["type"],
    fromState: DocumentVersionEvent["fromState"],
    toState: DocumentVersionEvent["toState"],
    actor: string,
    occurredAt: string,
  ): Record<string, unknown> & EntityKey {
    const event: DocumentVersionEvent = {
      ...documentVersionEventKey(tenantId, documentId, seq, this.ids.newEventId()),
      entityType: "DocumentVersionEvent",
      tenantId,
      documentId,
      versionId,
      type,
      fromState,
      toState,
      actor,
      occurredAt,
    };
    return event as unknown as Record<string, unknown> & EntityKey;
  }
}

// Re-exported so callers building GSI2 keys for a newly-created Document don't need to reach
// into domain/document.ts directly for this one helper.
export { documentGsi2Keys };
