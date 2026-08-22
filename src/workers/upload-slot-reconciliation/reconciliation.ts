/** UploadSlotReconciliationWorker core logic (M6 design §3.5). Sweeps GSI6 for RESERVED slots
 * past their expiresAt, releases quota, marks the slot EXPIRED, and moves any stuck Document
 * to TIMEOUT (never CLEAN by omission - fail-closed per blueprint §12.7). */
import { buildVersionedUpdate, isTransactionCanceled } from "../../shared/dynamodb/occ.js";
import { documentKey, type Document } from "../../modules/document/domain/document.js";
import { uploadSlotKey, type UploadSlot } from "../../modules/document/domain/upload-slot.js";
import type { DocumentStore, UploadSlotReconciliationSource } from "../../modules/document/ports/document-store.js";
import { GSI6PK_RECON_UPLOAD_PENDING } from "../../modules/document/ports/document-store.js";
import type { TenantQuotaService } from "../../modules/identity/application/quota.js";

export interface ReconciliationDeps {
  store: DocumentStore;
  candidates: UploadSlotReconciliationSource;
  quota: TenantQuotaService;
  tableName: string;
  now: () => string;
  pageSize?: number;
}

export interface ReconciliationResult {
  slotsExpired: number;
  documentsTimedOut: number;
  errors: number;
}

const TERMINAL: ReadonlySet<Document["status"]> = new Set(["CLEAN", "REJECTED", "UNSUPPORTED", "TIMEOUT", "DELETED"]);

export async function reconcileExpiredUploadSlots(deps: ReconciliationDeps): Promise<ReconciliationResult> {
  const now = deps.now();
  const result: ReconciliationResult = { slotsExpired: 0, documentsTimedOut: 0, errors: 0 };

  let cursor: string | undefined;
  do {
    const page = await deps.candidates.queryExpiredSlots<UploadSlot>({ gsi6pk: GSI6PK_RECON_UPLOAD_PENDING, before: now, pageSize: deps.pageSize, cursor });
    cursor = page.cursor;

    for (const slot of page.items) {
      try {
        await processOneSlot(deps, slot);
        result.slotsExpired += 1;
      } catch {
        result.errors += 1;
        // One bad slot never blocks the rest of the sweep - continue, surfaced via the
        // errors count for alarming, same discipline as other reconciliation workers in
        // this codebase.
      }
    }
  } while (cursor);

  return result;
}

async function processOneSlot(deps: ReconciliationDeps, slot: UploadSlot): Promise<void> {
  if (slot.status !== "RESERVED") return; // already handled by a previous/concurrent sweep.

  try {
    await deps.store.transactWrite([
      { Update: buildVersionedUpdate({ tableName: deps.tableName, key: uploadSlotKey(slot.tenantId, slot.uploadSlotId), tenantId: slot.tenantId, expectedVersion: slot.version, set: { status: "EXPIRED" } }) },
    ]);
  } catch (err) {
    if (isTransactionCanceled(err)) return; // concurrent sweep already claimed it.
    throw err;
  }

  await deps.quota.release({ tenantId: slot.tenantId, quotaType: "UPLOAD_COUNT", window: "current", windowSeconds: 60 });

  const key = documentKey(slot.tenantId, slot.itemId, slot.documentId);
  const doc = await deps.store.get<Document>(key, true);
  if (!doc || TERMINAL.has(doc.status)) return;

  try {
    await deps.store.transactWrite([
      { Update: buildVersionedUpdate({ tableName: deps.tableName, key, tenantId: slot.tenantId, expectedVersion: doc.version, set: { status: "TIMEOUT" } }) },
    ]);
  } catch (err) {
    if (isTransactionCanceled(err)) return; // document already advanced concurrently - fine, don't clobber it.
    throw err;
  }
}
