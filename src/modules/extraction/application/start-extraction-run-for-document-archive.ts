/**
 * startExtractionRunForDocumentArchive — D-193 ("Reconciliação OCR/Extração ↔ Document
 * Lifecycle", `estado-final-consolidado.md` item 3/9) "Starter" for the `document-archive`
 * pipeline. Sibling to `start-extraction-run.ts` (the OLD `document`-module trigger, left
 * intact per D-193's explicit scope exclusion "desligar o módulo document antigo") — same
 * idempotent-create-then-(would-be)-start shape, but keyed by `{tenantId, documentId,
 * versionId}` (this file's own `ExtractionRun` re-keying, `domain/extraction-run.ts`) and
 * gated by the design's 5 fresh-re-read preconditions instead of a single `Document.status`
 * check.
 *
 * The approved design text names 4 preconditions explicitly ("Sempre relê DocumentFile
 * fresco: scanStatus === CLEAN, cleanObject bate exatamente, role === PRINCIPAL,
 * DocumentVersion em estado elegível") but the design's own summary calls this "the 5
 * Starter preconditions". The 5th, consistent with the tenant-ACTIVE-fence discipline this
 * same design applies everywhere else in D-193 (`apply-file-scan-result.ts`'s
 * `tryTenantBusinessMutation` fence, added explicitly to `applyFileScanResult`/
 * `confirmFileScanClean` rather than "inherited"), is a fresh tenant-ACTIVE check here too —
 * this Starter never assumes the tenant is still ACTIVE just because the file/version rows
 * happen to still exist.
 *
 * TOCTOU protection: every precondition is checked against a FRESH, strongly consistent read
 * taken at call time — never the caller's S3-event payload, never a value read earlier in the
 * same Lambda invocation (e.g. by `advanceDocumentArchiveFileAfterEvidence`'s own internal
 * reads, which this function does not receive or trust). `input.observedCleanObject` is the
 * ONE piece of caller-supplied data this function compares against a fresh read (never used to
 * decide anything on its own) - it is the S3 "Object Created" event's own claimed bucket/key/
 * versionId, matched byte-for-byte against the freshly re-read `DocumentFile.cleanObject`.
 *
 * RESOLVED GAP (D-193 item 3/9 slice 3, `run-extraction-validation.ts`'s own doc comments have
 * the detail): `commitOrDiscard()` now branches on `ExtractionExecutionInput.documentSource` to
 * guard against the `document-archive` `Document` row instead of the OLD module's, and the
 * classifier's `fileName` gap is closed by passing `""` (never a fabricated name — the
 * classifier's own fallback chain, magic bytes -> extension -> `contentType`, already degrades
 * gracefully to `contentType` when `fileName` yields no extension match; `DocumentFile.mediaType`
 * supplies that `contentType` here). `startExecution()` is therefore called for real below, same
 * "call every time, dedup via Step Functions' own execution-name uniqueness" discipline
 * `start-extraction-run.ts` documents.
 */
import { documentFileKey, type DocumentFile } from "../../document-archive/domain/document-file.js";
import { documentVersionKey, type DocumentVersion, type DocumentVersionState } from "../../document-archive/domain/document-version.js";
import type { DocumentArchiveStore } from "../../document-archive/ports/document-archive-store.js";
import type { DocumentObjectReference } from "../../document/domain/document-object-reference.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { extractionRunKey, deriveExtractionRunId, type ExtractionRun } from "../domain/extraction-run.js";
import { PIPELINE_VERSION_V1 } from "../domain/field-schema.js";
import { isDocumentArchiveExtractionTriggerEnabled } from "./document-archive-activation.js";
import type { ExtractionRunStore } from "../ports/extraction-run-store.js";
import type { ExtractionExecutionStarter } from "../ports/extraction-execution-starter.js";
import type { FeatureFlagsReader } from "../ports/feature-flags-reader.js";

export interface StartExtractionRunForDocumentArchiveDeps {
  archive: DocumentArchiveStore;
  runs: ExtractionRunStore;
  executions: ExtractionExecutionStarter;
  /** D-193 item 8/9 (STARTER gate). Read once at the top of every invocation - a read/parse
   * failure fails closed exactly like `start-ocr.ts`'s own `OcrDisabledError` posture (any error
   * is treated identically to the flag being off, never as "unknown, proceed"). */
  featureFlags: FeatureFlagsReader;
  now?: () => string;
}

