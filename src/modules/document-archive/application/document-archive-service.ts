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
  buildVersionedUpdate,
  getCancellationReasonCodes,
  isTransactionCanceled,
  type EntityKey,
} from "../../../shared/dynamodb/occ.js";
import { AuthorizationError, ConflictError, DocumentTypeNameConflictError, DocumentTypeNotActiveError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { normalizeDisplayName } from "../../../shared/text/normalize-display-name.js";
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { DocumentArchiveStore } from "../ports/document-archive-store.js";
import type { DocumentArchiveIdGenerator } from "./id-generator.js";
import { type CreateDocumentInput, type Document, documentGsi1Keys, documentGsi2Keys, documentKey } from "../domain/document.js";
import {
  documentTypeGsi1Keys,
  documentTypeKey,
  documentTypeNamePointerKey,
  type CreateDocumentTypeInput,
  type DocumentType,
  type DocumentTypeNamePointer,
} from "../domain/document-type.js";
import {
  assertExactlyOnePrincipal,
  documentFileKey,
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
  deriveRequirementStatus,
  requirementGsi1Keys,
  requirementKey,
  REQUIREMENT_SK_PREFIX,
  type CreateRequirementInput,
  type Requirement,
  type UpdateRequirementInput,
} from "../domain/requirement.js";

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
  now?: () => string;
}

export interface AcceptVersionResult {
  document: Document;
  acceptedVersionId: string;
}

/** A persisted `DocumentFile` row plus the presigned PUT the caller uploads its bytes to —
 * mirrors `ReserveUploadResult`'s shape in M6's `document-service.ts` (`uploadUrl`/
 * `requiredHeaders`), one per file in the batch instead of a single document. */
export interface ReservedFile {
  file: DocumentFile;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
}

const PRESIGN_TTL_SECONDS = 600; // 10 minutes — same TTL M6's document-service.ts uses.

export class DocumentArchiveService {
  private readonly store: DocumentArchiveStore;
  private readonly tableName: string;
  private readonly ids: DocumentArchiveIdGenerator;
  private readonly quarantineBucket: string;
  private readonly signer: UploadUrlSigner;
  private readonly now: () => string;

