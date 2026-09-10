import { describe, expect, it } from "vitest";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";
import { GuestDocumentAccessService, GuestAccessInvalidError } from "../../../src/modules/document-archive/application/guest-document-access-service.js";
import { DocumentArchiveGuestRateLimiter } from "../../../src/modules/document-archive/application/document-archive-guest-rate-limiter.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore, seedActiveDocumentType } from "./in-memory-store.js";
import type { Document } from "../../../src/modules/document-archive/domain/document.js";
import { documentTypeKey, documentTypeGsi1Keys } from "../../../src/modules/document-archive/domain/document-type.js";
import { documentRequestKey, type DocumentRequest } from "../../../src/modules/document-archive/domain/document-request.js";
import { epochSecondsFromIso, issueRequestAccessCredential, requestAccessCredentialKey, type RequestAccessCredential } from "../../../src/modules/document-archive/domain/request-access-credential.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { buildVersionedUpdate } from "../../../src/shared/dynamodb/occ.js";
import type { DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import { trackedSubjectKeyForFence } from "../../../src/modules/document-archive/domain/requirement-template.js";
import { requirementKey } from "../../../src/modules/document-archive/domain/requirement.js";
import type { UploadUrlSigner, PresignUploadInput, PresignUploadResult } from "../../../src/modules/document/ports/upload-url-signer.js";
import { documentFileKey, type DocumentFile } from "../../../src/modules/document-archive/domain/document-file.js";

/** Fake signer, not a stub that just resolves undefined — same "record every call" discipline
 * as `document-archive-service.test.ts`'s own `makeSigner()` (G-V3). */
function makeSigner(): UploadUrlSigner & { calls: PresignUploadInput[] } {
  const calls: PresignUploadInput[] = [];
  return {
    calls,
    presignUpload: async (input: PresignUploadInput): Promise<PresignUploadResult> => {
      calls.push(input);
      return { uploadUrl: `https://s3.example/${input.bucket}/${input.key}?sig=fake`, requiredHeaders: { "x-amz-checksum-sha256": input.checksumSha256 } };
    },
  };
}

const PEPPER = "test-pepper-value";
const TENANT = authorizedTenantIdFromPersistedEntity({ tenantId: "tenant-1" });
const SUBJECT = "subject-1";
const REQUIREMENT = "requirement-1";
const NOW = "2026-09-01T00:00:00.000Z";

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
  newRequirementTemplateId: () => "reqtpl_test",
  newRequirementTemplateItemId: () => `reqtplitem_${crypto.randomUUID()}`,
  newDossierExportRunId: () => `dossier_${crypto.randomUUID()}`,
  newDocumentTypeFieldId: () => `doctypefield_${crypto.randomUUID()}`,
  newDocumentTypeFieldOptionId: () => `doctypefieldopt_${crypto.randomUUID()}`,
    newShareId: () => `share_${crypto.randomUUID()}`,
  };
}

async function seedTenant(store: InMemoryDocumentArchiveStore): Promise<void> {
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
}

