import { describe, expect, it, beforeEach } from "vitest";
import { confirmField, rejectField, type ConfirmRejectFieldDeps } from "../../../src/modules/extraction/application/confirm-reject-field.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";
import { documentKey, type Document } from "../../../src/modules/document/domain/document.js";
import { itemKey, type ExpirationItem } from "../../../src/modules/expiration/domain/expiration-item.js";
import { extractionRunKey, type ExtractionRun } from "../../../src/modules/extraction/domain/extraction-run.js";
import { extractedFieldKey, type ExtractedField } from "../../../src/modules/extraction/domain/extracted-field.js";
import { PIPELINE_VERSION_V1 } from "../../../src/modules/extraction/domain/field-schema.js";
import type { EntityReader } from "../../../src/modules/extraction/ports/entity-reader.js";
import type { ExtractionRunStore } from "../../../src/modules/extraction/ports/extraction-run-store.js";
import type { ConfirmFieldInput, ExtractedFieldStore, RejectFieldInput } from "../../../src/modules/extraction/ports/extracted-field-store.js";
import { IdempotencyStore, type DynamoLike } from "../../../src/shared/idempotency/idempotency.js";
import { BusinessRuleError, ConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "t1", roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

/** In-memory single-table double, backing every port confirm-reject-field.ts needs (reads,
 * ExtractedFieldStore's transactional confirm/reject, and IdempotencyStore's DynamoLike) — same
 * hand-written-fake convention as InMemoryExpirationStore, no vi.mock anywhere. */
class InMemoryTable {
  private readonly rows = new Map<string, Record<string, unknown> & EntityKey>();

  seed(item: Record<string, unknown> & EntityKey): void {
    this.rows.set(`${item["PK"]}#${item["SK"]}`, { ...item });
  }

  read<T extends EntityKey>(key: EntityKey): T | undefined {
    const row = this.rows.get(`${key.PK}#${key.SK}`);
    return row ? ({ ...row } as unknown as T) : undefined;
  }

  write(key: EntityKey, set: Record<string, unknown>, expectedVersion: number): boolean {
    const row = this.rows.get(`${key.PK}#${key.SK}`);
    if (!row || (row["version"] as number) !== expectedVersion) return false;
    this.rows.set(`${key.PK}#${key.SK}`, { ...row, ...set, version: expectedVersion + 1 });
    return true;
  }

  assertVersion(key: EntityKey, expectedVersion: number): boolean {
    const row = this.rows.get(`${key.PK}#${key.SK}`);
    return !!row && (row["version"] as number) === expectedVersion;
  }

  putIfAbsent(item: Record<string, unknown> & EntityKey): boolean {
    if (this.rows.has(`${item["PK"]}#${item["SK"]}`)) return false;
    this.rows.set(`${item["PK"]}#${item["SK"]}`, { ...item });
    return true;
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
  async confirmField(input: ConfirmFieldInput): Promise<"COMMITTED" | "VERSION_CONFLICT"> {
    if (!this.table.assertVersion(input.runKey, input.runExpectedVersion)) return "VERSION_CONFLICT";
    if (!this.table.assertVersion(input.documentKey, input.documentExpectedVersion)) return "VERSION_CONFLICT";
    if (input.itemUpdate) {
      if (!this.table.write(input.itemKey, input.itemUpdate, input.itemExpectedVersion)) return "VERSION_CONFLICT";
    } else if (!this.table.assertVersion(input.itemKey, input.itemExpectedVersion)) {
      return "VERSION_CONFLICT";
    }
    const ok = this.table.write(input.fieldKey, { state: "CONFIRMED", confirmedValue: input.confirmedValue, updatedAt: input.now }, input.fieldExpectedVersion);
    return ok ? "COMMITTED" : "VERSION_CONFLICT";
  }
  async rejectField(input: RejectFieldInput): Promise<"COMMITTED" | "VERSION_CONFLICT"> {
    if (!this.table.assertVersion(input.runKey, input.runExpectedVersion)) return "VERSION_CONFLICT";
    if (!this.table.assertVersion(input.documentKey, input.documentExpectedVersion)) return "VERSION_CONFLICT";
    const set: Record<string, unknown> = { state: "REJECTED", updatedAt: input.now };
    if (input.correctionReason !== undefined) set["correctionReason"] = input.correctionReason;
    const ok = this.table.write(input.fieldKey, set, input.fieldExpectedVersion);
    return ok ? "COMMITTED" : "VERSION_CONFLICT";
  }
}

function makeDeps(table: InMemoryTable): ConfirmRejectFieldDeps {
  // IdempotencyStore's own bookkeeping records are a separate concern from the entities
  // confirm/reject read/write (InMemoryTable's write() is OCC-conditional, but idempotency
  // records need unconditional overwrite - the exact same distinction ExpirationService's own
  // DynamoLike adapter draws around its store, expiration-service.ts) - a tiny dedicated map.
  const idemStore = new Map<string, Parameters<DynamoLike["update"]>[0]>();
  const adapter: DynamoLike = {
    putIfAbsent: async (item) => {
      const k = `${item.PK}#${item.SK}`;
      if (idemStore.has(k)) return "ALREADY_EXISTS";
      idemStore.set(k, item);
      return "PUT";
    },
    get: async (key) => idemStore.get(`${key.PK}#${key.SK}`),
    update: async (item) => {
      idemStore.set(`${item.PK}#${item.SK}`, item);
    },
    transitionIfStatus: async (item, expectedStatus) => {
      const k = `${item.PK}#${item.SK}`;
      const existing = idemStore.get(k);
      if (!existing || existing.status !== expectedStatus) return false;
      idemStore.set(k, item);
      return true;
    },
  };

  const idempotency = new IdempotencyStore(adapter, "MainTable", () => "2026-08-26T12:00:00.000Z");

  return {
    documents: new FakeReader(table),
    items: new FakeReader(table),
    runs: new FakeExtractionRunStore(table),
    fields: new FakeExtractedFieldStore(table),
    idempotency,
    now: () => "2026-08-26T12:00:00.000Z",
  };
}

function seedFixture(table: InMemoryTable) {
  const item: ExpirationItem = {
    ...itemKey("t1", "item1"),
    entityType: "ExpirationItem",
    itemId: "item1",
    tenantId: "t1",
    name: "Alvará",
    category: "Licenças",
    categoryNormalized: "licencas",
    dueDate: "2026-01-01T00:00:00.000Z",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 5,
    GSI1PK: "TENANT#t1#ITEMSTATUS#ACTIVE",
    GSI1SK: "DUE#2026-01-01T00:00:00.000Z#ITEM#item1",
  };
  const document: Document = {
    ...documentKey("t1", "item1", "doc1"),
    entityType: "Document",
    tenantId: "t1",
    itemId: "item1",
    documentId: "doc1",
    uploadSlotId: "slot1",
    fileName: "f.pdf",
    mediaType: "application/pdf",
    contentLength: 10,
    checksumSha256: "abc",
    status: "CLEAN",
    quarantineObject: { bucket: "q", key: "k", versionId: "v1" },
    retentionClass: "USER_DOCUMENT",
    version: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const run: ExtractionRun = {
    ...extractionRunKey("t1", "doc1", "run1"),
    entityType: "ExtractionRun",
    tenantId: "t1",
    itemId: "item1",
    documentId: "doc1",
    documentVersion: 3,
    runId: "run1",
    pipelineVersion: PIPELINE_VERSION_V1,
    status: "COMPLETED",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:05:00.000Z",
    version: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:05:00.000Z",
  };
  const field: ExtractedField = {
    ...extractedFieldKey("t1", "doc1", "expirationDate", "run1"),
    entityType: "ExtractedField",
    tenantId: "t1",
    documentId: "doc1",
    runId: "run1",
    fieldName: "expirationDate",
    valueType: "DATE",
    candidateValue: "2027-02-28",
    confidence: 0.5,
    sources: ["DETERMINISTIC_PARSER"],
    agreement: "SINGLE_SOURCE",
    state: "PENDING_CONFIRMATION",
    documentVersion: 3,
    pipelineVersion: PIPELINE_VERSION_V1,
    version: 1,
    createdAt: "2026-01-01T00:05:00.000Z",
    updatedAt: "2026-01-01T00:05:00.000Z",
  };

  table.seed(item as unknown as Record<string, unknown> & EntityKey);
  table.seed(document as unknown as Record<string, unknown> & EntityKey);
  table.seed(run as unknown as Record<string, unknown> & EntityKey);
  table.seed(field as unknown as Record<string, unknown> & EntityKey);

  return { item, document, run, field };
}

const CONFIRM_PARAMS = {
  itemId: "item1",
  documentId: "doc1",
  runId: "run1",
  fieldName: "expirationDate",
  expectedItemVersion: 5,
  expectedDocumentVersion: 3,
  expectedRunVersion: 2,
  expectedFieldVersion: 1,
  confirmedValue: "2027-03-31",
  idempotencyKey: "idem-confirm-1",
};

const REJECT_PARAMS = {
  itemId: "item1",
  documentId: "doc1",
  runId: "run1",
  fieldName: "expirationDate",
  expectedDocumentVersion: 3,
  expectedRunVersion: 2,
  expectedFieldVersion: 1,
  correctionReason: "Wrong date read.",
  idempotencyKey: "idem-reject-1",
};

describe("confirmField / rejectField (M7 item 8, §1.7)", () => {
  let table: InMemoryTable;
  let deps: ConfirmRejectFieldDeps;

  beforeEach(() => {
    table = new InMemoryTable();
    seedFixture(table);
    deps = makeDeps(table);
  });

  it("confirm happy path: ExtractedField -> CONFIRMED and ExpirationItem.dueDate updated, both version-bumped", async () => {
    const field = await confirmField(deps, ctx(), CONFIRM_PARAMS);
    expect(field.state).toBe("CONFIRMED");
    expect(field.confirmedValue).toBe("2027-03-31");
    expect(field.version).toBe(2);

    const item = table.read<ExpirationItem>(itemKey("t1", "item1"));
    expect(item?.dueDate).toBe("2027-03-31");
    expect(item?.version).toBe(6);
  });

  it("reject happy path: ExtractedField -> REJECTED with correctionReason, ExpirationItem untouched", async () => {
    const field = await rejectField(deps, ctx(), REJECT_PARAMS);
    expect(field.state).toBe("REJECTED");
    expect(field.correctionReason).toBe("Wrong date read.");

    const item = table.read<ExpirationItem>(itemKey("t1", "item1"));
    expect(item?.version).toBe(5); // unchanged
    expect(item?.dueDate).toBe("2026-01-01T00:00:00.000Z"); // unchanged
  });

  it("confirm is idempotent: replaying the same Idempotency-Key returns the same committed result without re-executing", async () => {
    const first = await confirmField(deps, ctx(), CONFIRM_PARAMS);
    const second = await confirmField(deps, ctx(), CONFIRM_PARAMS);
    expect(second).toEqual(first);
    const item = table.read<ExpirationItem>(itemKey("t1", "item1"));
    expect(item?.version).toBe(6); // only bumped once, not twice
  });

  it("reject is idempotent: replaying the same Idempotency-Key returns the same committed result", async () => {
    const first = await rejectField(deps, ctx(), REJECT_PARAMS);
    const second = await rejectField(deps, ctx(), REJECT_PARAMS);
    expect(second).toEqual(first);
  });

  it("confirm 409s on a stale expectedFieldVersion", async () => {
    await expect(confirmField(deps, ctx(), { ...CONFIRM_PARAMS, expectedFieldVersion: 99, idempotencyKey: "k-field" })).rejects.toThrow(ConflictError);
  });

  it("confirm 409s on a stale expectedRunVersion", async () => {
    await expect(confirmField(deps, ctx(), { ...CONFIRM_PARAMS, expectedRunVersion: 99, idempotencyKey: "k-run" })).rejects.toThrow(ConflictError);
  });

  it("confirm 409s on a stale expectedDocumentVersion", async () => {
    await expect(confirmField(deps, ctx(), { ...CONFIRM_PARAMS, expectedDocumentVersion: 99, idempotencyKey: "k-doc" })).rejects.toThrow(ConflictError);
  });

  it("confirm 409s on a stale expectedItemVersion", async () => {
    await expect(confirmField(deps, ctx(), { ...CONFIRM_PARAMS, expectedItemVersion: 99, idempotencyKey: "k-item" })).rejects.toThrow(ConflictError);
  });

  it("reject 409s on a stale expectedFieldVersion", async () => {
    await expect(rejectField(deps, ctx(), { ...REJECT_PARAMS, expectedFieldVersion: 99, idempotencyKey: "k-rf" })).rejects.toThrow(ConflictError);
  });

  it("reject 409s on a stale expectedRunVersion", async () => {
    await expect(rejectField(deps, ctx(), { ...REJECT_PARAMS, expectedRunVersion: 99, idempotencyKey: "k-rr" })).rejects.toThrow(ConflictError);
  });

  it("reject 409s on a stale expectedDocumentVersion", async () => {
    await expect(rejectField(deps, ctx(), { ...REJECT_PARAMS, expectedDocumentVersion: 99, idempotencyKey: "k-rd" })).rejects.toThrow(ConflictError);
  });

  it("confirming a field that is not PENDING_CONFIRMATION is a 422 BusinessRuleError, never touching the item", async () => {
    table.write(extractedFieldKey("t1", "doc1", "expirationDate", "run1"), { state: "CONFIRMED" }, 1);
    await expect(confirmField(deps, ctx(), { ...CONFIRM_PARAMS, expectedFieldVersion: 2, idempotencyKey: "k-state" })).rejects.toThrow(BusinessRuleError);
    const item = table.read<ExpirationItem>(itemKey("t1", "item1"));
    expect(item?.version).toBe(5);
  });

  it("rejecting a field that is not PENDING_CONFIRMATION is a 422 BusinessRuleError", async () => {
    table.write(extractedFieldKey("t1", "doc1", "expirationDate", "run1"), { state: "REJECTED" }, 1);
    await expect(rejectField(deps, ctx(), { ...REJECT_PARAMS, expectedFieldVersion: 2, idempotencyKey: "k-state2" })).rejects.toThrow(BusinessRuleError);
  });

  it("confirming with a confirmedValue that fails the field's DATE validation is a 422 BusinessRuleError", async () => {
    await expect(confirmField(deps, ctx(), { ...CONFIRM_PARAMS, confirmedValue: "not-a-date", idempotencyKey: "k-invalid" })).rejects.toThrow(BusinessRuleError);
  });

  it("confirm 404s when the ExtractedField does not exist", async () => {
    await expect(confirmField(deps, ctx(), { ...CONFIRM_PARAMS, fieldName: "doesNotExist", idempotencyKey: "k-nf1" })).rejects.toThrow(NotFoundError);
  });

  it("confirm 404s when the ExtractionRun does not exist", async () => {
    await expect(confirmField(deps, ctx(), { ...CONFIRM_PARAMS, runId: "missingRun", idempotencyKey: "k-nf2" })).rejects.toThrow(NotFoundError);
  });

  it("confirm 404s when the Document does not exist", async () => {
    await expect(confirmField(deps, ctx(), { ...CONFIRM_PARAMS, documentId: "missingDoc", idempotencyKey: "k-nf3" })).rejects.toThrow(NotFoundError);
  });

  it("confirm 404s when the ExpirationItem does not exist", async () => {
    await expect(confirmField(deps, ctx(), { ...CONFIRM_PARAMS, itemId: "missingItem", idempotencyKey: "k-nf4" })).rejects.toThrow(NotFoundError);
  });

  it("denies confirm/reject for a caller with no tenant membership (extraction:confirm authorization)", async () => {
    await expect(confirmField(deps, ctx({ tenant: { tenantId: "t1", roles: [] } }), { ...CONFIRM_PARAMS, idempotencyKey: "k-auth1" })).rejects.toThrow(
      AuthorizationDeniedError,
    );
    await expect(rejectField(deps, ctx({ tenant: { tenantId: "t1", roles: [] } }), { ...REJECT_PARAMS, idempotencyKey: "k-auth2" })).rejects.toThrow(
      AuthorizationDeniedError,
    );
  });

  it("cross-tenant: tenant B cannot confirm or reject tenant A's real extraction field, even knowing every real id", async () => {
    const tenantB = ctx({ tenant: { tenantId: "t2", roles: ["OWNER"] } });
    await expect(confirmField(deps, tenantB, { ...CONFIRM_PARAMS, idempotencyKey: "k-cross-1" })).rejects.toThrow(NotFoundError);
    await expect(rejectField(deps, tenantB, { ...REJECT_PARAMS, idempotencyKey: "k-cross-2" })).rejects.toThrow(NotFoundError);

    const field = table.read<ExtractedField>(extractedFieldKey("t1", "doc1", "expirationDate", "run1"));
    expect(field?.state).toBe("PENDING_CONFIRMATION");
    const item = table.read<ExpirationItem>(itemKey("t1", "item1"));
    expect(item?.version).toBe(5); // unchanged
  });
});
