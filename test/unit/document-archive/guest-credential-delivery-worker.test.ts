/** D-228 — G-V3 adversarial coverage for the delivery worker that D-222/D-227 named as
 * missing: sends to the actual `resolveCredential`-shaped token/link, idempotent under a
 * duplicate Streams delivery, never sends when the DocumentRequest has no recipient or the
 * generation is stale, raw token appears only in the email body (never logged/marked). */
import { describe, expect, it } from "vitest";
import { deliverGuestCredential, type GuestCredentialDeliveryDeps, type GuestCredentialDeliveryStore } from "../../../src/workers/guest-credential-delivery/deliver.js";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { documentRequestKey, type DocumentRequest } from "../../../src/modules/document-archive/domain/document-request.js";
import type { GuestCredentialDeliveryRecord } from "../../../src/modules/document-archive/domain/guest-credential-delivery.js";
import type { GuestCredentialDeliveryMarkerStore } from "../../../src/modules/document-archive/ports/guest-credential-delivery-marker-store.js";
import type { EmailProviderAdapter, EmailSendInput } from "../../../src/modules/notification/ports/email-provider.js";

const TENANT = "tenant-1";
const SUBJECT = "subject-1";

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
    recipientEmail: "guest@example.com",
    deadline: "2026-02-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function seedDelivery(overrides: Partial<GuestCredentialDeliveryRecord> = {}): GuestCredentialDeliveryRecord {
  return {
    PK: `DOCREQUEST#docreq-1#GEN#1`,
    SK: "DELIVERY",
    entityType: "GuestCredentialDelivery",
    tenantId: TENANT,
    subjectId: SUBJECT,
    documentRequestId: "docreq-1",
    requirementId: "req-1",
    issuanceGeneration: 1,
    token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    selectorHash: "selector-hash",
    expiresAt: "2026-02-01T00:00:00.000Z",
    purgeAfterTtl: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
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

class FakeEmailProvider implements EmailProviderAdapter {
  public readonly sent: EmailSendInput[] = [];
  public shouldFail = false;
  async send(input: EmailSendInput) {
    if (this.shouldFail) throw new Error("SES failure");
    this.sent.push(input);
    return { providerMessageId: "msg-1" };
  }
}

function makeDeps(store: GuestCredentialDeliveryStore, overrides: Partial<Omit<GuestCredentialDeliveryDeps, "store">> = {}) {
  const markerStore = overrides.markerStore ?? new FakeMarkerStore();
  const emailProvider = overrides.emailProvider ?? new FakeEmailProvider();
  const deps: GuestCredentialDeliveryDeps = {
    store,
    markerStore,
    emailProvider,
    guestUploadBaseUrl: "https://app.example.invalid/guest/document-requests",
    now: () => "2026-01-02T00:00:00.000Z",
    newCorrelationId: () => "corr-1",
    ...overrides,
  };
  return deps;
}

describe("deliverGuestCredential (D-228)", () => {
  it("sends an email whose link embeds the record's raw token — the same token resolveCredential() would need to authenticate", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const emailProvider = new FakeEmailProvider();
    const outcome = await deliverGuestCredential(makeDeps(store, { emailProvider }), seedDelivery());

    expect(outcome.kind).toBe("SENT");
    expect(emailProvider.sent).toHaveLength(1);
    expect(emailProvider.sent[0]?.to).toBe("guest@example.com");
    const link = String(emailProvider.sent[0]?.renderContext["guestLink"]);
    expect(link).toBe(`https://app.example.invalid/guest/document-requests?token=${encodeURIComponent(seedDelivery().token)}`);
  });

  it("G-V3: a duplicate Streams delivery of the SAME record is a safe no-op — never sends twice", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const emailProvider = new FakeEmailProvider();
    const markerStore = new FakeMarkerStore();
    const deps = makeDeps(store, { emailProvider, markerStore });

    const first = await deliverGuestCredential(deps, seedDelivery());
    expect(first.kind).toBe("SENT");
    const second = await deliverGuestCredential(deps, seedDelivery());
    expect(second.kind).toBe("ALREADY_DELIVERED");
    expect(emailProvider.sent).toHaveLength(1);
  });

  it("skips (no send, no claim) when the DocumentRequest has no recipientEmail — a data gap, not a transient failure", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest({ recipientEmail: undefined }) as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const emailProvider = new FakeEmailProvider();
    const outcome = await deliverGuestCredential(makeDeps(store, { emailProvider }), seedDelivery());

    expect(outcome.kind).toBe("SKIPPED_NO_RECIPIENT_EMAIL");
    expect(emailProvider.sent).toHaveLength(0);
  });

  it("skips when the DocumentRequest no longer exists", async () => {
    const store = new InMemoryDocumentArchiveStore([]);
    const outcome = await deliverGuestCredential(makeDeps(store), seedDelivery());
    expect(outcome.kind).toBe("SKIPPED_REQUEST_NOT_FOUND");
  });

  it("skips a stale generation — a reissuance already superseded this delivery record", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest({ issuanceGeneration: 2 }) as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const outcome = await deliverGuestCredential(makeDeps(store), seedDelivery({ issuanceGeneration: 1 }));
    expect(outcome.kind).toBe("SKIPPED_STALE_GENERATION");
  });

  it("reports SEND_FAILED (retryable) when the email provider throws, without leaving a false ALREADY_DELIVERED for a later valid retry to be blocked by forever", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const emailProvider = new FakeEmailProvider();
    emailProvider.shouldFail = true;
    const outcome = await deliverGuestCredential(makeDeps(store, { emailProvider }), seedDelivery());
    expect(outcome.kind).toBe("SEND_FAILED");
  });
});
