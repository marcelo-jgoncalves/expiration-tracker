/**
 * GuestCredentialDeliveryWorker — D-228 (closes D-222 Achado 1 for real), revised by D-233
 * (fixes SEC-R2-02/full-audit-round2, both Segurança and Arquitetura axes converged on the
 * same finding independently): the original `deliver.ts` claimed the delivery marker BEFORE
 * calling `emailProvider.send()` with no way back — a transient send failure (SES throttled,
 * momentarily unavailable) permanently and silently lost the guest's only credential link,
 * because a Streams retry found the marker already claimed and returned `ALREADY_DELIVERED`
 * instead of resending. Full mechanism/decision record: `docs/architecture/decisions-log.md`
 * D-233; Claude<->Codex convergence: `docs/engineering/reviews/d-233-*` (8 rounds, both ≥9.0).
 *
 * Consumes ONE `GuestCredentialDeliveryRecord` (already unmarshalled from the dedicated table's
 * own DynamoDB Streams NEW_IMAGE, INSERT only — the record is created exactly once per issuance,
 * never updated) and, if a recipient is known, emails the guest link that actually authenticates
 * via `resolveCredential()`.
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
 * Idempotency under Streams' at-least-once redelivery (G-V3 requirement), REVISED mechanism
 * (D-233): a lease-based claim, proportional variant of the same PRINCIPLE
 * `NotificationAttempt`/`email-delivery-workflow.ts` already established for this exact problem
 * class (never `NotificationAttempt`'s full OCC/version machinery — a guest link is a static,
 * harmlessly re-sendable value, unlike a customer-facing paid send).
 *  - `markerStore.claim()` returns `CLAIMED` (safe to send), `LEASE_ACTIVE` (another invocation
 *    is sending right now or died very recently — retryable, never a silent skip),
 *    `ALREADY_DELIVERED` (terminal, confirmed sent), or `PREVIOUSLY_UNCERTAIN` (a prior attempt
 *    could not conclusively rule out having sent — terminal for automated resend, alerted).
 *  - `EmailProviderAdapter`'s existing `EmailSendFailureKind` taxonomy
 *    (`CONCLUSIVE_RETRYABLE`/`CONCLUSIVE_TERMINAL`/`AMBIGUOUS`, `email-provider.ts`) decides the
 *    outcome: ONLY `CONCLUSIVE_RETRYABLE` (SES definitively rejected the request before
 *    accepting it) releases the claim for an immediate, safe automatic retry. Every other
 *    outcome (`AMBIGUOUS`, `CONCLUSIVE_TERMINAL`, or the send succeeding but `markDelivered`
 *    itself failing to persist) transitions to `SEND_UNCERTAIN` — SES may have already accepted
 *    the message, so a duplicate send would be a real, avoidable failure — paired ALWAYS with
 *    `notifyUncertainDelivery` (an alert into the existing `guest-credential-delivery-failures`
 *    queue/alarm, never silent, never carrying the raw token).
 *  - A claim whose lease expires without ANY of the above transitions (process died at an
 *    indeterminate point, including possibly after SES already accepted) is reconciled by
 *    `claim()` ITSELF into `SEND_UNCERTAIN` on the next invocation — never resent automatically.
 *
 * The raw token (`record.token`) is embedded in the email body — its ONLY appearance outside
 * the dedicated delivery table — and never logged, never written to any other row (the alert
 * payload for SEND_UNCERTAIN carries only key/metadata fields, never the token).
 */
import { EmailSendError, type EmailSendFailureKind, type EmailProviderAdapter } from "../../modules/notification/ports/email-provider.js";
import type { GuestCredentialDeliveryMarkerStore } from "../../modules/document-archive/ports/guest-credential-delivery-marker-store.js";
import { documentRequestKey, type DocumentRequest } from "../../modules/document-archive/domain/document-request.js";
import type { GuestCredentialDeliveryRecord } from "../../modules/document-archive/domain/guest-credential-delivery.js";
import { authorizedTenantIdFromPersistedEntity } from "../../modules/identity/domain/authorization.js";

export interface GuestCredentialDeliveryStore {
  get<T extends { PK: string; SK: string } = DocumentRequest & { PK: string; SK: string }>(key: { PK: string; SK: string }): Promise<T | undefined>;
}

export interface UncertainDeliveryAlert {
  documentRequestId: string;
  issuanceGeneration: number;
  failureKind: string;
  correlationId: string;
}

export interface GuestCredentialDeliveryDeps {
  store: GuestCredentialDeliveryStore;
  markerStore: GuestCredentialDeliveryMarkerStore;
  emailProvider: EmailProviderAdapter;
  /** Sends an operator-facing alert (metadata only, never the token) when a delivery could not
   * be conclusively resolved as sent or not-sent — real implementation is an SQS SendMessage
   * into the already-existing `guest-credential-delivery-failures` queue (composition root),
   * kept as an injected dependency so this worker stays AWS-SDK-free (AGENTS.md §7). */
  notifyUncertainDelivery: (alert: UncertainDeliveryAlert) => Promise<void>;
  /** Placeholder frontend base URL, same documented posture as
   * `document-chasing-dispatch/dispatch.ts`'s `guestUploadBaseUrl` (no real frontend domain
   * exists yet, D-047). */
  guestUploadBaseUrl: string;
  now: () => string;
  newCorrelationId: () => string;
  /** How long a claim is leased before an unresolved invocation is treated as died-mid-flight
   * (D-233 round 5/6: kept short — 30s default — because every OBSERVABLE outcome already
   * resolves synchronously via releaseClaim/markDelivered/markUncertain; the lease only covers
   * the residual case of a process dying with no observable outcome at all). */
  leaseDurationMs?: number;
}

