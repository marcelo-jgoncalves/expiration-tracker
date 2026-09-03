import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore } from "../document-archive/in-memory-store.js";
import { resolveDocumentTypeReferences } from "../../../src/modules/import/application/resolve-document-type-references.js";
import { documentTypeGsi1Keys, documentTypeKey, documentTypeNamePointerKey, type DocumentType, type DocumentTypeNamePointer, type DocumentTypeStatus } from "../../../src/modules/document-archive/domain/document-type.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

type SeedItem = Record<string, unknown> & EntityKey;

const TENANT = "tenant-1";
const NOW = "2026-09-03T00:00:00.000Z";

function seedDocumentType(id: string, normalizedName: string, status: DocumentTypeStatus = "ACTIVE") {
  const documentType: DocumentType = {
    ...documentTypeKey(TENANT, id),
    entityType: "DocumentType",
    documentTypeId: id,
    tenantId: TENANT,
    displayName: normalizedName,
    status,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...documentTypeGsi1Keys(TENANT, status, normalizedName, id),
  };
  const pointer: DocumentTypeNamePointer = {
    ...documentTypeNamePointerKey(TENANT, normalizedName),
    entityType: "DocumentTypeNamePointer",
    tenantId: TENANT,
    normalizedName,
    documentTypeId: id,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
  return { documentType: documentType as unknown as SeedItem, pointer: pointer as unknown as SeedItem };
}

describe("resolveDocumentTypeReferences (D-192 §4, batched two-phase resolution, fatia 6)", () => {
  it("resolves a duplicate DISPLAY_NAME reference ONCE across the batch, never double-fetched", async () => {
    const { documentType, pointer } = seedDocumentType("dt1", "alvara");
    const store = new InMemoryDocumentArchiveStore([pointer, documentType]);

    const result = await resolveDocumentTypeReferences(store, TENANT, "DISPLAY_NAME", ["alvara", "alvara", "alvara"]);

    expect(result.get("alvara")).toEqual({ kind: "RESOLVED", documentTypeId: "dt1" });
    // Phase 1 batchGet call: exactly 1 distinct key requested (deduped before the call, not
    // after). Phase 2 batchGet call: exactly 1 distinct documentTypeId. Total keys: 2.
    expect(store.batchGetCallCount).toBe(2);
    expect(store.batchGetKeyCount).toBe(2);
  });

  it("rejects a reference to a nonexistent DocumentType as NOT_FOUND, never a crash", async () => {
    const store = new InMemoryDocumentArchiveStore([]);

    const result = await resolveDocumentTypeReferences(store, TENANT, "DISPLAY_NAME", ["ghost"]);

    expect(result.get("ghost")).toEqual({ kind: "NOT_FOUND" });
  });

  it("rejects a reference to a DEPRECATED DocumentType as NOT_FOUND (mirrors createDocument's DocumentType fence, status=ACTIVE only)", async () => {
    const { documentType, pointer } = seedDocumentType("dt2", "contrato", "DEPRECATED");
    const store = new InMemoryDocumentArchiveStore([pointer, documentType]);

    const result = await resolveDocumentTypeReferences(store, TENANT, "DISPLAY_NAME", ["contrato"]);

    expect(result.get("contrato")).toEqual({ kind: "NOT_FOUND" });
  });

  it("resolves DOCUMENT_TYPE_ID-kind references directly against DocumentType, skipping the pointer phase entirely", async () => {
    const { documentType } = seedDocumentType("dt3", "certidao");
    const store = new InMemoryDocumentArchiveStore([documentType]);

    const result = await resolveDocumentTypeReferences(store, TENANT, "DOCUMENT_TYPE_ID", ["dt3"]);

    expect(result.get("dt3")).toEqual({ kind: "RESOLVED", documentTypeId: "dt3" });
    // Only phase 2 runs for DOCUMENT_TYPE_ID-kind references - no pointer lookup at all.
    expect(store.batchGetCallCount).toBe(1);
  });

  it("returns an empty map for an empty batch without calling batchGet", async () => {
    const store = new InMemoryDocumentArchiveStore([]);

    const result = await resolveDocumentTypeReferences(store, TENANT, "DISPLAY_NAME", []);

    expect(result.size).toBe(0);
    expect(store.batchGetCallCount).toBe(0);
  });

  it("resolves a mixed batch (some found, some not) independently per reference", async () => {
    const { documentType, pointer } = seedDocumentType("dt4", "licenca");
    const store = new InMemoryDocumentArchiveStore([pointer, documentType]);

    const result = await resolveDocumentTypeReferences(store, TENANT, "DISPLAY_NAME", ["licenca", "missing-name"]);

    expect(result.get("licenca")).toEqual({ kind: "RESOLVED", documentTypeId: "dt4" });
    expect(result.get("missing-name")).toEqual({ kind: "NOT_FOUND" });
  });

  it("dedupes distinct DISPLAY_NAME references that resolve to the SAME documentTypeId in phase 2", async () => {
    // Two normalized names both pointing at the same DocumentType (a rename race in principle) -
    // phase 2 must dedupe the resolved ids again, not fetch the same DocumentType twice.
    const { documentType, pointer: pointerA } = seedDocumentType("dt5", "old-name");
    const pointerB: DocumentTypeNamePointer = {
      ...documentTypeNamePointerKey(TENANT, "new-name"),
      entityType: "DocumentTypeNamePointer",
      tenantId: TENANT,
      normalizedName: "new-name",
      documentTypeId: "dt5",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    };
    const store = new InMemoryDocumentArchiveStore([pointerA, pointerB as unknown as SeedItem, documentType]);

    const result = await resolveDocumentTypeReferences(store, TENANT, "DISPLAY_NAME", ["old-name", "new-name"]);

    expect(result.get("old-name")).toEqual({ kind: "RESOLVED", documentTypeId: "dt5" });
    expect(result.get("new-name")).toEqual({ kind: "RESOLVED", documentTypeId: "dt5" });
    // Phase 1: 2 distinct names. Phase 2: deduped to 1 distinct documentTypeId.
    expect(store.batchGetKeyCount).toBe(3);
  });
});
