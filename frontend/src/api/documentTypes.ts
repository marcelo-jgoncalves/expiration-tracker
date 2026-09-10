/**
 * A20 (Block 4, D-2xx) - `document-archive` module's `DocumentType` catalog
 * (`src/modules/document-archive/http/document-archive-handlers.ts`). Same one-layer
 * convention as `requirements.ts` - every call site goes through these functions, never
 * `apiClient` inline.
 */
import { apiClient } from "./apiClient.js";
import type {
  CreateDocumentTypeInput,
  CreateDocumentTypeMetadataFieldInput,
  DocumentType,
  DocumentTypeStatus,
  UpdateDocumentTypeMetadataFieldInput,
} from "./types.js";

/** `GET /document-archive/document-types?status=` - defaults ACTIVE server-side; the catalog
 * screen fetches both ACTIVE and DEPRECATED as two independent queries (same "Todos" merge
 * precedent as A11's `useRequirementsSearch`, never a client-side "ALL" mode the backend
 * doesn't offer). */
export function listDocumentTypes(status: DocumentTypeStatus, options?: { signal?: AbortSignal }): Promise<{ documentTypes: DocumentType[] }> {
  return apiClient.get<{ documentTypes: DocumentType[] }>(`/document-archive/document-types?status=${status}`, { signal: options?.signal });
}

export function fetchDocumentType(documentTypeId: string, options?: { signal?: AbortSignal }): Promise<{ documentType: DocumentType }> {
  return apiClient.get<{ documentType: DocumentType }>(`/document-archive/document-types/${encodeURIComponent(documentTypeId)}`, { signal: options?.signal });
}

export function createDocumentType(input: CreateDocumentTypeInput): Promise<{ documentType: DocumentType }> {
  return apiClient.post<{ documentType: DocumentType }>("/document-archive/document-types", input);
}

/** `expectedVersion` MUST travel in the JSON body here (`handleRenameDocumentType` reads
 * `req.body.expectedVersion`, not the `If-Match` header) - `document-archive-handlers.ts`
 * uses a different OCC convention than the legacy `subject` module (which DOES read
 * `If-Match`). `ApiClient`'s `expectedVersion` request option only sets the header, so it is
 * never used for any `document-archive` mutation in this module - deliberate, not an
 * oversight. */
export function renameDocumentType(documentTypeId: string, displayName: string, expectedVersion: number): Promise<{ documentType: DocumentType }> {
  return apiClient.request<{ documentType: DocumentType }>(`/document-archive/document-types/${encodeURIComponent(documentTypeId)}`, {
    method: "PATCH",
    body: { displayName, expectedVersion },
  });
}

export function deprecateDocumentType(documentTypeId: string, expectedVersion: number): Promise<{ documentType: DocumentType }> {
  return apiClient.post<{ documentType: DocumentType }>(`/document-archive/document-types/${encodeURIComponent(documentTypeId)}/deprecate`, { expectedVersion });
}

export function reactivateDocumentType(documentTypeId: string, expectedVersion: number): Promise<{ documentType: DocumentType }> {
  return apiClient.post<{ documentType: DocumentType }>(`/document-archive/document-types/${encodeURIComponent(documentTypeId)}/reactivate`, { expectedVersion });
}

/** `expectedDocumentTypeVersion` is folded into the body per the real backend contract
 * (`handleCreateDocumentTypeMetadataField`), not sent as the OCC-header `expectedVersion` -
 * the field-create/update routes fence the OWNING DocumentType's version, not a field's own
 * (a field has no independent version). */
export function createMetadataField(documentTypeId: string, expectedDocumentTypeVersion: number, input: CreateDocumentTypeMetadataFieldInput): Promise<{ documentType: DocumentType }> {
  return apiClient.post<{ documentType: DocumentType }>(`/document-archive/document-types/${encodeURIComponent(documentTypeId)}/metadata-fields`, {
    expectedDocumentTypeVersion,
    ...input,
  });
}

export function updateMetadataField(documentTypeId: string, fieldId: string, expectedDocumentTypeVersion: number, input: UpdateDocumentTypeMetadataFieldInput): Promise<{ documentType: DocumentType }> {
  return apiClient.request<{ documentType: DocumentType }>(`/document-archive/document-types/${encodeURIComponent(documentTypeId)}/metadata-fields/${encodeURIComponent(fieldId)}`, {
    method: "PATCH",
    body: { expectedDocumentTypeVersion, ...input },
  });
}
