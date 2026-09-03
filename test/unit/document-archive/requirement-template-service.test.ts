/**
 * RequirementTemplate (P0.1) — design APPROVED in
 * `docs/architecture/reviews/requirement-template-scoping/estado-final-consolidado.md`.
 *
 * G-V3 discipline: every test below is adversarial — each one FAILS if the specific mechanism it
 * targets is removed, rather than merely asserting a happy path. The mechanism each test kills is
 * named in its own comment.
 */
import { describe, expect, it } from "vitest";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import {
  RequirementNameConflictError,
  SubjectPreconditionFailedError,
  TemplatePreconditionFailedError,
  ValidationError,
} from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { UploadUrlSigner } from "../../../src/modules/document/ports/upload-url-signer.js";
import { normalizeDisplayName } from "../../../src/shared/text/normalize-display-name.js";
import { requirementKey, type Requirement } from "../../../src/modules/document-archive/domain/requirement.js";
import {
  estimateDynamoItemBytesUpperBound,
  MAX_NAME_BYTES,
  MAX_NOTES_BYTES,
  MAX_TEMPLATE_ITEMS,
  planTemplateApplication,
  requirementNamePointerKey,
  requirementTemplateKey,
  requirementTemplateNamePointerKey,
  trackedSubjectKeyForFence,
  type RequirementTemplate,
} from "../../../src/modules/document-archive/domain/requirement-template.js";

const TENANT = "tenant-1";
const SUBJECT = "subject-1";
const NOW = "2026-09-03T00:00:00.000Z";

function makeIds(): DocumentArchiveIdGenerator {
  let n = 0;
  return {
    newDocumentId: () => `doc-${++n}`,
    newVersionId: () => `ver-${++n}`,
    newEventId: () => `evt-${++n}`,
    newRequirementId: () => `req-${++n}`,
    newSeriesId: () => `series-${++n}`,
    newDocumentRequestId: () => `docreq-${++n}`,
    newFileId: () => `file-${++n}`,
    newDocumentTypeId: () => `doctype-${++n}`,
    newRequirementTemplateId: () => `reqtpl-${++n}`,
    newRequirementTemplateItemId: () => `reqtplitem-${++n}`,
  };
}

const noopSigner: UploadUrlSigner = {
  presignUpload: async () => ({ uploadUrl: "https://s3.example/unused", requiredHeaders: {} }),
};

function ctx(roles: string[] = ["ADMIN"]): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: TENANT, roles },
    auth: { issuedAt: NOW, expiresAt: new Date(Date.parse(NOW) + 60_000).toISOString(), tokenId: "jti-1" },
  };
}

