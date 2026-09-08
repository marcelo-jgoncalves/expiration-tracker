import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyMetaSignature,
  verifyMetaWebhookChallenge,
  parseBizOpaqueCallbackData,
  parseCloudApiWebhookEvents,
  decideWhatsAppCallbackApplication,
} from "../../../src/modules/notification/application/whatsapp-webhook-processor.js";

const APP_SECRET = "test-app-secret";

function sign(rawBody: string, appSecret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf-8").digest("hex")}`;
}

describe("verifyMetaSignature (X-Hub-Signature-256, D-7)", () => {
  it("accepts a correctly-signed body", () => {
    const rawBody = JSON.stringify({ a: 1 });
    expect(verifyMetaSignature({ rawBody, signatureHeader: sign(rawBody), appSecret: APP_SECRET })).toBe(true);
  });

  it("rejects a tampered body (signature computed over a different payload)", () => {
    const rawBody = JSON.stringify({ a: 1 });
    const tampered = JSON.stringify({ a: 2 });
    expect(verifyMetaSignature({ rawBody: tampered, signatureHeader: sign(rawBody), appSecret: APP_SECRET })).toBe(false);
  });

  it("rejects a signature computed with the wrong app secret", () => {
    const rawBody = JSON.stringify({ a: 1 });
    expect(verifyMetaSignature({ rawBody, signatureHeader: sign(rawBody, "wrong-secret"), appSecret: APP_SECRET })).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyMetaSignature({ rawBody: "{}", signatureHeader: undefined, appSecret: APP_SECRET })).toBe(false);
  });

  it("rejects a malformed header without the sha256= prefix", () => {
    expect(verifyMetaSignature({ rawBody: "{}", signatureHeader: "deadbeef", appSecret: APP_SECRET })).toBe(false);
  });

  it("rejects a digest of the wrong length (never throws on Buffer length mismatch)", () => {
    expect(verifyMetaSignature({ rawBody: "{}", signatureHeader: "sha256=abc", appSecret: APP_SECRET })).toBe(false);
  });

  it("rejects an empty string signature", () => {
    expect(verifyMetaSignature({ rawBody: "{}", signatureHeader: "", appSecret: APP_SECRET })).toBe(false);
  });
});

describe("verifyMetaWebhookChallenge (GET verification handshake)", () => {
  const expectedVerifyToken = "my-verify-token";

  it("echoes the challenge when mode=subscribe and the token matches", () => {
    const result = verifyMetaWebhookChallenge({ mode: "subscribe", verifyToken: expectedVerifyToken, challenge: "12345", expectedVerifyToken });
    expect(result).toEqual({ verified: true, challenge: "12345" });
  });

  it("rejects when the token does not match", () => {
    const result = verifyMetaWebhookChallenge({ mode: "subscribe", verifyToken: "wrong", challenge: "12345", expectedVerifyToken });
    expect(result).toEqual({ verified: false });
  });

  it("rejects when mode is not subscribe", () => {
    const result = verifyMetaWebhookChallenge({ mode: "unsubscribe", verifyToken: expectedVerifyToken, challenge: "12345", expectedVerifyToken });
    expect(result).toEqual({ verified: false });
  });

  it("rejects when challenge is missing", () => {
    const result = verifyMetaWebhookChallenge({ mode: "subscribe", verifyToken: expectedVerifyToken, challenge: undefined, expectedVerifyToken });
    expect(result).toEqual({ verified: false });
  });

  it("rejects when verifyToken is missing (never echoes on absence)", () => {
    const result = verifyMetaWebhookChallenge({ mode: "subscribe", verifyToken: undefined, challenge: "12345", expectedVerifyToken });
    expect(result).toEqual({ verified: false });
  });
});

describe("parseBizOpaqueCallbackData", () => {
  it("parses a well-formed correlation payload", () => {
    const raw = JSON.stringify({ attemptId: "a1", intentId: "i1", tenantId: "t1", correlationId: "c1" });
    expect(parseBizOpaqueCallbackData(raw)).toEqual({ attemptId: "a1", intentId: "i1", tenantId: "t1" });
  });

  it("returns undefined for missing/undefined input", () => {
    expect(parseBizOpaqueCallbackData(undefined)).toBeUndefined();
  });

  it("returns undefined for malformed JSON (never throws)", () => {
    expect(parseBizOpaqueCallbackData("not json")).toBeUndefined();
  });

  it("returns undefined when a required field is missing/wrong type", () => {
    expect(parseBizOpaqueCallbackData(JSON.stringify({ attemptId: "a1", intentId: "i1" }))).toBeUndefined();
    expect(parseBizOpaqueCallbackData(JSON.stringify({ attemptId: 1, intentId: "i1", tenantId: "t1" }))).toBeUndefined();
  });
});

