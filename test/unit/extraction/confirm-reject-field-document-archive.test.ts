import { describe, expect, it, beforeEach } from "vitest";
import {
  confirmFieldForDocumentArchive,
  rejectFieldForDocumentArchive,
  type ConfirmRejectFieldDocumentArchiveDeps,
} from "../../../src/modules/extraction/application/confirm-reject-field-document-archive.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import { requirementKey, type Requirement } from "../../../src/modules/document-archive/domain/requirement.js";
import { extractionRunKey, type ExtractionRun } from "../../../src/modules/extraction/domain/extraction-run.js";
import { extractedFieldKey, type ExtractedField } from "../../../src/modules/extraction/domain/extracted-field.js";
import { PIPELINE_VERSION_V1 } from "../../../src/modules/extraction/domain/field-schema.js";
import type { EntityReader } from "../../../src/modules/extraction/ports/entity-reader.js";
import type { ExtractionRunStore } from "../../../src/modules/extraction/ports/extraction-run-store.js";
import type {
  ConfirmFieldForDocumentArchiveInput,
  ExtractedFieldStore,
  RejectFieldForDocumentArchiveInput,
} from "../../../src/modules/extraction/ports/extracted-field-store.js";
import { IdempotencyStore, type DynamoLike } from "../../../src/shared/idempotency/idempotency.js";
import { BusinessRuleError, ConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";

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

/** Same hand-written single-table double convention as `confirm-reject-field.test.ts` — proves
 * the transactional shape (which rows move, which don't) without a real DynamoDB. Seeds a
 * `Requirement` row too, so tests can assert it is BYTE-IDENTICAL after confirm/reject (a real
 * assertion, not just "no call was made to a Requirement port" — this module never even imports
 * `requirement.ts`, but the design's own checklist demands the stronger proof). */
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

/** Records every call to `confirmFieldForDocumentArchive`/`rejectFieldForDocumentArchive` (not
 * just the plain reads/writes) so tests can assert the outbox conditionality directly — the
 * planned `effect`, not just its side effect on the table. */
class FakeExtractedFieldStore implements ExtractedFieldStore {
  public confirmCalls: ConfirmFieldForDocumentArchiveInput[] = [];
  public rejectCalls: RejectFieldForDocumentArchiveInput[] = [];
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

  async confirmFieldForDocumentArchive(input: ConfirmFieldForDocumentArchiveInput): Promise<"COMMITTED" | "VERSION_CONFLICT"> {
    this.confirmCalls.push(input);
    if (!this.table.assertVersion(input.runKey, input.runExpectedVersion)) return "VERSION_CONFLICT";
    // DocumentVersion Update ALWAYS runs (fixed cardinality — 3 aggregates/4 actions), even on a
    // NO_CHANGE plan: it still bumps version/updatedAt.
    const versionSet = input.effect.kind === "SET" ? { validUntil: input.effect.validUntil } : {};
    if (!this.table.write(input.documentVersionKey, versionSet, input.documentVersionExpectedVersion)) return "VERSION_CONFLICT";
    const ok = this.table.write(
      input.fieldKey,
      { state: "CONFIRMED", confirmedValue: input.confirmedValue, confirmedBy: input.confirmedBy, confirmedAt: input.now, updatedAt: input.now },
      input.fieldExpectedVersion,
    );
    return ok ? "COMMITTED" : "VERSION_CONFLICT";
  }

  async rejectFieldForDocumentArchive(input: RejectFieldForDocumentArchiveInput): Promise<"COMMITTED" | "VERSION_CONFLICT"> {
    this.rejectCalls.push(input);
    if (!this.table.assertVersion(input.runKey, input.runExpectedVersion)) return "VERSION_CONFLICT";
    const set: Record<string, unknown> = { state: "REJECTED" };
    if (input.correctionReason !== undefined) set["correctionReason"] = input.correctionReason;
    const ok = this.table.write(input.fieldKey, set, input.fieldExpectedVersion);
    return ok ? "COMMITTED" : "VERSION_CONFLICT";
  }
}

function makeDeps(table: InMemoryTable): ConfirmRejectFieldDocumentArchiveDeps {
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
    archive: new FakeReader(table),
    runs: new FakeExtractionRunStore(table),
    fields: new FakeExtractedFieldStore(table),
    idempotency,
    now: () => "2026-08-26T12:00:00.000Z",
  };
}

