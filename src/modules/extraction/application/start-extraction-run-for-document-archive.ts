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
 * KNOWN, DOCUMENTED GAP (real engineering finding, not anticipated by the design text):
 * actually calling `ExtractionExecutionStarter.startExecution()` here would feed the M7 Step
 * Functions pipeline an `ExtractionExecutionInput` this pipeline's OWN downstream stage
 * (`run-extraction-validation.ts`'s `commitOrDiscard`) cannot yet honor correctly - it reads a
 * `document`-module `Document` by `documentKey(tenantId, itemId, documentId)` to guard
 * PERSIST_EXTRACTED_FIELDS/MARK_PENDING_CONFIRMATION, a row that does not exist for a
 * `document-archive`-only document. `DocumentFile` also carries no `fileName` today (RunTextract's
 * classifier requires one). Rather than start a real Step Functions execution that would
 * silently resolve to DISCARDED for every document-archive document (or worse, misapply state
 * if that guard is ever loosened), this Starter's job in THIS slice stops at gate-and-record:
 * it creates the idempotent `ExtractionRun` row (the authoritative record that extraction
 * SHOULD proceed for this version) but leaves the actual `StartExecution` call for the slice
 * that teaches the validation stage to understand `document-archive` documents (named
 * explicitly as follow-up work in `NEXT_SESSION_PROMPT.md`).
 */
import { documentFileKey, type DocumentFile } from "../../document-archive/domain/document-file.js";
import { documentVersionKey, type DocumentVersion, type DocumentVersionState } from "../../document-archive/domain/document-version.js";
import type { DocumentArchiveStore } from "../../document-archive/ports/document-archive-store.js";
import type { DocumentObjectReference } from "../../document/domain/document-object-reference.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { extractionRunKey, deriveExtractionRunId, type ExtractionRun } from "../domain/extraction-run.js";
import { PIPELINE_VERSION_V1 } from "../domain/field-schema.js";
import type { ExtractionRunStore } from "../ports/extraction-run-store.js";

export interface StartExtractionRunForDocumentArchiveDeps {
  archive: DocumentArchiveStore;
  runs: ExtractionRunStore;
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
}

export type StartExtractionRunForDocumentArchivePreconditionFailure =
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
  // Deliberately does NOT call ExtractionExecutionStarter.startExecution() yet - see this
  // file's own doc comment ("KNOWN, DOCUMENTED GAP").
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
  return created ? { outcome: "GATE_OPENED" } : { outcome: "ALREADY_OPENED" };
}
