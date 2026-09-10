/** D-228 — G-V3 adversarial coverage for the delivery worker, REVISED by D-233 (fixes
 * SEC-R2-02/full-audit-round2: the original claim-before-send marker had no way back from a
 * transient send failure, permanently and silently losing the guest's credential link). Covers
 * the full lease-based state machine: sends to the actual `resolveCredential()`-shaped
 * token/link, idempotent under a duplicate Streams delivery, never sends when the
 * DocumentRequest has no recipient or the generation is stale, raw token appears only in the
 * email body (never logged/marked) — AND (D-233's core G-V3 requirement) a transient
 * CONCLUSIVE_RETRYABLE send failure releases the claim so a SUBSEQUENT redelivery actually
 * completes the send, while an AMBIGUOUS/CONCLUSIVE_TERMINAL failure (or a post-accept
 * persistence failure) never resends automatically and always alerts a human. */
import { describe, expect, it } from "vitest";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";
import { deliverGuestCredential, type GuestCredentialDeliveryDeps, type GuestCredentialDeliveryStore, type UncertainDeliveryAlert } from "../../../src/workers/guest-credential-delivery/deliver.js";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { documentRequestKey, type DocumentRequest } from "../../../src/modules/document-archive/domain/document-request.js";
import type { GuestCredentialDeliveryRecord } from "../../../src/modules/document-archive/domain/guest-credential-delivery.js";
import type { GuestCredentialDeliveryClaimResult, GuestCredentialDeliveryMarkerStore } from "../../../src/modules/document-archive/ports/guest-credential-delivery-marker-store.js";
import { EmailSendError, type EmailProviderAdapter, type EmailSendInput } from "../../../src/modules/notification/ports/email-provider.js";

const TENANT = authorizedTenantIdFromPersistedEntity({ tenantId: "tenant-1" });
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

/** Faithful in-memory reproduction of `DynamoDbGuestCredentialDeliveryMarkerStore`'s state
 * machine (claim/markDelivered/releaseClaim/markUncertain + expired-lease reconciliation),
 * driven by an injectable clock so tests can simulate a lease expiring without real sleeps. */
class FakeMarkerStore implements GuestCredentialDeliveryMarkerStore {
  private readonly items = new Map<string, { status: "CLAIMED" | "DELIVERED" | "SEND_UNCERTAIN"; claimId: string; leaseExpiresAt?: string; failureKind?: string }>();
  private nextClaimId = 0;

  private key(documentRequestId: string, issuanceGeneration: number): string {
    return `${documentRequestId}#${issuanceGeneration}`;
  }

  async claim(documentRequestId: string, issuanceGeneration: number, now: string, leaseExpiresAt: string): Promise<GuestCredentialDeliveryClaimResult> {
    const key = this.key(documentRequestId, issuanceGeneration);
    const existing = this.items.get(key);
    if (!existing) {
      const claimId = `claim-${++this.nextClaimId}`;
      this.items.set(key, { status: "CLAIMED", claimId, leaseExpiresAt });
      return { outcome: "CLAIMED", claimId };
    }
    if (existing.status === "DELIVERED") return { outcome: "ALREADY_DELIVERED" };
    if (existing.status === "SEND_UNCERTAIN") return { outcome: "PREVIOUSLY_UNCERTAIN", failureKind: existing.failureKind ?? "AMBIGUOUS" };
    // CLAIMED - lease still active or expired?
    if (existing.leaseExpiresAt && Date.parse(existing.leaseExpiresAt) < Date.parse(now)) {
      existing.status = "SEND_UNCERTAIN";
      existing.failureKind = "AMBIGUOUS";
      return { outcome: "PREVIOUSLY_UNCERTAIN", failureKind: "AMBIGUOUS" };
    }
    return { outcome: "LEASE_ACTIVE" };
  }

  async markDelivered(documentRequestId: string, issuanceGeneration: number, claimId: string): Promise<void> {
    const item = this.items.get(this.key(documentRequestId, issuanceGeneration));
    if (item && item.status === "CLAIMED" && item.claimId === claimId) item.status = "DELIVERED";
  }

  async releaseClaim(documentRequestId: string, issuanceGeneration: number, claimId: string): Promise<void> {
    const key = this.key(documentRequestId, issuanceGeneration);
    const item = this.items.get(key);
    if (item && item.status === "CLAIMED" && item.claimId === claimId) this.items.delete(key);
  }

  async markUncertain(documentRequestId: string, issuanceGeneration: number, claimId: string, failureKind: string): Promise<void> {
    const item = this.items.get(this.key(documentRequestId, issuanceGeneration));
    if (item && item.status === "CLAIMED" && item.claimId === claimId) {
      item.status = "SEND_UNCERTAIN";
      item.failureKind = failureKind;
    }
  }
}

class FakeEmailProvider implements EmailProviderAdapter {
  public readonly sent: EmailSendInput[] = [];
  public failWith: EmailSendError | Error | undefined;
  async send(input: EmailSendInput) {
    if (this.failWith) throw this.failWith;
    this.sent.push(input);
    return { providerMessageId: "msg-1" };
  }
}

