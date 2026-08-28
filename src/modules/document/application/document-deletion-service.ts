/**
 * Logical deletion — M6 design §3.6 / blueprint §12.6. Version-conditioned, idempotent,
 * never physically deletes the object here (physical purge is a separate, later step driven
 * by `retentionClass`/`purgeAfter` — out of scope for M6's acceptance criteria beyond marking
 * the document DELETED and scheduling the clock).
 */
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { NotFoundError, ConflictError } from "../../../shared/errors/app-error.js";
import { buildVersionedUpdate, isTransactionCanceled } from "../../../shared/dynamodb/occ.js";
import { documentKey, type Document } from "../domain/document.js";
import { computeUserDocumentPurgeAfter } from "../domain/retention.js";
import { GSI6PK_PURGE_PENDING, buildDocumentPurgeGsi6Sk, type DocumentStore } from "../ports/document-store.js";

export interface DocumentDeletionServiceDeps {
  store: DocumentStore;
  tableName: string;
  now?: () => string;
}

const TERMINAL_ALREADY = new Set(["DELETED"]);

export class DocumentDeletionService {
  private readonly store: DocumentStore;
  private readonly tableName: string;
  private readonly now: () => string;

  constructor(deps: DocumentDeletionServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async deleteDocument(ctx: RequestContext, itemId: string, documentId: string): Promise<void> {
    authorize({ context: ctx, action: "document:delete", resource: { tenantId: ctx.tenant.tenantId } });

    const key = documentKey(ctx.tenant.tenantId, itemId, documentId);
    const doc = await this.store.get<Document>(key, true);
    if (!doc) throw new NotFoundError("Document not found.", { itemId, documentId });
    if (TERMINAL_ALREADY.has(doc.status)) return; // idempotent: already deleted.

    const now = this.now();
    const purgeAfter = computeUserDocumentPurgeAfter(now);
    try {
      await this.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: this.tableName,
            key,
            tenantId: ctx.tenant.tenantId,
            expectedVersion: doc.version,
            // W3-06 (D-061): the GSI6 purge-pending pointer is written in the SAME transaction
            // as the soft-delete - never a second write - so the physical purge worker can
            // never miss a deleted Document the way reserveUpload once missed writing its own
            // GSI6 pointer (see document-store.ts's GSI6PK_RECON_UPLOAD_PENDING comment).
            set: {
              status: "DELETED",
              deletedAt: now,
              purgeAfter,
              GSI6PK: GSI6PK_PURGE_PENDING,
              GSI6SK: buildDocumentPurgeGsi6Sk(purgeAfter, ctx.tenant.tenantId, documentId),
            },
          }),
        },
      ]);
    } catch (err) {
      if (isTransactionCanceled(err)) {
        throw new ConflictError("Document was modified concurrently; retry with the current version.", { itemId, documentId });
      }
      throw err;
    }
  }
}
