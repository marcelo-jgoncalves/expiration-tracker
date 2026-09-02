/**
 * Orchestration around `decideNextAction()` — called identically by UploadFinalizerWorker
 * (after persisting uploadEvidence) and MalwareResultWorker (after persisting malwareEvidence).
 * Owns the OCC read-decide-write loop and the actual promotion copy; the pure decision logic
 * itself lives in document-state-machine.ts.
 */
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { decideNextAction } from "../domain/document-state-machine.js";
import { documentKey, type Document } from "../domain/document.js";
import { uploadSlotKey, type UploadSlot } from "../domain/upload-slot.js";
import type { DocumentStore, TransactWriteEntry } from "../ports/document-store.js";
import type { DocumentObjectStore } from "../ports/document-object-store.js";
import { sameObjectVersion } from "../domain/document-object-reference.js";
import { tryTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { deriveUploadSlotMaintenanceDue, transientPurgeGsi8Keys } from "../../../shared/transient-purge-gsi8.js";

export interface AdvanceAfterEvidenceDeps {
  store: DocumentStore;
  objects: DocumentObjectStore;
  tableName: string;
  cleanBucket: string;
}

export type AdvanceOutcome = "PROMOTED" | "REJECTED" | "AWAITING" | "IGNORED_STALE" | "IGNORED_WRONG_VERSION" | "IGNORED_TENANT_NOT_ACTIVE";

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
  // D-179/D-188 (transient-purge, 7th GSI8 slice): CONSUMED is a terminal transition off
  // RESERVED - the slot becomes a real purge candidate the moment this commits, so the GSI8
  // pointer must be written atomically in the SAME conditional write as the status change,
  // never as a separate follow-up write (same "pointer + transition, one commit" discipline as
  // invitation-purge's D-182 writers).
  const due = deriveUploadSlotMaintenanceDue({ status: "CONSUMED", reservedAt: slot.reservedAt });
  const gsi8 = due ? transientPurgeGsi8Keys({ dueAtIso: due.dueAtIso, tenantId, entityType: "UploadSlot", sk: uploadSlotKey(tenantId, uploadSlotId).SK }) : undefined;
  entries.push({
    Update: buildVersionedUpdate({
      tableName: deps.tableName,
      key: uploadSlotKey(tenantId, uploadSlotId),
      tenantId,
      expectedVersion: slot.version,
      set: { status: "CONSUMED", ...(gsi8 ?? {}) },
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
      // W3-07 (Round F/G finding): the REJECT transition is itself a TenantBusinessMutation -
      // fence it, not just the final CLEAN promotion below.
      const rejectResult = await tryTenantBusinessMutation({ store: deps.store, tableName: deps.tableName, tenantId: input.tenantId, entries: rejectEntries });
      if (rejectResult.ok) return "REJECTED";
      if (rejectResult.reason === "OCC_CONFLICT") continue; // concurrent update won the race, retry fresh.
      return "IGNORED_TENANT_NOT_ACTIVE";
    }

    // decision.action === "PROMOTE": copy quarantine -> clean, verify, then confirm CLEAN.
    // Real bug found via Camada 3 (2026-08-22): copying from `doc.quarantineObject` crashed
    // with "Version id cannot be the empty string" - that field's versionId is always "" (see
    // comment above), never the real S3 version. PROMOTE is only reachable once uploadEvidence
    // exists (uploadValid === true is required by decideNextAction), so `knownObject` here is
    // guaranteed to hold the real, observed object reference.
    const sourceObject = knownObject ?? doc.quarantineObject;
    // M7 (ExtractionStarterWorker, D-035 §12.5): the clean-bucket S3 event that triggers
    // extraction carries only bucket+key+versionId, never itemId - Document's PK requires
    // itemId to look up. Extending the key to mirror the quarantine key's item-anchored shape
    // (parseQuarantineKey's own pattern) closes that gap at the source instead of adding a
    // GSI just to look up Document by documentId alone.
    const cleanKey = `clean/${doc.tenantId}/${doc.itemId}/${doc.documentId}`;
    const cleanObject = await deps.objects.copyObject(sourceObject, deps.cleanBucket, cleanKey);
    const verify = await deps.objects.headObject(cleanObject);
    if (!verify || verify.contentLength !== doc.contentLength) {
      // Copy landed but didn't verify - never confirm CLEAN on unverified data. The
      // reconciler's TIMEOUT path recovers a document stuck here; a bare retry of this
      // function attempt is also safe (copyObject is not required to be idempotent across
      // attempts, but re-copying the same source version to the same destination key is).
      // W3-07 review finding (Codex round 1, 2026-08-29): `cleanBucket` is versioned
      // (`infra/modules/document-buckets/main.tf`'s `aws_s3_bucket_versioning.clean`) - a
      // verification failure that just throws without deleting the just-created version left
      // an orphaned clean-bucket version behind on every retry, undetected by any existing
      // test. Compensate this exact version, best-effort, before surfacing the error.
      try {
        await deps.objects.deleteObjectVersion(cleanObject);
      } catch {
        // Best-effort - same backstop reasoning as the TENANT_NOT_ACTIVE compensation below.
      }
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
    // W3-07 (Round F finding): the copy to `cleanObject` above already happened BEFORE this
    // fenced commit - if the tenant moved to DELETING in that exact window, the commit below is
    // rejected atomically by the lifecycle fence, but `cleanObject` now exists in S3 with no
    // corresponding Document row. Immediate compensation (Round G's proposed closure item 3,
    // endorsed by Codex against the real TransactWriteItems/CancellationReasons API): on a
    // TENANT_NOT_ACTIVE rejection specifically, delete the just-copied clean object right here,
    // best-effort. This does NOT fully close the race Round G also found (an operation that was
    // admitted before DELETING and only creates its S3 object after the purge sweep's final
    // authoritative re-scan) - that residual case is covered by the permanent post-DELETED
    // sweeper (approved design §O-6 item 1c, reusing the DocumentPurgeWorker/D-061 pattern),
    // which is separate future work, not attempted this session.
    const promoteResult = await tryTenantBusinessMutation({ store: deps.store, tableName: deps.tableName, tenantId: input.tenantId, entries });
    if (!promoteResult.ok) {
      // W3-07 review finding (Codex round 1, 2026-08-29): the ORIGINAL code only compensated
      // `cleanObject` on TENANT_NOT_ACTIVE, never on an ordinary OCC_CONFLICT retry - since
      // `cleanKey` is deterministic and the bucket is versioned, every OCC-losing attempt left
      // its own orphaned clean-bucket version behind even though the loop went on to succeed on
      // a later attempt. Compensate on EVERY non-committed outcome, not just the fence
      // rejection, before deciding whether to retry or give up.
      try {
        await deps.objects.deleteObjectVersion(cleanObject);
      } catch {
        // Best-effort - the permanent post-DELETED sweeper (future work) is the backstop for a
        // failed compensation delete, same as the quarantine-delete backstop below.
      }
      if (promoteResult.reason === "OCC_CONFLICT") continue;
      return "IGNORED_TENANT_NOT_ACTIVE";
    }
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
  }

  throw new Error(`advanceAfterEvidence exhausted retries for document ${input.documentId} under contention.`);
}