async function seedRequest(store: InMemoryDocumentArchiveStore, overrides: Partial<DocumentRequest> = {}): Promise<DocumentRequest> {
  const request: DocumentRequest = {
    ...documentRequestKey(TENANT, SUBJECT, "docreq-1"),
    entityType: "DocumentRequest",
    documentRequestId: "docreq-1",
    tenantId: TENANT,
    subjectId: SUBJECT,
    requirementId: REQUIREMENT,
    status: "REQUESTED",
    deadline: "2026-12-31T00:00:00.000Z",
    submissionCount: 0,
    issuanceGeneration: 1,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
  await store.putIfAbsent(request);
  return request;
}

function makeService(store: InMemoryDocumentArchiveStore, signer: UploadUrlSigner = makeSigner()) {
  const rateLimiter = new DocumentArchiveGuestRateLimiter(store, () => NOW);
  return new GuestDocumentAccessService({ store, tableName: "test-table", ids: makeIds(), rateLimiter, pepper: PEPPER, quarantineBucket: "test-quarantine-bucket", signer, now: () => NOW });
}

describe("GuestDocumentAccessService (D-143 Decision 4, D-146)", () => {
  it("issueCredential + resolveCredential happy path returns the credential and its DocumentRequest", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    await seedRequest(store);
    const service = makeService(store);

    const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
    const resolved = await service.resolveCredential(issued.token, { ip: "1.1.1.1" });
    expect(resolved.credential.documentRequestId).toBe("docreq-1");
    // markOpened() writes REQUESTED -> OPENED to the store, but resolveCredential() returns the
    // in-memory `request` read BEFORE that write (same best-effort staleness as
    // GuestSubmissionService.getRequestInfo's identical pattern) - the STORE reflects OPENED.
    expect(resolved.request.status).toBe("REQUESTED");
    const stored = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, "docreq-1"));
    expect(stored?.status).toBe("OPENED");
  });

  describe("subjectDisplayName / requirementName enrichment (G02, Block 6, D-2xx)", () => {
    it("resolveCredential and startGuestSession both return the Subject/Requirement's real display names", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent({ ...(trackedSubjectKeyForFence(TENANT, SUBJECT) as { PK: string; SK: string }), entityType: "TrackedSubject", displayName: "Atlas Schindler" });
      await store.putIfAbsent({ ...(requirementKey(TENANT, SUBJECT, REQUIREMENT) as { PK: string; SK: string }), entityType: "Requirement", name: "CND Federal" });
      const service = makeService(store);

      const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const resolved = await service.resolveCredential(issued.token, { ip: "1.1.1.1" });
      expect(resolved.subjectDisplayName).toBe("Atlas Schindler");
      expect(resolved.requirementName).toBe("CND Federal");

      const issued2 = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const session = await service.startGuestSession(issued2.token, { ip: "1.1.1.1" });
      expect(session.subjectDisplayName).toBe("Atlas Schindler");
      expect(session.requirementName).toBe("CND Federal");
    });

    it("degrades to undefined (never throws) when the Subject/Requirement no longer exist", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      const service = makeService(store);

      const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const resolved = await service.resolveCredential(issued.token, { ip: "1.1.1.1" });
      expect(resolved.subjectDisplayName).toBeUndefined();
      expect(resolved.requirementName).toBeUndefined();
    });
  });

  describe("anti-enumeration: every failure mode collapses to the same generic error", () => {
    it("malformed token", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const service = makeService(store);
      await expect(service.resolveCredential("not-a-token", { ip: "1.1.1.1" })).rejects.toThrow(GuestAccessInvalidError);
    });

    it("well-formed but nonexistent selector", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const service = makeService(store);
      const fake = `${"a".repeat(32)}.${"b".repeat(64)}`;
      await expect(service.resolveCredential(fake, { ip: "1.1.1.1" })).rejects.toThrow(GuestAccessInvalidError);
    });

    it("wrong secret against a real selector", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      const service = makeService(store);
      const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const [selector] = issued.token.split(".");
      const wrong = `${selector}.${"f".repeat(64)}`;
      await expect(service.resolveCredential(wrong, { ip: "1.1.1.1" })).rejects.toThrow(GuestAccessInvalidError);
    });

    it("expired credential", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      const service = makeService(store);
      const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2020-01-01T00:00:00.000Z" });
      await expect(service.resolveCredential(issued.token, { ip: "1.1.1.1" })).rejects.toThrow(GuestAccessInvalidError);
    });

    it("revoked credential", async () => {
      // Pre-built directly via the domain issuance function (not the service) so the pointer
      // can be seeded already-revoked — a real revocation is a follow-up write this task's
      // service does not expose yet (revocation itself is out of scope; only its EFFECT on
      // resolveCredential is under test here).
      const issued = issueRequestAccessCredential(PEPPER);
      const revoked: RequestAccessCredential = {
        ...requestAccessCredentialKey(issued.selectorHash),
        entityType: "RequestAccessCredential",
        selectorHash: issued.selectorHash,
        secretHash: issued.secretHash,
        tenantId: TENANT,
        subjectId: SUBJECT,
        requirementId: REQUIREMENT,
        documentRequestId: "docreq-1",
        tokenVersion: 1,
        expiresAt: "2026-12-31T00:00:00.000Z",
        purgeAfterTtl: epochSecondsFromIso("2026-12-31T00:00:00.000Z"),
        revokedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
      };
      const store = new InMemoryDocumentArchiveStore([revoked as unknown as Record<string, unknown> & { PK: string; SK: string }]);
      await seedTenant(store);
      await seedRequest(store);
      const service = makeService(store);
      await expect(service.resolveCredential(issued.token, { ip: "1.1.1.1" })).rejects.toThrow(GuestAccessInvalidError);
    });

    it("rate-limited (exhausted before lookup)", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      const service = makeService(store);
      const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      for (let i = 0; i < 30; i++) {
        await service.resolveCredential(issued.token, { ip: "1.1.1.1" }).catch(() => undefined);
      }
      await expect(service.resolveCredential(issued.token, { ip: "1.1.1.1" })).rejects.toThrow(GuestAccessInvalidError);
    });

    it("DocumentRequest already CANCELLED", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store, { status: "CANCELLED" });
      const service = makeService(store);
      const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      await expect(service.resolveCredential(issued.token, { ip: "1.1.1.1" })).rejects.toThrow(GuestAccessInvalidError);
    });
  });

  it("startGuestSession is the ONLY way a session is minted, and requires a valid credential", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    await seedRequest(store);
    const service = makeService(store);
    const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
    const result = await service.startGuestSession(issued.token, { ip: "1.1.1.1" });
    expect(result.session.token).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{64}$/);
    expect(result.expiresAt).toBe(new Date(Date.parse(NOW) + 30 * 60 * 1000).toISOString());
  });

  describe("listActiveDocumentTypesForGuest (item 6 discovery route, engineering-only slice)", () => {
    it("g1: valid token returns only ACTIVE DocumentTypes of the token's own tenant", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "CERTIDAO"));
      const service = makeService(store);
      const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });

      const types = await service.listActiveDocumentTypesForGuest(issued.token, { ip: "1.1.1.1" });
      expect(types.map((t) => t.documentTypeId).sort()).toEqual(["ALVARA", "CERTIDAO"]);
      for (const t of types) {
        expect(Object.keys(t).sort()).toEqual(["displayName", "documentTypeId"]);
      }
    });

    /** Mutation check: a naive implementation that queries by tenant-agnostic status alone (or
     * hardcodes a tenant) would leak another tenant's catalog — this proves isolation for real,
     * not merely "no other tenant seeded". */
    it("g2: never returns another tenant's DocumentTypes, even when both tenants have ACTIVE types with colliding ids", async () => {
      const OTHER_TENANT = "tenant-2";
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      await store.putIfAbsent(seedActiveDocumentType(OTHER_TENANT, "ALVARA"));
      await store.putIfAbsent(seedActiveDocumentType(OTHER_TENANT, "SOMENTE_OUTRO_TENANT"));
      const service = makeService(store);
      const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });

      const types = await service.listActiveDocumentTypesForGuest(issued.token, { ip: "1.1.1.1" });
      expect(types).toHaveLength(1);
      expect(types[0]?.documentTypeId).toBe("ALVARA");
      expect(types.some((t) => t.documentTypeId === "SOMENTE_OUTRO_TENANT")).toBe(false);
    });

    it("g3: a DEPRECATED DocumentType never appears in the list", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "CERTIDAO"));
      await store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: "test-table",
            key: documentTypeKey(TENANT, "CERTIDAO"),
            tenantId: TENANT,
            expectedVersion: 1,
            // Mirrors flipDocumentTypeStatus()'s real transition: the GSI1 DOCTYPESTATUS
            // namespace is keyed by status, so deprecating must also move the item out of the
            // ACTIVE partition, not just flip the `status` attribute in place.
            set: { status: "DEPRECATED", ...documentTypeGsi1Keys(TENANT, "DEPRECATED", "certidao", "CERTIDAO") },
          }),
        },
      ]);
      const service = makeService(store);
      const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });

      const types = await service.listActiveDocumentTypesForGuest(issued.token, { ip: "1.1.1.1" });
      expect(types.map((t) => t.documentTypeId)).toEqual(["ALVARA"]);
    });

    /** Anti-enumeration: an invalid/expired token must reject with the exact same generic error
     * as every other guest entry point on this surface — never a distinct "route not found"/
     * "no types" response that would let an attacker distinguish a bad token from an empty
     * catalog. */
    it("g4: invalid/expired token rejects with the same generic GuestAccessInvalidError as resolveCredential", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      const service = makeService(store);

      await expect(service.listActiveDocumentTypesForGuest("not-a-token", { ip: "1.1.1.1" })).rejects.toThrow(GuestAccessInvalidError);

      const expiredIssued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2020-01-01T00:00:00.000Z" });
      await expect(service.listActiveDocumentTypesForGuest(expiredIssued.token, { ip: "1.1.1.1" })).rejects.toThrow(GuestAccessInvalidError);
    });

    it("g5: DocumentRequest already CANCELLED rejects with the same generic error even for a well-formed credential", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store, { status: "CANCELLED" });
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      const service = makeService(store);
      const issued = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });

      await expect(service.listActiveDocumentTypesForGuest(issued.token, { ip: "1.1.1.1" })).rejects.toThrow(GuestAccessInvalidError);
    });
  });

  it("submitEvidence: happy path creates a Document+DocumentVersion landing at RECEIVED (never auto-accepted, C2)", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    await seedRequest(store);
    await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
    const service = makeService(store);
    const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
    const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });

    const result = await service.submitEvidence(
      session.session.token,
      { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken },
      { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-1" },
    );
    expect(result.seq).toBe(1);

    const version = await store.get<DocumentVersion>({ PK: `TENANT#${TENANT}#DOCUMENT#${result.documentId}`, SK: "VERSION#000001" });
    expect(version?.state).toBe("RECEIVED");
    expect(version?.origin).toBe("GUEST_UPLOAD");

    const request = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, "docreq-1"));
    expect(request?.status).toBe("SUBMITTED");
    expect(request?.submissionCount).toBe(1);
  });

  it("submitEvidence: replaying the same idempotencyKey (same payload) never double-creates a DocumentVersion, returns original snapshot", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    await seedRequest(store);
    await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
    const service = makeService(store);
    const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
    const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });
    const csrf = { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken };

    const first = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-replay" });
    const second = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-replay" });
    expect(second).toEqual(first);

    const allVersions = store.allItems().filter((i) => i["entityType"] === "DocumentVersion");
    expect(allVersions).toHaveLength(1);
  });

  it("submitEvidence: CSRF mismatch (header != cookie) is rejected with the same generic error", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    await seedRequest(store);
    await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
    const service = makeService(store);
    const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
    const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });

    await expect(
      service.submitEvidence(
        session.session.token,
        { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: "attacker-supplied-value" },
        { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-2" },
      ),
    ).rejects.toThrow(GuestAccessInvalidError);
  });

  it("submitEvidence: missing CSRF cookie/header is rejected with the same generic error", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    await seedRequest(store);
    await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
    const service = makeService(store);
    const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
    const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });

    await expect(
      service.submitEvidence(session.session.token, { ip: "1.1.1.1", csrfCookieValue: undefined, csrfHeaderValue: undefined }, { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-3" }),
    ).rejects.toThrow(GuestAccessInvalidError);
  });

  /** D-243 (supersedes D-184's conditional guard): `documentTypeId` is now mandatory end to end,
   * always validated against the tenant's DocumentType catalog via the unconditional
   * ConditionCheck at entries[0] — no free-text fallback to `requirementId` remains anywhere.
   * Implements the 9-item checklist from `round2-reconciliation.md` §4 (items 1-2, HTTP-schema
   * shaped, live in `test/contract/schemas.test.ts`; items 3-9 here). */
  describe("submitEvidence: D-243 documentTypeId mandatory + catalog validation", () => {
    /** Checklist item 3: ACTIVE documentTypeId creates the Document and composes GSI2 correctly. */
    it("t2: documentTypeId ACTIVE in the catalog succeeds, Document records that id and GSI2 uses it", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      const service = makeService(store);
      const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });
      const csrf = { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken };

      const result = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-t2" });
      const document = await store.get<Document>({ PK: `TENANT#${TENANT}#DOCUMENT#${result.documentId}`, SK: "METADATA" });
      expect(document?.documentTypeId).toBe("ALVARA");
      expect((document as unknown as Record<string, unknown>)["GSI2SK"]).toBe(`DOCTYPE#ALVARA#DOCUMENT#${result.documentId}`);
    });

    /** Checklist item 4 (nonexistent half) + item 5 (G-V3 mutation check): anti-enumeration — a
     * nonexistent DocumentType must reject with the SAME generic error as every other failure mode
     * on this surface, never a distinct "DocumentType not found". Removing/inverting the
     * ConditionCheck at entries[0] makes this test fail, proving it genuinely runs and blocks. */
    it("t3: documentTypeId nonexistent in the catalog rejects with the generic guest error", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      const service = makeService(store);
      const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });
      const csrf = { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken };

      await expect(
        service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", documentTypeId: "NAO_EXISTE", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-t3" }),
      ).rejects.toThrow(GuestAccessInvalidError);
    });

    /** Checklist item 4 (DEPRECATED half): same anti-enumeration collapse for a real-but-inactive
     * DocumentType, TOCTOU-safe (the ConditionCheck runs inside the same TransactWriteItems as the
     * Document Put, never a separate read-before-write) — mirrors createDocument()'s D-175
     * DEPRECATED case. */
    it("t4: documentTypeId DEPRECATED rejects with the generic guest error", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      await store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: "test-table",
            key: documentTypeKey(TENANT, "ALVARA"),
            tenantId: TENANT,
            expectedVersion: 1,
            set: { status: "DEPRECATED" },
          }),
        },
      ]);
      const service = makeService(store);
      const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });
      const csrf = { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken };

      await expect(
        service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-t4" }),
      ).rejects.toThrow(GuestAccessInvalidError);
    });

    /** Checklist item 6: replay with the same key AND the same payload returns the original
     * snapshot — covered structurally by the "replaying the same idempotencyKey" test above; kept
     * as a named checklist alias so the 9-item mapping is traceable one-to-one. */
    it("t_replay_same: replay with same key and same documentTypeId returns the original snapshot", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      const service = makeService(store);
      const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });
      const csrf = { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken };

      const first = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-replay-same" });
      const second = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-replay-same" });
      expect(second).toEqual(first);
    });

    /** Checklist item 7 (D-243 replay policy, payload-agnostic first-write-wins): a replay with
     * the SAME key but a DIFFERENT (even invalid/nonexistent) `documentTypeId` still returns the
     * original snapshot untouched — the second `documentTypeId` is never consulted or validated,
     * and no second version is created. Pre-existing property of the `existingReplay`
     * short-circuit (D-143 Decision 4), explicitly reaffirmed as part of D-243's design. */
    it("t_replay_diff: replay with same key but a different (invalid) documentTypeId still returns the original snapshot, no second version", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      const service = makeService(store);
      const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });
      const csrf = { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken };

      const first = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-replay-diff" });
      const second = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", documentTypeId: "NAO_EXISTE", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-replay-diff" });
      expect(second).toEqual(first);

      const allVersions = store.allItems().filter((i) => i["entityType"] === "DocumentVersion");
      expect(allVersions).toHaveLength(1);
    });

    /** Checklist item 8: a NEW idempotencyKey with a different (valid) documentTypeId executes a
     * genuinely new submission and validates that type normally — proves the replay short-circuit
     * is keyed correctly and does not over-suppress unrelated submissions. */
    it("t_new_key: a new idempotencyKey with a different valid documentTypeId performs a fresh submission", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "CERTIDAO"));
      const service = makeService(store);
      const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });
      const csrf = { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken };

      const first = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-new-1" });
      const second = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao2.pdf", documentTypeId: "CERTIDAO", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-new-2" });
      expect(second.documentId).not.toBe(first.documentId);

      const secondDocument = await store.get<Document>({ PK: `TENANT#${TENANT}#DOCUMENT#${second.documentId}`, SK: "METADATA" });
      expect(secondDocument?.documentTypeId).toBe("CERTIDAO");

      const allVersions = store.allItems().filter((i) => i["entityType"] === "DocumentVersion");
      expect(allVersions).toHaveLength(2);
    });

    /** Checklist item 9: no code path writes `requirementId` (or any value other than the caller's
     * own `documentTypeId`) into `Document.documentTypeId` anymore — the old D-184 fallback test
     * ("documentType absent falls back to requirementId") is removed by design, since the field is
     * mandatory now and a missing `documentTypeId` never reaches the service (rejected at the HTTP
     * schema layer, see `test/contract/schemas.test.ts`). This test proves the positive: the
     * catalog-validated id, never `requirementId`, ends up on the row. */
    it("t9: Document.documentTypeId always equals the validated input, never requirementId", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      const service = makeService(store);
      const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });
      const csrf = { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken };

      const result = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", idempotencyKey: "idem-t9" });
      const document = await store.get<Document>({ PK: `TENANT#${TENANT}#DOCUMENT#${result.documentId}`, SK: "METADATA" });
      expect(document?.documentTypeId).toBe("ALVARA");
      expect(document?.documentTypeId).not.toBe(REQUIREMENT);
    });
  });

  describe("ADR-0013 (D-265) — real file storage in the guest path", () => {
    const VALID_INPUT = { fileName: "certidao.pdf", documentTypeId: "ALVARA", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };

    async function setup(signer?: UploadUrlSigner) {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      await seedRequest(store);
      await store.putIfAbsent(seedActiveDocumentType(TENANT, "ALVARA"));
      const service = makeService(store, signer);
      const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
      const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });
      const csrf = { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken };
      return { store, service, sessionToken: session.session.token, csrf };
    }

    it("creates a PENDING_UPLOAD DocumentFile with a GSI8 pointer and returns a presigned uploadUrl", async () => {
      const signer = makeSigner();
      const { store, service, sessionToken, csrf } = await setup(signer);

      const result = await service.submitEvidence(sessionToken, csrf, { ...VALID_INPUT, idempotencyKey: "idem-file-1" });
      expect(result.uploadUrl).toBeDefined();
      expect(result.requiredHeaders).toBeDefined();
      expect(result.fileId).toBeDefined();
      expect(signer.calls).toHaveLength(1);
      expect(signer.calls[0]?.bucket).toBe("test-quarantine-bucket");
      expect(signer.calls[0]?.checksumSha256).toBe(VALID_INPUT.checksumSha256);

      const file = await store.get<DocumentFile>(documentFileKey(TENANT, result.documentId, result.seq, result.fileId));
      expect(file?.scanStatus).toBe("PENDING_UPLOAD");
      expect(file?.role).toBe("PRINCIPAL");
      expect(file?.GSI8PK).toBe("WORK#DOCUMENT_FILE_RECONCILIATION");
      expect(file?.GSI8SK).toBeDefined();
    });

    it("rejects an unsupported mediaType, an oversized contentLength, and a malformed checksumSha256 — all with the generic guest error", async () => {
      const { service, sessionToken, csrf } = await setup();
      await expect(service.submitEvidence(sessionToken, csrf, { ...VALID_INPUT, mediaType: "application/zip", idempotencyKey: "idem-bad-1" })).rejects.toThrow(GuestAccessInvalidError);
      await expect(service.submitEvidence(sessionToken, csrf, { ...VALID_INPUT, contentLength: 10 * 1024 * 1024 + 1, idempotencyKey: "idem-bad-2" })).rejects.toThrow(GuestAccessInvalidError);
      await expect(service.submitEvidence(sessionToken, csrf, { ...VALID_INPUT, checksumSha256: "not-a-real-checksum", idempotencyKey: "idem-bad-3" })).rejects.toThrow(GuestAccessInvalidError);
    });

    it("confirmUploadInFlight extends the deadline exactly once (idempotent on a second call)", async () => {
      const { store, service, sessionToken, csrf } = await setup();
      const result = await service.submitEvidence(sessionToken, csrf, { ...VALID_INPUT, idempotencyKey: "idem-confirm-1" });

      const first = await service.confirmUploadInFlight(sessionToken, csrf, "idem-confirm-1");
      expect(first).toEqual({ extended: true });

      const file = await store.get<DocumentFile>(documentFileKey(TENANT, result.documentId, result.seq, result.fileId));
      expect(file?.deadlineExtended).toBe(true);

      const second = await service.confirmUploadInFlight(sessionToken, csrf, "idem-confirm-1");
      expect(second).toEqual({ extended: true }); // idempotent — never a conflict on a repeat call.
    });

    it("confirmUploadInFlight never accepts a loose idempotencyKey — an unknown one is the generic guest error", async () => {
      const { service, sessionToken, csrf } = await setup();
      await expect(service.confirmUploadInFlight(sessionToken, csrf, "unknown-key")).rejects.toThrow(GuestAccessInvalidError);
    });

    it("confirmUploadInFlight is a no-op once the file already reached a terminal scanStatus", async () => {
      const { store, service, sessionToken, csrf } = await setup();
      const result = await service.submitEvidence(sessionToken, csrf, { ...VALID_INPUT, idempotencyKey: "idem-terminal-1" });

      const key = documentFileKey(TENANT, result.documentId, result.seq, result.fileId);
      const file = await store.get<DocumentFile>(key);
      await store.transactWrite([{ Update: buildVersionedUpdate({ tableName: "test-table", key, tenantId: TENANT, expectedVersion: file!.version, set: { scanStatus: "TIMEOUT" }, remove: ["GSI8PK", "GSI8SK"] }) }]);

      const outcome = await service.confirmUploadInFlight(sessionToken, csrf, "idem-terminal-1");
      expect(outcome).toEqual({ extended: false });
    });

    // Codex review round 2 — the real bug this test guards against: a file that NEVER received a
    // single byte (still PENDING_UPLOAD, never advanced to SCANNING) whose original GSI8 deadline
    // has already lapsed must report {extended:false}, never resurrect a dead reservation just
    // because PENDING_UPLOAD is technically "non-terminal".
    it("confirmUploadInFlight reports {extended:false} for a PENDING_UPLOAD file whose original deadline already lapsed (never uploaded, retried too late)", async () => {
      const { store, service, sessionToken, csrf } = await setup();
      const result = await service.submitEvidence(sessionToken, csrf, { ...VALID_INPUT, idempotencyKey: "idem-expired-1" });

      const key = documentFileKey(TENANT, result.documentId, result.seq, result.fileId);
      const file = await store.get<DocumentFile>(key);
      expect(file?.scanStatus).toBe("PENDING_UPLOAD"); // never advanced — no physical S3 event ever arrived.
      // Back-date the GSI8 deadline to the past, simulating a guest who retried long after the
      // original presign window (FILE_SCAN_TIMEOUT_SECONDS) closed, without ever completing the PUT.
      await store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: "test-table",
            key,
            tenantId: TENANT,
            expectedVersion: file!.version,
            set: { GSI8SK: `2000-01-01T00:00:00.000Z#TENANT#${TENANT}#${result.fileId}` },
          }),
        },
      ]);

      const outcome = await service.confirmUploadInFlight(sessionToken, csrf, "idem-expired-1");
      expect(outcome).toEqual({ extended: false });
      const fileAfter = await store.get<DocumentFile>(key);
      expect(fileAfter?.deadlineExtended).not.toBe(true); // never resurrected.
    });
  });
});