  constructor(deps: DocumentArchiveServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.quarantineBucket = deps.quarantineBucket;
    this.signer = deps.signer;
    this.now = deps.now ?? (() => new Date().toISOString());
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
    const document: Document = {
      ...documentKey(tenantId, documentId),
      entityType: "Document",
      documentId,
      tenantId,
      subjectId: input.subjectId,
      documentTypeId: input.documentTypeId,
      status: "ACTIVE",
      hasValidity: input.hasValidity,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...documentGsi1Keys(tenantId, "ACTIVE", now, documentId),
      // GSI2 (AP3, Documents-by-Subject) written as a second attribute set on the same item —
      // both index memberships live on one physical row, no mirror item needed for this pattern.
      ...documentGsi2Keys(tenantId, input.subjectId, input.documentTypeId, documentId),
    };

    const entries = [
      buildExistenceConditionCheck({
        tableName: this.tableName,
        key: documentTypeKey(tenantId, input.documentTypeId),
        extra: { status: "ACTIVE" },
      }),
      { Put: buildVersionedCreate(this.tableName, document as unknown as Record<string, unknown> & EntityKey) },
    ];
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
    } catch (err) {
      if (isTransactionCanceled(err)) {
        const codes = getCancellationReasonCodes(err);
        if (codes?.[0] === "ConditionalCheckFailed") throw new DocumentTypeNotActiveError("This DocumentType is not ACTIVE.", { documentTypeId: input.documentTypeId });
        if (codes?.[1] === "ConditionalCheckFailed") throw new ConflictError("Document already exists.", { documentId });
        throw new ConflictError("createDocument transaction was rejected.", { documentId });
      }
      throw err;
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
   * exact contradiction with J9 a Rodada 1 proposal introduced and this design corrects). */
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
    try {
      await this.store.transactWrite([{ Update: update }, { Put: buildVersionedCreate(this.tableName, event) }]);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("DocumentVersion was concurrently modified.", { documentId, seq });
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
    const requirementId = this.ids.newRequirementId();
    const now = this.now();
    const status = deriveRequirementStatus(input.applicability, undefined, new Date(now));
    const requirement: Requirement = {
      ...requirementKey(tenantId, input.subjectId, requirementId),
      entityType: "Requirement",
      requirementId,
      tenantId,
      subjectId: input.subjectId,
      name: input.name,
      // `notes` omitted entirely (never written as an explicit `undefined` attribute value) when
      // the caller didn't supply one — same D3-style "no fabricated value" discipline as
      // Document.hasValidity's optional siblings.
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      applicability: input.applicability,
      status,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...requirementGsi1Keys(tenantId, status, now, requirementId),
    };
    const created = await this.store.putIfAbsent(requirement);
    if (!created) throw new ConflictError("Requirement already exists.", { requirementId });
    return requirement;
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

  /** Never touches `evidenceVersionId`/`status` directly — an `applicability` change here still
   * re-derives `status` (e.g. flipping to NOT_APPLICABLE must immediately reflect in GSI1's
   * REQSTATUS namespace, not wait for the next unrelated mutation or the daily reindex). */
  async updateRequirement(ctx: RequestContext, subjectId: string, requirementId: string, expectedVersion: number, input: UpdateRequirementInput): Promise<Requirement> {
    authorize({ context: ctx, action: "docarchive:requirement-update", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    const current = await this.getRequirementUnchecked(tenantId, subjectId, requirementId);
    const nextApplicability = input.applicability ?? current.applicability;
    const now = this.now();
    let status = current.status;
    if (nextApplicability !== current.applicability) {
      const evidence = this.cachedEvidenceForDerivation(current);
      status = deriveRequirementStatus(nextApplicability, evidence, new Date(now));
    }
    const set: Record<string, unknown> = { applicability: nextApplicability, status, ...requirementGsi1Keys(tenantId, status, now, requirementId) };
    if (input.name !== undefined) set["name"] = input.name;
    if (input.notes !== undefined) set["notes"] = input.notes;
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: requirementKey(tenantId, subjectId, requirementId),
      tenantId,
      expectedVersion,
      set,
    });
    try {
      await this.store.transactWrite([{ Update: update }]);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("Requirement was concurrently modified.", { requirementId });
      throw err;
    }
    return { ...current, ...set, version: expectedVersion + 1, updatedAt: now } as Requirement;
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
    };
    // `undefined` is not a valid DynamoDB attribute value (occ.ts's SET-clause builder would
    // otherwise emit an ExpressionAttributeValue literally equal to `undefined`) — only include
    // evidenceValidUntil when the evidence version actually carries one (D3: a document without
    // an expiration date is a legitimate first-class case).
    if (evidenceVersion.validUntil !== undefined) set["evidenceValidUntil"] = evidenceVersion.validUntil;
    const remove = evidenceVersion.validUntil === undefined ? ["evidenceValidUntil"] : undefined;
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key: requirementKey(tenantId, subjectId, requirementId),
      tenantId,
      expectedVersion,
      set,
      remove,
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
    const removedFields = ["evidenceVersionId", "evidenceDocumentId", "evidenceSeq", "evidenceState", "evidenceValidUntil"] as const;
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

  async deleteRequirement(ctx: RequestContext, subjectId: string, requirementId: string, expectedVersion: number): Promise<void> {
    authorize({ context: ctx, action: "docarchive:requirement-delete", resource: { tenantId: ctx.tenant.tenantId } });
    const tenantId = ctx.tenant.tenantId;
    await this.getRequirementUnchecked(tenantId, subjectId, requirementId); // 404s if absent
    const key = requirementKey(tenantId, subjectId, requirementId);
    const del = buildVersionedDelete({ tableName: this.tableName, key, tenantId, expectedVersion });
    try {
      await this.store.transactWrite([{ Delete: del }]);
    } catch (err) {
      if (isTransactionCanceled(err)) throw new ConflictError("Requirement was concurrently modified.", { requirementId });
      throw err;
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