export interface StartExtractionRunForDocumentArchiveInput {
  tenantId: string;
  documentId: string;
  /** From `parseDocumentArchiveCleanKey()` — this key format carries `versionId`, never `seq`
   * (D-193's closed clean-key decision), so `seq` (which `DocumentFile`/`DocumentVersion`'s own
   * DynamoDB key actually uses) is resolved via an eventually-consistent partition query below.
   * That resolution only ever locates WHICH row to strongly-consistently re-read next — it is
   * never itself the basis for a precondition decision. */
  versionId: string;
  fileId: string;
  /** The S3 "Object Created" event's own claimed clean-bucket object — matched against a fresh
   * `DocumentFile.cleanObject` read, never trusted on its own (precondition 2). */
  observedCleanObject: DocumentObjectReference;
  /** The run's one business correlationId, established once by the caller
   * (`extraction-starter-handler.ts`) — threaded into the Step Functions execution input, same
   * discipline as `StartExtractionRunInput.correlationId`. */
  correlationId: string;
}

export type StartExtractionRunForDocumentArchivePreconditionFailure =
  | "STARTER_DISABLED"
  | "FILE_NOT_FOUND"
  | "FILE_NOT_CLEAN"
  | "CLEAN_OBJECT_MISMATCH"
  | "NOT_PRINCIPAL"
  | "VERSION_NOT_FOUND"
  | "VERSION_NOT_ELIGIBLE"
  | "TENANT_NOT_ACTIVE";

export type StartExtractionRunForDocumentArchiveOutcome =
  | { outcome: "GATE_OPENED" }
  | { outcome: "ALREADY_OPENED" }
  | { outcome: "REFUSED"; reason: StartExtractionRunForDocumentArchivePreconditionFailure };

/** Precondition 4 — `DocumentVersion` must be in one of these states (design's exact wording:
 * "RECEIVED/UNDER_REVIEW/ACCEPTED"). Never SUPERSEDED/REJECTED/WITHDRAWN/DRAFT. */
const ELIGIBLE_VERSION_STATES: readonly DocumentVersionState[] = ["RECEIVED", "UNDER_REVIEW", "ACCEPTED"];

function sameCleanObject(a: DocumentObjectReference, b: DocumentObjectReference): boolean {
  return a.bucket === b.bucket && a.key === b.key && a.versionId === b.versionId;
}

/** Resolves `versionId`+`fileId` to the `seq` `DocumentFile`/`DocumentVersion`'s real DynamoDB
 * key is built from — an eventually-consistent `queryByPk` over the Document's own (small,
 * `MAX_FILES_PER_VERSION`-bounded) partition, same "no GSI needed, co-located items" posture
 * `document-archive-store.ts`'s own doc comment establishes for this partition. Only ever used
 * to find WHICH row to strongly-consistently re-read next (see this file's own doc comment) -
 * never to decide a precondition. */
async function resolveSeq(archive: DocumentArchiveStore, tenantId: string, documentId: string, versionId: string, fileId: string): Promise<number | undefined> {
  const items = await archive.queryByPk(`TENANT#${tenantId}#DOCUMENT#${documentId}`);
  const stub = items.find((item) => item["entityType"] === "DocumentFile" && item["fileId"] === fileId && item["versionId"] === versionId) as
    | (Record<string, unknown> & { seq?: number })
    | undefined;
  return stub?.seq;
}

