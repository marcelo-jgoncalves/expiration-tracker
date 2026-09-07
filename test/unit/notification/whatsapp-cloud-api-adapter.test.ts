import { describe, expect, it, afterEach, vi } from "vitest";
import { WhatsAppCloudApiAdapter } from "../../../src/modules/notification/providers/whatsapp-cloud-api-adapter.js";
import { WhatsAppSendError } from "../../../src/modules/notification/ports/whatsapp-provider.js";

const INPUT = {
  to: "+15551234567",
  templateName: "expiration_reminder",
  templateLanguage: "pt_BR",
  templateParams: ["Passport", "2026-12-01"],
  tags: { attemptId: "a1", intentId: "i1", tenantId: "t1", correlationId: "c1" },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("WhatsAppCloudApiAdapter (D-2, adversarial error-classification coverage)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function adapter(): WhatsAppCloudApiAdapter {
    return new WhatsAppCloudApiAdapter({ accessToken: "token", phoneNumberId: "pn1", apiVersion: "v21.0" });
  }

  it("2xx with a message id -> resolves with providerMessageId", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { messages: [{ id: "wamid.ABC" }] }));
    const result = await adapter().send(INPUT);
    expect(result).toEqual({ providerMessageId: "wamid.ABC" });
  });

  it("2xx WITHOUT a message id -> AMBIGUOUS (never assumes success or failure)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    await expect(adapter().send(INPUT)).rejects.toMatchObject({ kind: "AMBIGUOUS" });
  });

  it("HTTP 401 with error code 190 (expired/invalid token) -> CONCLUSIVE_TERMINAL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 190, message: "Invalid OAuth access token" } }));
    await expect(adapter().send(INPUT)).rejects.toMatchObject({ kind: "CONCLUSIVE_TERMINAL" });
  });

  it("HTTP 400 with error code 131026 (message undeliverable) -> CONCLUSIVE_TERMINAL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(400, { error: { code: 131026, message: "Message undeliverable" } }));
    await expect(adapter().send(INPUT)).rejects.toMatchObject({ kind: "CONCLUSIVE_TERMINAL" });
  });

  it("HTTP 400 with error code 132001 (template does not exist) -> CONCLUSIVE_TERMINAL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(400, { error: { code: 132001, message: "Template does not exist" } }));
    await expect(adapter().send(INPUT)).rejects.toMatchObject({ kind: "CONCLUSIVE_TERMINAL" });
  });

  it("HTTP 429 with error code 131056 (rate limit hit) -> CONCLUSIVE_RETRYABLE", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(429, { error: { code: 131056, message: "Rate limit hit" } }));
    await expect(adapter().send(INPUT)).rejects.toMatchObject({ kind: "CONCLUSIVE_RETRYABLE" });
  });

  it("HTTP 429 with NO parseable error code -> CONCLUSIVE_RETRYABLE via httpStatus alone", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(429, {}));
    await expect(adapter().send(INPUT)).rejects.toMatchObject({ kind: "CONCLUSIVE_RETRYABLE" });
  });

  it("HTTP 500 (Meta infra failure, not a rejection of this request's content) -> CONCLUSIVE_RETRYABLE", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(500, { error: { message: "Internal server error" } }));
    await expect(adapter().send(INPUT)).rejects.toMatchObject({ kind: "CONCLUSIVE_RETRYABLE" });
  });

  it("HTTP 400 with an unrecognized error code -> falls back to CONCLUSIVE_TERMINAL via httpStatus (client error)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(400, { error: { code: 999999, message: "Some new client error" } }));
    await expect(adapter().send(INPUT)).rejects.toMatchObject({ kind: "CONCLUSIVE_TERMINAL" });
  });

  it("non-JSON error body -> classification still falls back to httpStatus, never crashes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    await expect(adapter().send(INPUT)).rejects.toMatchObject({ kind: "CONCLUSIVE_RETRYABLE" });
  });

  it("fetch() itself throws (network error/timeout/DNS) -> AMBIGUOUS, the request may have reached Meta", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    await expect(adapter().send(INPUT)).rejects.toMatchObject({ kind: "AMBIGUOUS" });
  });

  it("re-throws a WhatsAppSendError raised internally without re-wrapping it (kind preserved)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    try {
      await adapter().send(INPUT);
      throw new Error("expected send() to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(WhatsAppSendError);
    }
  });

  it("sends the request to the correct Cloud API URL with the Bearer token and template payload shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { messages: [{ id: "wamid.X" }] }));
    globalThis.fetch = fetchMock;
    await adapter().send(INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/pn1/messages");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token");
    const body = JSON.parse(init.body as string);
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.to).toBe(INPUT.to);
    expect(body.template.name).toBe(INPUT.templateName);
    expect(body.template.language.code).toBe(INPUT.templateLanguage);
    expect(body.template.components[0].parameters).toEqual([{ type: "text", text: "Passport" }, { type: "text", text: "2026-12-01" }]);
    expect(JSON.parse(body.biz_opaque_callback_data)).toEqual(INPUT.tags);
  });
});
