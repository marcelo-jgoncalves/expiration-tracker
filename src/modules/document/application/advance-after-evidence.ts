/**
 * Orchestration around `decideNextAction()` — called identically by UploadFinalizerWorker
 * (after persisting uploadEvidence) and MalwareResultWorker (after persisting malwareEvidence).
 * Owns the OCC read-decide-write loop and the actual promotion copy; the pure decision logic
 * itself lives in document-state-machine.ts.
 */
import { buildVersionedUpdate, isTransactionCanceled } from "../../../shared/dynamodb/occ.js";
import { decideNextAction } from "../domain/document-state-machine.js";
import { documentKey, type Document } from "../domain/document.js";
import { uploadSlotKey, type UploadSlot } from "../domain/upload-slot.js";
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

/** Real bug found via Camada 3 verification against AWS real (2026-08-25): a Document
 * reaching a terminal outcome here never told its UploadSlot the reservation was resolved -
 * the slot stayed `RESERVED` (and, once reserveUpload's GSI6-write fix lands, visible to
 * every future reconciliation sweep) forever, even for a perfectly successful upload. This
 * mirrors reconciliation.ts's own "remove the GSI6 pointer the moment the slot leaves
 * RESERVED" rule - skips entirely (never a hard error) if the slot is missing or already
 * left RESERVED, since a concurrent reconciliation sweep resolving the exact same race is a
 * legitimate, already-handled outcome, not a defect. */
async function appendSlotConsumption(deps: AdvanceAfterEvidenceDeps, entries: TransactWriteEntry[], tenantId: string, uploadSlotId: string): Promise<void> {
  const slot = await deps.store.get<UploadSlot>(uploadSlotKey(tenantId, uploadSlotId));
  if (!slot || slot.status !== "RESERVED") return;
  entries.push({
    Update: buildVersionedUpdate({
      tableName: deps.tableName,
      key: uploadSlotKey(tenantId, uploadSlotId),
      tenantId,
      expectedVersion: slot.version,
      set: { status: "CONSUMED" },
      remove: ["GSI6PK", "GSI6SK"],
    }),
  });
}

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

    // `doc.quarantineObject.versionId` is always "" (reserveUpload sets it before the real
    // object exists - the actual versionId is only known once evidence arrives) - the real,
    // current object reference lives in whichever evidence has already been persisted.
    const knownObject = doc.uploadEvidence?.object ?? doc.malwareEvidence?.object;

    // A late event for a superseded object version (e.g. a re-upload reused the slot before
    // this event was processed) is never applied to the current document state.
    if (knownObject && knownObject.key === input.expectedObject.key && !sameObjectVersion(knownObject, input.expectedObject)) {
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
      const rejectEntries: TransactWriteEntry[] = [
        { Update: buildVersionedUpdate({ tableName: deps.tableName, key, tenantId: input.tenantId, expectedVersion: doc.version, set: { status: decision.status } }) },
      ];
      await appendSlotConsumption(deps, rejectEntries, input.tenantId, doc.uploadSlotId);
      try {
        await deps.store.transactWrite(rejectEntries);
        return "REJECTED";
      } catch (err) {
        if (isTransactionCanceled(err)) continue; // concurrent update won the race, retry fresh.
        throw err;
      }
    }

    // decision.action === "PROMOTE": copy quarantine -> clean, verify, then confirm CLEAN.
    // Real bug found via Camada 3 (2026-08-22): copying from `doc.quarantineObject` crashed
    // with "Version id cannot be the empty string" - that field's versionId is always "" (see
    // comment above), never the real S3 version. PROMOTE is only reachable once uploadEvidence
    // exists (uploadValid === true is required by decideNextAction), so `knownObject` here is
    // guaranteed to hold the real, observed object reference.
    const sourceObject = knownObject ?? doc.quarantineObject;
    const cleanKey = `clean/${doc.tenantId}/${doc.documentId}`;
    const cleanObject = await deps.objects.copyObject(sourceObject, deps.cleanBucket, cleanKey);
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
    await appendSlotConsumption(deps, entries, input.tenantId, doc.uploadSlotId);
    try {
      await deps.store.transactWrite(entries);
      // Quarantine object removal is best-effort cleanup, never a condition for CLEAN -
      // M6 design §2.3 ("Falha nessa remoção não reverte CLEAN; gera métrica e é recuperada
      // por lifecycle/reconciliação"). The quarantine bucket's own 24h lifecycle rule is the
      // backstop even if this delete call fails or is never reached.
      try {
        await deps.objects.deleteObjectVersion(sourceObject);
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
