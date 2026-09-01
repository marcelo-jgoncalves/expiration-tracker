/**
 * DocumentArchiveService — D-143 Nucleus 1: orchestrates the Document/DocumentVersion state
 * machine (`domain/document-version.ts`) against real transactional writes
 * (`ports/document-archive-store.ts`). Out of scope for this increment (per
 * `estado-final-consolidado.md`): Requirement linkage, DocumentRequest origin, guest access,
 * recurrence, DocumentFile persistence/malware scanning — `acceptVersion`'s transaction here
 * only builds the Document/DocumentVersion/DocumentVersionEvent/idempotency actions (up to 6 of
 * the up-to-10 the full design describes); items 7-10 (Requirement/DocumentRequest fencing)
 * are added when those modules exist.
 */
import {
  buildVersionedCreate,
  buildVersionedUpdate,
  isTransactionCanceled,
  type EntityKey,
} from "../../../shared/dynamodb/occ.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { DocumentArchiveStore } from "../ports/document-archive-store.js";
import type { DocumentArchiveIdGenerator } from "./id-generator.js";
import { type CreateDocumentInput, type Document, documentGsi1Keys, documentGsi2Keys, documentKey } from "../domain/document.js";
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

export interface DocumentArchiveServiceDeps {
  store: DocumentArchiveStore;
  tableName: string;
  ids: DocumentArchiveIdGenerator;
  now?: () => string;
}

export interface AcceptVersionResult {
  document: Document;
  acceptedVersionId: string;
}

export class DocumentArchiveService {
  private readonly store: DocumentArchiveStore;
  private readonly tableName: string;
  private readonly ids: DocumentArchiveIdGenerator;
  private readonly now: () => string;

  constructor(deps: DocumentArchiveServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.ids = deps.ids;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async createDocument(tenantId: string, input: CreateDocumentInput): Promise<Document> {
    const documentId = this.ids.newDocumentId();
    const now = this.now();
    const document: Document = {
      ...documentKey(tenantId, documentId),
      entityType: "Document",
      documentId,
      tenantId,
      subjectId: input.subjectId,
      documentType: input.documentType,
      status: "ACTIVE",
      hasValidity: input.hasValidity,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...documentGsi1Keys(tenantId, "ACTIVE", now, documentId),
    };
    const created = await this.store.putIfAbsent(document);
    if (!created) throw new ConflictError("Document already exists.", { documentId });
    // GSI2 (AP3, Documents-by-Subject) written as a second attribute set on the same item —
    // both index memberships live on one physical row, no mirror item needed for this pattern.
    return document;
  }

  async getDocument(tenantId: string, documentId: string): Promise<Document> {
    const document = await this.store.get<Document>(documentKey(tenantId, documentId));
    if (!document) throw new NotFoundError("Document not found.", { documentId });
    return document;
  }

  async listVersions(tenantId: string, documentId: string): Promise<DocumentVersion[]> {
    const items = await this.store.queryByPk<DocumentVersion>(`TENANT#${tenantId}#DOCUMENT#${documentId}`, "VERSION#");
    // DocumentVersionEvent rows share the "VERSION#" SK prefix (VERSION#<seq>#EVENT#...) —
    // filter to rows whose SK is exactly "VERSION#<seq>" (no further "#" segment).
    return items.filter((item) => /^VERSION#\d{6}$/.test(item.SK));
  }

  /** DRAFT creation (`reserveUpload`) — seq is 1 + the highest existing seq for this Document. */
  async reserveUpload(tenantId: string, documentId: string, origin: DocumentVersionOrigin): Promise<DocumentVersion> {
    await this.getDocument(tenantId, documentId); // 404s if the Document doesn't exist
    const existingVersions = await this.listVersions(tenantId, documentId);
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

  /** DRAFT -> RECEIVED. File presence/malware-scan-clean validation is the caller's
   * responsibility in this increment (DocumentFile persistence is a follow-up slice) — this
   * method only enforces the state-machine transition itself. */
  async commitUpload(tenantId: string, documentId: string, seq: number, expectedVersion: number): Promise<DocumentVersion> {
    const key = documentVersionKey(tenantId, documentId, seq);
    const current = await this.store.get<DocumentVersion>(key);
    if (!current) throw new NotFoundError("DocumentVersion not found.", { documentId, seq });
    this.assertTransitionOrConflict(current.state, "RECEIVED", documentId, seq);
    const now = this.now();
    const gsi5 = reviewQueueGsi5Keys(tenantId, "RECEIVED", now, current.versionId);
    const update = buildVersionedUpdate({
      tableName: this.tableName,
      key,
      tenantId,
      expectedVersion,
      set: { state: "RECEIVED", receivedAt: now, ...gsi5 },
      now,
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
  async claimReview(tenantId: string, documentId: string, seq: number, expectedVersion: number, reviewerId: string): Promise<DocumentVersion> {
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
  async acceptVersion(tenantId: string, documentId: string, seq: number, expectedVersion: number, actor: string, clientRequestToken: string): Promise<AcceptVersionResult> {
    // Idempotency check FIRST, before any state-transition validation: a legitimate replay of
    // an already-applied `acceptVersion` must return the original result even though the real
    // current state has since moved on (e.g. ACCEPTED -> SUPERSEDED by a later renewal) — D-143
    // Decision 2/Bloqueador 4-5. Checking transition validity first would misclassify a genuine
    // replay as an illegal transition.
    const existingReplay = await this.store.get<IdempotencyRecord<AcceptVersionResult>>(idempotencyRecordKey(tenantId, documentId, seq, clientRequestToken));
    if (existingReplay) return existingReplay.resultSnapshot;

    const document = await this.getDocument(tenantId, documentId);
    const key = documentVersionKey(tenantId, documentId, seq);
    const current = await this.store.get<DocumentVersion>(key);
    if (!current) throw new NotFoundError("DocumentVersion not found.", { documentId, seq });
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
  async rejectVersion(tenantId: string, documentId: string, seq: number, expectedVersion: number, actor: string, reason: RejectionReason): Promise<DocumentVersion> {
    const key = documentVersionKey(tenantId, documentId, seq);
    const current = await this.store.get<DocumentVersion>(key);
    if (!current) throw new NotFoundError("DocumentVersion not found.", { documentId, seq });
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
    const versions = await this.listVersions(tenantId, documentId);
    return versions.find((v) => v.versionId === versionId);
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
