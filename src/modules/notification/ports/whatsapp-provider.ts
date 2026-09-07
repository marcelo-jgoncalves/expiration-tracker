/**
 * WhatsAppProviderAdapter (D-2, `docs/architecture/reviews/whatsapp-channel-scoping/
 * estado-final-consolidado.md`: "mesma forma de porta de EmailProviderAdapter"). Fatia 2/5 of
 * the WhatsApp implementation program (see `decisions-log.md` D-197/D-223 and this file's
 * sibling `email-provider.ts`, which this port deliberately mirrors field-for-field so the
 * delivery workflow/worker pair can be built by direct analogy).
 *
 * Same three-way `SendError.kind` discipline as email: CONCLUSIVE_RETRYABLE/CONCLUSIVE_TERMINAL
 * (the Cloud API is certain it never accepted the request - safe to classify precisely) vs.
 * AMBIGUOUS (timeout/connection drop after the request may have reached Meta's servers - never
 * retried automatically, same at-most-once discipline `email-delivery.ts` documents). D-2 leaves
 * the EXACT Cloud API error code -> kind mapping to the implementation (this fatia) - see
 * `whatsapp-cloud-api-adapter.ts`'s `classifyFailure`.
 */
export interface WhatsAppSendInput {
  /** E.164 recipient phone number - see `shared/text/phone-e164.ts#isValidE164`. */
  to: string;
  /** D-3: templates are a pre-provisioned catalog (Meta Business Manager, outside this repo) -
   * referenced by name+language, never created/submitted via the API in this fatia. */
  templateName: string;
  templateLanguage: string;
  /** Positional template body parameters, already rendered to strings - no generic
   * `channelPayload` field, same discipline as `notification-email-deliver.v1.json`. */
  templateParams: string[];
  /** Opaque correlation tags - never PII. Carried as `biz_opaque_callback_data` on the real
   * Cloud API call so a later webhook (fatia 3, D-7) can correlate back to this attempt. */
  tags: { attemptId: string; intentId: string; tenantId: string; correlationId: string };
}

export interface WhatsAppSendResult {
  providerMessageId: string;
}

export type WhatsAppSendFailureKind = "CONCLUSIVE_RETRYABLE" | "CONCLUSIVE_TERMINAL" | "AMBIGUOUS";

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    public readonly kind: WhatsAppSendFailureKind,
  ) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

export interface WhatsAppProviderAdapter {
  send(input: WhatsAppSendInput): Promise<WhatsAppSendResult>;
}
