/**
 * Orchestration around `decideNextAction()` — called identically by UploadFinalizerWorker
 * (after persisting uploadEvidence) and MalwareResultWorker (after persisting malwareEvidence).
 * Owns the OCC read-decide-write loop and the actual promotion copy; the pure decision logic
 * itself lives in document-state-machine.ts.
 */
import { buildVersionedUpdate, isTransactionCanceled } from "../../../shared/dynamodb/occ.js";
import { decideNextAction } from "../domain/document-state-machine.js";
import { documentKey, type Document } from "../domain/document.js";
import type { DocumentStore, TransactWriteEntry } from "../ports/document-store.js";
import type { DocumentObjectStore } from "../ports/document-object-store.js";
import { sameObjectVersion } from "../domain/document-object-reference.js";

export interface AdvanceAfterEvidenceDeps {
  store: DocumentStore;
  objects: DocumentObjectStore;
  tableName: string;
  cleanBucket: string;
}

export type AdvanceOutcome = "PROMOTED" | "REJECTED" | "AWAITING" | "IGNORED_STALE" | "IGNORED_WRONG_VERSION";

const MAX_OCC_RETRIES = 10;

/**
 * Re-reads the document fresh on every attempt (never assumes the caller's in-memory copy is
 * current) - both workers may call this concurrently for the same document with different
 * halves of the evidence.
 */
export async function advanceAfterEvidence(
  deps: AdvanceAfterEvidenceDeps,
  input: { tenantId: string; itemId: string; documentId: string; expectedObject: { bucket: string; key: string; versionId: string } },
): Promise<AdvanceOutcome> {
  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const key = documentKey(input.tenantId, input.itemId, input.documentId);
    const doc = await deps.store.get<Document>(key, true);
    if (!doc) return "IGNORED_STALE";

    // A late event for a superseded object version (e.g. a re-upload reused the slot before
    // this event was processed) is never applied to the current document state.
    if (doc.quarantineObject.key === input.expectedObject.key && doc.quarantineObject.versionId && !sameObjectVersion(doc.quarantineObject, input.expectedObject)) {
      return "IGNORED_WRONG_VERSION";
    }

    const decision = decideNextAction({
      currentStatus: doc.status,
      uploadValid: doc.uploadEvidence?.valid,
      uploadEvidence: doc.uploadEvidence,
      malwareEvidence: doc.malwareEvidence,
    });

    if (decision.action === "IGNORE_STALE_EVENT") return "IGNORED_STALE";
    if (decision.action === "AWAIT_MORE_EVIDENCE") return "AWAITING";

    if (decision.action === "REJECT") {
      try {
        await deps.store.transactWrite([
          { Update: buildVersionedUpdate({ tableName: deps.tableName, key, tenantId: input.tenantId, expectedVersion: doc.version, set: { status: decision.status } }) },
        ]);
        return "REJECTED";
      } catch (err) {
        if (isTransactionCanceled(err)) continue; // concurrent update won the race, retry fresh.
        throw err;
      }
    }

    // decision.action === "PROMOTE": copy quarantine -> clean, verify, then confirm CLEAN.
    const cleanKey = `clean/${doc.tenantId}/${doc.documentId}`;
    const cleanObject = await deps.objects.copyObject(doc.quarantineObject, deps.cleanBucket, cleanKey);
    const verify = await deps.objects.headObject(cleanObject);
    if (!verify || verify.contentLength !== doc.contentLength) {
      // Copy landed but didn't verify - never confirm CLEAN on unverified data. The
      // reconciler's TIMEOUT path recovers a document stuck here; a bare retry of this
      // function attempt is also safe (copyObject is not required to be idempotent across
      // attempts, but re-copying the same source version to the same destination key is).
      throw new Error(`Promotion copy verification failed for document ${doc.documentId}`);
    }

    const entries: TransactWriteEntry[] = [
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key,
          tenantId: input.tenantId,
          expectedVersion: doc.version,
          set: { status: "CLEAN", cleanObject },
        }),
      },
    ];
    try {
      await deps.store.transactWrite(entries);
      // Quarantine object removal is best-effort cleanup, never a condition for CLEAN -
      // M6 design §2.3 ("Falha nessa remoção não reverte CLEAN; gera métrica e é recuperada
      // por lifecycle/reconciliação"). The quarantine bucket's own 24h lifecycle rule is the
      // backstop even if this delete call fails or is never reached.
      try {
        await deps.objects.deleteObjectVersion(doc.quarantineObject);
      } catch {
        // Intentionally swallowed - see comment above. Real failure visibility comes from the
        // bucket lifecycle rule + reconciliation metrics, not from this call succeeding.
      }
      return "PROMOTED";
    } catch (err) {
      if (isTransactionCanceled(err)) continue;
      throw err;
    }
  }

  throw new Error(`advanceAfterEvidence exhausted retries for document ${input.documentId} under contention.`);
}
