/**
 * readExtractionDisclosure — D-349 (`docs/architecture/reviews/p0-screen-a12-ocr-drift-scoping/`,
 * 3-round Claude<->Codex protocol, Claude 9.1/Codex 9.1). The read contract that closes the
 * design's blocking requirement: neither A07 nor A12 had any HTTP route exposing an
 * `ExtractionRun`/`ExtractedField` for display. This is the shared read used by both — the
 * caller (an already-authorized `document:read`/`docarchive:read` handler) supplies the tenant,
 * documentId, and the version identity (`String(Document.version)` for A07's OLD module,
 * `DocumentVersion.versionId` for A12's document-archive) that `deriveExtractionRunId()` already
 * uses to compute the run deterministically — no query needed, no new index.
 *
 * Vínculo item/documento/execução (A07) e documento/versão-imutável/execução (A12), per the
 * converged design: the caller passes `versionId` freshly read from the SAME entity read that
 * already authorized this request, never a client-supplied value — the run this returns is
 * therefore provably the one belonging to the version the caller just read, by construction.
 *
 * A run that doesn't exist yet (extraction never started, or the pipeline is disabled) is a
 * normal, named outcome — `undefined` — never a fabricated empty-but-"pending" disclosure.
 */
import { authorize, authorizedTenantId } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { NotFoundError } from "../../../shared/errors/app-error.js";
import { deriveExtractionRunId, extractionRunKey, type ExtractionRun } from "../domain/extraction-run.js";
import { extractedFieldKey, type ExtractedField } from "../domain/extracted-field.js";
import { getFieldSchema, PIPELINE_VERSION_V1 } from "../domain/field-schema.js";
import type { ExtractionRunStore } from "../ports/extraction-run-store.js";
import type { ExtractedFieldStore } from "../ports/extracted-field-store.js";
import type { EntityReader } from "../ports/entity-reader.js";
import { documentKey, type Document } from "../../document/domain/document.js";
import { documentVersionKey, type DocumentVersion } from "../../document-archive/domain/document-version.js";

export interface ReadExtractionDisclosureDeps {
  runs: ExtractionRunStore;
  fields: ExtractedFieldStore;
}

export interface ExtractionDisclosure {
  runId: string;
  runStatus: ExtractionRun["status"];
  /** One entry per field the run's pipeline schema defines — a field the run hasn't produced a
   * row for yet (still `STARTED`, or genuinely no candidate) is simply absent from this array,
   * never a fabricated placeholder. */
  fields: ExtractedField[];
}

export async function readExtractionDisclosure(deps: ReadExtractionDisclosureDeps, tenantId: string, documentId: string, versionId: string): Promise<ExtractionDisclosure | undefined> {
  const runId = deriveExtractionRunId(tenantId, documentId, versionId, PIPELINE_VERSION_V1);
  const run = await deps.runs.get<ExtractionRun>(extractionRunKey(tenantId, documentId, runId));
  if (!run || run.tenantId !== tenantId) return undefined;

  const schema = getFieldSchema(run.pipelineVersion);
  const fields = await Promise.all(schema.map((def) => deps.fields.get(extractedFieldKey(tenantId, documentId, def.fieldName, runId))));

  return { runId, runStatus: run.status, fields: fields.filter((f): f is ExtractedField => f !== undefined) };
}

/** A07 (`document` module, OLD): `GET /items/{itemId}/documents/{documentId}/extractions`.
 * Authorizes `document:read` itself (same tier `DocumentService.getDocument` uses) and reads the
 * `Document` directly via `EntityReader` — same established pattern as `confirm-reject-field.ts`,
 * never the full `DocumentService` (this module reads the OTHER module's entities through this
 * narrow port precisely so it never depends on `document`'s own store/service types). */
export interface GetExtractionDisclosureForItemDeps extends ReadExtractionDisclosureDeps {
  documents: EntityReader;
}

export async function getExtractionDisclosureForItem(deps: GetExtractionDisclosureForItemDeps, ctx: RequestContext, itemId: string, documentId: string): Promise<ExtractionDisclosure | undefined> {
  authorize({ context: ctx, action: "document:read", resource: { tenantId: ctx.tenant.tenantId } });
  const tenantId = authorizedTenantId(ctx);

  const document = await deps.documents.get<Document>(documentKey(tenantId, itemId, documentId));
  if (!document || document.tenantId !== tenantId) throw new NotFoundError("Document not found.", { itemId, documentId });

  return readExtractionDisclosure(deps, tenantId, documentId, String(document.version));
}

/** A12 (`document-archive` module): `GET /document-archive/documents/{documentId}/versions/{seq}/extractions`.
 * Authorizes `docarchive:read` itself and reads the `DocumentVersion` directly via `EntityReader`
 * to resolve its immutable `versionId` — never trusts a client-supplied versionId, exactly the
 * "vínculo documento/versão-imutável/execução" the converged design requires. */
export interface GetExtractionDisclosureForDocumentArchiveDeps extends ReadExtractionDisclosureDeps {
  archive: EntityReader;
}

export async function getExtractionDisclosureForDocumentArchive(
  deps: GetExtractionDisclosureForDocumentArchiveDeps,
  ctx: RequestContext,
  documentId: string,
  seq: number,
): Promise<ExtractionDisclosure | undefined> {
  authorize({ context: ctx, action: "docarchive:read", resource: { tenantId: ctx.tenant.tenantId } });
  const tenantId = authorizedTenantId(ctx);

  const version = await deps.archive.get<DocumentVersion>(documentVersionKey(tenantId, documentId, seq));
  if (!version || version.tenantId !== tenantId) throw new NotFoundError("DocumentVersion not found.", { documentId, seq });

  return readExtractionDisclosure(deps, tenantId, documentId, version.versionId);
}
