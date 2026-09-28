/**
 * D-349 (`docs/architecture/reviews/p0-screen-a12-ocr-drift-scoping/`): the read contract closing
 * the design's blocking requirement — neither A07 nor A12 had any HTTP-reachable way to read an
 * `ExtractionRun`/`ExtractedField`. Verifies the deterministic runId derivation (no query needed),
 * the "vínculo" guarantee (versionId comes from a fresh entity read, never a client value), and
 * that a run that doesn't exist yet is a normal `undefined`, never a fabricated disclosure.
 */
import { describe, expect, it } from "vitest";
import {
  readExtractionDisclosure,
  getExtractionDisclosureForItem,
  getExtractionDisclosureForDocumentArchive,
} from "../../../src/modules/extraction/application/read-extraction-disclosure.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";
import { documentKey } from "../../../src/modules/document/domain/document.js";
import { documentVersionKey } from "../../../src/modules/document-archive/domain/document-version.js";
import { deriveExtractionRunId, extractionRunKey, type ExtractionRun } from "../../../src/modules/extraction/domain/extraction-run.js";
import { extractedFieldKey, type ExtractedField } from "../../../src/modules/extraction/domain/extracted-field.js";
import { PIPELINE_VERSION_V1 } from "../../../src/modules/extraction/domain/field-schema.js";
import type { EntityReader } from "../../../src/modules/extraction/ports/entity-reader.js";
import type { ExtractionRunStore } from "../../../src/modules/extraction/ports/extraction-run-store.js";
import type { ExtractedFieldStore } from "../../../src/modules/extraction/ports/extracted-field-store.js";
import { NotFoundError } from "../../../src/shared/errors/app-error.js";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";

