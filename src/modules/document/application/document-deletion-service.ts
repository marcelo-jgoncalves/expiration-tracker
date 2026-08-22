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
import type { DocumentStore } from "../ports/document-store.js";

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
    try {
      await this.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: this.tableName,
            key,
            tenantId: ctx.tenant.tenantId,
            expectedVersion: doc.version,
            set: { status: "DELETED", deletedAt: now, purgeAfter: computeUserDocumentPurgeAfter(now) },
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
