/**
 * Real Meta WhatsApp Cloud API adapter for WhatsAppProviderAdapter (D-2, fatia 2/5 of
 * `docs/architecture/reviews/whatsapp-channel-scoping/estado-final-consolidado.md`). Mirrors
 * `ses-email-adapter.ts`'s structure and failure-classification discipline exactly.
 *
 * CREDENTIALS NOTE (fatia 2/5 boundary, see `decisions-log.md` D-229 and the design's D-10):
 * this fatia does NOT wire AWS Secrets Manager - that is fatia 3/5. `WhatsAppCloudApiConfig`
 * is shaped so the composition root can hand this adapter real credentials fetched from
 * Secrets Manager later WITHOUT changing this class's constructor shape or any caller's code -
 * `buildWhatsAppDeliveryDeps` (runtime/aws/composition/notification.ts) is the single seam
 * that will change (env-var-backed config -> Secrets Manager-backed config), never this file.
 * `send()` is fully implemented (real `fetch` call, real error classification) - only the
 * SOURCE of `config.accessToken` is a placeholder today (an env var, D-229), never persisted
 * or logged (`SecureLogger` redaction rules already cover unknown fields defensively, but this
 * adapter also never logs `config` itself).
 *
 * Cloud API failure taxonomy (pendência 1 of the design, resolved here): the Graph API returns
 * an HTTP error status with a JSON body `{ error: { code, type, message, error_subcode } }` -
 * see https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes. `code`
 * values below are Meta's own documented codes:
 *  - 401/'code 190' (OAuthException, expired/invalid token): CONCLUSIVE_TERMINAL - the request
 *    never reached message submission, but retrying with the same bad token will only repeat
 *    the same terminal failure.
 *  - 131056/131057 (rate limit / spam rate limit) and HTTP 429: CONCLUSIVE_RETRYABLE - the API
 *    is certain it rejected THIS request before doing anything with it.
 *  - 131026 (message undeliverable - e.g. recipient has no WhatsApp), 131047 (re-engagement /
 *    outside window), 132000-132001 (template does not exist / param mismatch), 100
 *    (invalid parameter, e.g. malformed phone): CONCLUSIVE_TERMINAL - certain, structural
 *    rejections, retrying the same input can never succeed.
 *  - Any other 4xx/5xx with a parseable error body: CONCLUSIVE_TERMINAL for 4xx (client error,
 *    the request itself is malformed for this recipient/template) and CONCLUSIVE_RETRYABLE for
 *    5xx (Meta's own infra failure, not a rejection of THIS request's content).
 *  - Network error, timeout, non-JSON response, or the fetch itself throwing: AMBIGUOUS - the
 *    request may have reached Meta and been accepted even though this Lambda never saw
 *    confirmation, same as SES's connection-drop case.
 */
import type { WhatsAppProviderAdapter, WhatsAppSendInput, WhatsAppSendResult } from "../ports/whatsapp-provider.js";
import { WhatsAppSendError, type WhatsAppSendFailureKind } from "../ports/whatsapp-provider.js";

const RETRYABLE_ERROR_CODES = new Set([131056, 131057, 4, 80007]); // rate limit / spam rate limit / app rate limit / business throughput
const TERMINAL_ERROR_CODES = new Set([190, 100, 131026, 131047, 132000, 132001, 131009]);

export interface WhatsAppCloudApiConfig {
  /** Never logged, never persisted by this adapter. Fatia 2/5 sources this from an env var
   * (D-229); fatia 3/5 replaces the SOURCE with Secrets Manager without touching this shape. */
  accessToken: string;
  phoneNumberId: string;
  /** Graph API version, e.g. "v21.0" - kept configurable so a future version bump is a config
   * change, never a code change. */
  apiVersion: string;
  /** Overridable for tests; defaults to the real Graph API host. */
  baseUrl?: string;
}

interface CloudApiErrorBody {
  error?: { code?: number; type?: string; message?: string; error_subcode?: number };
}

interface CloudApiSuccessBody {
  messages?: { id?: string }[];
}

function classifyFailure(httpStatus: number | undefined, body: CloudApiErrorBody | undefined): WhatsAppSendFailureKind {
  const code = body?.error?.code;
  if (code !== undefined) {
    if (RETRYABLE_ERROR_CODES.has(code)) return "CONCLUSIVE_RETRYABLE";
    if (TERMINAL_ERROR_CODES.has(code)) return "CONCLUSIVE_TERMINAL";
  }
  if (httpStatus !== undefined) {
    if (httpStatus === 429) return "CONCLUSIVE_RETRYABLE";
    if (httpStatus >= 500) return "CONCLUSIVE_RETRYABLE";
    if (httpStatus >= 400) return "CONCLUSIVE_TERMINAL";
  }
  // No parseable status/body (network error, timeout, malformed response) - the request may
  // have reached Meta before the failure occurred. Never assumed safe to retry.
  return "AMBIGUOUS";
}

export class WhatsAppCloudApiAdapter implements WhatsAppProviderAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: WhatsAppCloudApiConfig) {
    this.baseUrl = config.baseUrl ?? "https://graph.facebook.com";
  }

  async send(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    const url = `${this.baseUrl}/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
    // biz_opaque_callback_data round-trips through Meta's webhook delivery-status callbacks
    // (D-7, fatia 3/5) - this is the ONLY correlation mechanism the Cloud API offers, no
    // client-controlled idempotency key exists (same limitation SES has - see D-2's comment).
    const bizOpaqueCallbackData = JSON.stringify(input.tags);
    let httpStatus: number | undefined;
    let json: CloudApiSuccessBody & CloudApiErrorBody = {};
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.to,
          type: "template",
          // D-4: every message is category Utility (never Marketing) - enforced by only ever
          // sending pre-provisioned Utility templates, not by a field on this request (the
          // Cloud API infers category from the template itself, provisioned out-of-band per D-3).
          template: {
            name: input.templateName,
            language: { code: input.templateLanguage },
            components: [
              {
                type: "body",
                parameters: input.templateParams.map((text) => ({ type: "text", text })),
              },
            ],
          },
          biz_opaque_callback_data: bizOpaqueCallbackData,
        }),
      });
      httpStatus = response.status;
      try {
        json = (await response.json()) as CloudApiSuccessBody & CloudApiErrorBody;
      } catch {
        // Non-JSON body (e.g. an upstream proxy error page) - fall through to classifyFailure
        // with an empty body; httpStatus alone still drives the classification.
      }
      if (!response.ok) {
        throw new WhatsAppSendError(
          json.error?.message ?? `WhatsApp Cloud API request failed with HTTP ${httpStatus}.`,
          classifyFailure(httpStatus, json),
        );
      }
      const providerMessageId = json.messages?.[0]?.id;
      if (!providerMessageId) {
        // Cloud API contract guarantees a message id on 2xx - its absence means something
        // unexpected happened even though the HTTP call itself succeeded. Never assume
        // success OR failure.
        throw new WhatsAppSendError("WhatsApp Cloud API returned 2xx without a message id.", "AMBIGUOUS");
      }
      return { providerMessageId };
    } catch (err) {
      if (err instanceof WhatsAppSendError) throw err;
      // fetch() itself threw (network error/timeout/DNS/abort) - the request may have reached
      // Meta before the failure. Never assumed safe to retry.
      throw new WhatsAppSendError(err instanceof Error ? err.message : "WhatsApp Cloud API send failed.", "AMBIGUOUS");
    }
  }
}