class FakeAlerter {
  public readonly alerts: UncertainDeliveryAlert[] = [];
  public failNextTimes = 0;
  notify = async (alert: UncertainDeliveryAlert): Promise<void> => {
    if (this.failNextTimes > 0) {
      this.failNextTimes -= 1;
      throw new Error("alert queue unavailable");
    }
    this.alerts.push(alert);
  };
}

function makeDeps(store: GuestCredentialDeliveryStore, overrides: Partial<Omit<GuestCredentialDeliveryDeps, "store">> = {}) {
  const markerStore = overrides.markerStore ?? new FakeMarkerStore();
  const emailProvider = overrides.emailProvider ?? new FakeEmailProvider();
  const notifyUncertainDelivery = overrides.notifyUncertainDelivery ?? new FakeAlerter().notify;
  let clock = "2026-01-02T00:00:00.000Z";
  const deps: GuestCredentialDeliveryDeps = {
    store,
    markerStore,
    emailProvider,
    notifyUncertainDelivery,
    guestUploadBaseUrl: "https://app.example.invalid/document-archive/guest/document-requests",
    now: () => clock,
    newCorrelationId: () => "corr-1",
    leaseDurationMs: 30_000,
    ...overrides,
  };
  return { deps, advanceClock: (ms: number) => { clock = new Date(Date.parse(clock) + ms).toISOString(); } };
}

