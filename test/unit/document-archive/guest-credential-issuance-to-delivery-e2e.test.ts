/**
 * D-228 G-V3 (real requirement): an end-to-end test proving the FULL cycle now actually
 * works — createDocumentRequest (producer) -> DocumentRequestCredentialIssuanceService
 * (issuance consumer, D-226/D-227) -> deliverGuestCredential (D-228's new delivery worker) ->
 * the email's link authenticates via GuestDocumentAccessService.resolveCredential(), the exact
 * method the real HTTP guest handler calls. Before D-228 this chain was structurally
 * incomplete (D-222/D-227): a guest could never receive a usable link. This test is the proof
 * that the gap is closed for the avulso creation path (`createDocumentRequest` with
 * `recipientEmail` — the series/recurrence path still lacks a recipient contact, a named,
 * documented pendency, not silently glossed over here).
 */
import { describe, expect, it } from "vitest";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import { DocumentRequestRecurrenceService } from "../../../src/modules/document-archive/application/document-request-recurrence-service.js";
import { GuestDocumentAccessService } from "../../../src/modules/document-archive/application/guest-document-access-service.js";
import { DocumentArchiveGuestRateLimiter } from "../../../src/modules/document-archive/application/document-archive-guest-rate-limiter.js";
import { DocumentRequestCredentialIssuanceService } from "../../../src/modules/document-archive/application/document-request-credential-issuance-service.js";
import { deliverGuestCredential, type GuestCredentialDeliveryDeps } from "../../../src/workers/guest-credential-delivery/deliver.js";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle, seedActiveTrackedSubject } from "./in-memory-store.js";
import type { GuestCredentialDeliveryMarkerStore } from "../../../src/modules/document-archive/ports/guest-credential-delivery-marker-store.js";
import type { EmailProviderAdapter, EmailSendInput } from "../../../src/modules/notification/ports/email-provider.js";
import { guestCredentialDeliveryKey, type GuestCredentialDeliveryRecord } from "../../../src/modules/document-archive/domain/guest-credential-delivery.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { requirementKey } from "../../../src/modules/document-archive/domain/requirement.js";

const TENANT = "tenant-1";
const SUBJECT = "subject-1";
const MAIN_TABLE = "test-table";
const DELIVERY_TABLE = "delivery-table";
const PEPPER = "e2e-test-pepper";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: TENANT, roles: ["MEMBER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

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
    newRequirementTemplateItemId: () => `reqtplitem_${++n}`,
    newDossierExportRunId: () => `dossier_${++n}`,
    newDocumentTypeFieldId: () => `doctypefield_${++n}`,
    newDocumentTypeFieldOptionId: () => `doctypefieldopt_${++n}`,
  };
}

function seedRequirement(tenantId: string, subjectId: string, requirementId: string): Record<string, unknown> & { PK: string; SK: string } {
  return {
    ...(requirementKey(tenantId, subjectId, requirementId) as { PK: string; SK: string }),
    entityType: "Requirement",
    requirementId,
    tenantId,
    subjectId,
    name: "Alvará",
    applicability: "APPLICABLE",
    status: "MISSING",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    GSI1PK: `TENANT#${tenantId}#REQSTATUS#MISSING`,
    GSI1SK: `REQUIREMENT#${requirementId}`,
  } as unknown as Record<string, unknown> & { PK: string; SK: string };
}

function makeArchiveService(store: InMemoryDocumentArchiveStore, ids: DocumentArchiveIdGenerator) {
  return new DocumentArchiveService({
    store,
    tableName: MAIN_TABLE,
    ids,
    quarantineBucket: "test-quarantine-bucket",
    signer: { presignUpload: async () => ({ uploadUrl: "https://example/x", requiredHeaders: {} }) },
    members: { isEligibleMember: async () => true },
    now: () => "2026-01-01T00:00:00.000Z",
  });
}

class FakeMarkerStore implements GuestCredentialDeliveryMarkerStore {
  private readonly claimed = new Set<string>();
  async claim(documentRequestId: string, issuanceGeneration: number): Promise<boolean> {
    const key = `${documentRequestId}#${issuanceGeneration}`;
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
}

class CapturingEmailProvider implements EmailProviderAdapter {
  public sent: EmailSendInput[] = [];
  async send(input: EmailSendInput) {
    this.sent.push(input);
    return { providerMessageId: "msg-1" };
  }
}

describe("D-228 end-to-end: issue -> deliver -> resolve", () => {
  it("a guest can authenticate via the exact link the delivery worker emails", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), seedRequirement(TENANT, SUBJECT, "req-1")]);
    const ids = makeIds();
    const archiveService = makeArchiveService(store, ids);