async function seed(store: InMemoryDocumentArchiveStore, subjectStatus: "ACTIVE" | "ARCHIVED" | "MISSING" = "ACTIVE"): Promise<void> {
  const record: TenantLifecycleRecord = {
    ...(tenantLifecycleKey(TENANT) as { PK: string; SK: "LIFECYCLE" }),
    entityType: "TenantLifecycleRecord",
    tenantId: TENANT,
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
  await store.putIfAbsent(record);
  if (subjectStatus !== "MISSING") {
    await store.putIfAbsent({
      ...trackedSubjectKeyForFence(TENANT, SUBJECT),
      entityType: "TrackedSubject",
      tenantId: TENANT,
      subjectId: SUBJECT,
      status: subjectStatus,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    } as never);
  }
}

function makeService(store = new InMemoryDocumentArchiveStore()) {
  const service = new DocumentArchiveService({
    store,
    tableName: "test-table",
    ids: makeIds(),
    quarantineBucket: "test-quarantine-bucket",
    signer: noopSigner,
    now: () => NOW,
  });
  return { service, store };
}

const BASIC_ITEMS = [{ name: "CND Federal" }, { name: "CND Estadual" }, { name: "Alvará de Funcionamento" }];

describe("RequirementTemplate — catalog CRUD", () => {
  it("createRequirementTemplate persists the template plus its name pointer, minting one templateItemId per item", async () => {
    const { service, store } = makeService();
    await seed(store);
    const template = await service.createRequirementTemplate(ctx(), { displayName: "Regularidade básica", items: BASIC_ITEMS });

    expect(template.status).toBe("ACTIVE");
    expect(template.GSI1PK).toBe(`TENANT#${TENANT}#REQTEMPLATESTATUS#ACTIVE`);
    expect(template.GSI1SK).toBe(`NAME#regularidade basica#REQTEMPLATE#${template.templateId}`);
    expect(template.items.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(new Set(template.items.map((i) => i.templateItemId)).size).toBe(3);
    expect(template.items.every((i) => i.applicability === "APPLICABLE")).toBe(true);

    const pointer = await store.get(requirementTemplateNamePointerKey(TENANT, "regularidade basica"));
    expect(pointer).toMatchObject({ templateId: template.templateId });
  });

  it("duplicateRequirementTemplate mints BOTH a new templateId and new templateItemIds — a copy is independent, never an alias", async () => {
    // Kills: reusing source templateItemIds. If ids were shared, `applyTemplate` of the copy would
    // report `sameTemplateItem` collisions against Requirements created by the ORIGINAL, silently
    // coupling two templates that the design says are independent.
    const { service, store } = makeService();
    await seed(store);
    const source = await service.createRequirementTemplate(ctx(), { displayName: "Base", items: BASIC_ITEMS });
    const copy = await service.duplicateRequirementTemplate(ctx(), source.templateId, "Base (cópia)");

    expect(copy.templateId).not.toBe(source.templateId);
    const sourceItemIds = new Set(source.items.map((i) => i.templateItemId));
    expect(copy.items.some((i) => sourceItemIds.has(i.templateItemId))).toBe(false);
    expect(copy.items.map((i) => i.name)).toEqual(source.items.map((i) => i.name));
  });

  it("archive is a status flip fenced on the FROM status — a second archive is a conflict, and an ARCHIVED template is not editable", async () => {
    // Kills: dropping `extraConditions` (the FROM-status fence). With only `expectedVersion`, a
    // stale double-flip would silently succeed instead of conflicting.
    const { service, store } = makeService();
    await seed(store);
    const template = await service.createRequirementTemplate(ctx(), { displayName: "T", items: BASIC_ITEMS });
    const archived = await service.archiveRequirementTemplate(ctx(), template.templateId, template.version);
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.GSI1PK).toBe(`TENANT#${TENANT}#REQTEMPLATESTATUS#ARCHIVED`);

    await expect(service.archiveRequirementTemplate(ctx(), template.templateId, archived.version)).rejects.toThrow(/not ACTIVE/);
    await expect(
      service.updateRequirementTemplate(ctx(), template.templateId, archived.version, { displayName: "novo" }),
    ).rejects.toThrow(/not ACTIVE/);

    const unarchived = await service.unarchiveRequirementTemplate(ctx(), template.templateId, archived.version);
    expect(unarchived.status).toBe("ACTIVE");
  });

  it("duplicating an ARCHIVED template is allowed on purpose — it is how a retired template is revived", async () => {
    const { service, store } = makeService();
    await seed(store);
    const template = await service.createRequirementTemplate(ctx(), { displayName: "Antigo", items: BASIC_ITEMS });
    await service.archiveRequirementTemplate(ctx(), template.templateId, template.version);
    const copy = await service.duplicateRequirementTemplate(ctx(), template.templateId, "Novo");
    expect(copy.status).toBe("ACTIVE");
  });

  it("VIEWER may read the catalog but cannot create/update/duplicate/archive/apply", async () => {
    const { service, store } = makeService();
    await seed(store);
    const viewer = ctx(["VIEWER"]);
    await expect(service.createRequirementTemplate(viewer, { displayName: "X", items: BASIC_ITEMS })).rejects.toThrow(AuthorizationDeniedError);
    await expect(service.applyTemplate(viewer, "reqtpl-1", SUBJECT)).rejects.toThrow(AuthorizationDeniedError);
    await expect(service.listRequirementTemplates(viewer, "ACTIVE")).resolves.toBeDefined();
  });
});

describe("RequirementTemplate — intra-template name uniqueness (Codex Round 1, achado 5)", () => {
  it("rejects two items that normalize to the same name, BEFORE they can become two Puts on one pointer key", async () => {
    // Kills: `assertTemplateItemNamesUnique`. Without it these two items reach the apply's
    // transaction as two `Put`s against the IDENTICAL RequirementNamePointer key, which real
    // DynamoDB rejects with ValidationException — an opaque 500 instead of this 400.
    const { service, store } = makeService();
    await seed(store);
    await expect(
      service.createRequirementTemplate(ctx(), { displayName: "T", items: [{ name: "CND Federal" }, { name: "  cnd   FEDERAL " }] }),
    ).rejects.toThrow(ValidationError);
  });

  it("the same guard runs on update and inside the pure planner", async () => {
    const { service, store } = makeService();
    await seed(store);
    const template = await service.createRequirementTemplate(ctx(), { displayName: "T", items: BASIC_ITEMS });
    await expect(
      // "Á" and "a" normalize identically (NFD + diacritic strip + lowercase).
      service.updateRequirementTemplate(ctx(), template.templateId, template.version, { items: [{ name: "A" }, { name: "á" }] }),
    ).rejects.toThrow(ValidationError);

    expect(() =>
      planTemplateApplication(
        [
          { templateItemId: "i1", name: "CND Federal", applicability: "APPLICABLE", position: 0 },
          { templateItemId: "i2", name: "cnd federal", applicability: "APPLICABLE", position: 1 },
        ],
        [],
      ),
    ).toThrow(ValidationError);
  });

  it("rejects more items than MAX_TEMPLATE_ITEMS — the cap that keeps 2N+3 inside the 100-action transaction limit", async () => {
    const { service, store } = makeService();
    await seed(store);
    const tooMany = Array.from({ length: MAX_TEMPLATE_ITEMS + 1 }, (_, i) => ({ name: `Item ${i}` }));
    await expect(service.createRequirementTemplate(ctx(), { displayName: "T", items: tooMany })).rejects.toThrow(ValidationError);
  });
});

describe("RequirementTemplate — preview and apply", () => {
  it("apply materializes each item as a Requirement carrying provenance, and writes one dedupe pointer per Requirement", async () => {
    const { service, store } = makeService();
    await seed(store);
    const template = await service.createRequirementTemplate(ctx(), { displayName: "T", items: BASIC_ITEMS });
    const result = await service.applyTemplate(ctx(), template.templateId, SUBJECT);

    expect(result.created).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    for (const created of result.created) {
      const requirement = await store.get<Requirement>(requirementKey(TENANT, SUBJECT, created.requirementId));
      expect(requirement?.sourceTemplateId).toBe(template.templateId);
      expect(requirement?.sourceTemplateItemId).toBe(created.templateItemId);
      expect(requirement?.sourceTemplateAppliedVersion).toBe(template.version);
      expect(requirement?.status).toBe("MISSING");
      const pointer = await store.get(requirementNamePointerKey(TENANT, SUBJECT, normalizeDisplayName(created.name)));
      expect(pointer).toMatchObject({ requirementId: created.requirementId });
    }
  });

  it("editing the template AFTER an apply never reaches the Requirements it already created (snapshot, not live-link)", async () => {
    // Kills: any live-link. If the Requirement read its name through the template, renaming the
    // template item would change an already-materialized Requirement.
    const { service, store } = makeService();
    await seed(store);
    const template = await service.createRequirementTemplate(ctx(), { displayName: "T", items: [{ name: "CND Federal" }] });
    const { created } = await service.applyTemplate(ctx(), template.templateId, SUBJECT);
    const requirementId = created[0]!.requirementId;

    await service.updateRequirementTemplate(ctx(), template.templateId, template.version, { items: [{ name: "Certidão Renomeada" }] });

    const after = await store.get<Requirement>(requirementKey(TENANT, SUBJECT, requirementId));
    expect(after?.name).toBe("CND Federal");
  });

  it("skips an item whose name already exists on the Subject, matching only after normalization", async () => {
    // Kills: comparing raw names. "  cnd   FEDERAL " must collide with "CND Federal".
    const { service, store } = makeService();
    await seed(store);
    await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "  cnd   FEDERAL ", applicability: "APPLICABLE" });
    const template = await service.createRequirementTemplate(ctx(), { displayName: "T", items: BASIC_ITEMS });

    const preview = await service.previewTemplateApplication(ctx(), template.templateId, SUBJECT);
    const applied = await service.applyTemplate(ctx(), template.templateId, SUBJECT);

    expect(preview.skip.map((s) => s.name)).toEqual(["CND Federal"]);
    expect(preview.create).toHaveLength(2);
    // Preview and apply cannot diverge ALGORITHMICALLY — one implementation, two call sites.
    expect(applied.skipped.map((s) => s.name)).toEqual(preview.skip.map((s) => s.name));
    expect(applied.created).toHaveLength(2);
  });

  it("re-applying the same template is idempotent SUCCESS (200-shaped, empty `created`), never a conflict", async () => {
    const { service, store } = makeService();
    await seed(store);
    const template = await service.createRequirementTemplate(ctx(), { displayName: "T", items: BASIC_ITEMS });
    await service.applyTemplate(ctx(), template.templateId, SUBJECT);
    const again = await service.applyTemplate(ctx(), template.templateId, SUBJECT);

    expect(again.created).toEqual([]);
    expect(again.skipped).toHaveLength(3);
    expect(again.skipped.every((s) => s.sameTemplateItem)).toBe(true);
  });

  it("a pointer claimed concurrently aborts the WHOLE apply — dedupe is transactional, not read-then-write", async () => {
    // THE core G-V3 of this decision. The pointer row is seeded directly, simulating a concurrent
    // writer that won the race AFTER this apply's plan was computed — so the plan still believes
    // the name is free. Kills: read-then-write dedupe (which would happily create a duplicate) and
    // kills any partial application (no Requirement may survive an aborted apply).
    const { service, store } = makeService();
    await seed(store);
    const template = await service.createRequirementTemplate(ctx(), { displayName: "T", items: BASIC_ITEMS });
    await store.putIfAbsent({
      ...requirementNamePointerKey(TENANT, SUBJECT, "cnd estadual"),
      entityType: "RequirementNamePointer",
      tenantId: TENANT,
      subjectId: SUBJECT,
      normalizedName: "cnd estadual",
      requirementId: "req-written-by-someone-else",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    } as never);

    await expect(service.applyTemplate(ctx(), template.templateId, SUBJECT)).rejects.toThrow(RequirementNameConflictError);

    // All-or-nothing: not even the two non-colliding items were written.
    const rows = await store.queryByPk<Requirement>(`TENANT#${TENANT}#SUBJECT#${SUBJECT}`, "REQUIREMENT#");
    expect(rows).toHaveLength(0);
  });

  it("a template edited between preview and apply rejects the stale plan (version, not just status, is fenced)", async () => {
    // Kills: fencing only on `status = ACTIVE` (Codex Round 2, achado 2). With status alone, this
    // apply would materialize items from a template version that had already been edited away.
    const { service, store } = makeService();
    await seed(store);
    const template = await service.createRequirementTemplate(ctx(), { displayName: "T", items: BASIC_ITEMS });
    const preview = await service.previewTemplateApplication(ctx(), template.templateId, SUBJECT);

    await service.updateRequirementTemplate(ctx(), template.templateId, template.version, { items: [{ name: "Outra coisa" }] });

    await expect(service.applyTemplate(ctx(), template.templateId, SUBJECT, preview.templateVersion)).rejects.toThrow(TemplatePreconditionFailedError);
  });

  it("applying an ARCHIVED template fails the template precondition", async () => {
    const { service, store } = makeService();
    await seed(store);
    const template = await service.createRequirementTemplate(ctx(), { displayName: "T", items: BASIC_ITEMS });
    await service.archiveRequirementTemplate(ctx(), template.templateId, template.version);
    await expect(service.applyTemplate(ctx(), template.templateId, SUBJECT)).rejects.toThrow(TemplatePreconditionFailedError);
  });

  it("an ARCHIVED Subject rejects both apply and createRequirement — the fence enumerates ACTIVE, it does not merely exclude DELETED", async () => {
    // Kills: `status <> DELETED` (Codex Round 2, achado 8 — TrackedSubjectStatus is
    // ACTIVE|ARCHIVED|DELETED, so `<> DELETED` let ARCHIVED straight through).
    const { service, store } = makeService();
    await seed(store, "ARCHIVED");
    const template = await service.createRequirementTemplate(ctx(), { displayName: "T", items: BASIC_ITEMS });
    await expect(service.applyTemplate(ctx(), template.templateId, SUBJECT)).rejects.toThrow(SubjectPreconditionFailedError);
    await expect(service.createRequirement(ctx(), { subjectId: SUBJECT, name: "X", applicability: "APPLICABLE" })).rejects.toThrow(
      SubjectPreconditionFailedError,
    );
  });

  it("a missing Subject rejects createRequirement — closing a pre-existing gap this decision found", async () => {
    // Before P0.1 `createRequirement` never checked the Subject at all and would create a
    // Requirement under a Subject that does not exist.
    const { service, store } = makeService();
    await seed(store, "MISSING");
    await expect(service.createRequirement(ctx(), { subjectId: SUBJECT, name: "X", applicability: "APPLICABLE" })).rejects.toThrow(
      SubjectPreconditionFailedError,
    );
  });
});

