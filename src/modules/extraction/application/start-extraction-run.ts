/**
 * ExtractionStarterWorker's pure orchestration (`implementation-blueprint.md` §12.5,
 * `claude-reconciliation-final-design.md` §1.1/§2 "LoadMetadata"). Triggered by the S3
 * "Object Created" event on the clean bucket; creates the idempotent `ExtractionRun` and, only
 * on the FIRST successful creation, starts the Step Functions Standard execution.
 */
import { documentKey, type Document } from "../../document/domain/document.js";
import { extractionRunKey, deriveExtractionRunId, type ExtractionRun } from "../domain/extraction-run.js";
import { PIPELINE_VERSION_V1 } from "../domain/field-schema.js";
import type { DocumentReader } from "../ports/document-reader.js";
import type { ExtractionRunStore } from "../ports/extraction-run-store.js";
import type { ExtractionExecutionStarter } from "../ports/extraction-execution-starter.js";

export interface StartExtractionRunDeps {
  documents: DocumentReader;
  runs: ExtractionRunStore;
  executions: ExtractionExecutionStarter;
  now?: () => string;
}

export interface StartExtractionRunInput {
  tenantId: string;
  itemId: string;
  documentId: string;
  /** The business correlationId established by the caller (extraction-starter-handler.ts) —
   * threaded into the Step Functions execution input so every downstream task handler can
   * join its logs back to this same run. See ExtractionExecutionInput's doc comment. */
  correlationId: string;
  cleanObject: { bucket: string; key: string; versionId: string };
}

export type StartExtractionRunOutcome = "STARTED" | "ALREADY_RUNNING" | "DOCUMENT_NOT_FOUND";

/** The clean-bucket promotion copy and the Document's own `status: "CLEAN"` transition are two
 * separate writes (advanceAfterEvidence() copies the object BEFORE the transactional status
 * update) - a real, expected race where the S3 event can arrive before the Document read below
 * observes CLEAN yet. Distinct from DOCUMENT_NOT_FOUND (never retryable - the document genuinely
 * doesn't exist), this IS retryable: thrown, not returned, so the runtime handler's normal SQS
 * batch-item-failure path redelivers it instead of silently dropping a real, in-flight upload. */
export class DocumentNotCleanYetError extends Error {
  constructor(documentId: string, status: string) {
    super(`Document ${documentId} is not CLEAN yet (status=${status}) - retrying.`);
    this.name = "DocumentNotCleanYetError";
  }
}

export async function startExtractionRun(deps: StartExtractionRunDeps, input: StartExtractionRunInput): Promise<StartExtractionRunOutcome> {
  const doc = await deps.documents.get<Document>(documentKey(input.tenantId, input.itemId, input.documentId), true);
  if (!doc) return "DOCUMENT_NOT_FOUND";
  if (doc.status !== "CLEAN") throw new DocumentNotCleanYetError(input.documentId, doc.status);

  const documentVersion = doc.version;
  // D-193 item 3: ExtractionRun's own identity field is now `versionId` (string), never a raw
  // `documentVersion` number - this OLD `document`-module trigger (kept intact, out of scope
  // for D-193) adapts by stringifying its own numeric version. `itemId` stays a local
  // application parameter only (needed below to build ExtractionExecutionInput), never stored
  // on the ExtractionRun entity itself any more.
  const versionId = String(documentVersion);
  const pipelineVersion = PIPELINE_VERSION_V1;
  const runId = deriveExtractionRunId(input.tenantId, input.documentId, versionId, pipelineVersion);
  const now = deps.now?.() ?? new Date().toISOString();

  const run: ExtractionRun = {
    ...extractionRunKey(input.tenantId, input.documentId, runId),
    entityType: "ExtractionRun",
    tenantId: input.tenantId,
    documentId: input.documentId,
    versionId,
    runId,
    pipelineVersion,
    status: "RUNNING",
    startedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  const created = await deps.runs.putIfAbsent(run);

  // startExecution is called EVERY time, whether the DynamoDB record was just created or
  // already existed - deliberately not gated on `created`. Gating it would orphan a run
  // whenever putIfAbsent succeeds but the subsequent startExecution call fails transiently
  // (network blip, throttling): the record would sit in RUNNING forever with no real Step
  // Functions execution behind it, and a retry would find the record already there and skip
  // starting one. Instead, the real dedup mechanism is Step Functions' own execution-name
  // uniqueness (`runId` as `name`, see ExtractionExecutionStarter's doc comment) - calling
  // StartExecution again with the same name and the same input is itself idempotent at the
  // AWS API level, so this stays safe to call unconditionally on every retry.
  await deps.executions.startExecution({
    name: runId,
    input: {
      tenantId: input.tenantId,
      itemId: input.itemId,
      documentId: input.documentId,
      documentVersion,
      runId,
      pipelineVersion,
      correlationId: input.correlationId,
      cleanObject: input.cleanObject,
      // RunTextract's classifier needs these (see ExtractionExecutionInput's doc comment) -
      // `doc` was already fetched above, no extra read.
      fileName: doc.fileName,
      contentType: doc.mediaType,
    },
  });

  return created ? "STARTED" : "ALREADY_RUNNING";
}