    // 1. Producer: creates a DocumentRequest with a real recipientEmail (D-228).
    const request = await archiveService.createDocumentRequest(ctx(), {
      subjectId: SUBJECT,
      requirementId: "req-1",
      idempotencyKey: "idem-e2e-1",
      recipientEmail: "guest@example.com",
    });
    expect(request.recipientEmail).toBe("guest@example.com");

    // 2. Issuance consumer (D-226/D-227, guest Lambda): mints the RequestAccessCredential and
    // writes the delivery record to the dedicated table — same store instance, different table
    // name, exactly like production's shared DynamoDBDocumentClient across two tables.
    const issuanceService = new DocumentRequestCredentialIssuanceService({ store, tableName: MAIN_TABLE, deliveryTableName: DELIVERY_TABLE, pepper: PEPPER, now: () => "2026-01-01T00:05:00.000Z" });
    const issuanceOutcome = await issuanceService.handle({ tenantId: TENANT, subjectId: SUBJECT, documentRequestId: request.documentRequestId, issuanceGeneration: request.issuanceGeneration });
    expect(issuanceOutcome.kind).toBe("ISSUED");

    const deliveryRecord = await store.get<GuestCredentialDeliveryRecord>(guestCredentialDeliveryKey(request.documentRequestId, request.issuanceGeneration));
    expect(deliveryRecord).toBeDefined();

    // 3. Delivery worker (D-228, this task): reads the Streams record, emails the link.
    const emailProvider = new CapturingEmailProvider();
    const deliveryDeps: GuestCredentialDeliveryDeps = {
      store,
      markerStore: new FakeMarkerStore(),
      emailProvider,
      guestUploadBaseUrl: "https://app.example.invalid/guest/document-requests",
      now: () => "2026-01-01T00:06:00.000Z",
      newCorrelationId: () => "corr-delivery-1",
    };
    const deliveryOutcome = await deliverGuestCredential(deliveryDeps, deliveryRecord!);
    expect(deliveryOutcome.kind).toBe("SENT");
    expect(emailProvider.sent).toHaveLength(1);
    expect(emailProvider.sent[0]?.to).toBe("guest@example.com");

    // 4. The guest clicks the link — extract its token and prove resolveCredential() (the exact
    // method the real HTTP guest handler calls, document-archive-guest-handlers.ts) accepts it.
    const guestLink = String(emailProvider.sent[0]?.renderContext["guestLink"]);
    const url = new URL(guestLink);
    const token = url.searchParams.get("token");
    expect(token).toBe(deliveryRecord!.token);

    const rateLimiter = new DocumentArchiveGuestRateLimiter(store);
    const guestAccess = new GuestDocumentAccessService({ store, tableName: MAIN_TABLE, ids, rateLimiter, pepper: PEPPER, now: () => "2026-01-01T00:10:00.000Z" });
    const resolved = await guestAccess.resolveCredential(token!, { ip: "203.0.113.1" });
    expect(resolved.credential.documentRequestId).toBe(request.documentRequestId);
  });
});

