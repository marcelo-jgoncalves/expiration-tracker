/** D-226 decision central (guest credential issuance consumer) — G-V3 adversarial coverage:
 * idempotency under a duplicate delivery (at-least-once SQS), dedicated-table isolation (never
 * leaks into the main tenant-facing table), stale-generation/status no-ops, expired deadline. */
import { describe, expect, it } from "vitest";
import { DocumentRequestCredentialIssuanceService } from "../../../src/modules/document-archive/application/document-request-credential-issuance-service.js";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { documentRequestKey, type DocumentRequest } from "../../../src/modules/document-archive/domain/document-request.js";
import { guestCredentialDeliveryKey, type GuestCredentialDeliveryRecord } from "../../../src/modules/document-archive/domain/guest-credential-delivery.js";
import type { RequestAccessCredential } from "../../../src/modules/document-archive/domain/request-access-credential.js";

const TENANT = "tenant-1";
const SUBJECT = "subject-1";
const MAIN_TABLE = "main-table";
const DELIVERY_TABLE = "guest-credential-delivery-table";

function seedRequest(overrides: Partial<DocumentRequest> = {}): DocumentRequest {
  return {
    ...documentRequestKey(TENANT, SUBJECT, "docreq-1"),
    entityType: "DocumentRequest",
    documentRequestId: "docreq-1",
    tenantId: TENANT,
    subjectId: SUBJECT,
    requirementId: "req-1",
    status: "REQUESTED",
    submissionCount: 0,
    issuanceGeneration: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function makeService(store: InMemoryDocumentArchiveStore, now = () => "2026-01-02T00:00:00.000Z") {
  return new DocumentRequestCredentialIssuanceService({ store, tableName: MAIN_TABLE, deliveryTableName: DELIVERY_TABLE, pepper: "test-pepper", now });
}

describe("DocumentRequestCredentialIssuanceService.handle (D-226 decision central)", () => {
  it("issues a credential, writes the delivery record ONLY to the dedicated table, and sets activeCredentialSelectorHash on the DocumentRequest", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const service = makeService(store);

    const outcome = await service.handle({ tenantId: TENANT, subjectId: SUBJECT, documentRequestId: "docreq-1", issuanceGeneration: 1 });
    expect(outcome.kind).toBe("ISSUED");

    const request = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, "docreq-1"));
    expect(request?.activeCredentialSelectorHash).toBeDefined();

    const delivery = await store.get<GuestCredentialDeliveryRecord>(guestCredentialDeliveryKey("docreq-1", 1));
    expect(delivery).toBeDefined();
    expect(delivery?.token).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{64}$/);

    // Isolation (G-V3): the raw token/selectorHash pair must NEVER appear on any row this fake
    // store holds that isn't the dedicated delivery record itself — proves no dual-write leaked
    // the bearer material into a main-table-shaped item.
    const allItems = store.allItems();
    const leaks = allItems.filter((item) => item !== (delivery as unknown as Record<string, unknown>) && JSON.stringify(item).includes(delivery!.token));
    expect(leaks).toHaveLength(0);
  });

  it("G-V3: a duplicate delivery of the SAME message (at-least-once SQS) is a safe no-op — never issues a second credential", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const service = makeService(store);
    const message = { tenantId: TENANT, subjectId: SUBJECT, documentRequestId: "docreq-1", issuanceGeneration: 1 };

    const first = await service.handle(message);
    expect(first.kind).toBe("ISSUED");
    const second = await service.handle(message);
    expect(second.kind).toBe("SKIPPED_ALREADY_ISSUED");

    const credentials = store.allItems().filter((item) => item["entityType"] === "RequestAccessCredential");
    expect(credentials).toHaveLength(1);
    const deliveries = store.allItems().filter((item) => item["entityType"] === "GuestCredentialDelivery");
    expect(deliveries).toHaveLength(1);
  });

  it("G-V3: a message for a SUPERSEDED issuanceGeneration (reissuance already happened) is a safe no-op, never overwrites the newer credential", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest({ issuanceGeneration: 2, activeCredentialSelectorHash: "already-current" }) as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const service = makeService(store);

    const outcome = await service.handle({ tenantId: TENANT, subjectId: SUBJECT, documentRequestId: "docreq-1", issuanceGeneration: 1 });
    expect(outcome.kind).toBe("SKIPPED_STALE_GENERATION");

    const request = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, "docreq-1"));
    expect(request?.activeCredentialSelectorHash).toBe("already-current"); // untouched.
  });

  it("skips a DocumentRequest that is no longer eligible (already SUBMITTED)", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest({ status: "SUBMITTED" }) as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const service = makeService(store);
    const outcome = await service.handle({ tenantId: TENANT, subjectId: SUBJECT, documentRequestId: "docreq-1", issuanceGeneration: 1 });
    expect(outcome.kind).toBe("SKIPPED_NOT_ELIGIBLE");
    const credentials = store.allItems().filter((item) => item["entityType"] === "RequestAccessCredential");
    expect(credentials).toHaveLength(0);
  });

  it("refuses to issue a credential whose deadline has already passed by the time this async consumer runs", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest({ deadline: "2026-01-01T12:00:00.000Z" }) as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const service = makeService(store, () => "2026-01-02T00:00:00.000Z"); // after the deadline.
    const outcome = await service.handle({ tenantId: TENANT, subjectId: SUBJECT, documentRequestId: "docreq-1", issuanceGeneration: 1 });
    expect(outcome.kind).toBe("SKIPPED_NOT_ELIGIBLE");
  });

  it("defaults to a 7-day TTL from createdAt when DocumentRequest.deadline is absent", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest({ createdAt: "2026-01-01T00:00:00.000Z" }) as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const service = makeService(store, () => "2026-01-02T00:00:00.000Z");
    await service.handle({ tenantId: TENANT, subjectId: SUBJECT, documentRequestId: "docreq-1", issuanceGeneration: 1 });
    const request = await store.get<DocumentRequest>(documentRequestKey(TENANT, SUBJECT, "docreq-1"));
    const credential = await store.get<RequestAccessCredential>({ PK: `DOCARCHIVEGUEST#${request!.activeCredentialSelectorHash}`, SK: "POINTER" });
    expect(credential?.expiresAt).toBe("2026-01-08T00:00:00.000Z");
  });

  it("is a safe no-op when the DocumentRequest is genuinely missing (defensive — should never happen since the outbox entry is written in the SAME transaction that creates it)", async () => {
    const store = new InMemoryDocumentArchiveStore([]);
    const service = makeService(store);
    const outcome = await service.handle({ tenantId: TENANT, subjectId: SUBJECT, documentRequestId: "missing", issuanceGeneration: 1 });
    expect(outcome.kind).toBe("SKIPPED_MISSING_REQUEST");
  });
});
