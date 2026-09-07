/**
 * GuestCredentialDeliveryWorker — D-228 (closes D-222 Achado 1 for real, D-226/D-227's named
 * gap: the delivery worker itself never existed). Consumes ONE `GuestCredentialDeliveryRecord`
 * (already unmarshalled from the dedicated table's own DynamoDB Streams NEW_IMAGE, INSERT
 * only — the record is created exactly once per issuance, never updated) and, if a recipient
 * is known, emails the guest link that actually authenticates via `resolveCredential()`.
 *
 * Deliberately re-reads the authoritative `DocumentRequest` (main table) rather than trusting
 * anything beyond the record's own key fields — same discipline
 * `DocumentRequestCredentialIssuanceService.handle` already documents for the producer side.
 * Two independent staleness/eligibility guards before ever sending:
 *  - `request.issuanceGeneration !== record.issuanceGeneration`: a newer reissuance
 *    (`rejectVersion()`) has already superseded this delivery — safe no-op.
 *  - `!request.recipientEmail`: a genuine data gap (D-228 pendency — series-materialized
 *    requests carry no recipient contact yet), terminal and NOT retried; retrying can never
 *    make an absent field appear.
 *
 * Idempotency under Streams' at-least-once redelivery (G-V3 requirement): `markerStore.claim`
 * is a conditional create under the delivery record's own key — `false` means some earlier
 * invocation (this shard is ordered per-partition-key, so genuine concurrency here is not
 * expected) already claimed this exact (documentRequestId, issuanceGeneration) pair, treated
 * as `ALREADY_DELIVERED` rather than a resend. Known trade-off, same class already accepted by
 * D-226 for the producer side: claiming happens BEFORE the SES call, not after — a crash
 * between claim and send would leave a pair permanently unclaimed-but-unsent rather than
 * risking a double send on retry (this codebase already treats email delivery as
 * best-effort/at-least-once elsewhere, e.g. `document-request-service.ts`'s initial invite).
 *
 * The raw token (`record.token`) is embedded in the email body — its ONLY appearance outside
 * the dedicated delivery table — and never logged, never written to any other row.
 */
import type { EmailProviderAdapter } from "../../modules/notification/ports/email-provider.js";
import type { GuestCredentialDeliveryMarkerStore } from "../../modules/document-archive/ports/guest-credential-delivery-marker-store.js";
import { documentRequestKey, type DocumentRequest } from "../../modules/document-archive/domain/document-request.js";
import type { GuestCredentialDeliveryRecord } from "../../modules/document-archive/domain/guest-credential-delivery.js";

export interface GuestCredentialDeliveryStore {
  get<T extends { PK: string; SK: string } = DocumentRequest & { PK: string; SK: string }>(key: { PK: string; SK: string }): Promise<T | undefined>;
}

export interface GuestCredentialDeliveryDeps {
  store: GuestCredentialDeliveryStore;
  markerStore: GuestCredentialDeliveryMarkerStore;
  emailProvider: EmailProviderAdapter;
  /** Placeholder frontend base URL, same documented posture as
   * `document-chasing-dispatch/dispatch.ts`'s `guestUploadBaseUrl` (no real frontend domain
   * exists yet, D-047). */
  guestUploadBaseUrl: string;
  now: () => string;
  newCorrelationId: () => string;
}

export type GuestCredentialDeliveryOutcome =
  | { kind: "SENT" }
  | { kind: "ALREADY_DELIVERED" }
  | { kind: "SKIPPED_REQUEST_NOT_FOUND" }
  | { kind: "SKIPPED_STALE_GENERATION" }
  | { kind: "SKIPPED_NO_RECIPIENT_EMAIL" }
  | { kind: "SEND_FAILED"; error: string };

export async function deliverGuestCredential(deps: GuestCredentialDeliveryDeps, record: GuestCredentialDeliveryRecord): Promise<GuestCredentialDeliveryOutcome> {
  const request = await deps.store.get<DocumentRequest>(documentRequestKey(record.tenantId, record.subjectId, record.documentRequestId));
  if (!request) return { kind: "SKIPPED_REQUEST_NOT_FOUND" };
  if (request.issuanceGeneration !== record.issuanceGeneration) return { kind: "SKIPPED_STALE_GENERATION" };
  if (!request.recipientEmail) return { kind: "SKIPPED_NO_RECIPIENT_EMAIL" };

  const claimed = await deps.markerStore.claim(record.documentRequestId, record.issuanceGeneration, deps.now());
  if (!claimed) return { kind: "ALREADY_DELIVERED" };

  const guestLink = `${deps.guestUploadBaseUrl}?token=${encodeURIComponent(record.token)}`;
  try {
    await deps.emailProvider.send({
      to: request.recipientEmail,
      templateId: "guest-credential-delivery-invite",
      templateVersion: 1,
      locale: "pt-BR",
      renderContext: { deadlineLocal: request.deadline?.slice(0, 10), guestLink },
      tags: { attemptId: `${record.documentRequestId}#${record.issuanceGeneration}`, intentId: record.documentRequestId, tenantId: record.tenantId, correlationId: deps.newCorrelationId() },
    });
    return { kind: "SENT" };
  } catch (err) {
    return { kind: "SEND_FAILED", error: err instanceof Error ? err.message : "SEND_FAILED" };
  }
}