export type GuestCredentialDeliveryOutcome =
  | { kind: "SENT" }
  | { kind: "ALREADY_DELIVERED" }
  | { kind: "SKIPPED_REQUEST_NOT_FOUND" }
  | { kind: "SKIPPED_STALE_GENERATION" }
  | { kind: "SKIPPED_NO_RECIPIENT_EMAIL" }
  | { kind: "SKIPPED_LEASE_ACTIVE" }
  | { kind: "SEND_FAILED"; error: string }
  | { kind: "SEND_UNCERTAIN_NOT_RETRIED"; failureKind: string }
  | { kind: "PREVIOUSLY_UNCERTAIN"; failureKind: string };

export async function deliverGuestCredential(deps: GuestCredentialDeliveryDeps, record: GuestCredentialDeliveryRecord): Promise<GuestCredentialDeliveryOutcome> {
  const request = await deps.store.get<DocumentRequest>(documentRequestKey(authorizedTenantIdFromPersistedEntity(record), record.subjectId, record.documentRequestId));
  if (!request) return { kind: "SKIPPED_REQUEST_NOT_FOUND" };
  if (request.issuanceGeneration !== record.issuanceGeneration) return { kind: "SKIPPED_STALE_GENERATION" };
  if (!request.recipientEmail) return { kind: "SKIPPED_NO_RECIPIENT_EMAIL" };

  const now = deps.now();
  const leaseExpiresAt = new Date(Date.parse(now) + (deps.leaseDurationMs ?? 30_000)).toISOString();
  const claim = await deps.markerStore.claim(record.documentRequestId, record.issuanceGeneration, now, leaseExpiresAt);
  if (claim.outcome === "ALREADY_DELIVERED") return { kind: "ALREADY_DELIVERED" };
  if (claim.outcome === "LEASE_ACTIVE") return { kind: "SKIPPED_LEASE_ACTIVE" };
  if (claim.outcome === "PREVIOUSLY_UNCERTAIN") {
    // Never call SES again - just make sure the human-facing alert actually got through.
    await deps.notifyUncertainDelivery({
      documentRequestId: record.documentRequestId,
      issuanceGeneration: record.issuanceGeneration,
      failureKind: claim.failureKind,
      correlationId: deps.newCorrelationId(),
    });
    return { kind: "PREVIOUSLY_UNCERTAIN", failureKind: claim.failureKind };
  }

  const { claimId } = claim;
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
  } catch (err) {
    const failureKind: EmailSendFailureKind = err instanceof EmailSendError ? err.kind : "AMBIGUOUS";
    if (failureKind === "CONCLUSIVE_RETRYABLE") {
      // SES definitively refused the request BEFORE accepting it - never touched the boundary,
      // safe for an immediate automatic retry.
      await deps.markerStore.releaseClaim(record.documentRequestId, record.issuanceGeneration, claimId);
      return { kind: "SEND_FAILED", error: err instanceof Error ? err.message : "SEND_FAILED" };
    }
    // AMBIGUOUS or CONCLUSIVE_TERMINAL - SES may already have accepted the message, or the
    // error is too definitive to retry blindly. Never releaseClaim, never let Streams resend.
    await transitionToUncertain(deps, record, claimId, failureKind, deps.now());
    return { kind: "SEND_UNCERTAIN_NOT_RETRIED", failureKind };
  }

  try {
    await deps.markerStore.markDelivered(record.documentRequestId, record.issuanceGeneration, claimId, deps.now());
    return { kind: "SENT" };
  } catch {
    // SES ALREADY accepted the send - a failure persisting DELIVERED is never grounds to
    // release the claim (that would risk a real duplicate send on retry). Same uncertain path.
    await transitionToUncertain(deps, record, claimId, "CONCLUSIVE_TERMINAL", deps.now());
    return { kind: "SEND_UNCERTAIN_NOT_RETRIED", failureKind: "CONCLUSIVE_TERMINAL" };
  }
}

/** Marks the claim SEND_UNCERTAIN and alerts a human, in that order — if EITHER step throws,
 * the exception propagates uncaught out of `deliverGuestCredential`, which the Lambda handler's
 * own try/catch turns into a `batchItemFailures` entry (Streams retries). On retry, `claim()`
 * finds the marker already `SEND_UNCERTAIN` (if the first step succeeded) and only the alert is
 * retried — `emailProvider.send` is never called again for this record. */
async function transitionToUncertain(
  deps: GuestCredentialDeliveryDeps,
  record: GuestCredentialDeliveryRecord,
  claimId: string,
  failureKind: string,
  now: string,
): Promise<void> {
  await deps.markerStore.markUncertain(record.documentRequestId, record.issuanceGeneration, claimId, failureKind, now);
  await deps.notifyUncertainDelivery({
    documentRequestId: record.documentRequestId,
    issuanceGeneration: record.issuanceGeneration,
    failureKind,
    correlationId: deps.newCorrelationId(),
  });
}