describe("parseCloudApiWebhookEvents", () => {
  it("flattens a real-shaped Cloud API statuses webhook payload", () => {
    const events = parseCloudApiWebhookEvents({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-1",
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  { id: "wamid-1", status: "delivered", timestamp: "1700000000", biz_opaque_callback_data: JSON.stringify({ attemptId: "a1", intentId: "i1", tenantId: "t1" }) },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(events).toEqual([
      {
        wabaId: "waba-1",
        wamid: "wamid-1",
        statusType: "DELIVERED",
        occurredAt: new Date(1700000000 * 1000).toISOString(),
        tags: { attemptId: "a1", intentId: "i1", tenantId: "t1" },
      },
    ]);
  });

  it("skips a change whose field is not 'messages' (e.g. template-status webhook)", () => {
    const events = parseCloudApiWebhookEvents({ entry: [{ id: "waba-1", changes: [{ field: "message_template_status_update", value: {} }] }] });
    expect(events).toEqual([]);
  });

  it("skips a status entry missing id/status/timestamp, never throws", () => {
    const events = parseCloudApiWebhookEvents({ entry: [{ id: "waba-1", changes: [{ field: "messages", value: { statuses: [{ id: "wamid-1" }] } }] }] });
    expect(events).toEqual([]);
  });

  it("tags is an empty object (never undefined) when biz_opaque_callback_data is absent - UNMATCHED, not a crash", () => {
    const events = parseCloudApiWebhookEvents({
      entry: [{ id: "waba-1", changes: [{ field: "messages", value: { statuses: [{ id: "wamid-1", status: "sent", timestamp: "1700000000" }] } }] }],
    });
    expect(events[0]!.tags).toEqual({});
  });

  it("handles multiple entries/statuses in one batch", () => {
    const events = parseCloudApiWebhookEvents({
      entry: [
        { id: "waba-1", changes: [{ field: "messages", value: { statuses: [{ id: "wamid-1", status: "sent", timestamp: "1700000000" }] } }] },
        { id: "waba-2", changes: [{ field: "messages", value: { statuses: [{ id: "wamid-2", status: "failed", timestamp: "1700000001" }] } }] },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.wabaId)).toEqual(["waba-1", "waba-2"]);
  });

  it("returns [] for an empty/missing entry array", () => {
    expect(parseCloudApiWebhookEvents({})).toEqual([]);
  });
});

describe("decideWhatsAppCallbackApplication (monotonic precedence, mirrors ses-callback-processor.ts's discipline)", () => {
  it("SENT applies from SUBMITTING", () => {
    expect(decideWhatsAppCallbackApplication("SUBMITTING", "SENT")).toEqual({ apply: true, nextStatus: "ACCEPTED" });
  });

  it("DELIVERED applies from ACCEPTED", () => {
    expect(decideWhatsAppCallbackApplication("ACCEPTED", "DELIVERED")).toEqual({ apply: true, nextStatus: "DELIVERED" });
  });

  it("READ is conflated with DELIVERED - applies from ACCEPTED", () => {
    expect(decideWhatsAppCallbackApplication("ACCEPTED", "READ")).toEqual({ apply: true, nextStatus: "DELIVERED" });
  });

  it("READ is a no-op once already DELIVERED (same precedence tier, never regresses)", () => {
    expect(decideWhatsAppCallbackApplication("DELIVERED", "READ")).toEqual({ apply: false, reason: "NO_OP_NOT_HIGHER_PRECEDENCE" });
  });

  it("FAILED applies as a terminal outcome, outranking DELIVERED", () => {
    expect(decideWhatsAppCallbackApplication("DELIVERED", "FAILED")).toEqual({ apply: true, nextStatus: "FAILED_TERMINAL" });
  });

  it("a lower-precedence callback (DELIVERED after FAILED_TERMINAL) never regresses the attempt", () => {
    expect(decideWhatsAppCallbackApplication("FAILED_TERMINAL", "DELIVERED")).toEqual({ apply: false, reason: "NO_OP_NOT_HIGHER_PRECEDENCE" });
  });

  it("an unrecognized status type is never applied", () => {
    expect(decideWhatsAppCallbackApplication("ACCEPTED", "DEACTIVATED")).toEqual({ apply: false, reason: "UNRECOGNIZED_STATUS_TYPE" });
  });

  it("duplicate callback (same status twice) is an idempotent no-op", () => {
    expect(decideWhatsAppCallbackApplication("DELIVERED", "DELIVERED")).toEqual({ apply: false, reason: "NO_OP_NOT_HIGHER_PRECEDENCE" });
  });
});
