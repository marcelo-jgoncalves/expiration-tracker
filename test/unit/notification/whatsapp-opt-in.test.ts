import { describe, expect, it } from "vitest";
import { buildWhatsAppOptIn, whatsAppOptInKey } from "../../../src/modules/notification/domain/whatsapp-opt-in.js";
import { ValidationError } from "../../../src/shared/errors/app-error.js";

const NOW = "2026-09-07T00:00:00.000Z";

describe("whatsAppOptInKey", () => {
  it("embeds the phone number in SK, not just the user", () => {
    const a = whatsAppOptInKey("t1", "u1", "+15551234567");
    const b = whatsAppOptInKey("t1", "u1", "+15559999999");
    expect(a.PK).toBe("TENANT#t1#USER#u1");
    expect(a.PK).toBe(b.PK);
    expect(a.SK).not.toBe(b.SK); // G-V3: a phone change must land on a DIFFERENT key, never overwrite the old opt-in.
    expect(a.SK).toBe("WHATSAPP_OPTIN#+15551234567");
  });
});

describe("buildWhatsAppOptIn", () => {
  it("builds a well-formed entity for a valid E.164 phone", () => {
    const optIn = buildWhatsAppOptIn({ tenantId: "t1", userId: "u1", phoneE164: "+15551234567", source: "USER_SETTINGS", now: NOW });
    expect(optIn.entityType).toBe("WhatsAppOptIn");
    expect(optIn.PK).toBe("TENANT#t1#USER#u1");
    expect(optIn.SK).toBe("WHATSAPP_OPTIN#+15551234567");
    expect(optIn.optedInAt).toBe(NOW);
    expect(optIn.createdAt).toBe(NOW);
  });

  // G-V3: adversarial - a malformed phone number must never reach a build result at all,
  // never a "best effort" record with a bad phoneE164 silently persisted.
  it("throws ValidationError before constructing anything, given a malformed phone number", () => {
    expect(() => buildWhatsAppOptIn({ tenantId: "t1", userId: "u1", phoneE164: "555-1234", source: "USER_SETTINGS", now: NOW })).toThrow(
      ValidationError,
    );
    expect(() => buildWhatsAppOptIn({ tenantId: "t1", userId: "u1", phoneE164: "not-a-phone", source: "USER_SETTINGS", now: NOW })).toThrow(
      ValidationError,
    );
  });
});
