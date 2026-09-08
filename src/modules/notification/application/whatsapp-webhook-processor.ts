/**
 * WhatsAppWebhookHandler pure logic (D-197 fatia 3/5, D-7). Mirrors `ses-callback-processor.ts`'s
 * "pure, no AWS SDK" discipline - `whatsapp-webhook-handler.ts` (the Lambda entrypoint) owns
 * parsing the raw API Gateway event and calling `crypto`; this file is testable without either.
 *
 * `verifyMetaSignature()` implements Meta's documented X-Hub-Signature-256 scheme
 * (https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 * and #payload-verification, verified 2026-09-07): the header is `sha256=<hex>`, computed as
 * `HMAC-SHA256(appSecret, rawRequestBody)` over the EXACT bytes Meta sent (never the
 * re-serialized/parsed JSON, which can differ in whitespace/key order and silently break the
 * comparison) - callers MUST pass the raw string body, before any `JSON.parse`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NotificationAttemptStatus } from "../domain/notification-attempt.js";

const SIGNATURE_PREFIX = "sha256=";

/** Constant-time comparison of the hex digest, same `Buffer.from` + length-check + `timingSafeEqual`
 * discipline as `bff/domain/csrf.ts#safeEqual` - never a plain `===` on secret-derived material. */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Returns `false` for: missing header, malformed prefix, or a digest mismatch. NEVER throws -
 * the caller (the handler) always has a clean boolean to gate persistence on, so "verification
 * failed" and "header malformed" are handled identically (reject before any write, same as any
 * other invalid signature).
 */
export function verifyMetaSignature(input: { rawBody: string; signatureHeader: string | undefined; appSecret: string }): boolean {
  if (!input.signatureHeader || !input.signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;
  const providedDigest = input.signatureHeader.slice(SIGNATURE_PREFIX.length);
  const expectedDigest = createHmac("sha256", input.appSecret).update(input.rawBody, "utf-8").digest("hex");
  return safeEqualHex(providedDigest, expectedDigest);
}

/**
 * Meta's initial webhook-registration handshake (GET request, documented at the same URL above,
 * "Verification Requests" - verified 2026-09-07): Meta calls `GET <callback_url>?hub.mode=
 * subscribe&hub.verify_token=<token>&hub.challenge=<value>`; the endpoint must echo back
 * `hub.challenge` as a PLAIN TEXT 200 response if and only if `hub.mode === "subscribe"` AND
 * `hub.verify_token` matches the token configured in the Meta App Dashboard for this webhook -
 * any other combination must be rejected (Meta's own docs specify returning an error, not the
 * challenge) so an attacker probing the endpoint can never learn whether a guessed token is
 * correct via a successful echo.
 */
export function verifyMetaWebhookChallenge(input: {
  mode: string | undefined;
  verifyToken: string | undefined;
  challenge: string | undefined;
  expectedVerifyToken: string;
}): { verified: true; challenge: string } | { verified: false } {
  if (input.mode !== "subscribe" || !input.verifyToken || !input.challenge) return { verified: false };
  if (!safeEqualHex(input.verifyToken, input.expectedVerifyToken)) return { verified: false };
  return { verified: true, challenge: input.challenge };
}

/**
 * `biz_opaque_callback_data` round-trips the exact JSON string `whatsapp-cloud-api-adapter.ts`
 * sent on the outbound send (`{attemptId, intentId, tenantId, correlationId}`) - Meta echoes it
 * back verbatim on every status webhook for that message (D-2's own comment). Never throws on
 * malformed/missing data (an old message sent before this fatia shipped, a webhook replay with
 * corrupted data, or a message this repo never sent) - returns `undefined`, which the workflow
 * treats identically to "correlation failed" (UNMATCHED), same posture as SES's missing-tags case.
 */
export function parseBizOpaqueCallbackData(raw: string | undefined): { attemptId: string; intentId: string; tenantId: string } | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const { attemptId, intentId, tenantId } = parsed;
    if (typeof attemptId !== "string" || typeof intentId !== "string" || typeof tenantId !== "string") return undefined;
    return { attemptId, intentId, tenantId };
  } catch {
    return undefined;
  }
}

export interface WhatsAppStatusEvent {
  wabaId: string;
  wamid: string;
  statusType: string;
  occurredAt: string;
  tags: { attemptId?: string; intentId?: string; tenantId?: string };
}

interface CloudApiStatusEntryValue {
  statuses?: {
    id?: string;
    status?: string;
    timestamp?: string;
    biz_opaque_callback_data?: string;
  }[];
}

interface CloudApiWebhookChange {
  value?: CloudApiStatusEntryValue;
  field?: string;
}

interface CloudApiWebhookEntry {
  id?: string; // wabaId
  changes?: CloudApiWebhookChange[];
}

