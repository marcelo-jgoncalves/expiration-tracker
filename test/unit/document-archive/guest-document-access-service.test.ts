import { describe, expect, it } from "vitest";
import { GuestDocumentAccessService, GuestAccessInvalidError } from "../../../src/modules/document-archive/application/guest-document-access-service.js";
import { DocumentArchiveGuestRateLimiter } from "../../../src/modules/document-archive/application/document-archive-guest-rate-limiter.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { documentRequestKey, type DocumentRequest } from "../../../src/modules/document-archive/domain/document-request.js";
import { epochSecondsFromIso, issueRequestAccessCredential, requestAccessCredentialKey, type RequestAccessCredential } from "../../../src/modules/document-archive/domain/request-access-credential.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";

const PEPPER = "test-pepper-value";
const TENANT = "tenant-1";
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
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
  await store.putIfAbsent(request);
  return request;
}

function makeService(store: InMemoryDocumentArchiveStore) {
  const rateLimiter = new DocumentArchiveGuestRateLimiter(store, () => NOW);
  return new GuestDocumentAccessService({ store, tableName: "test-table", ids: makeIds(), rateLimiter, pepper: PEPPER, now: () => NOW });
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

  it("submitEvidence: happy path creates a Document+DocumentVersion landing at RECEIVED (never auto-accepted, C2)", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    await seedRequest(store);
    const service = makeService(store);
    const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
    const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });

    const result = await service.submitEvidence(
      session.session.token,
      { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken },
      { fileName: "certidao.pdf", idempotencyKey: "idem-1" },
    );
    expect(result.seq).toBe(1);

    const version = await store.get<DocumentVersion>({ PK: `TENANT#${TENANT}#DOCUMENT#${result.documentId}`, SK: "VERSION#000001" });
    expect(version?.state).toBe("RECEIVED");
    expect(version?.origin).toBe("GUEST_UPLOAD");

    const request = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, "docreq-1"));
    expect(request?.status).toBe("SUBMITTED");
    expect(request?.submissionCount).toBe(1);
  });

  it("submitEvidence: replaying the same idempotencyKey never double-creates a DocumentVersion", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    await seedRequest(store);
    const service = makeService(store);
    const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
    const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });
    const csrf = { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: session.session.csrfToken };

    const first = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", idempotencyKey: "idem-replay" });
    const second = await service.submitEvidence(session.session.token, csrf, { fileName: "certidao.pdf", idempotencyKey: "idem-replay" });
    expect(second).toEqual(first);

    const allVersions = store.allItems().filter((i) => i["entityType"] === "DocumentVersion");
    expect(allVersions).toHaveLength(1);
  });

  it("submitEvidence: CSRF mismatch (header != cookie) is rejected with the same generic error", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    await seedRequest(store);
    const service = makeService(store);
    const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
    const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });

    await expect(
      service.submitEvidence(
        session.session.token,
        { ip: "1.1.1.1", csrfCookieValue: session.session.csrfToken, csrfHeaderValue: "attacker-supplied-value" },
        { fileName: "certidao.pdf", idempotencyKey: "idem-2" },
      ),
    ).rejects.toThrow(GuestAccessInvalidError);
  });

  it("submitEvidence: missing CSRF cookie/header is rejected with the same generic error", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    await seedRequest(store);
    const service = makeService(store);
    const credential = await service.issueCredential({ tenantId: TENANT, subjectId: SUBJECT, requirementId: REQUIREMENT, documentRequestId: "docreq-1", expiresAt: "2026-12-31T00:00:00.000Z" });
    const session = await service.startGuestSession(credential.token, { ip: "1.1.1.1" });

    await expect(
      service.submitEvidence(session.session.token, { ip: "1.1.1.1", csrfCookieValue: undefined, csrfHeaderValue: undefined }, { fileName: "certidao.pdf", idempotencyKey: "idem-3" }),
    ).rejects.toThrow(GuestAccessInvalidError);
  });
});
