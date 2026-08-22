/** UploadFinalizerWorker core logic (M6 design §3.2). Pure(ish): injected store/objects/parser,
 * no AWS SDK/Lambda runtime dependency directly (adapters are injected). */
import { buildVersionedUpdate, isTransactionCanceled } from "../../shared/dynamodb/occ.js";
import { validateObservedUpload } from "../../modules/document/application/upload-validation.js";
import { advanceAfterEvidence } from "../../modules/document/application/advance-after-evidence.js";
import { documentKey, type Document } from "../../modules/document/domain/document.js";
import type { DocumentStore } from "../../modules/document/ports/document-store.js";
import type { DocumentObjectStore } from "../../modules/document/ports/document-object-store.js";
import type { PdfParser } from "../../modules/document/ports/pdf-parser.js";

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

export type FinalizeOutcome = "CONFIRMED" | "REJECTED_INVALID" | "IGNORED_UNKNOWN_SLOT" | "IGNORED_STALE";

/**
 * Fail-closed at every branch (M6 design §3.2: "Eventos sem slot, com identidade divergente ou
 * versão inesperada são fail-closed"). Never confirms a document based on a mismatched bucket/
 * key or a document that's already past PENDING_UPLOAD/SCANNING.
 */
export async function finalizeUpload(deps: FinalizeUploadDeps, input: FinalizeUploadInput): Promise<FinalizeOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const key = documentKey(input.tenantId, input.itemId, input.documentId);
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

  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key,
          tenantId: input.tenantId,
          expectedVersion: doc.version,
          set: { status: "SCANNING", uploadEvidence },
        }),
      },
    ]);
  } catch (err) {
    if (isTransactionCanceled(err)) return "IGNORED_STALE"; // concurrent event already advanced it.
    throw err;
  }

  const outcome = await advanceAfterEvidence(
    { store: deps.store, objects: deps.objects, tableName: deps.tableName, cleanBucket: deps.cleanBucket },
    { tenantId: input.tenantId, itemId: input.itemId, documentId: input.documentId, expectedObject: input.object },
  );
  return outcome === "REJECTED" ? "REJECTED_INVALID" : "CONFIRMED";
}