describe("Requirement — per-Subject name uniqueness (the product rule the template's dedupe rests on)", () => {
  it("two Requirements with the same normalized name cannot coexist on one Subject", async () => {
    const { service, store } = makeService();
    await seed(store);
    await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND Federal", applicability: "APPLICABLE" });
    await expect(
      service.createRequirement(ctx(), { subjectId: SUBJECT, name: "cnd  federal", applicability: "NOT_APPLICABLE" }),
    ).rejects.toThrow(RequirementNameConflictError);
  });

  it("renaming moves the pointer (old name freed, new name claimed) and deleting frees it", async () => {
    // Kills: the same-name/changed-name branch split. A single shared transaction shape would try
    // to Delete and Put the same pointer item when the normalized name did not change.
    const { service, store } = makeService();
    await seed(store);
    const created = await service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND Federal", applicability: "APPLICABLE" });
    const renamed = await service.updateRequirement(ctx(), SUBJECT, created.requirementId, created.version, { name: "CND Municipal" });

    expect(await store.get(requirementNamePointerKey(TENANT, SUBJECT, "cnd federal"))).toBeUndefined();
    expect(await store.get(requirementNamePointerKey(TENANT, SUBJECT, "cnd municipal"))).toMatchObject({ requirementId: created.requirementId });

    // A no-op rename (same normalized name) must not attempt to move anything.
    const sameName = await service.updateRequirement(ctx(), SUBJECT, created.requirementId, renamed.version, { name: "  CND   municipal " });
    expect(await store.get(requirementNamePointerKey(TENANT, SUBJECT, "cnd municipal"))).toBeDefined();

    await service.deleteRequirement(ctx(), SUBJECT, created.requirementId, sameName.version);
    expect(await store.get(requirementNamePointerKey(TENANT, SUBJECT, "cnd municipal"))).toBeUndefined();
    // Freed: the name is creatable again, proving no permanent reservation.
    await expect(service.createRequirement(ctx(), { subjectId: SUBJECT, name: "CND Municipal", applicability: "APPLICABLE" })).resolves.toBeDefined();
  });
});