export async function startExtractionRunForDocumentArchive(
  deps: StartExtractionRunForDocumentArchiveDeps,
  input: StartExtractionRunForDocumentArchiveInput,
): Promise<StartExtractionRunForDocumentArchiveOutcome> {
  // D-193 item 8/9 (STARTER gate) - checked FIRST, before any DynamoDB read: while OFF (the
  // default), this Starter must be completely inert for document-archive documents, never even
  // reading the tenant/file/version rows. Fail-closed on a flags-read error too, same posture
  // start-ocr.ts's OcrDisabledError already established for the sibling OLD-module trigger.
  let flags;
  try {
    flags = await deps.featureFlags.getFlags();
  } catch {
    return { outcome: "REFUSED", reason: "STARTER_DISABLED" };
  }
  if (!isDocumentArchiveExtractionTriggerEnabled(flags)) {
    return { outcome: "REFUSED", reason: "STARTER_DISABLED" };
  }

  // Precondition 5 (this file's own doc comment: the design's summary says "5", the design's
  // prose only names 4 — the 5th is this tenant-ACTIVE fresh check, same discipline every other
  // D-193 write path applies explicitly rather than inheriting).
  const tenant = await deps.archive.get<TenantLifecycleRecord>(tenantLifecycleKey(input.tenantId));
  if (!tenant || tenant.status !== "ACTIVE") return { outcome: "REFUSED", reason: "TENANT_NOT_ACTIVE" };

  const seq = await resolveSeq(deps.archive, input.tenantId, input.documentId, input.versionId, input.fileId);
  if (seq === undefined) return { outcome: "REFUSED", reason: "FILE_NOT_FOUND" };

  // Precondition 1: fresh, strongly consistent re-read of DocumentFile - never the event
  // payload, never a value read by an earlier step in this same invocation.
  const file = await deps.archive.get<DocumentFile>(documentFileKey(input.tenantId, input.documentId, seq, input.fileId));
  if (!file) return { outcome: "REFUSED", reason: "FILE_NOT_FOUND" };
  if (file.scanStatus !== "CLEAN") return { outcome: "REFUSED", reason: "FILE_NOT_CLEAN" };

  // Precondition 2: cleanObject bate exatamente.
  if (!file.cleanObject || !sameCleanObject(file.cleanObject, input.observedCleanObject)) {
    return { outcome: "REFUSED", reason: "CLEAN_OBJECT_MISMATCH" };
  }

  // Precondition 3: only the PRINCIPAL file of a DocumentFile set ever triggers OCR (design's
  // explicit, provisional, revisable product decision).
  if (file.role !== "PRINCIPAL") return { outcome: "REFUSED", reason: "NOT_PRINCIPAL" };

  // Precondition 4: DocumentVersion in an eligible state - fresh read, same discipline.
  const version = await deps.archive.get<DocumentVersion>(documentVersionKey(input.tenantId, input.documentId, seq));
  if (!version) return { outcome: "REFUSED", reason: "VERSION_NOT_FOUND" };
  if (!ELIGIBLE_VERSION_STATES.includes(version.state)) return { outcome: "REFUSED", reason: "VERSION_NOT_ELIGIBLE" };

  // All 5 preconditions passed - open the gate: create the idempotent ExtractionRun row,
  // keyed by {tenantId, documentId, versionId} (domain/extraction-run.ts's D-193 re-keying).
  const pipelineVersion = PIPELINE_VERSION_V1;
  const runId = deriveExtractionRunId(input.tenantId, input.documentId, version.versionId, pipelineVersion);
  const now = deps.now?.() ?? new Date().toISOString();

  const run: ExtractionRun = {
    ...extractionRunKey(input.tenantId, input.documentId, runId),
    entityType: "ExtractionRun",
    tenantId: input.tenantId,
    documentId: input.documentId,
    versionId: version.versionId,
    runId,
    pipelineVersion,
    status: "RUNNING",
    startedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  const created = await deps.runs.putIfAbsent(run);

  // startExecution is called EVERY time, whether the ExtractionRun row was just created or
  // already existed - same "never gate on `created`" discipline start-extraction-run.ts
  // documents (a transient failure here after a successful putIfAbsent must not orphan the run;
  // Step Functions' own execution-name uniqueness on `runId` is the real dedup mechanism).
  await deps.executions.startExecution({
    name: runId,
    input: {
      tenantId: input.tenantId,
      documentSource: "DOCUMENT_ARCHIVE",
      // No ExpirationItem/M6-Document concept exists on this path - opaque passthrough, see
      // ExtractionExecutionInput's own doc comment.
      itemId: input.documentId,
      documentId: input.documentId,
      documentVersion: seq,
      runId,
      pipelineVersion,
      correlationId: input.correlationId,
      cleanObject: input.observedCleanObject,
      // RunTextract's classifier (`document-classifier.ts`) needs SOME signal to pick a
      // Textract call - DocumentFile carries no `fileName` (real gap this slice found, not
      // invented away). Passing "" never fabricates an identity: `classifyByExtension("")`
      // yields no match by construction, so the classifier's own fallback chain lands on
      // `classifyByContentType(file.mediaType)`, which alone already covers all 4 formats
      // Textract supports (PDF/JPEG/PNG/TIFF) - the same set `mediaType` is validated against
      // at `reserveFiles()` time.
      fileName: "",
      contentType: file.mediaType,
    },
  });

  return created ? { outcome: "GATE_OPENED" } : { outcome: "ALREADY_OPENED" };
}
