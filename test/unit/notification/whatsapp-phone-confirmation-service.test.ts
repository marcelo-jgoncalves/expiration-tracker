import { describe, expect, it } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { WhatsAppOptInService } from "../../../src/modules/notification/application/whatsapp-opt-in-service.js";
import { WhatsAppPhoneConfirmationService } from "../../../src/modules/notification/application/whatsapp-phone-confirmation-service.js";
import { whatsAppPhoneConfirmationKey, type WhatsAppPhoneConfirmation } from "../../../src/modules/notification/domain/whatsapp-phone-confirmation.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import { ValidationError, DependencyUnavailableError } from "../../../src/shared/errors/app-error.js";
import type { WhatsAppProviderAdapter, WhatsAppSendInput } from "../../../src/modules/notification/ports/whatsapp-provider.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

const TENANT = "t1";
const USER = "u1";
const PHONE = "+15551234567";
const PEPPER = "test-pepper";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: USER, cognitoSubject: "sub-u1", sessionId: "s1" },
    tenant: { tenantId: TENANT, roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

class FakeWhatsAppProvider implements WhatsAppProviderAdapter {
  sent: WhatsAppSendInput[] = [];
  shouldFail = false;

  async send(input: WhatsAppSendInput) {
    if (this.shouldFail) throw new Error("simulated send failure");
    this.sent.push(input);
    return { providerMessageId: "msg-1" };
  }
}

function buildService(overrides: { now?: () => string; enabled?: boolean; provider?: FakeWhatsAppProvider } = {}) {
  const store = new InMemoryNotificationStore();
  const whatsAppOptIn = new WhatsAppOptInService({ store, now: overrides.now ?? (() => "2026-09-23T00:00:00.000Z") });
  const provider = overrides.provider ?? new FakeWhatsAppProvider();
  const service = new WhatsAppPhoneConfirmationService({
    store,
    whatsAppOptIn,
    whatsAppProvider: provider,
    pepper: PEPPER,
    isWhatsAppChannelEnabled: async () => overrides.enabled ?? true,
    now: overrides.now ?? (() => "2026-09-23T00:00:00.000Z"),
    newId: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  });
  return { service, store, provider, whatsAppOptIn };
}

async function extractSentCode(store: InMemoryNotificationStore, provider: FakeWhatsAppProvider): Promise<string> {
  void store;
  return provider.sent[provider.sent.length - 1]!.templateParams[0]!;
}

describe("WhatsAppPhoneConfirmationService.requestConfirmation", () => {
  it("sends a code over WhatsApp and persists only its hash", async () => {
    const { service, store, provider } = buildService();
    const result = await service.requestConfirmation(ctx(), PHONE);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.to).toBe(PHONE);
    expect(result.expiresAt).toBeTruthy();

    const record = await store.get<WhatsAppPhoneConfirmation>(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE));
    expect(record).toBeDefined();
    expect(record!.codeHash).not.toBe(provider.sent[0]!.templateParams[0]);
  });

  it("rejects while the WhatsApp channel flag is disabled, never attempting a send", async () => {
    const { service, provider } = buildService({ enabled: false });
    await expect(service.requestConfirmation(ctx(), PHONE)).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(provider.sent).toHaveLength(0);
  });

  it("enforces a resend cooldown for the same tenant/user/phone", async () => {
    const { service } = buildService();
    await service.requestConfirmation(ctx(), PHONE);
    await expect(service.requestConfirmation(ctx(), PHONE)).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows a fresh request once the cooldown has passed", async () => {
    let now = "2026-09-23T00:00:00.000Z";
    const { service, provider } = buildService({ now: () => now });
    await service.requestConfirmation(ctx(), PHONE);
    now = new Date(Date.parse(now) + 61_000).toISOString();
    await service.requestConfirmation(ctx(), PHONE);
    expect(provider.sent).toHaveLength(2);
  });

  it("wraps a provider send failure as DependencyUnavailableError, never persisting a record", async () => {
    const provider = new FakeWhatsAppProvider();
    provider.shouldFail = true;
    const { service, store } = buildService({ provider });
    await expect(service.requestConfirmation(ctx(), PHONE)).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(await store.get(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE))).toBeUndefined();
  });

  it("enforces authorization (no membership => denied)", async () => {
    const { service } = buildService();
    await expect(service.requestConfirmation(ctx({ tenant: { tenantId: TENANT, roles: [] } }), PHONE)).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });
});

describe("WhatsAppPhoneConfirmationService.confirmPhone", () => {
  it("records the opt-in only after the correct code is provided", async () => {
    const { service, store, provider, whatsAppOptIn } = buildService();
    await service.requestConfirmation(ctx(), PHONE);
    const code = await extractSentCode(store, provider);

    const optIn = await service.confirmPhone(ctx(), PHONE, code);
    expect(optIn.phoneE164).toBe(PHONE);
    expect(optIn.source).toBe("USER_SETTINGS");

    // recordOptIn's own create-once semantics still hold - a second confirmPhone call is idempotent.
    const again = await service.confirmPhone(ctx(), PHONE, code);
    expect(again.optedInAt).toBe(optIn.optedInAt);
    void whatsAppOptIn;
  });

  it("rejects an unknown/never-requested phone", async () => {
    const { service } = buildService();
    await expect(service.confirmPhone(ctx(), PHONE, "123456")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a wrong code without recording an opt-in, and increments attemptCount", async () => {
    const { service, store } = buildService();
    await service.requestConfirmation(ctx(), PHONE);

    await expect(service.confirmPhone(ctx(), PHONE, "000000")).rejects.toBeInstanceOf(ValidationError);
    const record = await store.get<WhatsAppPhoneConfirmation>(whatsAppPhoneConfirmationKey(TENANT, USER, PHONE));
    expect(record!.attemptCount).toBe(1);
    expect(record!.confirmedAt).toBeUndefined();
  });

  it("rejects an expired code even if correct", async () => {
    let now = "2026-09-23T00:00:00.000Z";
    const { service, store, provider } = buildService({ now: () => now });
    await service.requestConfirmation(ctx(), PHONE);
    const code = await extractSentCode(store, provider);

    now = new Date(Date.parse(now) + 11 * 60 * 1000).toISOString(); // past the 10-minute TTL
    await expect(service.confirmPhone(ctx(), PHONE, code)).rejects.toBeInstanceOf(ValidationError);
  });

  it("locks out further attempts after the max wrong-guess count, even with the correct code", async () => {
    const { service, store, provider } = buildService();
    await service.requestConfirmation(ctx(), PHONE);
    const code = await extractSentCode(store, provider);

    for (let i = 0; i < 5; i++) {
      await expect(service.confirmPhone(ctx(), PHONE, "000000")).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(service.confirmPhone(ctx(), PHONE, code)).rejects.toBeInstanceOf(ValidationError);
  });
});
