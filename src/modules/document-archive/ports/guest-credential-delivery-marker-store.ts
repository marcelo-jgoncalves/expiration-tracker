/**
 * GuestCredentialDeliveryMarkerStore — D-233 (fixes SEC-R2-02/full-audit-round2, closes the
 * claim-before-send race D-228's original `claim()` boolean left open: a transient send
 * failure permanently and silently lost a guest's credential link). Replaces the single
 * conditional-Put `claim(): Promise<boolean>` with a proportional lease-based state machine —
 * CLAIMED (leased) -> DELIVERED | SEND_UNCERTAIN — mirroring the PRINCIPLE `NotificationAttempt`
 * (`src/modules/notification/domain/notification-attempt.ts`)/`email-delivery-workflow.ts`
 * already established for this exact class of problem (at-least-once delivery with a
 * non-retryable-for-free external side effect), NOT its full 10-status entity: a guest
 * credential link is a static, harmlessly re-sendable value (unlike a paid/customer-facing
 * email attempt), so the proportional design never needs `NotificationAttempt`'s OCC/version
 * machinery — a single-attribute conditional item is enough.
 *
 * States (the `status` attribute on the SAME `PK`/`SK="DELIVERED"` row `claim()` always wrote):
 *  - absent -> `claim()` may create it (`CLAIMED`).
 *  - `CLAIMED` + `leaseExpiresAt` in the future -> another invocation is actively sending
 *    right now (or crashed very recently) - `LEASE_ACTIVE`, never claimed twice concurrently.
 *  - `CLAIMED` + `leaseExpiresAt` in the past -> `claim()` itself reconciles this to
 *    `SEND_UNCERTAIN` (see below) rather than ever reclaiming it for a fresh send: a lease that
 *    expired without an observed `markDelivered`/`releaseClaim` means the invocation died at an
 *    INDETERMINATE point, possibly after SES already accepted the message - resending
 *    automatically would risk a real duplicate. This is deliberately the ONLY path that leaves
 *    `CLAIMED`, and it never leads back to a fresh send.
 *  - `DELIVERED` -> confirmed sent, terminal, `ALREADY_DELIVERED` forever after.
 *  - `SEND_UNCERTAIN` -> a send outcome that could not be conclusively resolved as "definitely
 *    not sent" (SES `AMBIGUOUS`/`CONCLUSIVE_TERMINAL`, or `markDelivered` itself failing to
 *    persist after SES accepted) — terminal for automated resend, but NOT silent: the worker
 *    always pairs this transition with an alert (`notifyUncertainDelivery`, deliver.ts) into the
 *    existing `guest-credential-delivery-failures` queue/alarm for human follow-up.
 *
 * `releaseClaim` is the ONLY way back to a fresh claim, and only the worker itself calls it,
 * synchronously, in the SAME invocation that observed a CONCLUSIVE_RETRYABLE send failure
 * (SES definitively rejected the request before accepting it — safe to retry for real). Every
 * other exit from CLAIMED (ambiguous error, terminal error, post-accept persistence failure, or
 * silent process death) converges to SEND_UNCERTAIN, never to a second send.
 */
export type GuestCredentialDeliveryClaimResult =
  | { outcome: "CLAIMED"; claimId: string }
  | { outcome: "LEASE_ACTIVE" }
  | { outcome: "ALREADY_DELIVERED" }
  | { outcome: "PREVIOUSLY_UNCERTAIN"; failureKind: string };

export interface GuestCredentialDeliveryMarkerStore {
  /** Creates the marker as `CLAIMED` (fresh, `attribute_not_exists`), or - if it already exists
   * as `CLAIMED` with an expired lease - reconciles it to `SEND_UNCERTAIN` in the SAME call
   * (never re-claims for a new send). `leaseExpiresAt` is an ISO-8601 timestamp the caller
   * already computed (`now + leaseDurationMs`). */
  claim(documentRequestId: string, issuanceGeneration: number, now: string, leaseExpiresAt: string): Promise<GuestCredentialDeliveryClaimResult>;

  /** `CLAIMED` (matching `claimId`) -> `DELIVERED`. A condition-check failure (already
   * DELIVERED, or the claimId no longer matches - a later invocation already reconciled this
   * claim to SEND_UNCERTAIN) is swallowed as a harmless idempotent no-op, same posture as
   * `email-delivery-workflow.ts`'s `forceUpdateAttemptStatus`. */
  markDelivered(documentRequestId: string, issuanceGeneration: number, claimId: string, now: string): Promise<void>;

  /** `CLAIMED` (matching `claimId`) -> deleted entirely, permitting an immediate fresh `claim()`.
   * Called ONLY for a CONCLUSIVE_RETRYABLE send failure observed before SES could have accepted
   * the message - never after the send call itself may have crossed that boundary. */
  releaseClaim(documentRequestId: string, issuanceGeneration: number, claimId: string): Promise<void>;

  /** `CLAIMED` (matching `claimId`) -> `SEND_UNCERTAIN`. Called for every send outcome that is
   * NOT conclusively "never sent" (AMBIGUOUS, CONCLUSIVE_TERMINAL, or a `markDelivered`
   * persistence failure after SES already accepted). Idempotent: a condition-check failure
   * (already SEND_UNCERTAIN/DELIVERED, or claimId mismatch) is swallowed. */
  markUncertain(documentRequestId: string, issuanceGeneration: number, claimId: string, failureKind: string, now: string): Promise<void>;
}