const T1 = authorizedTenantIdFromPersistedEntity({ tenantId: "t1" });

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "t1", roles: ["MEMBER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

class InMemoryTable {
  private readonly rows = new Map<string, Record<string, unknown> & EntityKey>();
  seed(item: Record<string, unknown> & EntityKey): void {
    this.rows.set(`${item["PK"]}#${item["SK"]}`, { ...item });
  }
  read<T extends EntityKey>(key: EntityKey): T | undefined {
    const row = this.rows.get(`${key.PK}#${key.SK}`);
    return row ? ({ ...row } as unknown as T) : undefined;
  }
}

class FakeReader implements EntityReader {
  constructor(private readonly table: InMemoryTable) {}
  async get<T extends EntityKey>(key: EntityKey): Promise<T | undefined> {
    return this.table.read<T>(key);
  }
}

class FakeExtractionRunStore implements ExtractionRunStore {
  constructor(private readonly table: InMemoryTable) {}
  async get<T extends EntityKey>(key: EntityKey): Promise<T | undefined> {
    return this.table.read<T>(key);
  }
  async putIfAbsent(): Promise<boolean> {
    throw new Error("not used");
  }
  async updateStatus(): Promise<boolean> {
    throw new Error("not used");
  }
}

class FakeExtractedFieldStore implements ExtractedFieldStore {
  constructor(private readonly table: InMemoryTable) {}
  async get(key: EntityKey): Promise<ExtractedField | undefined> {
    return this.table.read<ExtractedField>(key);
  }
  async commitRunOutcome(): Promise<"COMMITTED" | "DOCUMENT_DISCARDED"> {
    throw new Error("not used");
  }
  async confirmField(): Promise<"COMMITTED" | "VERSION_CONFLICT"> {
    throw new Error("not used");
  }
  async rejectField(): Promise<"COMMITTED" | "VERSION_CONFLICT"> {
    throw new Error("not used");
  }
  async confirmFieldForDocumentArchive(): Promise<"COMMITTED" | "VERSION_CONFLICT" | "RUN_VERSION_MISMATCH"> {
    throw new Error("not used");
  }
  async rejectFieldForDocumentArchive(): Promise<"COMMITTED" | "VERSION_CONFLICT"> {
    throw new Error("not used");
  }
}

function seedRunAndField(table: InMemoryTable, documentId: string, versionId: string, fieldState: ExtractedField["state"] = "CONFIRMED"): { runId: string } {
  const runId = deriveExtractionRunId(T1, documentId, versionId, PIPELINE_VERSION_V1);
  table.seed({
    ...extractionRunKey(T1, documentId, runId),
    entityType: "ExtractionRun",
    tenantId: T1,
    documentId,
    versionId,
    runId,
    pipelineVersion: PIPELINE_VERSION_V1,
    status: "COMPLETED",
    startedAt: "2026-09-28T00:00:00.000Z",
    version: 1,
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
  } satisfies ExtractionRun);
  table.seed({
    ...extractedFieldKey(T1, documentId, "expirationDate", runId),
    entityType: "ExtractedField",
    tenantId: T1,
    documentId,
    runId,
    fieldName: "expirationDate",
    valueType: "DATE",
    candidateValue: "2027-03-31",
    confidence: 0.95,
    sources: ["DETERMINISTIC_PARSER"],
    agreement: "SINGLE_SOURCE",
    state: fieldState,
    documentVersion: 1,
    pipelineVersion: PIPELINE_VERSION_V1,
    version: 1,
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
  } satisfies ExtractedField);
  return { runId };
}

describe("readExtractionDisclosure (core)", () => {
  it("returns undefined when no run has ever been created for this version - never a fabricated disclosure", async () => {
    const table = new InMemoryTable();
    const runs = new FakeExtractionRunStore(table);
    const fields = new FakeExtractedFieldStore(table);

    const result = await readExtractionDisclosure({ runs, fields }, T1, "doc1", "1");
    expect(result).toBeUndefined();
  });

  it("returns the run status and every field the schema produced a row for", async () => {
    const table = new InMemoryTable();
    const { runId } = seedRunAndField(table, "doc1", "1");
    const runs = new FakeExtractionRunStore(table);
    const fields = new FakeExtractedFieldStore(table);

    const result = await readExtractionDisclosure({ runs, fields }, T1, "doc1", "1");
    expect(result?.runId).toBe(runId);
    expect(result?.runStatus).toBe("COMPLETED");
    expect(result?.fields).toHaveLength(1);
    expect(result?.fields[0]).toMatchObject({ fieldName: "expirationDate", state: "CONFIRMED" });
  });

  it("never leaks a run/field belonging to a different tenant, even with a colliding key shape", async () => {
    const table = new InMemoryTable();
    seedRunAndField(table, "doc1", "1"); // seeded as T1
    const runs = new FakeExtractionRunStore(table);
    const fields = new FakeExtractedFieldStore(table);

    const result = await readExtractionDisclosure({ runs, fields }, "t2", "doc1", "1");
    expect(result).toBeUndefined();
  });
});

describe("getExtractionDisclosureForItem (A07)", () => {
  it("404s when the Document does not exist", async () => {
    const table = new InMemoryTable();
    const deps = { documents: new FakeReader(table), runs: new FakeExtractionRunStore(table), fields: new FakeExtractedFieldStore(table) };

    await expect(getExtractionDisclosureForItem(deps, ctx(), "item1", "doc1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("derives the run from String(Document.version) - never a client-supplied versionId", async () => {
    const table = new InMemoryTable();
    table.seed({ ...documentKey(T1, "item1", "doc1"), entityType: "Document", tenantId: T1, itemId: "item1", documentId: "doc1", version: 3 } as unknown as Record<string, unknown> & EntityKey);
    seedRunAndField(table, "doc1", "3"); // versionId = String(document.version)
    const deps = { documents: new FakeReader(table), runs: new FakeExtractionRunStore(table), fields: new FakeExtractedFieldStore(table) };

    const result = await getExtractionDisclosureForItem(deps, ctx(), "item1", "doc1");
    expect(result?.fields).toHaveLength(1);
  });
});

describe("getExtractionDisclosureForDocumentArchive (A12)", () => {
  it("404s when the DocumentVersion does not exist", async () => {
    const table = new InMemoryTable();
    const deps = { archive: new FakeReader(table), runs: new FakeExtractionRunStore(table), fields: new FakeExtractedFieldStore(table) };

    await expect(getExtractionDisclosureForDocumentArchive(deps, ctx(), "doc1", 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("derives the run from DocumentVersion.versionId (its immutable identity), never from seq directly", async () => {
    const table = new InMemoryTable();
    table.seed({ ...documentVersionKey(T1, "doc1", 2), entityType: "DocumentVersion", tenantId: T1, documentId: "doc1", seq: 2, versionId: "immutable-version-id-xyz", version: 1 } as unknown as Record<string, unknown> & EntityKey);
    seedRunAndField(table, "doc1", "immutable-version-id-xyz");
    const deps = { archive: new FakeReader(table), runs: new FakeExtractionRunStore(table), fields: new FakeExtractedFieldStore(table) };

    const result = await getExtractionDisclosureForDocumentArchive(deps, ctx(), "doc1", 2);
    expect(result?.fields).toHaveLength(1);
  });

  it("returns undefined (not a 404) when the DocumentVersion exists but extraction never started", async () => {
    const table = new InMemoryTable();
    table.seed({ ...documentVersionKey(T1, "doc1", 1), entityType: "DocumentVersion", tenantId: T1, documentId: "doc1", seq: 1, versionId: "v-no-run-yet", version: 1 } as unknown as Record<string, unknown> & EntityKey);
    const deps = { archive: new FakeReader(table), runs: new FakeExtractionRunStore(table), fields: new FakeExtractedFieldStore(table) };

    const result = await getExtractionDisclosureForDocumentArchive(deps, ctx(), "doc1", 1);
    expect(result).toBeUndefined();
  });
});