describe("deliverGuestCredential (D-228/D-233)", () => {
  it("sends an email whose link embeds the record's raw token — the same token resolveCredential() would need to authenticate", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const emailProvider = new FakeEmailProvider();
    const { deps } = makeDeps(store, { emailProvider });
    const outcome = await deliverGuestCredential(deps, seedDelivery());

    expect(outcome.kind).toBe("SENT");
    expect(emailProvider.sent).toHaveLength(1);
    expect(emailProvider.sent[0]?.to).toBe("guest@example.com");
    const link = String(emailProvider.sent[0]?.renderContext["guestLink"]);
    expect(link).toBe(`https://app.example.invalid/document-archive/guest/document-requests/${encodeURIComponent(seedDelivery().token)}`);
  });

  it("G-V3: a duplicate Streams delivery of the SAME record after a confirmed send is a safe no-op — never sends twice", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const emailProvider = new FakeEmailProvider();
    const { deps } = makeDeps(store, { emailProvider });

    const first = await deliverGuestCredential(deps, seedDelivery());
    expect(first.kind).toBe("SENT");
    const second = await deliverGuestCredential(deps, seedDelivery());
    expect(second.kind).toBe("ALREADY_DELIVERED");
    expect(emailProvider.sent).toHaveLength(1);
  });

  it("skips (no send, no claim) when the DocumentRequest has no recipientEmail — a data gap, not a transient failure", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest({ recipientEmail: undefined }) as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const emailProvider = new FakeEmailProvider();
    const { deps } = makeDeps(store, { emailProvider });
    const outcome = await deliverGuestCredential(deps, seedDelivery());

    expect(outcome.kind).toBe("SKIPPED_NO_RECIPIENT_EMAIL");
    expect(emailProvider.sent).toHaveLength(0);
  });

  it("skips when the DocumentRequest no longer exists", async () => {
    const store = new InMemoryDocumentArchiveStore([]);
    const { deps } = makeDeps(store);
    const outcome = await deliverGuestCredential(deps, seedDelivery());
    expect(outcome.kind).toBe("SKIPPED_REQUEST_NOT_FOUND");
  });

  it("skips a stale generation — a reissuance already superseded this delivery record", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest({ issuanceGeneration: 2 }) as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const { deps } = makeDeps(store);
    const outcome = await deliverGuestCredential(deps, seedDelivery({ issuanceGeneration: 1 }));
    expect(outcome.kind).toBe("SKIPPED_STALE_GENERATION");
  });

  it("G-V3 (D-233 core fix): CONCLUSIVE_RETRYABLE send failure releases the claim, and a SUBSEQUENT redelivery actually completes the send — never permanently lost, never falsely ALREADY_DELIVERED", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const emailProvider = new FakeEmailProvider();
    emailProvider.failWith = new EmailSendError("SES throttled", "CONCLUSIVE_RETRYABLE");
    const { deps } = makeDeps(store, { emailProvider });

    const first = await deliverGuestCredential(deps, seedDelivery());
    expect(first.kind).toBe("SEND_FAILED");
    expect(emailProvider.sent).toHaveLength(0);

    // Streams redelivers the exact same record - the transient failure must NOT have
    // permanently claimed the marker.
    emailProvider.failWith = undefined;
    const second = await deliverGuestCredential(deps, seedDelivery());
    expect(second.kind).toBe("SENT");
    expect(emailProvider.sent).toHaveLength(1);
  });

  it("G-V3: AMBIGUOUS send failure never auto-resends — alerts once, and a redelivery never calls SES again", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const emailProvider = new FakeEmailProvider();
    emailProvider.failWith = new EmailSendError("timeout", "AMBIGUOUS");
    const alerter = new FakeAlerter();
    const { deps } = makeDeps(store, { emailProvider, notifyUncertainDelivery: alerter.notify });

    const first = await deliverGuestCredential(deps, seedDelivery());
    expect(first.kind).toBe("SEND_UNCERTAIN_NOT_RETRIED");
    expect(alerter.alerts).toHaveLength(1);

    const second = await deliverGuestCredential(deps, seedDelivery());
    expect(second.kind).toBe("PREVIOUSLY_UNCERTAIN");
    expect(emailProvider.sent).toHaveLength(0); // SES never called again.
    expect(alerter.alerts).toHaveLength(2); // alert re-delivered, never silent.
  });

  it("G-V3: SES accepts the send but markDelivered persistence fails — never releases the claim, never resends, always alerts", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const emailProvider = new FakeEmailProvider();
    class FailingMarkDeliveredStore extends FakeMarkerStore {
      override async markDelivered(): Promise<void> {
        throw new Error("DynamoDB unavailable");
      }
    }
    const markerStore = new FailingMarkDeliveredStore();
    const alerter = new FakeAlerter();
    const { deps } = makeDeps(store, { emailProvider, markerStore, notifyUncertainDelivery: alerter.notify });

    const outcome = await deliverGuestCredential(deps, seedDelivery());
    expect(outcome.kind).toBe("SEND_UNCERTAIN_NOT_RETRIED");
    expect(emailProvider.sent).toHaveLength(1); // the send DID go out - must never be repeated.
    expect(alerter.alerts).toHaveLength(1);

    const second = await deliverGuestCredential(deps, seedDelivery());
    expect(second.kind).toBe("PREVIOUSLY_UNCERTAIN");
    expect(emailProvider.sent).toHaveLength(1); // still only once.
  });

  it("G-V3: a concurrent/very-recent invocation is reported as retryable LEASE_ACTIVE, never as a false success", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const markerStore = new FakeMarkerStore();
    // Claim it out-of-band, simulating another in-flight invocation.
    await markerStore.claim("docreq-1", 1, "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:30.000Z");
    const emailProvider = new FakeEmailProvider();
    const { deps } = makeDeps(store, { emailProvider, markerStore });

    const outcome = await deliverGuestCredential(deps, seedDelivery());
    expect(outcome.kind).toBe("SKIPPED_LEASE_ACTIVE");
    expect(emailProvider.sent).toHaveLength(0);
  });

  it("G-V3: a lease that expires with NO observed outcome (process died mid-flight, including possibly after SES accepted) reconciles to SEND_UNCERTAIN — never a silent reclaim/resend", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const markerStore = new FakeMarkerStore();
    await markerStore.claim("docreq-1", 1, "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:30.000Z");
    const emailProvider = new FakeEmailProvider();
    const alerter = new FakeAlerter();
    const { deps, advanceClock } = makeDeps(store, { emailProvider, markerStore, notifyUncertainDelivery: alerter.notify });
    advanceClock(31_000); // past the 30s lease.

    const outcome = await deliverGuestCredential(deps, seedDelivery());
    expect(outcome.kind).toBe("PREVIOUSLY_UNCERTAIN");
    expect(emailProvider.sent).toHaveLength(0); // NEVER resent blindly after an indeterminate crash.
    expect(alerter.alerts).toHaveLength(1); // but a human is told.
  });

  it("G-V3: the alert itself surviving its own failure — a retry after a failed notifyUncertainDelivery re-delivers the alert without ever calling SES again", async () => {
    const store = new InMemoryDocumentArchiveStore([seedRequest() as unknown as Record<string, unknown> & { PK: string; SK: string }]);
    const emailProvider = new FakeEmailProvider();
    emailProvider.failWith = new EmailSendError("permanent reject", "CONCLUSIVE_TERMINAL");
    const alerter = new FakeAlerter();
    alerter.failNextTimes = 1;
    const { deps } = makeDeps(store, { emailProvider, notifyUncertainDelivery: alerter.notify });

    await expect(deliverGuestCredential(deps, seedDelivery())).rejects.toThrow("alert queue unavailable");
    expect(emailProvider.sent).toHaveLength(0);
    expect(alerter.alerts).toHaveLength(0);

    // Handler-level retry (Streams redelivery) - marker is already SEND_UNCERTAIN (markUncertain
    // persisted before the alert threw), so this retry only re-attempts the alert.
    const retried = await deliverGuestCredential(deps, seedDelivery());
    expect(retried.kind).toBe("PREVIOUSLY_UNCERTAIN");
    expect(emailProvider.sent).toHaveLength(0); // SES never called on the retry either.
    expect(alerter.alerts).toHaveLength(1); // alert eventually delivered.
  });
});