// D-230 (closes D-228's named pendency): the SAME end-to-end chain, but for a DocumentRequest
// materialized by a RECURRING series with a recipientEmail — before D-230, DocumentRequestSeries
// had no recipient contact modeled, so every series-materialized DocumentRequest was structurally
// unable to deliver a guest link (the delivery worker always skipped it, terminal, never an
// error). This proves the recurrence path now closes ponta a ponta too.
describe("D-230 end-to-end: series (recurrence) -> issue -> deliver -> resolve", () => {
  it("a series WITH recipientEmail: a materialized cycle delivers a real, usable guest link", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), seedRequirement(TENANT, SUBJECT, "req-1")]);
    const ids = makeIds();
    const recurrenceService = new DocumentRequestRecurrenceService({ store, tableName: MAIN_TABLE, ids, now: () => "2026-01-01T00:00:00.000Z" });

    // 1. Producer: creates a DocumentRequestSeries with a real recipientEmail (D-230), then
    // materializes cycle 1's attempt — same builder the interactive AND periodic worker paths
    // both go through (buildMaterializeAttemptEntries).
    const series = await recurrenceService.createSeries(ctx(), { subjectId: SUBJECT, requirementId: "req-1", cadence: { intervalDays: 90 }, recipientEmail: "guest@example.com" });
    const { request } = await recurrenceService.materializeAttempt(ctx(), SUBJECT, series.seriesId, series.version);
    expect(request.recipientEmail).toBe("guest@example.com");

    // 2. Issuance consumer (D-226/D-227).
    const issuanceService = new DocumentRequestCredentialIssuanceService({ store, tableName: MAIN_TABLE, deliveryTableName: DELIVERY_TABLE, pepper: PEPPER, now: () => "2026-01-01T00:05:00.000Z" });
    const issuanceOutcome = await issuanceService.handle({ tenantId: TENANT, subjectId: SUBJECT, documentRequestId: request.documentRequestId, issuanceGeneration: request.issuanceGeneration });
    expect(issuanceOutcome.kind).toBe("ISSUED");

    const deliveryRecord = await store.get<GuestCredentialDeliveryRecord>(guestCredentialDeliveryKey(request.documentRequestId, request.issuanceGeneration));
    expect(deliveryRecord).toBeDefined();

    // 3. Delivery worker (D-228) — the piece this decision proves now reaches the recurrence path.
    const emailProvider = new CapturingEmailProvider();
    const deliveryDeps: GuestCredentialDeliveryDeps = {
      store,
      markerStore: new FakeMarkerStore(),
      emailProvider,
      guestUploadBaseUrl: "https://app.example.invalid/guest/document-requests",
      now: () => "2026-01-01T00:06:00.000Z",
      newCorrelationId: () => "corr-delivery-2",
    };
    const deliveryOutcome = await deliverGuestCredential(deliveryDeps, deliveryRecord!);
    expect(deliveryOutcome.kind).toBe("SENT");
    expect(emailProvider.sent).toHaveLength(1);
    expect(emailProvider.sent[0]?.to).toBe("guest@example.com");

    // 4. The guest clicks the link — resolveCredential() accepts it, exactly like the avulso path.
    const guestLink = String(emailProvider.sent[0]?.renderContext["guestLink"]);
    const token = new URL(guestLink).searchParams.get("token");
    expect(token).toBe(deliveryRecord!.token);

    const rateLimiter = new DocumentArchiveGuestRateLimiter(store);
    const guestAccess = new GuestDocumentAccessService({ store, tableName: MAIN_TABLE, ids, rateLimiter, pepper: PEPPER, now: () => "2026-01-01T00:10:00.000Z" });
    const resolved = await guestAccess.resolveCredential(token!, { ip: "203.0.113.1" });
    expect(resolved.credential.documentRequestId).toBe(request.documentRequestId);
  });

  it("a series WITHOUT recipientEmail: the delivery worker keeps skipping (terminal, never an error) — non-regression", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), seedRequirement(TENANT, SUBJECT, "req-1")]);
    const ids = makeIds();
    const recurrenceService = new DocumentRequestRecurrenceService({ store, tableName: MAIN_TABLE, ids, now: () => "2026-01-01T00:00:00.000Z" });

    const series = await recurrenceService.createSeries(ctx(), { subjectId: SUBJECT, requirementId: "req-1", cadence: { intervalDays: 90 } });
    const { request } = await recurrenceService.materializeAttempt(ctx(), SUBJECT, series.seriesId, series.version);
    expect(request.recipientEmail).toBeUndefined();

    const issuanceService = new DocumentRequestCredentialIssuanceService({ store, tableName: MAIN_TABLE, deliveryTableName: DELIVERY_TABLE, pepper: PEPPER, now: () => "2026-01-01T00:05:00.000Z" });
    await issuanceService.handle({ tenantId: TENANT, subjectId: SUBJECT, documentRequestId: request.documentRequestId, issuanceGeneration: request.issuanceGeneration });
    const deliveryRecord = await store.get<GuestCredentialDeliveryRecord>(guestCredentialDeliveryKey(request.documentRequestId, request.issuanceGeneration));

    const emailProvider = new CapturingEmailProvider();
    const deliveryOutcome = await deliverGuestCredential(
      { store, markerStore: new FakeMarkerStore(), emailProvider, guestUploadBaseUrl: "https://app.example.invalid/guest/document-requests", now: () => "2026-01-01T00:06:00.000Z", newCorrelationId: () => "corr-delivery-3" },
      deliveryRecord!,
    );
    expect(deliveryOutcome.kind).toBe("SKIPPED_NO_RECIPIENT_EMAIL");
    expect(emailProvider.sent).toHaveLength(0);
  });
});