export interface CloudApiWebhookPayload {
  object?: string;
  entry?: CloudApiWebhookEntry[];
}

/** Flattens Meta's nested `entry[].changes[].value.statuses[]` shape (Cloud API webhooks docs,
 * `whatsapp_business_account` object type) into one `WhatsAppStatusEvent` per status update - a
 * single POST can carry multiple entries/statuses in one batch. Skips (never throws on) any
 * change whose `field` isn't `"messages"` (e.g. a template-status or account-review webhook this
 * repo doesn't act on yet) or whose `statuses` entry is missing `id`/`status`/`timestamp`. */
export function parseCloudApiWebhookEvents(payload: CloudApiWebhookPayload): WhatsAppStatusEvent[] {
  const events: WhatsAppStatusEvent[] = [];
  for (const entry of payload.entry ?? []) {
    const wabaId = entry.id;
    if (!wabaId) continue;
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      for (const status of change.value?.statuses ?? []) {
        if (!status.id || !status.status || !status.timestamp) continue;
        const tags = parseBizOpaqueCallbackData(status.biz_opaque_callback_data);
        events.push({
          wabaId,
          wamid: status.id,
          statusType: status.status.toUpperCase(),
          occurredAt: new Date(Number(status.timestamp) * 1000).toISOString(),
          tags: tags ?? {},
        });
      }
    }
  }
  return events;
}

/**
 * WhatsApp Cloud API status webhook statuses (`sent|delivered|read|failed`, Cloud API webhooks
 * docs) mapped onto the SAME `NotificationAttemptStatus` precedence `ses-callback-processor.ts`
 * already established, reusing its states directly rather than adding WhatsApp-only ones (implem-
 * entation-level mapping choice, same posture as D-2's own "exact error code mapping left to the
 * fatia" pendency - resolved here directly, not a Type 1 decision):
 *  - `sent`: the message left Meta's servers - the attempt is already `ACCEPTED` by the time this
 *    webhook can arrive (set synchronously by `whatsapp-delivery-workflow.ts` on a successful
 *    `send()`), so this is always a same-or-lower-precedence no-op in practice; mapped to
 *    `ACCEPTED` for correctness if it ever arrives first.
 *  - `delivered`: -> `DELIVERED`.
 *  - `read`: the Cloud API offers no read-receipt state in `NotificationAttemptStatus` today
 *    (adding one is a real product-facing modeling decision - out of scope for this fatia, which
 *    only wires the webhook plumbing) - conflated with `DELIVERED` (same precedence tier): a read
 *    receipt proves delivery already happened, so it is always at least as informative as
 *    `DELIVERED`, never a regression.
 *  - `failed`: -> `FAILED_TERMINAL` (delivery failed after acceptance - e.g. recipient
 *    uninstalled WhatsApp - a genuinely terminal, non-retryable outcome, same precedence tier as
 *    SES's `COMPLAINED`/`BOUNCED`).
 * An unrecognized status type returns `undefined` - the caller treats it as "no known target
 * status", i.e. never applied, same as SES's unmapped `Reject`/`Rendering Failure` event kinds.
 */
const CALLBACK_TARGET_STATUS: Record<string, NotificationAttemptStatus> = {
  SENT: "ACCEPTED",
  DELIVERED: "DELIVERED",
  READ: "DELIVERED",
  FAILED: "FAILED_TERMINAL",
};

const PRECEDENCE: Record<string, number> = {
  SUBMITTING: 0,
  UNKNOWN: 0,
  ACCEPTED: 1,
  DELIVERED: 2,
  FAILED_TERMINAL: 3,
};

export type WhatsAppCallbackApplication =
  | { apply: true; nextStatus: NotificationAttemptStatus }
  | { apply: false; reason: "UNRECOGNIZED_STATUS_TYPE" | "NO_OP_NOT_HIGHER_PRECEDENCE" };

/** Same monotonic-precedence discipline as `ses-callback-processor.ts#decideCallbackApplication`
 * - a callback never regresses the attempt to a lower-precedence state, duplicate/out-of-order
 * callbacks are idempotent no-ops. */
export function decideWhatsAppCallbackApplication(currentStatus: NotificationAttemptStatus, statusType: string): WhatsAppCallbackApplication {
  const targetStatus = CALLBACK_TARGET_STATUS[statusType];
  if (!targetStatus) return { apply: false, reason: "UNRECOGNIZED_STATUS_TYPE" };
  const currentRank = PRECEDENCE[currentStatus] ?? -1;
  const targetRank = PRECEDENCE[targetStatus] ?? -1;
  if (targetRank <= currentRank) return { apply: false, reason: "NO_OP_NOT_HIGHER_PRECEDENCE" };
  return { apply: true, nextStatus: targetStatus };
}
