import { describe, expect, it } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { WhatsAppOptInService } from "../../../src/modules/notification/application/whatsapp-opt-in-service.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import { ValidationError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

const TENANT = "t1";
const USER = "u1";

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

describe("WhatsAppOptInService", () => {
  it("records a new opt-in", async () => {
    const store = new InMemoryNotificationStore();
    const service = new WhatsAppOptInService({ store, now: () => "2026-09-07T00:00:00.000Z" });

    const optIn = await service.recordOptIn(ctx(), "+15551234567", "USER_SETTINGS");
    expect(optIn.tenantId).toBe(TENANT);
    expect(optIn.userId).toBe(USER);
    expect(optIn.phoneE164).toBe("+15551234567");
    expect(store.allItems()).toHaveLength(1);
  });

  // G-V3: create-once idempotency - opting in twice for the SAME phone must never produce a
  // second row nor overwrite the original optedInAt with the second call's (later) timestamp.
  it("is idempotent for the same tenant/user/phone - returns the ORIGINAL record, never a second row", async () => {
    const store = new InMemoryNotificationStore();
    const service = new WhatsAppOptInService({ store, now: () => "2026-09-07T00:00:00.000Z" });

    const first = await service.recordOptIn(ctx(), "+15551234567", "USER_SETTINGS");

    const laterService = new WhatsAppOptInService({ store, now: () => "2026-09-08T00:00:00.000Z" });
    const second = await laterService.recordOptIn(ctx(), "+15551234567", "USER_SETTINGS");

    expect(second.optedInAt).toBe(first.optedInAt); // NOT the later call's timestamp
    expect(store.allItems()).toHaveLength(1);
  });

  // G-V3: a phone number change must create a DIFFERENT row, never mutate/replace the prior one.
  it("a different phone number for the same user creates a second, independent row", async () => {
    const store = new InMemoryNotificationStore();
    const service = new WhatsAppOptInService({ store, now: () => "2026-09-07T00:00:00.000Z" });

    await service.recordOptIn(ctx(), "+15551234567", "USER_SETTINGS");
    await service.recordOptIn(ctx(), "+15559999999", "USER_SETTINGS");

    expect(store.allItems()).toHaveLength(2);
  });

  it("rejects a malformed phone number before any write, and never persists a row", async () => {
    const store = new InMemoryNotificationStore();
    const service = new WhatsAppOptInService({ store, now: () => "2026-09-07T00:00:00.000Z" });

    await expect(service.recordOptIn(ctx(), "not-a-phone", "USER_SETTINGS")).rejects.toBeInstanceOf(ValidationError);
    expect(store.allItems()).toHaveLength(0);
  });

  it("enforces authorization (no membership => denied)", async () => {
    const store = new InMemoryNotificationStore();
    const service = new WhatsAppOptInService({ store, now: () => "2026-09-07T00:00:00.000Z" });

    await expect(service.recordOptIn(ctx({ tenant: { tenantId: TENANT, roles: [] } }), "+15551234567", "USER_SETTINGS")).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
    expect(store.allItems()).toHaveLength(0);
  });
});
