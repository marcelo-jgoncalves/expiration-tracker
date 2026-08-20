/**
 * EmailProviderAdapter (M4, ADR-0008: "envelope comum + payload específico por canal",
 * contract-tested). Amazon SES for this milestone (sandbox/test account,
 * implementation-blueprint.md §19 M4 scope), but the port stays provider-agnostic so
 * swapping SES for another provider later doesn't touch domain/application code.
 *
 * SES gives no client-controlled idempotency key and no confirmation until it accepts the
 * request - `send` either resolves with a providerMessageId (ACCEPTED) or rejects. A
 * rejection distinguishes CONCLUSIVE (the provider is certain it never accepted the
 * request - safe to retry the same logical attempt) from AMBIGUOUS (timeout/connection
 * drop after the request may have reached the provider - never retried automatically, see
 * email-delivery.ts's SUBMITTING/UNKNOWN handling).
 */
export interface EmailSendInput {
  to: string;
  templateId: string;
  templateVersion: number;
  locale: string;
  renderContext: Record<string, unknown>;
  /** Opaque correlation tags carried on the provider call - never PII (docs/architecture/
   * reviews/m4-notification-engine-design/codex-proposal-round1.md §10.4). */
  tags: { attemptId: string; intentId: string; tenantId: string; correlationId: string };
}

export interface EmailSendResult {
  providerMessageId: string;
}

export type EmailSendFailureKind = "CONCLUSIVE_RETRYABLE" | "CONCLUSIVE_TERMINAL" | "AMBIGUOUS";

export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly kind: EmailSendFailureKind,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

export interface EmailProviderAdapter {
  send(input: EmailSendInput): Promise<EmailSendResult>;
}