function seedFixture(table: InMemoryTable, versionOverrides: Partial<DocumentVersion> = {}) {
  const version: DocumentVersion = {
    ...documentVersionKey("t1", "doc1", 3),
    entityType: "DocumentVersion",
    versionId: "v1",
    documentId: "doc1",
    tenantId: "t1",
    seq: 3,
    state: "RECEIVED",
    origin: "MANUAL_UPLOAD",
    pendingFileScans: 0,
    infectedFileScans: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 4,
    ...versionOverrides,
  };
  const run: ExtractionRun = {
    ...extractionRunKey("t1", "doc1", "run1"),
    entityType: "ExtractionRun",
    tenantId: "t1",
    documentId: "doc1",
    versionId: "v1",
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
  // A real Requirement row, unrelated to this DocumentVersion by identity — seeded so tests can
  // prove it is byte-identical after confirm/reject (checklist: "Requirement nunca dentro dela").
  const requirement: Requirement = {
    ...requirementKey("t1", "subject1", "req1"),
    entityType: "Requirement",
    requirementId: "req1",
    tenantId: "t1",
    subjectId: "subject1",
    name: "Alvará de funcionamento",
    applicability: "APPLICABLE",
    status: "PENDING",
    version: 9,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as Requirement;

  table.seed(version as unknown as Record<string, unknown> & EntityKey);
  table.seed(run as unknown as Record<string, unknown> & EntityKey);
  table.seed(field as unknown as Record<string, unknown> & EntityKey);
  table.seed(requirement as unknown as Record<string, unknown> & EntityKey);

  return { version, run, field, requirement };
}

const CONFIRM_PARAMS = {
  documentId: "doc1",
  seq: 3,
  runId: "run1",
  fieldName: "expirationDate",
  expectedDocumentVersionVersion: 4,
  expectedRunVersion: 2,
  expectedFieldVersion: 1,
  confirmedValue: "2027-03-31",
  correlationId: "corr-1",
  idempotencyKey: "idem-confirm-1",
};

const REJECT_PARAMS = {
  documentId: "doc1",
  runId: "run1",
  fieldName: "expirationDate",
  expectedRunVersion: 2,
  expectedFieldVersion: 1,
  correctionReason: "Wrong date read.",
  idempotencyKey: "idem-reject-1",
};

describe("confirmFieldForDocumentArchive / rejectFieldForDocumentArchive (D-193 item 4/9)", () => {
  let table: InMemoryTable;
  let deps: ConfirmRejectFieldDocumentArchiveDeps;

  beforeEach(() => {
    table = new InMemoryTable();
  });

  it("confirm overwrites an existing validUntil: ExtractedField -> CONFIRMED with provenance, DocumentVersion.validUntil set, Requirement untouched", async () => {
    seedFixture(table, { validUntil: "2026-01-01" });
    deps = makeDeps(table);

    const field = await confirmFieldForDocumentArchive(deps, ctx(), CONFIRM_PARAMS);
    expect(field.state).toBe("CONFIRMED");
    expect(field.confirmedValue).toBe("2027-03-31");
    expect(field.confirmedBy).toBe("user-1");
    expect(field.confirmedAt).toBe("2026-08-26T12:00:00.000Z");

    const version = table.read<DocumentVersion>(documentVersionKey("t1", "doc1", 3));
    expect(version?.validUntil).toBe("2027-03-31");
    expect(version?.version).toBe(5); // bumped

    const requirement = table.read<Requirement>(requirementKey("t1", "subject1", "req1"));
    expect(requirement).toEqual({
      ...requirementKey("t1", "subject1", "req1"),
      entityType: "Requirement",
      requirementId: "req1",
      tenantId: "t1",
      subjectId: "subject1",
      name: "Alvará de funcionamento",
      applicability: "APPLICABLE",
      status: "PENDING",
      version: 9, // byte-identical — never touched by this transaction
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("the confirm transaction is exactly 3 aggregates: fieldKey, runKey, documentVersionKey — Requirement is never even referenced in the store call", async () => {
    seedFixture(table);
    deps = makeDeps(table);
    await confirmFieldForDocumentArchive(deps, ctx(), CONFIRM_PARAMS);

    const call = (deps.fields as FakeExtractedFieldStore).confirmCalls[0];
    expect(call).toBeDefined();
    expect(Object.keys(call!).sort()).not.toContain("requirementKey");
    expect(call!.fieldKey).toEqual(extractedFieldKey("t1", "doc1", "expirationDate", "run1"));
    expect(call!.runKey).toEqual(extractionRunKey("t1", "doc1", "run1"));
    expect(call!.documentVersionKey).toEqual(documentVersionKey("t1", "doc1", 3));
  });

  it("confirm with no actual validUntil change plans NO_CHANGE — the outbox write is genuinely conditional, not always-fired", async () => {
    // Same value already on the DocumentVersion — planDocumentVersionValidityEffect must plan
    // NO_CHANGE, proving the outbox Put in the real adapter is skipped for this exact case.
    seedFixture(table, { validUntil: "2027-03-31" });
    deps = makeDeps(table);
    await confirmFieldForDocumentArchive(deps, ctx(), CONFIRM_PARAMS);

    const call = (deps.fields as FakeExtractedFieldStore).confirmCalls[0];
    expect(call?.effect).toEqual({ kind: "NO_CHANGE" });
  });

  it("confirm plans SET (and the outbox write fires) when the confirmed value genuinely changes validUntil", async () => {
    seedFixture(table, { validUntil: "2020-01-01" });
    deps = makeDeps(table);
    await confirmFieldForDocumentArchive(deps, ctx(), CONFIRM_PARAMS);

    const call = (deps.fields as FakeExtractedFieldStore).confirmCalls[0];
    expect(call?.effect).toEqual({ kind: "SET", validUntil: "2027-03-31" });
  });

  it("reject: ExtractedField -> REJECTED with correctionReason; DocumentVersion and Requirement both byte-identical (2 aggregates/2 actions, DocumentVersion never referenced)", async () => {
    const { version: seededVersion, requirement: seededRequirement } = seedFixture(table, { validUntil: "2026-01-01" });
    deps = makeDeps(table);

    const field = await rejectFieldForDocumentArchive(deps, ctx(), REJECT_PARAMS);
    expect(field.state).toBe("REJECTED");
    expect(field.correctionReason).toBe("Wrong date read.");

    const version = table.read<DocumentVersion>(documentVersionKey("t1", "doc1", 3));
    expect(version).toEqual(seededVersion); // byte-identical — reject never touches DocumentVersion

    const requirement = table.read<Requirement>(requirementKey("t1", "subject1", "req1"));
    expect(requirement).toEqual(seededRequirement); // byte-identical — reject never touches Requirement

    const call = (deps.fields as FakeExtractedFieldStore).rejectCalls[0];
    expect(call).toBeDefined();
    expect(Object.keys(call!)).not.toContain("documentVersionKey");
  });

  it("confirm is idempotent: replaying the same Idempotency-Key returns the same committed result without re-executing", async () => {
    seedFixture(table);
    deps = makeDeps(table);
    const first = await confirmFieldForDocumentArchive(deps, ctx(), CONFIRM_PARAMS);
    const second = await confirmFieldForDocumentArchive(deps, ctx(), CONFIRM_PARAMS);
    expect(second).toEqual(first);
    expect((deps.fields as FakeExtractedFieldStore).confirmCalls).toHaveLength(1);
  });

  it("confirm 409s on a stale expectedDocumentVersionVersion", async () => {
    seedFixture(table);
    deps = makeDeps(table);
    await expect(confirmFieldForDocumentArchive(deps, ctx(), { ...CONFIRM_PARAMS, expectedDocumentVersionVersion: 99, idempotencyKey: "k-dv" })).rejects.toThrow(ConflictError);
  });

  it("confirm 409s on a stale expectedRunVersion", async () => {
    seedFixture(table);
    deps = makeDeps(table);
    await expect(confirmFieldForDocumentArchive(deps, ctx(), { ...CONFIRM_PARAMS, expectedRunVersion: 99, idempotencyKey: "k-run" })).rejects.toThrow(ConflictError);
  });

  it("confirm 409s on a stale expectedFieldVersion", async () => {
    seedFixture(table);
    deps = makeDeps(table);
    await expect(confirmFieldForDocumentArchive(deps, ctx(), { ...CONFIRM_PARAMS, expectedFieldVersion: 99, idempotencyKey: "k-field" })).rejects.toThrow(ConflictError);
  });

  it("confirm 404s when the DocumentVersion does not exist", async () => {
    seedFixture(table);
    deps = makeDeps(table);
    await expect(confirmFieldForDocumentArchive(deps, ctx(), { ...CONFIRM_PARAMS, seq: 999, idempotencyKey: "k-nf" })).rejects.toThrow(NotFoundError);
  });

  it("confirming a field that is not PENDING_CONFIRMATION is a 422 BusinessRuleError, never touching DocumentVersion", async () => {
    const { version } = seedFixture(table);
    table.write(extractedFieldKey("t1", "doc1", "expirationDate", "run1"), { state: "CONFIRMED" }, 1);
    deps = makeDeps(table);
    await expect(confirmFieldForDocumentArchive(deps, ctx(), { ...CONFIRM_PARAMS, expectedFieldVersion: 2, idempotencyKey: "k-state" })).rejects.toThrow(BusinessRuleError);
    expect(table.read<DocumentVersion>(documentVersionKey("t1", "doc1", 3))).toEqual(version);
  });

  it("rejecting a field that is not PENDING_CONFIRMATION is a 422 BusinessRuleError", async () => {
    seedFixture(table);
    table.write(extractedFieldKey("t1", "doc1", "expirationDate", "run1"), { state: "REJECTED" }, 1);
    deps = makeDeps(table);
    await expect(rejectFieldForDocumentArchive(deps, ctx(), { ...REJECT_PARAMS, expectedFieldVersion: 2, idempotencyKey: "k-state2" })).rejects.toThrow(BusinessRuleError);
  });

  it("cross-tenant: tenant B cannot confirm or reject tenant A's real extraction field, even knowing every real id", async () => {
    seedFixture(table);
    deps = makeDeps(table);
    const tenantB = ctx({ tenant: { tenantId: "t2", roles: ["OWNER"] } });
    await expect(confirmFieldForDocumentArchive(deps, tenantB, { ...CONFIRM_PARAMS, idempotencyKey: "k-cross-1" })).rejects.toThrow(NotFoundError);
    await expect(rejectFieldForDocumentArchive(deps, tenantB, { ...REJECT_PARAMS, idempotencyKey: "k-cross-2" })).rejects.toThrow(NotFoundError);

    const field = table.read<ExtractedField>(extractedFieldKey("t1", "doc1", "expirationDate", "run1"));
    expect(field?.state).toBe("PENDING_CONFIRMATION");
  });
});
