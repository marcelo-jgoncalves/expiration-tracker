/**
 * Real Amazon SES adapter for EmailProviderAdapter (M4). SES sandbox/test account for this
 * milestone (implementation-blueprint.md §19 M4 scope: "provider sandbox/test account").
 *
 * Classifies SDK failures into the three EmailSendFailureKind buckets the delivery
 * workflow needs (docs/architecture/reviews/m4-notification-engine-design/
 * codex-proposal-round1.md §10.3): CONCLUSIVE failures are ones SES rejects synchronously,
 * BEFORE accepting the request (invalid recipient, throttling, message rejected) - safe to
 * treat as retryable or terminal. Anything that looks like a network/timeout/unknown error
 * is AMBIGUOUS by default (never assumed safe to retry) - the request may have reached SES
 * and been accepted even though this Lambda never saw the confirmation.
 */
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { EmailProviderAdapter, EmailSendInput, EmailSendResult } from "../ports/email-provider.js";
import { EmailSendError, type EmailSendFailureKind } from "../ports/email-provider.js";

const RETRYABLE_SDK_ERROR_NAMES = new Set(["ThrottlingException", "TooManyRequestsException", "LimitExceededException"]);
const TERMINAL_SDK_ERROR_NAMES = new Set([
  "MessageRejected",
  "MailFromDomainNotVerifiedException",
  "AccountSuspendedException",
  "SendingPausedException",
  "ValidationException",
]);

function classifyFailure(err: unknown): EmailSendFailureKind {
  const name = typeof err === "object" && err !== null && "name" in err ? String((err as { name?: unknown }).name) : undefined;
  if (name && RETRYABLE_SDK_ERROR_NAMES.has(name)) return "CONCLUSIVE_RETRYABLE";
  if (name && TERMINAL_SDK_ERROR_NAMES.has(name)) return "CONCLUSIVE_TERMINAL";
  // Unknown/network/timeout error - SES may have accepted the request before the failure
  // occurred (e.g. response lost after the request reached the service). Never assumed safe.
  return "AMBIGUOUS";
}

export class SesEmailAdapter implements EmailProviderAdapter {
  constructor(
    private readonly client: SESv2Client,
    private readonly fromAddress: string,
    private readonly configurationSetName: string,
  ) {}

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const { subject, html, text } = renderPlaceholder(input);
    try {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.fromAddress,
          ConfigurationSetName: this.configurationSetName,
          Destination: { ToAddresses: [input.to] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: "UTF-8" },
              Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: text, Charset: "UTF-8" } },
            },
          },
          EmailTags: [
            { Name: "et_attempt_id", Value: input.tags.attemptId },
            { Name: "et_intent_id", Value: input.tags.intentId },
            { Name: "et_tenant_id", Value: input.tags.tenantId },
            { Name: "et_correlation_id", Value: input.tags.correlationId },
          ],
        }),
      );
      if (!result.MessageId) {
        // SES contract guarantees a MessageId on success - its absence means something
        // unexpected happened even though the SDK call itself didn't throw. Treat as
        // ambiguous, never assume failure OR success.
        throw new EmailSendError("SES SendEmail succeeded without a MessageId.", "AMBIGUOUS");
      }
      return { providerMessageId: result.MessageId };
    } catch (err) {
      if (err instanceof EmailSendError) throw err;
      throw new EmailSendError(err instanceof Error ? err.message : "SES SendEmail failed.", classifyFailure(err));
    }
  }
}

/** Placeholder rendering - M4's real template rendering (locale-aware, versioned artifact
 * per templateId+templateVersion, docs/architecture/reviews/m4-notification-engine-design/
 * codex-proposal-round1.md §9.2) is a follow-up; this keeps the adapter itself free of
 * template-selection logic (that belongs in the workflow's `renderTemplate` dependency, not
 * here) while still producing a valid SES request shape end-to-end for the sandbox spike. */
function renderPlaceholder(input: EmailSendInput): { subject: string; html: string; text: string } {
  const name = (input.renderContext["itemDisplayName"] as string | undefined) ?? "seu item";
  const dueDate = (input.renderContext["dueDateLocal"] as string | undefined) ?? "";
  const subject = `Lembrete de vencimento: ${name}`;
  const text = `O item "${name}" vence em ${dueDate}.`;
  const html = `<p>O item <strong>${name}</strong> vence em ${dueDate}.</p>`;
  return { subject, html, text };
}

export function createSesClient(): SESv2Client {
  return new SESv2Client({});
}