describe("RequirementTemplate — byte budget (Codex Rounds 2-4)", () => {
  it("the worst-case template at the cap stays far under the sentinel, using an upper-bound estimator", async () => {
    // Kills: measuring `JSON.stringify(...).length` (not bytes) or limiting by characters instead
    // of UTF-8 bytes — with multi-byte input the character limit alone cannot bound the item size.
    const { service, store } = makeService();
    await seed(store);
    const worstName = "ç".repeat(MAX_NAME_BYTES / 2); // 2 bytes per code point = exactly the limit
    const worstNotes = "ç".repeat(MAX_NOTES_BYTES / 2);
    const items = Array.from({ length: MAX_TEMPLATE_ITEMS }, (_, i) => ({ name: `${i}${worstName}`.slice(0, 90), notes: worstNotes }));
    const template = await service.createRequirementTemplate(ctx(), { displayName: "worst", items });

    const stored = await store.get<RequirementTemplate>(requirementTemplateKey(TENANT, template.templateId));
    const bytes = estimateDynamoItemBytesUpperBound(stored as unknown as Record<string, unknown>);
    expect(bytes).toBeLessThan(200_000);
  });

  it("a name over the BYTE limit is rejected even when it is under the character limit", async () => {
    const { service, store } = makeService();
    await seed(store);
    const multiByte = "ç".repeat(MAX_NAME_BYTES / 2 + 1); // 201+ bytes, only ~101 characters
    await expect(service.createRequirementTemplate(ctx(), { displayName: "T", items: [{ name: multiByte }] })).rejects.toThrow(ValidationError);
  });

  it("the estimator throws on a type it cannot bound rather than silently contributing zero", () => {
    // Kills: a permissive `default: return 0`, which would make "upper bound" false in general.
    expect(() => estimateDynamoItemBytesUpperBound({ weird: Symbol("x") as unknown as string })).toThrow(/unsupported value type/);
  });
});
