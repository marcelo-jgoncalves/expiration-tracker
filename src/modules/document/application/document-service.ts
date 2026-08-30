/**
 * DocumentService — implementation-blueprint.md §12.1 interface (`reserveUpload`). Quota
 * consumption happens at the HTTP handler layer before calling this service, matching the
 * established pattern in this codebase (item-handlers.ts's `consumeApiRequestQuota` is a
 * separate call, not folded into the same DynamoDB transaction as the entity write) — not a
 * deviation from the blueprint's conceptual "transação" language, just reuse of the same
 * TenantQuotaService every other module already uses instead of inventing a bespoke one.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ValidationError, ConflictError, NotFoundError, TenantNotActiveError } from "../../../shared/errors/app-error.js";
import { buildVersionedCreate } from "../../../shared/dynamodb/occ.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { documentKey, type Document } from "../domain/document.js";
import { uploadSlotKey, type UploadSlot } from "../domain/upload-slot.js";
import { MAX_UPLOAD_BYTES } from "./upload-validation.js";
import { GSI6PK_RECON_UPLOAD_PENDING, buildUploadSlotGsi6Sk, type DocumentStore, type TransactWriteEntry } from "../ports/document-store.js";
import type { UploadUrlSigner } from "../ports/upload-url-signer.js";
import type { DocumentIdGenerator } from "./id-generator.js";
import { IdempotencyStore, transitionIdempotencyStatus, type DynamoLike } from "../../../shared/idempotency/idempotency.js";

const ALLOWED_MEDIA_TYPES: ReadonlySet<string> = new Set(["application/pdf", "image/jpeg", "image/png"]);
const PRESIGN_TTL_SECONDS = 600; // 10 minutes, M6 design §2 (fluxo de reserva).
const OPERATION = "document.reserve-upload";

export interface ReserveUploadInput {
  fileName: string;
  mediaType: string;
  contentLength: number;
  checksumSha256: string;
}

export interface ReserveUploadResult {
  documentId: string;
  uploadSlotId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

export interface DocumentServiceDeps {
  store: DocumentStore;
  tableName: string;
  quarantineBucket: string;
  ids: DocumentIdGenerator;
  signer: UploadUrlSigner;
  now?: () => string;
}

export class DocumentService {
  private readonly store: DocumentStore;
  private readonly tableName: string;
  private readonly quarantineBucket: string;
  private readonly ids: DocumentIdGenerator;
  private readonly signer: UploadUrlSigner;
  private readonly now: () => string;
  private readonly idempotency: IdempotencyStore;

  constructor(deps: DocumentServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.quarantineBucket = deps.quarantineBucket;
    this.ids = deps.ids;
    this.signer = deps.signer;
    this.now = deps.now ?? (() => new Date().toISOString());
    const adapter: DynamoLike = {
      putIfAbsent: async (item) => ((await this.store.putIfAbsent(item)) ? "PUT" : "ALREADY_EXISTS"),
      get: (key) => this.store.get(key),
      update: (item) => this.store.update(item),
      transitionIfStatus: (item, expectedStatus) => transitionIdempotencyStatus(this.store, this.tableName, item, expectedStatus),
    };
    this.idempotency = new IdempotencyStore(adapter, this.tableName, this.now);
  }

  async reserveUpload(ctx: RequestContext, itemId: string, input: ReserveUploadInput, idempotencyKey: string): Promise<ReserveUploadResult> {
    authorize({ context: ctx, action: "document:reserve-upload", resource: { tenantId: ctx.tenant.tenantId } });

    if (!ALLOWED_MEDIA_TYPES.has(input.mediaType)) {
      throw new ValidationError("Unsupported media type.", { mediaType: input.mediaType });
    }
    if (input.contentLength <= 0 || input.contentLength > MAX_UPLOAD_BYTES) {
      throw new ValidationError("contentLength must be between 1 and 10MiB.", { contentLength: input.contentLength, maxBytes: MAX_UPLOAD_BYTES });
    }
    if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) {
      throw new ValidationError("checksumSha256 must be a 64-character hex SHA-256 digest.");
    }

    const requestHash = `${itemId}|${input.fileName}|${input.mediaType}|${input.contentLength}|${input.checksumSha256}`;
    const now = this.now();
    const expiresAt = new Date(Date.parse(now) + PRESIGN_TTL_SECONDS * 1000).toISOString();

    const begin = await this.idempotency.begin({
      tenantId: ctx.tenant.tenantId,
      operation: OPERATION,
      key: idempotencyKey,
      requestHash,
      expiresAt,
    });

    let documentId: string;
    let uploadSlotId: string;
    let quarantineKey: string;

    if (begin === "COMPLETED_SAME_REQUEST") {
      // Retry of the exact same request within the idempotency window: reuse the SAME
      // document/slot/key already created by the first attempt (never mint new IDs or a new
      // quarantine key for a request that already succeeded) - same pattern as
      // ExpirationService.renewItem's COMPLETED_SAME_REQUEST branch.
      const record = await this.store.get({
        PK: `TENANT#${ctx.tenant.tenantId}#IDEMPOTENCY#${OPERATION}`,
        SK: `KEY#${idempotencyKey}`,
      });
      const existingDocumentId = (record as { responseRef?: string } | undefined)?.responseRef;
      if (!existingDocumentId) {
        throw new ConflictError("reserveUpload idempotency record missing responseRef.", { itemId });
      }
      const existingDocument = await this.store.get<Document>(documentKey(ctx.tenant.tenantId, itemId, existingDocumentId));
      if (!existingDocument) {
        throw new ConflictError("reserveUpload idempotency record points at a missing Document.", { itemId, documentId: existingDocumentId });
      }
      documentId = existingDocument.documentId;
      uploadSlotId = existingDocument.uploadSlotId;
      quarantineKey = existingDocument.quarantineObject.key;
    } else {
      documentId = this.ids.newDocumentId();
      uploadSlotId = this.ids.newUploadSlotId();
      // Key intentionally encodes tenantId/itemId/documentId/uploadSlotId (M6 design §2 "fluxo
      // de reserva", example key shape) - never the original file name (real PII, excluded).
      // The S3 event that later reaches UploadFinalizerWorker/MalwareResultWorker carries only
      // bucket/key/versionId, no application context - encoding these IDs in the key itself is
      // what lets those workers resolve the exact Document without an extra lookup index.
      // tenantId/itemId/documentId are internal identifiers, not personal data.
      quarantineKey = `tenant/${ctx.tenant.tenantId}/item/${itemId}/document/${documentId}/slot/${uploadSlotId}/${randomUUID()}`;
    }

    if (begin === "ACQUIRED") {
      const document: Document = {
        ...documentKey(ctx.tenant.tenantId, itemId, documentId),
        entityType: "Document",
        tenantId: ctx.tenant.tenantId,
        itemId,
        documentId,
        uploadSlotId,
        fileName: input.fileName,
        mediaType: input.mediaType,
        contentLength: input.contentLength,
        checksumSha256: input.checksumSha256,
        status: "PENDING_UPLOAD",
        quarantineObject: { bucket: this.quarantineBucket, key: quarantineKey, versionId: "" },
        retentionClass: "USER_DOCUMENT",
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const slot: UploadSlot = {
        ...uploadSlotKey(ctx.tenant.tenantId, uploadSlotId),
        entityType: "UploadSlot",
        tenantId: ctx.tenant.tenantId,
        uploadSlotId,
        documentId,
        itemId,
        status: "RESERVED",
        quarantineKey,
        reservedAt: now,
        expiresAt,
        retentionClass: "TRANSIENT",
        purgeAfter: expiresAt,
        version: 1,
        updatedAt: now,
        // Real bug found via Camada 3 verification against AWS real (2026-08-25): this write
        // was missing entirely - every expired reservation was invisible to
        // UploadSlotReconciliationWorker's GSI6 sweep, confirmed empirically against the
        // deployed dev Lambda (0 results without these two fields, correctly reconciled once
        // added). Removed the moment the slot leaves RESERVED (reconciliation.ts on EXPIRED,
        // advance-after-evidence.ts on CONSUMED).
        GSI6PK: GSI6PK_RECON_UPLOAD_PENDING,
        GSI6SK: buildUploadSlotGsi6Sk(expiresAt, ctx.tenant.tenantId, uploadSlotId),
      };

      const entries: TransactWriteEntry[] = [
        { Put: buildVersionedCreate(this.tableName, document as unknown as Record<string, unknown> & { PK: string; SK: string }) },
        { Put: buildVersionedCreate(this.tableName, slot as unknown as Record<string, unknown> & { PK: string; SK: string }) },
      ];
      try {
        // W3-07 (D-070 chunk 8/N): the Document+UploadSlot Put is the real DynamoDB admission
        // point that gates a NEW presigned URL issuance - fencing it here (instead of a
        // separate unfenced read-then-check right before presignUpload) closes the actual gap
        // and blocks new reservations atomically once the tenant is DELETING. A retry of an
        // already-admitted reservation (COMPLETED_SAME_REQUEST branch above) never reaches this
        // block, so it is free to re-presign per the established "admitted while ACTIVE may
        // finish" contract.
        //
        // Wave B2B-13 (E2E/Adversarial Security, D-112, Q16 of roadmap-evolution/17 §121)
        // audited this same admission-point contract against Membership (not just Organization
        // lifecycle) and confirmed it needs no code change here - the full contract, split
        // across 2 layers this function never touches: (a) a NEW reservation after the caller's
        // Membership is revoked is denied one layer up, at RequestContextResolver/
        // resolveWorkingOrganization() (proven by resolver.test.ts's Q6 revocation test) -
        // DocumentService only ever runs with an already-resolved, already-valid RequestContext,
        // it never re-checks Membership itself; (b) a presigned URL already issued before that
        // revocation remains a valid capability for its TTL regardless (roadmap-evolution/17
        // §47/§48: "emissão da URL é o admission point... não prometer revogação instantânea de
        // uma capability impossível de revogar") - not re-validated by this application at all,
        // by design, since S3 verifies the SigV4 signature itself; there is no code path here to
        // test for that half of the contract.
        await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId: ctx.tenant.tenantId, entries });
      } catch (err) {
        if (err instanceof TenantNotActiveError) throw err;
        throw new ConflictError("Failed to reserve upload slot.", { itemId, cause: err instanceof Error ? err.message : String(err) });
      }
    }

    const presigned = await this.signer.presignUpload({
      bucket: this.quarantineBucket,
      key: quarantineKey,
      mediaType: input.mediaType,
      contentLength: input.contentLength,
      checksumSha256: input.checksumSha256,
      metadata: { documentId, uploadSlotId, tenantId: ctx.tenant.tenantId },
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    });

    if (begin === "ACQUIRED") {
      await this.idempotency.complete({ tenantId: ctx.tenant.tenantId, operation: OPERATION, key: idempotencyKey, responseRef: documentId });
    }

    return {
      documentId,
      uploadSlotId,
      uploadUrl: presigned.uploadUrl,
      requiredHeaders: presigned.requiredHeaders,
      expiresAt,
    };
  }

  /** BLOCKER-A: closes the read gap — only upload/delete existed before. Mirrors
   * ExpirationService.readActiveItem's convention of treating a soft-deleted row as not
   * found rather than exposing it, tenant isolation coming from documentKey's PK. */
  async getDocument(ctx: RequestContext, itemId: string, documentId: string): Promise<Document> {
    authorize({ context: ctx, action: "document:read", resource: { tenantId: ctx.tenant.tenantId } });
    const document = await this.store.get<Document>(documentKey(ctx.tenant.tenantId, itemId, documentId));
    if (!document || document.status === "DELETED") {
      throw new NotFoundError("Document not found.", { itemId, documentId });
    }
    return document;
  }

  /** BLOCKER-A: lists an item's documents via the existing item partition (no new GSI —
   * Document is already keyed under `TENANT#t#ITEM#i`/`DOC#d`, data-model.md line 34).
   * Excludes DELETED rows, same visibility rule as getDocument. */
  async listDocuments(ctx: RequestContext, itemId: string): Promise<Document[]> {
    authorize({ context: ctx, action: "document:read", resource: { tenantId: ctx.tenant.tenantId } });
    const documents = await this.store.queryByPk<Document>(`TENANT#${ctx.tenant.tenantId}#ITEM#${itemId}`, "DOC#");
    return documents.filter((document) => document.status !== "DELETED");
  }
}
