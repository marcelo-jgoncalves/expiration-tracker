/** UploadFinalizerWorker core logic (M6 design §3.2). Pure(ish): injected store/objects/parser,
 * no AWS SDK/Lambda runtime dependency directly (adapters are injected). */
import { buildVersionedUpdate } from "../../shared/dynamodb/occ.js";
import { validateObservedUpload } from "../../modules/document/application/upload-validation.js";
import { advanceAfterEvidence } from "../../modules/document/application/advance-after-evidence.js";
import { documentKey, type Document } from "../../modules/document/domain/document.js";
import type { DocumentStore } from "../../modules/document/ports/document-store.js";
import type { DocumentObjectStore } from "../../modules/document/ports/document-object-store.js";
import type { PdfParser } from "../../modules/document/ports/pdf-parser.js";
import { tryTenantBusinessMutation } from "../../shared/tenant-lifecycle/tenant-business-mutation.js";

export interface FinalizeUploadInput {
  tenantId: string;
  itemId: string;
  documentId: string;
  object: { bucket: string; key: string; versionId: string };
}

export interface FinalizeUploadDeps {
  store: DocumentStore;
  objects: DocumentObjectStore;
  parser: PdfParser;
  tableName: string;
  cleanBucket: string;
  now?: () => string;
}

export type FinalizeOutcome = "CONFIRMED" | "REJECTED_INVALID" | "IGNORED_UNKNOWN_SLOT" | "IGNORED_STALE" | "IGNORED_TENANT_NOT_ACTIVE";

const MAX_OCC_RETRIES = 10;

/**
 * Fail-closed at every branch (M6 design §3.2: "Eventos sem slot, com identidade divergente ou
 * versão inesperada são fail-closed"). Never confirms a document based on a mismatched bucket/
 * key or a document that's already past PENDING_UPLOAD/SCANNING.
 *
 * Real bug found via Camada 3 exercise (2026-08-22): persisting this worker's OWN evidence
 * used to give up on the FIRST OCC conflict (isTransactionCanceled -> "IGNORED_STALE"),
 * assuming a version conflict always meant "the other worker already fully resolved this
 * document". In practice the far more common conflict is the OTHER worker (MalwareResultWorker)
 * concurrently persisting ITS OWN half of the evidence at the same moment - a transient,
 * retryable race, not real staleness. Giving up there permanently dropped this worker's
 * evidence (no retry, no DLQ - the SQS message is considered successfully processed), stranding
 * an otherwise-clean document in PENDING_UPLOAD forever (confirmed via a real EventBridge-fed
 * GuardDuty scan landing a few seconds before this worker's own read-modify-write finished).
 * Fixed with the same bounded read-decide-write retry loop advanceAfterEvidence already uses.
 */
export async function finalizeUpload(deps: FinalizeUploadDeps, input: FinalizeUploadInput): Promise<FinalizeOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const key = documentKey(input.tenantId, input.itemId, input.documentId);

  for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt++) {
    const doc = await deps.store.get<Document>(key, true);
    if (!doc) return "IGNORED_UNKNOWN_SLOT";
    if (doc.quarantineObject.key !== input.object.key || doc.quarantineObject.bucket !== input.object.bucket) return "IGNORED_UNKNOWN_SLOT";
    if (doc.status !== "PENDING_UPLOAD" && doc.status !== "SCANNING") return "IGNORED_STALE";

    const observed = await deps.objects.headObject(input.object);
    if (!observed) return "REJECTED_INVALID";

    const validation = validateObservedUpload({ mediaType: doc.mediaType, contentLength: doc.contentLength, checksumSha256: doc.checksumSha256 }, observed);

    let uploadValid = validation === "VALID";
    if (uploadValid && doc.mediaType === "application/pdf") {
      const parseResult = await deps.parser.parse(input.object);
      uploadValid = parseResult.outcome === "VALID";
    }

    const uploadEvidence = {
      object: input.object,
      contentLength: observed.contentLength,
      mediaType: observed.mediaType,
      checksumSha256: observed.checksumSha256 ?? doc.checksumSha256,
      valid: uploadValid,
      observedAt: now(),
    };

    // W3-07 (Round F finding): uploadEvidence is itself a TenantBusinessMutation, not just the
    // final CLEAN promotion advanceAfterEvidence() owns.
    const evidenceResult = await tryTenantBusinessMutation({
      store: deps.store,
      tableName: deps.tableName,
      tenantId: input.tenantId,
      entries: [
        {
          Update: buildVersionedUpdate({
            tableName: deps.tableName,
            key,
            tenantId: input.tenantId,
            expectedVersion: doc.version,
            set: { status: "SCANNING", uploadEvidence },
          }),
        },
      ],
    });
    if (!evidenceResult.ok) {
      if (evidenceResult.reason === "OCC_CONFLICT") continue; // concurrent evidence write raced us - re-read fresh and retry.
      return "IGNORED_TENANT_NOT_ACTIVE";
    }

    const outcome = await advanceAfterEvidence(
      { store: deps.store, objects: deps.objects, tableName: deps.tableName, cleanBucket: deps.cleanBucket },
      { tenantId: input.tenantId, itemId: input.itemId, documentId: input.documentId, expectedObject: input.object },
    );
    if (outcome === "REJECTED") return "REJECTED_INVALID";
    if (outcome === "IGNORED_TENANT_NOT_ACTIVE") return "IGNORED_TENANT_NOT_ACTIVE";
    return "CONFIRMED";
  }

  throw new Error(`finalizeUpload exhausted retries for document ${input.documentId} under contention.`);
}
